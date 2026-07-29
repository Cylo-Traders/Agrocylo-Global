import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { jsonValidated, validateParams, validateResponse } from "../middleware/validate.js";
import { problemDetail } from "../middleware/errors.js";
import { stellarAddress } from "../schemas/common.js";

const router = Router();

export const UserWalletParamSchema = z.object({
  walletAddress: stellarAddress,
});

export const UserProfileResponseSchema = z.object({
  walletAddress: stellarAddress,
  role: z.string(),
  createdAt: z.union([z.string().datetime(), z.date().transform((d) => d.toISOString())]),
  stats: z.object({
    campaignsCount: z.number().int(),
    investmentsCount: z.number().int(),
    ordersCount: z.number().int(),
    disputesCount: z.number().int(),
  }),
  reputationScore: z.number().int(),
});

// GET /users/:walletAddress — cross-referencing user profile and activity lookup by walletAddress
router.get(
  "/users/:walletAddress",
  validateParams(UserWalletParamSchema),
  validateResponse(UserProfileResponseSchema),
  async (req: Request, res: Response) => {
    const { walletAddress } = req.params;

    const user = await prisma.user.findUnique({
      where: { walletAddress },
      include: {
        _count: {
          select: {
            campaigns: true,
            investments: true,
            orders: true,
          },
        },
      },
    });

    if (!user) {
      problemDetail(res, req, 404, "User Not Found", `No user profile found for wallet ${walletAddress}`);
      return;
    }

    const disputesCount = await prisma.dispute.count({
      where: {
        OR: [
          { initiatorAddress: walletAddress },
          { respondentAddress: walletAddress },
        ],
      },
    });

    const baseScore = 100;
    const reputationScore = Math.max(
      0,
      baseScore + user._count.campaigns * 10 + user._count.orders * 10 - disputesCount * 20,
    );

    jsonValidated(res, UserProfileResponseSchema, 200, {
      walletAddress: user.walletAddress,
      role: user.role,
      createdAt: user.createdAt,
      stats: {
        campaignsCount: user._count.campaigns,
        investmentsCount: user._count.investments,
        ordersCount: user._count.orders,
        disputesCount,
      },
      reputationScore,
    });
  },
);

export default router;
