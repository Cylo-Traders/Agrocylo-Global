import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { ApiError, sendProblem } from '../http/errors.js';
import type { AdminRequest } from '../middleware/adminAuth.js';

const GetDisputesQuerySchema = z.object({
  status: z.enum(['OPEN', 'RESOLVED', 'REJECTED']).optional(),
  page: z.string().optional().transform((v) => (v ? parseInt(v, 10) : 1)),
  limit: z.string().optional().transform((v) => (v ? Math.min(parseInt(v, 10), 100) : 20)),
});

const ResolveDisputeSchema = z.object({
  disputeId: z.string().uuid({ message: 'disputeId must be a valid UUID.' }),
  decision: z.enum(['RESOLVED', 'REJECTED']),
  resolution: z.string().min(1, 'Resolution note is required.'),
});

export class AdminDisputeController {
  static async getDisputes(req: AdminRequest, res: Response): Promise<void> {
    const parsed = GetDisputesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((e) => e.message).join('; ');
      return sendProblem(res, req as Request, new ApiError(400, 'Invalid query parameters', detail));
    }
    const { status, page, limit } = parsed.data;
    const skip = (page - 1) * limit;
    const [disputes, total] = await Promise.all([
      prisma.dispute.findMany({
        where: status ? { status } : undefined,
        include: {
          order: {
            select: {
              id: true,
              orderIdOnChain: true,
              buyerAddress: true,
              sellerAddress: true,
              amount: true,
              token: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.dispute.count({ where: status ? { status } : undefined }),
    ]);
    res.status(200).json({
      disputes,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  }

  static async resolveDispute(req: AdminRequest, res: Response): Promise<void> {
    const parsed = ResolveDisputeSchema.safeParse(req.body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((e) => e.message).join('; ');
      return sendProblem(res, req as Request, new ApiError(400, 'Invalid request body', detail));
    }
    const { disputeId, decision, resolution } = parsed.data;
    const existing = await prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!existing) {
      return sendProblem(res, req as Request, new ApiError(404, 'Dispute not found', 'No dispute with id ' + disputeId));
    }
    if (existing.status !== 'OPEN') {
      return sendProblem(res, req as Request, new ApiError(409, 'Dispute already settled', 'Dispute is already ' + existing.status.toLowerCase()));
    }
    const updated = await prisma.dispute.update({
      where: { id: disputeId },
      data: { status: decision, resolution, resolvedBy: req.adminWallet, resolvedAt: new Date() },
      include: {
        order: { select: { id: true, orderIdOnChain: true, buyerAddress: true, sellerAddress: true } },
      },
    });
    await prisma.notification.create({
      data: {
        walletAddress: updated.raisedBy,
        message: 'Your dispute for order ' + updated.order.orderIdOnChain + ' has been ' + decision.toLowerCase() + '.',
        orderId: updated.orderId,
        type: 'DISPUTE_RESOLVED',
      },
    });
    res.status(200).json({ message: 'Dispute successfully ' + decision.toLowerCase() + '.', dispute: updated });
  }
}
