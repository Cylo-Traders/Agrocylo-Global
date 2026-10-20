import { Router, type Request, type Response } from 'express';
import { prisma } from '../db/client.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { problemDetail } from '../middleware/errors.js';
import {
  getCachedResponse,
  setCachedResponse,
} from '../middleware/idempotency.js';
import { writeLimiter } from '../middleware/rateLimit.js';
import {
  jsonValidated,
  validateParams,
  validateResponse,
} from '../middleware/validate.js';
import { requireWallet, type WalletRequest } from '../middleware/walletAuth.js';
import {
  GroupOrderIdParamSchema,
  GroupOrderListSchema,
  JoinGroupOrderBodySchema,
  JoinGroupOrderResponseSchema,
  type GroupOrderDto,
} from '../schemas/groupOrder.js';
import { broadcast } from '../services/wsServer.js';

const router = Router();

interface GroupOrderRow {
  id: string;
  productId?: string | null;
  productName: string;
  currentQuantity: number;
  targetQuantity: number;
  pricePerUnit: number;
  expiresAt: Date | string;
  status: 'open' | 'expired' | 'completed';
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

function resolveEffectiveStatus(
  row: GroupOrderRow,
  nowMs: number = Date.now(),
): 'open' | 'expired' | 'completed' {
  if (row.status === 'completed' || row.currentQuantity >= row.targetQuantity) {
    return 'completed';
  }
  const expiresMs =
    row.expiresAt instanceof Date
      ? row.expiresAt.getTime()
      : Date.parse(String(row.expiresAt));
  if (row.status === 'expired' || (Number.isFinite(expiresMs) && expiresMs <= nowMs)) {
    return 'expired';
  }
  return 'open';
}

function toGroupOrderDto(row: GroupOrderRow, nowMs: number = Date.now()): GroupOrderDto {
  const expiresAtIso =
    row.expiresAt instanceof Date ? row.expiresAt.toISOString() : String(row.expiresAt);
  const createdAtIso =
    row.createdAt instanceof Date
      ? row.createdAt.toISOString()
      : typeof row.createdAt === 'string'
        ? row.createdAt
        : undefined;
  const updatedAtIso =
    row.updatedAt instanceof Date
      ? row.updatedAt.toISOString()
      : typeof row.updatedAt === 'string'
        ? row.updatedAt
        : undefined;

  return {
    id: row.id,
    productId: row.productId ?? null,
    productName: row.productName,
    currentQuantity: row.currentQuantity,
    targetQuantity: row.targetQuantity,
    pricePerUnit: row.pricePerUnit,
    expiresAt: expiresAtIso,
    status: resolveEffectiveStatus(row, nowMs),
    ...(createdAtIso ? { createdAt: createdAtIso } : {}),
    ...(updatedAtIso ? { updatedAt: updatedAtIso } : {}),
  };
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'P2002'
  );
}

/**
 * GET /group-orders — List active and historical group-buy pools (#1257).
 */
router.get(
  '/group-orders',
  validateResponse(GroupOrderListSchema),
  asyncHandler(async (_req: Request, res: Response) => {
    const orders = await prisma.groupOrder.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const nowMs = Date.now();
    const payload = orders.map((order) => toGroupOrderDto(order as GroupOrderRow, nowMs));
    jsonValidated(res, GroupOrderListSchema, 200, payload);
  }),
);

/**
 * POST /group-orders/:id/join — Authenticated, idempotent, concurrency-safe pool join (#1257).
 */
