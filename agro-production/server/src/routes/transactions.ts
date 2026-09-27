import { Router, type Request, type Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db/client.js';
import {
  jsonValidated,
  validateBody,
  validateParams,
} from '../middleware/validate.js';
import { requireWallet, type WalletRequest } from '../middleware/walletAuth.js';
import { writeLimiter } from '../middleware/rateLimit.js';
import { problemDetail } from '../middleware/errors.js';
import {
  TransactionIntentCreateSchema,
  TransactionRequestIdParamSchema,
  TransactionStatusResponseSchema,
  TransactionStatusUpdateSchema,
  TransactionReconciliationResponseSchema,
} from '../schemas/transaction.js';
import type { TransactionStatus } from '../schemas/transaction.js';
import { broadcastTo } from '../services/wsServer.js';
import { reconcileTransaction } from '../services/transactionReconciler.js';

const router = Router();

const VALID_TRANSITIONS: Record<
  TransactionStatus,
  readonly TransactionStatus[]
> = {
  awaiting_signature: ['submitted', 'failed'],
  submitted: ['confirmed', 'failed'],
  confirmed: ['indexed', 'failed'],
  indexed: [],
  failed: [],
};

function txToResponse(
  tx: {
    id: string;
    txHash: string | null;
    walletAddress: string | null;
    status: string;
    eventType: string;
    campaignId: string | null;
    ledger: number;
    processedAt: Date;
  },
  fallbackWallet?: string,
) {
  return {
    requestId: tx.id,
    txHash: tx.txHash ?? '',
    walletAddress: tx.walletAddress ?? fallbackWallet ?? '',
    status: tx.status as TransactionStatus,
    eventType: tx.eventType,
    campaignId: tx.campaignId,
    ledger: tx.ledger || undefined,
    createdAt: tx.processedAt.toISOString(),
    updatedAt: tx.processedAt.toISOString(),
  };
}

router.post(
  '/transactions',
  requireWallet,
  writeLimiter,
  validateBody(TransactionIntentCreateSchema),
  async (req: WalletRequest, res: Response) => {
    const { requestId, txHash, walletAddress, eventType, campaignId } =
      req.body;

    if (req.walletAddress !== walletAddress) {
      problemDetail(res, req, 403, 'Forbidden', 'Wallet address mismatch');
      return;
    }

    const existing = await prisma.transaction.findFirst({
      where: { OR: [{ id: requestId }, { txHash }] },
    });

    if (existing) {
      jsonValidated(
        res,
        TransactionStatusResponseSchema,
        200,
        txToResponse(existing, walletAddress),
      );
      return;
    }

    const tx = await prisma.transaction.create({
      data: {
        id: requestId,
        campaignId: campaignId ?? null,
        walletAddress,
        eventType: eventType ?? 'transaction.submitted',
        status: 'awaiting_signature',
        payload: {},
        ledger: 0,
        eventIndex: 0,
        txHash,
      },
    });

    const response = txToResponse(tx, walletAddress);
    // Issue #1065: status updates are addressed to the owning wallet only and
    // carry no wallet address — unauthenticated sockets receive nothing.
    broadcastTo(walletAddress, 'transaction.status', {
      requestId: response.requestId,
      txHash: response.txHash,
      status: response.status,
    });

    jsonValidated(res, TransactionStatusResponseSchema, 201, response);
  },
);

router.get(
  '/transactions/:requestId',
  requireWallet,
  validateParams(TransactionRequestIdParamSchema),
  async (req: WalletRequest, res: Response) => {
    const tx = await prisma.transaction.findUnique({
      where: { id: req.params.requestId },
    });

    // Issue #1065: require ownership on reads so wallets cannot read each
    // other's transactions by guessing request IDs. A foreign transaction
    // responds with 404 so existence is not revealed.
    if (!tx || tx.walletAddress !== req.walletAddress) {
      problemDetail(
        res,
        req,
        404,
        'Transaction Not Found',
        `No transaction with id ${req.params.requestId}`,
      );
      return;
    }

    jsonValidated(res, TransactionStatusResponseSchema, 200, txToResponse(tx));
  },
);

router.get(
  '/transactions',
  requireWallet,
  async (req: WalletRequest, res: Response) => {
    const walletAddress = req.walletAddress!;

    const transactions = await prisma.transaction.findMany({
      where: { walletAddress },
      orderBy: { processedAt: 'desc' },
      take: 50,
    });

    const results = transactions.map((tx) => txToResponse(tx, walletAddress));
    jsonValidated(res, TransactionStatusResponseSchema.array(), 200, results);
  },
);

router.patch(
  '/transactions/:requestId/status',
  requireWallet,
  writeLimiter,
  validateParams(TransactionRequestIdParamSchema),
  validateBody(TransactionStatusUpdateSchema),
  async (req: WalletRequest, res: Response) => {
    const { status: newStatus, message } = req.body;

    const tx = await prisma.transaction.findUnique({
      where: { id: req.params.requestId },
    });

    if (!tx) {
      problemDetail(
        res,
        req,
        404,
        'Transaction Not Found',
        `No transaction with id ${req.params.requestId}`,
      );
      return;
    }

    if (tx.walletAddress !== req.walletAddress) {
      problemDetail(
        res,
        req,
        403,
        'Forbidden',
        'This transaction belongs to a different wallet',
      );
      return;
    }

    const currentStatus = tx.status;
    const allowed = VALID_TRANSITIONS[currentStatus];
    if (!allowed?.includes(newStatus)) {
      problemDetail(
        res,
        req,
        409,
        'Invalid Status Transition',
        `Cannot transition from ${currentStatus} to ${newStatus}. Allowed: ${allowed?.join(', ') ?? 'none'}`,
      );
      return;
    }

    const updated = await prisma.transaction.update({
      where: { id: req.params.requestId },
      data: {
        status: newStatus,
        payload: {
          ...((tx.payload as Record<string, unknown>) ?? {}),
          statusHistory: [
            ...(((tx.payload as Record<string, unknown>)
              ?.statusHistory as unknown[]) ?? []),
            {
              from: currentStatus,
              to: newStatus,
              at: new Date().toISOString(),
              message: message ?? null,
            },
          ],
        } as Prisma.InputJsonValue,
      },
    });

    const response = txToResponse(updated);
    // Issue #1065: owner-only status delivery with no wallet address in the
    // payload — the target is the transaction's own wallet.
    broadcastTo(updated.walletAddress ?? '', 'transaction.status', {
      requestId: response.requestId,
      txHash: response.txHash,
      status: response.status,
      previousStatus: currentStatus,
    });

    jsonValidated(res, TransactionStatusResponseSchema, 200, response);
  },
);

router.get(
  '/transactions/:requestId/reconcile',
  requireWallet,
  validateParams(TransactionRequestIdParamSchema),
  async (req: WalletRequest, res: Response) => {
    const tx = await prisma.transaction.findUnique({
      where: { id: req.params.requestId },
    });

    // Issue #1065: reconcile reads are owner-gated like status reads, and a
    // foreign transaction answers 404 to avoid leaking existence.
    if (!tx || tx.walletAddress !== req.walletAddress) {
      problemDetail(
        res,
        req,
        404,
        'Transaction Not Found',
        `No transaction with id ${req.params.requestId}`,
      );
      return;
    }

    const result = await reconcileTransaction(tx.txHash ?? '', tx.status);

    jsonValidated(res, TransactionReconciliationResponseSchema, 200, {
      requestId: tx.id,
      txHash: tx.txHash ?? '',
      dbStatus: result.dbStatus,
      reconciledStatus: result.reconciledStatus,
      confirmedInLedger: result.confirmedInLedger,
      indexedByWatcher: result.indexedByWatcher,
      latestIndexedLedger: result.latestIndexedLedger,
      createdAt: tx.processedAt.toISOString(),
      updatedAt: tx.processedAt.toISOString(),
    });
  },
);

export default router;
