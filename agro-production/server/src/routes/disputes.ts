import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../db/client.js";
import {
  jsonValidated,
  validateBody,
  validateParams,
  validateQuery,
  validateResponse,
} from "../middleware/validate.js";
import { problemDetail } from "../middleware/errors.js";
import { writeLimiter } from "../middleware/rateLimit.js";
import { requireWallet, type WalletRequest } from "../middleware/walletAuth.js";

const router = Router();

// Schema definitions
const DisputeIdParamSchema = z.object({
  id: z.string().uuid(),
});

const ListDisputesQuerySchema = z.object({
  campaignId: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const SubmitEvidenceSchema = z.object({
  evidenceUrl: z.string().url(),
  evidenceHash: z.string().min(1),
});

const ResolveDisputeSchema = z.object({
  resolutionOutcome: z.string().min(1),
  resolutionNotes: z.string().optional(),
});

// Response schemas
const DisputeEvidenceResponseSchema = z.object({
  id: z.string().uuid(),
  submitterAddress: z.string(),
  submittedAt: z.string().datetime(),
});

const DisputeResponseSchema = z.object({
  id: z.string().uuid(),
  campaignId: z.string().uuid(),
  orderId: z.string().uuid().nullable(),
  initiatorAddress: z.string(),
  respondentAddress: z.string(),
  status: z.enum(["Open", "EvidenceSubmitted", "Resolved", "Dismissed"]),
  resolutionOutcome: z.string().nullable(),
  transactionHash: z.string(),
  ledgerSequence: z.number(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const DisputeDetailResponseSchema = DisputeResponseSchema.extend({
  evidence: z.array(DisputeEvidenceResponseSchema),
});

const DisputeListResponseSchema = z.object({
  data: z.array(DisputeResponseSchema),
  meta: z.object({
    total: z.number(),
    page: z.number(),
    limit: z.number(),
  }),
});

// GET /disputes — paginated list with optional campaign filter
router.get(
  "/disputes",
  requireWallet,
  validateQuery(ListDisputesQuerySchema),
  validateResponse(DisputeListResponseSchema),
  async (req: Request, res: Response) => {
    const { campaignId, page, limit } = req.query as unknown as z.infer<typeof ListDisputesQuerySchema>;
    const walletReq = req as WalletRequest;
    const userWalletAddress = walletReq.walletAddress;

    // Get user role for authorization
    const user = await prisma.user.findUnique({
      where: { walletAddress: userWalletAddress || "UNKNOWN" },
    });

    const where: any = {};
    if (campaignId) {
      where.campaignId = campaignId;
    }

    // Non-admin participants can only see disputes they're involved in
    if (user?.role !== "ADMIN" && userWalletAddress) {
      where.OR = [
        { initiatorAddress: userWalletAddress },
        { respondentAddress: userWalletAddress },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.dispute.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.dispute.count({ where }),
    ]);

    jsonValidated(res, DisputeListResponseSchema, 200, {
      data: items,
      meta: { total, page, limit },
    });
  },
);

// GET /disputes/:id — dispute detail with evidence list
router.get(
  "/disputes/:id",
  requireWallet,
  validateParams(DisputeIdParamSchema),
  validateResponse(DisputeDetailResponseSchema),
  async (req: Request, res: Response) => {
    const walletReq = req as WalletRequest;
    const userWalletAddress = walletReq.walletAddress;

    const dispute = await prisma.dispute.findUnique({
      where: { id: req.params.id },
      include: {
        evidence: {
          select: {
            id: true,
            submitterAddress: true,
            submittedAt: true,
          },
          orderBy: { submittedAt: "desc" },
        },
      },
    });

    if (!dispute) {
      problemDetail(res, req, 404, "Dispute Not Found", `No dispute with id ${req.params.id}`);
      return;
    }

    // Check authorization: only participants and admin can view
    const user = await prisma.user.findUnique({
      where: { walletAddress: userWalletAddress || "UNKNOWN" },
    });

    const isParticipant =
      userWalletAddress === dispute.initiatorAddress || userWalletAddress === dispute.respondentAddress;

    if (user?.role !== "ADMIN" && !isParticipant) {
      problemDetail(res, req, 403, "Forbidden", "You do not have access to this dispute");
      return;
    }

    jsonValidated(res, DisputeDetailResponseSchema, 200, dispute);
  },
);

// POST /disputes/:id/evidence — submit evidence (dispute participants only)
router.post(
  "/disputes/:id/evidence",
  writeLimiter,
  requireWallet,
  validateParams(DisputeIdParamSchema),
  validateBody(SubmitEvidenceSchema),
  validateResponse(DisputeEvidenceResponseSchema),
  async (req: WalletRequest, res: Response) => {
    const { evidenceUrl, evidenceHash } = req.body as z.infer<typeof SubmitEvidenceSchema>;

    const dispute = await prisma.dispute.findUnique({
      where: { id: req.params.id },
    });

    if (!dispute) {
      problemDetail(res, req, 404, "Dispute Not Found", `No dispute with id ${req.params.id}`);
      return;
    }

    // Check if requester is a participant
    const isParticipant =
      req.walletAddress === dispute.initiatorAddress || req.walletAddress === dispute.respondentAddress;

    if (!isParticipant) {
      problemDetail(res, req, 403, "Forbidden", "Only dispute participants can submit evidence");
      return;
    }

    // Ensure dispute is still in a state accepting evidence
    if (dispute.status === "Resolved" || dispute.status === "Dismissed") {
      problemDetail(
        res,
        req,
        409,
        "Dispute Closed",
        `Cannot submit evidence to a ${dispute.status} dispute`,
      );
      return;
    }

    const evidence = await prisma.disputeEvidence.create({
      data: {
        disputeId: dispute.id,
        submitterAddress: req.walletAddress!,
        evidenceUrl,
        evidenceHash,
      },
    });

    jsonValidated(res, DisputeEvidenceResponseSchema, 201, evidence);
  },
);

// PATCH /disputes/:id/resolve — resolve dispute (admin only)
router.patch(
  "/disputes/:id/resolve",
  writeLimiter,
  requireWallet,
  validateParams(DisputeIdParamSchema),
  validateBody(ResolveDisputeSchema),
  validateResponse(DisputeResponseSchema),
  async (req: WalletRequest, res: Response) => {
    // Check admin role
    const user = await prisma.user.findUnique({
      where: { walletAddress: req.walletAddress || "UNKNOWN" },
    });

    if (user?.role !== "ADMIN") {
      problemDetail(res, req, 403, "Forbidden", "Only admins can resolve disputes");
      return;
    }

    const { resolutionOutcome, resolutionNotes } = req.body as z.infer<typeof ResolveDisputeSchema>;

    const dispute = await prisma.dispute.findUnique({
      where: { id: req.params.id },
    });

    if (!dispute) {
      problemDetail(res, req, 404, "Dispute Not Found", `No dispute with id ${req.params.id}`);
      return;
    }

    if (dispute.status === "Resolved" || dispute.status === "Dismissed") {
      problemDetail(res, req, 409, "Dispute Already Closed", "Cannot resolve an already closed dispute");
      return;
    }

    const updated = await prisma.dispute.update({
      where: { id: dispute.id },
      data: {
        status: "Resolved",
        resolutionOutcome,
        resolutionNotes,
      },
    });

    // Create audit entry
    await prisma.disputeAuditEntry.create({
      data: {
        disputeId: dispute.id,
        action: "resolved",
        actorAddress: req.walletAddress!,
        details: { outcome: resolutionOutcome },
      },
    });

    jsonValidated(res, DisputeResponseSchema, 200, updated);
  },
);

export default router;