router.post(
  '/group-orders/:id/join',
  requireWallet,
  writeLimiter,
  validateParams(GroupOrderIdParamSchema),
  validateResponse(JoinGroupOrderResponseSchema),
  asyncHandler(async (req: WalletRequest, res: Response) => {
    const walletAddress = req.walletAddress!;
    const groupOrderId = req.params.id!;

    const parsedBody = JoinGroupOrderBodySchema.safeParse(req.body);
    if (!parsedBody.success) {
      problemDetail(
        res,
        req,
        400,
        'Invalid Join Request',
        parsedBody.error.issues[0]?.message ?? 'quantity must be a positive integer',
      );
      return;
    }

    const quantity = parsedBody.data?.quantity ?? 1;
    const rawIdempotencyKey = req.header('x-idempotency-key')?.trim();
    const scopedCacheKey = rawIdempotencyKey
      ? `group-orders:join:${groupOrderId}:${walletAddress}:${rawIdempotencyKey}`
      : null;

    if (scopedCacheKey) {
      const cached = await getCachedResponse(scopedCacheKey);
      if (cached) {
        res.status(cached.status).json(cached.body);
        return;
      }
    }

    const runTx = async (tx: typeof prisma) => {
      const existingOrder = await tx.groupOrder.findUnique({
        where: { id: groupOrderId },
      });

      if (!existingOrder) {
        return { kind: 'not_found' as const };
      }

      // Check participant record first so a duplicate retry from the same wallet
      // remains idempotent even if that wallet's previous join completed the pool.
      const existingParticipant = await tx.groupOrderParticipant.findUnique({
        where: {
          groupOrderId_walletAddress: {
            groupOrderId,
            walletAddress,
          },
        },
      });

      if (existingParticipant) {
        return {
          kind: 'idempotent' as const,
          order: existingOrder as GroupOrderRow,
        };
      }

      const effectiveStatus = resolveEffectiveStatus(existingOrder as GroupOrderRow);
      if (effectiveStatus === 'expired') {
        return { kind: 'expired' as const };
      }
      if (effectiveStatus === 'completed') {
        return { kind: 'completed' as const };
      }

      if (existingOrder.currentQuantity + quantity > existingOrder.targetQuantity) {
        return {
          kind: 'exceeds_target' as const,
          remaining: Math.max(0, existingOrder.targetQuantity - existingOrder.currentQuantity),
        };
      }

      try {
        await tx.groupOrderParticipant.create({
          data: {
            groupOrderId,
            walletAddress,
            quantity,
          },
        });
      } catch (err) {
        if (isUniqueConstraintError(err)) {
          const latestOrder =
            (await tx.groupOrder.findUnique({ where: { id: groupOrderId } })) ??
            existingOrder;
          return {
            kind: 'idempotent' as const,
            order: latestOrder as GroupOrderRow,
          };
        }
        throw err;
      }

      const nextQuantity = existingOrder.currentQuantity + quantity;
      const nextStatus: 'open' | 'completed' =
        nextQuantity >= existingOrder.targetQuantity ? 'completed' : 'open';

      const updatedOrder = await tx.groupOrder.update({
        where: { id: groupOrderId },
        data: {
          currentQuantity: { increment: quantity },
          status: nextStatus,
        },
      });

      return {
        kind: 'joined' as const,
        order: updatedOrder as GroupOrderRow,
      };
    };

    const result =
      typeof prisma.$transaction === 'function'
        ? await prisma.$transaction(async (tx) => runTx(tx as typeof prisma))
        : await runTx(prisma);

    if (result.kind === 'not_found') {
      problemDetail(
        res,
        req,
        404,
        'Group Order Not Found',
        `No group order with id ${groupOrderId}`,
      );
      return;
    }

    if (result.kind === 'expired') {
      problemDetail(
        res,
        req,
        409,
        'Group Order Expired',
        'This group order has expired and is no longer accepting participants.',
      );
      return;
    }

    if (result.kind === 'completed') {
      problemDetail(
        res,
        req,
        409,
        'Group Order Completed',
        'This group order has already reached its target quantity.',
      );
      return;
    }

    if (result.kind === 'exceeds_target') {
      problemDetail(
        res,
        req,
        409,
        'Quantity Exceeds Remaining Pool Capacity',
        `Requested quantity (${quantity}) exceeds remaining capacity (${result.remaining}).`,
      );
      return;
    }

    const dto = toGroupOrderDto(result.order);
    const responseBody = {
      ...dto,
      joined: true,
      idempotentReplay: result.kind === 'idempotent',
    };

    if (scopedCacheKey) {
      await setCachedResponse(scopedCacheKey, 200, responseBody);
    }

    if (result.kind === 'joined') {
      broadcast('group_order.updated', {
        orderId: dto.id,
        currentQuantity: dto.currentQuantity,
        targetQuantity: dto.targetQuantity,
        status: dto.status,
      });
    }

    jsonValidated(res, JoinGroupOrderResponseSchema, 200, responseBody);
  }),
);

export default router;
