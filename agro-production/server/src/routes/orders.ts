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
import {
  ConfirmOrderSchema,
  CreateOrderSchema,
  ListOrdersQuerySchema,
  OrderIdParamSchema,
  type ListOrdersQuery,
} from "../schemas/order.js";
import { OrderSchema } from "../schemas/responses.js";
import { requireIdempotencyKey, getCachedResponse, setCachedResponse } from "../middleware/idempotency.js";

const router = Router();

// GET /orders?buyerAddress=... or ?farmerAddress=...
router.get(
  "/orders",
  validateQuery(ListOrdersQuerySchema),
  validateResponse(z.array(OrderSchema)),
  async (req: Request, res: Response) => {
    const { buyerAddress, farmerAddress } = req.query as unknown as ListOrdersQuery;

    if (buyerAddress) {
      const orders = await prisma.order.findMany({
        where: { buyerAddress },
        orderBy: { createdAt: "desc" },
        include: {
          campaign: { select: { farmerAddress: true, tokenAddress: true, onChainId: true } },
        },
      });
      jsonValidated(res, z.array(OrderSchema), 200, orders);
      return;
    }

    const campaigns = await prisma.campaign.findMany({
      where: { farmerAddress: farmerAddress! },
      select: { id: true },
    });
    const campaignIds = campaigns.map((c) => c.id);
    const orders = await prisma.order.findMany({
      where: { campaignId: { in: campaignIds } },
      orderBy: { createdAt: "desc" },
      include: {
        campaign: { select: { farmerAddress: true, tokenAddress: true, onChainId: true } },
      },
    });
    jsonValidated(res, z.array(OrderSchema), 200, orders);
  },
);

// POST /orders — create order intent (requires idempotency key and transaction hash)
router.post(
  "/orders",
  writeLimiter,
  requireIdempotencyKey,
  validateBody(CreateOrderSchema),
  validateResponse(OrderSchema),
  async (req: Request, res: Response) => {
    const key = (req as any).idempotencyKey as string;
    const cached = getCachedResponse(key);
    if (cached) {
      jsonValidated(res, OrderSchema, cached.status, cached.body);
      return;
    }

    const { buyerAddress, campaignId, amount, transactionHash } = req.body;

    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) {
      problemDetail(res, req, 404, "Campaign Not Found", `No campaign with id ${campaignId}`);
      return;
    }
    if (campaign.status !== "HARVESTED" && campaign.status !== "IN_PRODUCTION") {
      problemDetail(
        res,
        req,
        409,
        "Campaign Not Accepting Orders",
        `Campaign status is ${campaign.status}`,
      );
      return;
    }

    await prisma.user.upsert({
      where: { walletAddress: buyerAddress },
      create: { walletAddress: buyerAddress, role: "BUYER" },
      update: {},
    });

    const order = await prisma.order.create({
      data: {
        onChainId: "pending",
        campaignId: campaign.id,
        buyerAddress,
        amount,
        ledger: 0,
        txHash: transactionHash,
      },
    });

    await prisma.transaction.create({
      data: {
        campaignId: campaign.id,
        eventType: "order.created_intent",
        payload: { transactionHash, intent: true },
        ledger: 0,
        eventIndex: 0,
        txHash: transactionHash,
      },
    });

    const response = order;
    setCachedResponse(key, 201, response);
    jsonValidated(res, OrderSchema, 201, response);
  },
);

// GET /orders/:id
router.get(
  "/orders/:id",
  validateParams(OrderIdParamSchema),
  validateResponse(OrderSchema),
  async (req: Request, res: Response) => {
    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!order) {
      problemDetail(res, req, 404, "Order Not Found", `No order with id ${req.params.id}`);
      return;
    }
    jsonValidated(res, OrderSchema, 200, order);
  },
);

export default router;
