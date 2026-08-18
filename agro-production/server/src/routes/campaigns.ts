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
import { writeLimiter } from "../middleware/rateLimit.js";
import { requireWallet, type WalletRequest } from "../middleware/walletAuth.js";
import { requireIdempotencyKey } from "../middleware/idempotency.js";
import { problemDetail } from "../middleware/errors.js";
import {
  CampaignIdParamSchema,
  CreateCampaignSchema,
  InvestSchema,
  ListCampaignsQuerySchema,
  ListInvestmentsQuerySchema,
  type CreateCampaignInput,
  type InvestInput,
  type ListCampaignsQuery,
  type ListInvestmentsQuery,
} from "../schemas/campaign.js";
import {
  CampaignDetailSchema,
  CampaignListResponseSchema,
  CampaignMilestonesSchema,
  CampaignSchema,
  InvestmentSchema,
} from "../schemas/responses.js";
import { broadcast } from "../services/wsServer.js";
import { getCachedResponse, setCachedResponse } from "../middleware/idempotency.js";

const router = Router();

// GET /campaigns — list with optional status filter and pagination
router.get(
  "/campaigns",
  validateQuery(ListCampaignsQuerySchema),
  validateResponse(CampaignListResponseSchema),
  async (req: Request, res: Response) => {
    const { status, farmerAddress, page, limit } = req.query as unknown as ListCampaignsQuery;

    const where = {
      ...(status ? { status } : {}),
      ...(farmerAddress ? { farmerAddress } : {}),
    };
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

    jsonValidated(res, CampaignListResponseSchema, 200, {
      data: items,
      meta: { total, page, limit },
    });
  },
);

