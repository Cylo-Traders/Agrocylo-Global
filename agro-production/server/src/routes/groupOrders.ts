/**
 * Issue #1257: the production client's `/group-orders` page already
 * calls `GET /api/group-orders` and `POST /api/group-orders/:id/join`,
 * but neither route existed on the server. This module implements the
 * promised surface:
 *
 * - `GET /group-orders` lists currently-open group orders, newest
 *   first. The endpoint is public (the client's list page does not
 *   authenticate the read), with a bounded page size.
 * - `POST /group-orders/:id/join` adds the authenticated wallet to a
 *   group order. The server advances `currentQuantity` and marks the
 *   order `COMPLETED` once the target is hit. Join is idempotent and
 *   concurrency-safe because the (groupOrderId, participantAddress)
 *   unique index collapses two concurrent joins by the same wallet
 *   to one row; the quantity bump and the status transition happen
 *   in the same database transaction, so a race cannot double-advance.
 *
 * After a successful join the server emits a versioned
 * `group_order.updated` WebSocket event with the new quantity so the
 * live progress bar on the list page updates without a refetch.
 */

import { Router, type Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import {
  jsonValidated,
  validateParams,
  validateResponse,
} from '../middleware/validate.js';
import { problemDetail } from '../middleware/errors.js';
import { writeLimiter } from '../middleware/rateLimit.js';
import { requireWallet, type WalletRequest } from '../middleware/walletAuth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { broadcast } from '../services/wsServer.js';
import {
  GroupOrderSchema,
  JoinGroupOrderParamsSchema,
  JoinGroupOrderResponseSchema,
} from '../schemas/groupOrder.js';

const router = Router();

const LIST_LIMIT = 100;

// GET /group-orders — list open group orders
router.get(
  '/group-orders',
  validateResponse(z.array(GroupOrderSchema)),
  asyncHandler(async (_req: WalletRequest, res: Response) => {
    const orders = await prisma.groupOrder.findMany({
      where: { status: 'OPEN' },
      orderBy: { createdAt: 'desc' },
      take: LIST_LIMIT,
    });
    jsonValidated(res, z.array(GroupOrderSchema), 200, orders);
  }),
);

// POST /group-orders/:id/join — authenticated, idempotent join
router.post(
  '/group-orders/:id/join',
  requireWallet,
  writeLimiter,
  validateParams(JoinGroupOrderParamsSchema),
  validateResponse(JoinGroupOrderResponseSchema),
  asyncHandler(async (req: WalletRequest, res: Response) => {
    const walletAddress = req.walletAddress!;
    const { id } = req.params;

    try {
      // One transaction. The unique index on
      // (groupOrderId, participantAddress) collapses a duplicate join
      // into a P2002 (unique violation), which we translate into a
      // pass-through 200 with `joined: false` and the current quantity
      // snapshot. That is the documented idempotency behaviour.
      const result = await prisma.$transaction(async (tx) => {
        const order = await tx.groupOrder.findUnique({ where: { id } });
        if (!order) {
          return { kind: 'not-found' as const };
        }
        if (order.status !== 'OPEN') {
          return { kind: 'closed' as const, order };
        }
        if (new Date(order.expiresAt) <= new Date()) {
          // Expired orders stay "OPEN" until a sweep moves them;
          // treat them as closed for the join path.
          return { kind: 'expired' as const, order };
        }

        await tx.groupOrderParticipant.create({
          data: {
            groupOrderId: id,
            participantAddress: walletAddress,
            quantity: 1,
          },
        });

        const nextQuantity = order.currentQuantity + 1;
        const nextStatus =
          nextQuantity >= order.targetQuantity ? 'COMPLETED' : 'OPEN';
        const updated = await tx.groupOrder.update({
          where: { id },
          data: {
            currentQuantity: nextQuantity,
            status: nextStatus,
          },
        });
        return { kind: 'joined' as const, order: updated };
      });

      if (result.kind === 'not-found') {
        problemDetail(
          res,
          req,
          404,
          'Group Order Not Found',
          `No group order with id ${id}`,
        );
        return;
      }
      if (result.kind === 'closed' || result.kind === 'expired') {
        problemDetail(
          res,
          req,
          409,
          'Conflict',
          result.kind === 'expired'
            ? 'This group order has expired'
            : 'This group order is no longer open',
        );
        return;
      }

      // Successful join: emit the versioned WS event so the live
      // progress bar on the list page updates for every connected
      // client. The envelope is produced by WsServer.broadcast as a
      // v1 event; the module-level helper is a no-op when no server
      // is attached, so this call is safe to make from a route tested
      // against a stub server.
      broadcast('group_order.updated', {
        orderId: result.order.id,
        currentQuantity: result.order.currentQuantity,
      });

      jsonValidated(res, JoinGroupOrderResponseSchema, 200, {
        ...result.order,
        joined: true,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // Duplicate join by the same wallet. Return the current state
        // with joined=false so the client sees the request succeeded
        // and does not retry.
        const current = await prisma.groupOrder.findUnique({ where: { id } });
        if (!current) {
          problemDetail(
            res,
            req,
            404,
            'Group Order Not Found',
            `No group order with id ${id}`,
          );
          return;
        }
        jsonValidated(res, JoinGroupOrderResponseSchema, 200, {
          ...current,
          joined: false,
        });
        return;
      }
      throw error;
    }
  }),
);

export default router;
