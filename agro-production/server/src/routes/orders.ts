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
import {
  CreateOrderSchema,
  ListOrdersQuerySchema,
  OrderIdParamSchema,
  type ListOrdersQuery,
} from "../schemas/order.js";
import { OrderSchema } from "../schemas/responses.js";
import {
  requireIdempotencyKey,
  getCachedResponse,
  setCachedResponse,
} from "../middleware/idempotency.js";
import logger from "../config/logger.js";

const router = Router();

// GET /orders?buyerAddress=... or ?farmerAddress=...
router.get(
  "/orders",
  requireWallet,
  validateQuery(ListOrdersQuerySchema),
  validateResponse(z.array(OrderSchema)),
  async (req: WalletRequest, res: Response) => {
    const walletAddress = req.walletAddress!;
    const { buyerAddress, farmerAddress } = req.query as unknown as ListOrdersQuery;

    if (buyerAddress) {
      if (buyerAddress !== walletAddress) {
        problemDetail(res, req, 403, "Forbidden", "Cannot view another wallet's orders");
        return;
      }
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

    if (farmerAddress) {
      if (farmerAddress !== walletAddress) {
        problemDetail(res, req, 403, "Forbidden", "Cannot view another wallet's orders");
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
      return;
    }

    problemDetail(res, req, 400, "Bad Request", "Either buyerAddress or farmerAddress is required");
  },
);

// POST /orders — requires authenticated session; buyerAddress derived from session
router.post(
  "/orders",
  requireWallet,
  requireIdempotencyKey,
  writeLimiter,
  validateBody(CreateOrderSchema.omit({ buyerAddress: true })),
  validateResponse(OrderSchema),
  async (req: WalletRequest, res: Response) => {
    try {
      const buyerAddress = req.walletAddress!;
      const idempotencyKey = (req as any).idempotencyKey as string;
      const { campaignId, amount } = req.body;

      const cached = getCachedResponse(idempotencyKey);
      if (cached) {
        res.status(cached.status).json(cached.body);
        return;
      }

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
          txHash: null,
        },
      });

      await prisma.transaction.create({
        data: {
          campaignId: campaign.id,
          eventType: "order.created_intent",
          payload: { idempotencyKey, intent: true },
          ledger: 0,
          eventIndex: 0,
          txHash: null,
        },
      });

      const response = order;
      setCachedResponse(idempotencyKey, 201, response);
      jsonValidated(res, OrderSchema, 201, response);
    } catch (error) {
      logger.error("[POST /orders] Failed to create order", { error });
      problemDetail(res, req, 500, "Internal Server Error", "Failed to create order");
    }
  },
);

// GET /orders/:id
router.get(
  "/orders/:id",
  requireWallet,
  validateParams(OrderIdParamSchema),
  validateResponse(OrderSchema),
  async (req: WalletRequest, res: Response) => {
    const walletAddress = req.walletAddress!;
    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!order) {
      problemDetail(res, req, 404, "Order Not Found", `No order with id ${req.params.id}`);
      return;
    }
    if (order.buyerAddress !== walletAddress) {
      problemDetail(res, req, 403, "Forbidden", "Not the buyer for this order");
      return;
    }
    jsonValidated(res, OrderSchema, 200, order);
  },
);

// PUT /orders/:id — update txHash after on-chain confirmation
router.put(
  "/orders/:id",
  requireWallet,
  writeLimiter,
  validateParams(OrderIdParamSchema),
  validateBody(z.object({ txHash: z.string() })),
  validateResponse(OrderSchema),
  async (req: WalletRequest, res: Response) => {
    const walletAddress = req.walletAddress!;
    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!order) {
      problemDetail(res, req, 404, "Order Not Found", `No order with id ${req.params.id}`);
      return;
    }
    if (order.buyerAddress !== walletAddress) {
      problemDetail(res, req, 403, "Forbidden", "Not the buyer for this order");
      return;
    }

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { txHash: req.body.txHash },
    });

    jsonValidated(res, OrderSchema, 200, updated);
  },
);

// PATCH /orders/:id/confirm
// PATCH /orders/:id/confirm — requires authenticated session; buyerAddress derived from session
router.patch(
  "/orders/:id/confirm",
  requireWallet,
  writeLimiter,
  validateParams(OrderIdParamSchema),
  validateResponse(OrderSchema),
  async (req: WalletRequest, res: Response) => {
    const walletAddress = req.walletAddress!;

    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!order) {
      problemDetail(res, req, 404, "Order Not Found", `No order with id ${req.params.id}`);
      return;
    }
    if (order.buyerAddress !== walletAddress) {
      problemDetail(res, req, 403, "Forbidden", "Not the buyer for this order");
      return;
    }
    if (order.status !== "PENDING") {
      problemDetail(res, req, 409, "Order Already Confirmed", "Order is not pending");
      return;
    }

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { status: "CONFIRMED" },
    });

    jsonValidated(res, OrderSchema, 200, updated);
  },
);

export default router;