// GET /campaigns/:id — campaign detail with investments
router.get(
  "/campaigns/:id",
  validateParams(CampaignIdParamSchema),
  validateResponse(CampaignDetailSchema),
  async (req: Request, res: Response) => {
    const campaign = await prisma.campaign.findUnique({
      where: { id: req.params.id },
      include: {
        investments: { orderBy: { createdAt: "desc" } },
        orders: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!campaign) {
      problemDetail(res, req, 404, "Campaign Not Found", `No campaign with id ${req.params.id}`);
      return;
    }

    jsonValidated(res, CampaignDetailSchema, 200, campaign);
  },
);

// GET /campaigns/:id/milestones — campaign milestone/tranche state
router.get(
  "/campaigns/:id/milestones",
  validateParams(CampaignIdParamSchema),
  validateResponse(CampaignMilestonesSchema),
  async (req: Request, res: Response) => {
    const campaignId = req.params.id;
    const campaign = await prisma.campaign.findFirst({
      where: {
        OR: [
          { id: campaignId },
          { onChainId: campaignId },
        ],
      },
      include: {
        transactions: {
          where: {
            eventType: {
              in: ["campaign.produce", "campaign.harvest", "campaign.settled"],
            },
          },
          orderBy: { ledger: "asc" },
        },
      },
    });

    if (!campaign) {
      problemDetail(res, req, 404, "Campaign Not Found", `No campaign with id ${campaignId}`);
      return;
    }

    const totalRaised = BigInt(campaign.totalRaised || "0");
    const trancheReleased = BigInt(campaign.trancheReleased || "0");
    const percentageReleased = totalRaised > 0n
      ? Math.min(100, Math.round(Number((trancheReleased * 100n) / totalRaised)))
      : (campaign.status === "IN_PRODUCTION" ? 50 : (["HARVESTED", "SETTLED"].includes(campaign.status) ? 100 : 0));

    let currentMilestone = campaign.status.toString();
    let nextExpectedMilestone: string | null = null;

    switch (campaign.status) {
      case "FUNDING":
      case "FUNDED":
        nextExpectedMilestone = "IN_PRODUCTION";
        break;
      case "IN_PRODUCTION":
        nextExpectedMilestone = "HARVESTED";
        break;
      case "HARVESTED":
        nextExpectedMilestone = "SETTLED";
        break;
      case "SETTLED":
      case "FAILED":
      case "DISPUTED":
        nextExpectedMilestone = null;
        break;
    }

    const produceTx = campaign.transactions.find((t) => t.eventType === "campaign.produce");
    const harvestTx = campaign.transactions.find((t) => t.eventType === "campaign.harvest");
    const settledTx = campaign.transactions.find((t) => t.eventType === "campaign.settled");

    const milestoneState = {
      campaignId: campaign.id,
      onChainId: campaign.onChainId,
      status: campaign.status,
      percentageReleased,
      trancheReleased: campaign.trancheReleased,
      currentMilestone,
      nextExpectedMilestone,
      milestones: [
        {
          name: "FUNDING",
          percentage: 0,
          completed: true,
          completedAt: campaign.createdAt.toISOString(),
        },
        {
          name: "IN_PRODUCTION",
          percentage: 50,
          completed: ["IN_PRODUCTION", "HARVESTED", "SETTLED"].includes(campaign.status),
          completedAt: produceTx ? produceTx.processedAt.toISOString() : null,
        },
        {
          name: "HARVESTED",
          percentage: 100,
          completed: ["HARVESTED", "SETTLED"].includes(campaign.status),
          completedAt: harvestTx ? harvestTx.processedAt.toISOString() : null,
        },
        {
          name: "SETTLED",
          percentage: 100,
          completed: campaign.status === "SETTLED",
          completedAt: settledTx ? settledTx.processedAt.toISOString() : null,
        },
      ],
    };

    jsonValidated(res, CampaignMilestonesSchema, 200, milestoneState);
  },
);

// POST /campaigns — register a newly-created campaign (off-chain metadata)
// Requires authenticated session; farmerAddress is derived from session, not body
router.post(
  "/campaigns",
  requireWallet,
  writeLimiter,
  requireIdempotencyKey,
  validateBody(CreateCampaignSchema.omit({ farmerAddress: true })),
  validateResponse(CampaignSchema),
  async (req: WalletRequest, res: Response) => {
    const farmerAddress = req.walletAddress!;
    const idempotencyKey = (req as any).idempotencyKey as string;
    const { tokenAddress, targetAmount, deadline } = req.body as Omit<CreateCampaignInput, "farmerAddress">;

    const cached = getCachedResponse(idempotencyKey);
    if (cached) {
      res.status(cached.status).json(cached.body);
      return;
    }

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

    await prisma.transaction.create({
      data: {
        campaignId: campaign.id,
        eventType: "campaign.created_intent",
        payload: { idempotencyKey, intent: true },
        ledger: 0,
        eventIndex: 0,
        txHash: null,
      },
    });

    const response = campaign;
    setCachedResponse(idempotencyKey, 201, response);
    jsonValidated(res, CampaignSchema, 201, response);
  },
);

// GET /campaigns/:id/investments — investments for a campaign
router.get(
  "/campaigns/:id/investments",
  validateParams(CampaignIdParamSchema),
  validateResponse(z.array(InvestmentSchema)),
  async (req: Request, res: Response) => {
    const investments = await prisma.investment.findMany({
      where: { campaignId: req.params.id },
      orderBy: { createdAt: "desc" },
    });
    jsonValidated(res, z.array(InvestmentSchema), 200, investments);
  },
);

// GET /investments?investorAddress=... — all investments for a user
router.get(
  "/investments",
  validateQuery(ListInvestmentsQuerySchema),
  validateResponse(z.array(InvestmentSchema)),
  async (req: Request, res: Response) => {
    const { investorAddress } = req.query as unknown as ListInvestmentsQuery;

    const investments = await prisma.investment.findMany({
      where: { investorAddress },
      orderBy: { createdAt: "desc" },
      include: {
        campaign: {
          select: {
            id: true,
            onChainId: true,
            farmerAddress: true,
            tokenAddress: true,
            targetAmount: true,
            totalRaised: true,
            totalRevenue: true,
            status: true,
            deadline: true,
          },
        },
      },
    });

    jsonValidated(res, z.array(InvestmentSchema), 200, investments);
  },
);

// POST /campaigns/:id/invest — record an investment (indexer shortcut)
// Requires authenticated session; investorAddress is derived from session, not body
router.post(
  "/campaigns/:id/invest",
  requireWallet,
  writeLimiter,
  requireIdempotencyKey,
  validateParams(CampaignIdParamSchema),
  validateBody(InvestSchema.omit({ investorAddress: true })),
  validateResponse(InvestmentSchema),
  async (req: WalletRequest, res: Response) => {
    const investorAddress = req.walletAddress!;
    const idempotencyKey = (req as any).idempotencyKey as string;
    const { amount } = req.body as Omit<InvestInput, "investorAddress">;

    const cached = getCachedResponse(idempotencyKey);
    if (cached) {
      res.status(cached.status).json(cached.body);
      return;
    }

    const campaign = await prisma.campaign.findUnique({ where: { id: req.params.id } });
    if (!campaign) {
      problemDetail(res, req, 404, "Campaign Not Found", `No campaign with id ${req.params.id}`);
      return;
    }
    if (campaign.status !== "FUNDING") {
      problemDetail(
        res,
        req,
        409,
        "Campaign Not Accepting Investments",
        `Campaign status is ${campaign.status}`,
      );
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
        ledger: 0,
        txHash: null,
      },
    });

    await prisma.transaction.create({
      data: {
        campaignId: campaign.id,
        eventType: "campaign.invested_intent",
        payload: { idempotencyKey, intent: true },
        ledger: 0,
        eventIndex: 0,
        txHash: null,
      },
    });

    const response = investment;
    setCachedResponse(idempotencyKey, 201, response);
    jsonValidated(res, InvestmentSchema, 201, response);
  },
);

export default router;
