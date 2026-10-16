import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { requireWallet, type WalletRequest } from "../middleware/walletAuth.js";
import { jsonValidated, validateParams, validateQuery, validateResponse } from "../middleware/validate.js";
import { problemDetail } from "../middleware/errors.js";
import {
  BasketIdParamSchema,
  ListBasketDepositsQuerySchema,
  ListBasketsQuerySchema,
  type ListBasketDepositsQuery,
  type ListBasketsQuery,
} from "../schemas/basket.js";
import {
  BasketDepositSchema,
  BasketDetailSchema,
  BasketListResponseSchema,
  InvestorBasketSummarySchema,
} from "../schemas/responses.js";

const router = Router();

// GET /baskets — list investment baskets with optional status filter and pagination
router.get(
  "/baskets",
  validateQuery(ListBasketsQuerySchema),
  validateResponse(BasketListResponseSchema),
  async (req: Request, res: Response) => {
    const { status, page, limit } = req.query as unknown as ListBasketsQuery;

    const where = { ...(status ? { status } : {}) };
    const [items, total] = await Promise.all([
      prisma.basket.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.basket.count({ where }),
    ]);

    jsonValidated(res, BasketListResponseSchema, 200, {
      data: items,
      meta: { total, page, limit },
    });
  },
);

// GET /baskets/:id — basket detail with depositor positions
router.get(
  "/baskets/:id",
  validateParams(BasketIdParamSchema),
  validateResponse(BasketDetailSchema),
  async (req: Request, res: Response) => {
    const basket = await prisma.basket.findUnique({
      where: { id: req.params.id },
      include: { deposits: { orderBy: { createdAt: "desc" } } },
    });

    if (!basket) {
      problemDetail(res, req, 404, "Basket Not Found", `No basket with id ${req.params.id}`);
      return;
    }

    jsonValidated(res, BasketDetailSchema, 200, basket);
  },
);

// GET /baskets/:id/deposits — depositor positions for a basket
router.get(
  "/baskets/:id/deposits",
  validateParams(BasketIdParamSchema),
  validateResponse(z.array(BasketDepositSchema)),
  async (req: Request, res: Response) => {
    const deposits = await prisma.basketDeposit.findMany({
      where: { basketId: req.params.id },
      orderBy: { createdAt: "desc" },
    });
    jsonValidated(res, z.array(BasketDepositSchema), 200, deposits);
  },
);

// GET /basket-deposits?depositorAddress=... — a depositor's position across all baskets
router.get(
  "/basket-deposits",
  validateQuery(ListBasketDepositsQuerySchema),
  validateResponse(z.array(BasketDepositSchema)),
  async (req: Request, res: Response) => {
    const { depositorAddress } = req.query as unknown as ListBasketDepositsQuery;

    const deposits = await prisma.basketDeposit.findMany({
      where: { depositorAddress },
      orderBy: { createdAt: "desc" },
    });

    jsonValidated(res, z.array(BasketDepositSchema), 200, deposits);
  },
);

// GET /investor/basket — wallet-scoped summary of the investor's active basket (Issue #1050)
//
// The investor's wallet address is derived from the session, never from the
// query string, so an investor can only ever read their own data. The active
// basket is the basket owning the most recent deposit; amounts are i128
// stroop strings exactly as indexed on-chain.
router.get(
  "/investor/basket",
  requireWallet,
  validateResponse(InvestorBasketSummarySchema),
  async (req: WalletRequest, res: Response) => {
    const walletAddress = req.walletAddress!;

    const deposits = await prisma.basketDeposit.findMany({
      where: { depositorAddress: walletAddress },
      orderBy: { createdAt: "desc" },
    });

    if (deposits.length === 0) {
      problemDetail(
        res,
        req,
        404,
        "Basket Not Found",
        `No basket deposits found for ${walletAddress}`,
      );
      return;
    }

    // Active-basket selection: the basket owning the most recent deposit.
    const basket = await prisma.basket.findUnique({
      where: { id: deposits[0]!.basketId },
    });

    if (!basket) {
      problemDetail(
        res,
        req,
        404,
        "Basket Not Found",
        `No basket with id ${deposits[0]!.basketId}`,
      );
      return;
    }

    const positions = deposits.filter((d) => d.basketId === basket.id);

    // Totals: BigInt sum, re-serialized as i128 stroop strings so precision
    // survives the round trip (parsers must not route these through Number).
    let totalAllocated = 0n;
    let totalReturned = 0n;
    for (const position of positions) {
      totalAllocated += BigInt(position.amount || "0");
      if (position.claimed && position.payoutAmount) {
        totalReturned += BigInt(position.payoutAmount);
      }
    }

    jsonValidated(res, InvestorBasketSummarySchema, 200, {
      basket,
      positions,
      totalAllocated: totalAllocated.toString(),
      totalReturned: totalReturned.toString(),
    });
  },
);

export default router;
