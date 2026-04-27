import { Router, type Request, type Response } from "express";
import { prisma } from "../db/client.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import { writeLimiter } from "../middleware/rateLimit.js";
import {
  ConfirmOrderSchema,
  CreateOrderSchema,
  OrderIdParamSchema,
} from "../schemas/order.js";

const router = Router();

// GET /orders?buyerAddress=... or ?farmerAddress=...
router.get(
  "/orders",
  async (req: Request, res: Response) => {
    const { buyerAddress, farmerAddress } = req.query;

    if (!buyerAddress && !farmerAddress) {
      res.status(400).json({ error: "buyerAddress or farmerAddress query param required" });
      return;
    }

    if (buyerAddress && typeof buyerAddress === "string") {
      const orders = await prisma.order.findMany({
        where: { buyerAddress },
        orderBy: { createdAt: "desc" },
        include: { campaign: { select: { farmerAddress: true, tokenAddress: true, onChainId: true } } },
      });
      res.json(orders);
      return;
    }

    if (farmerAddress && typeof farmerAddress === "string") {
      const campaigns = await prisma.campaign.findMany({
        where: { farmerAddress },
        select: { id: true },
      });
      const campaignIds = campaigns.map((c) => c.id);
      const orders = await prisma.order.findMany({
        where: { campaignId: { in: campaignIds } },
        orderBy: { createdAt: "desc" },
        include: { campaign: { select: { farmerAddress: true, tokenAddress: true, onChainId: true } } },
      });
      res.json(orders);
      return;
    }

    res.status(400).json({ error: "Invalid query params" });
  },
);

// POST /orders
router.post(
  "/orders",
  writeLimiter,
  validateBody(CreateOrderSchema),
  async (req: Request, res: Response) => {
    const { buyerAddress, campaignId, amount } = req.body;

    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    if (campaign.status !== "HARVESTED" && campaign.status !== "IN_PRODUCTION") {
      res.status(409).json({ error: "Campaign is not accepting orders" });
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
      },
    });

    res.status(201).json(order);
  },
);

// GET /orders/:id
router.get(
  "/orders/:id",
  validateParams(OrderIdParamSchema),
  async (req: Request, res: Response) => {
    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    res.json(order);
  },
);

// PATCH /orders/:id/confirm
router.patch(
  "/orders/:id/confirm",
  writeLimiter,
  validateParams(OrderIdParamSchema),
  validateBody(ConfirmOrderSchema),
  async (req: Request, res: Response) => {
    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    if (order.buyerAddress !== req.body.buyerAddress) {
      res.status(403).json({ error: "Not the buyer for this order" });
      return;
    }
    if (order.status !== "PENDING") {
      res.status(409).json({ error: "Order already confirmed" });
      return;
    }

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { status: "CONFIRMED" },
    });

    res.json(updated);
  },
);

export default router;
