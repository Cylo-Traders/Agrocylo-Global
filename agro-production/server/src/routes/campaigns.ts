import { Router, type Request, type Response } from "express";
import { prisma } from "../db/client.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import { writeLimiter } from "../middleware/rateLimit.js";
import {
  CampaignIdParamSchema,
  CreateCampaignSchema,
  InvestSchema,
  ListCampaignsQuerySchema,
} from "../schemas/campaign.js";
import type { CampaignStatus } from "@prisma/client";

const router = Router();

// GET /campaigns — list with optional status filter and pagination
router.get(
  "/campaigns",
  validateQuery(ListCampaignsQuerySchema),
  async (req: Request, res: Response) => {
    const { status, page, limit } = req.query as unknown as {
      status?: CampaignStatus;
      page: number;
      limit: number;
    };

    const where = status ? { status } : {};
    const [items, total] = await Promise.all([
      prisma.campaign.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { investments: true, orders: true } } },
      }),
      prisma.campaign.count({ where }),
    ]);

    res.json({ data: items, meta: { total, page, limit } });
  },
);

// GET /campaigns/:id — campaign detail with investments
router.get(
  "/campaigns/:id",
  validateParams(CampaignIdParamSchema),
  async (req: Request, res: Response) => {
    const campaign = await prisma.campaign.findUnique({
      where: { id: req.params.id },
      include: {
        investments: { orderBy: { createdAt: "desc" } },
        orders: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }

    res.json(campaign);
  },
);

// POST /campaigns — register a newly-created campaign (for off-chain metadata)
router.post(
  "/campaigns",
  writeLimiter,
  validateBody(CreateCampaignSchema),
  async (req: Request, res: Response) => {
    const { farmerAddress, tokenAddress, targetAmount, deadline } = req.body;

    await prisma.user.upsert({
      where: { walletAddress: farmerAddress },
      create: { walletAddress: farmerAddress, role: "FARMER" },
      update: {},
    });

    const campaign = await prisma.campaign.create({
      data: {
        onChainId: "pending",
        farmerAddress,
        tokenAddress,
        targetAmount,
        deadline: new Date(deadline),
      },
    });

    res.status(201).json(campaign);
  },
);

// GET /campaigns/:id/investments — investments for a campaign
router.get(
  "/campaigns/:id/investments",
  validateParams(CampaignIdParamSchema),
  async (req: Request, res: Response) => {
    const investments = await prisma.investment.findMany({
      where: { campaignId: req.params.id },
      orderBy: { createdAt: "desc" },
    });
    res.json(investments);
  },
);

// POST /campaigns/:id/invest — record an investment (indexer shortcut)
router.post(
  "/campaigns/:id/invest",
  writeLimiter,
  validateParams(CampaignIdParamSchema),
  validateBody(InvestSchema),
  async (req: Request, res: Response) => {
    const { investorAddress, amount } = req.body;

    const campaign = await prisma.campaign.findUnique({ where: { id: req.params.id } });
    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    if (campaign.status !== "FUNDING") {
      res.status(409).json({ error: "Campaign is not accepting investments" });
      return;
    }

    await prisma.user.upsert({
      where: { walletAddress: investorAddress },
      create: { walletAddress: investorAddress, role: "INVESTOR" },
      update: {},
    });

    const investment = await prisma.investment.create({
      data: {
        campaignId: campaign.id,
        investorAddress,
        amount,
        ledger: 0, // will be updated by indexer
      },
    });

    res.status(201).json(investment);
  },
);

export default router;
