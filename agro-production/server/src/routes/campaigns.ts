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
  CampaignSchema,
  InvestmentSchema,
} from "../schemas/responses.js";
import { broadcast } from "../services/wsServer.js";
import { problemDetail } from "../middleware/errors.js";
import { requireIdempotencyKey, getCachedResponse, setCachedResponse } from "../middleware/idempotency.js";

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

// POST /campaigns — register a campaign intent (requires idempotency key and transaction hash)
router.post(
  "/campaigns",
  writeLimiter,
  requireIdempotencyKey,
  validateBody(CreateCampaignSchema),
  validateResponse(CampaignSchema),
  async (req: Request, res: Response) => {
    const key = (req as any).idempotencyKey as string;
    const cached = getCachedResponse(key);
    if (cached) {
      jsonValidated(res, CampaignSchema, cached.status, cached.body);
      return;
    }

    const { farmerAddress, tokenAddress, targetAmount, deadline, transactionHash } =
      req.body as CreateCampaignInput;

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
        payload: { transactionHash, intent: true },
        ledger: 0,
        eventIndex: 0,
        txHash: transactionHash,
      },
    });

    const response = campaign;
    setCachedResponse(key, 201, response);
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

// POST /campaigns/:id/invest — record an investment intent (requires idempotency key and transaction hash)
router.post(
  "/campaigns/:id/invest",
  writeLimiter,
  requireIdempotencyKey,
  validateParams(CampaignIdParamSchema),
  validateBody(InvestSchema),
  validateResponse(InvestmentSchema),
  async (req: Request, res: Response) => {
    const key = (req as any).idempotencyKey as string;
    const cached = getCachedResponse(key);
    if (cached) {
      jsonValidated(res, InvestmentSchema, cached.status, cached.body);
      return;
    }

    const { investorAddress, amount, transactionHash } = req.body as InvestInput;

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
        txHash: transactionHash,
      },
    });

    await prisma.transaction.create({
      data: {
        campaignId: campaign.id,
        eventType: "campaign.invested_intent",
        payload: { transactionHash, intent: true },
        ledger: 0,
        eventIndex: 0,
        txHash: transactionHash,
      },
    });

    const response = investment;
    setCachedResponse(key, 201, response);
    jsonValidated(res, InvestmentSchema, 201, response);
  },
);

export default router;
