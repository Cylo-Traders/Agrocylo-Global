import { Router, type Request, type Response } from 'express';
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
} from '../schemas/transaction.js';
const router = Router();

router.post(
  '/transactions',
  requireWallet,
  writeLimiter,
  validateBody(TransactionIntentCreateSchema),
  async (req: WalletRequest, res: Response) => {
    const { requestId, txHash, walletAddress, eventType, campaignId } = req.body;

    if (req.walletAddress !== walletAddress) {
      problemDetail(res, req, 403, 'Forbidden', 'Wallet address mismatch');
      return;
    }

    const existing = await prisma.transaction.findFirst({
      where: { OR: [{ id: requestId }, { txHash }] },
    });

    if (existing) {
      jsonValidated(res, TransactionStatusResponseSchema, 200, {
        requestId: existing.id,
        txHash: existing.txHash ?? '',
        walletAddress: existing.walletAddress ?? walletAddress,
        status: existing.status,
        eventType: existing.eventType,
        campaignId: existing.campaignId,
        ledger: existing.ledger || undefined,
        createdAt: existing.processedAt.toISOString(),
        updatedAt: existing.processedAt.toISOString(),
      });
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

    jsonValidated(res, TransactionStatusResponseSchema, 201, {
      requestId: tx.id,
      txHash: tx.txHash ?? '',
      walletAddress: tx.walletAddress ?? walletAddress,
      status: tx.status,
      eventType: tx.eventType,
      campaignId: tx.campaignId,
      ledger: tx.ledger || undefined,
      createdAt: tx.processedAt.toISOString(),
      updatedAt: tx.processedAt.toISOString(),
    });
  },
);

router.get(
  '/transactions/:requestId',
  validateParams(TransactionRequestIdParamSchema),
  async (req: Request, res: Response) => {
    const tx = await prisma.transaction.findUnique({
      where: { id: req.params.requestId },
    });

    if (!tx) {
      problemDetail(res, req, 404, 'Transaction Not Found', `No transaction with id ${req.params.requestId}`);
      return;
    }

    jsonValidated(res, TransactionStatusResponseSchema, 200, {
      requestId: tx.id,
      txHash: tx.txHash ?? '',
      walletAddress: tx.walletAddress ?? '',
      status: tx.status,
      eventType: tx.eventType,
      campaignId: tx.campaignId,
      ledger: tx.ledger || undefined,
      createdAt: tx.processedAt.toISOString(),
      updatedAt: tx.processedAt.toISOString(),
    });
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

    const results = transactions.map((tx) => ({
      requestId: tx.id,
      txHash: tx.txHash ?? '',
      walletAddress: tx.walletAddress ?? walletAddress,
      status: tx.status,
      eventType: tx.eventType,
      campaignId: tx.campaignId,
      ledger: tx.ledger || undefined,
      createdAt: tx.processedAt.toISOString(),
      updatedAt: tx.processedAt.toISOString(),
    }));

    jsonValidated(res, TransactionStatusResponseSchema.array(), 200, results);
  },
);

export default router;
