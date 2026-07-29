import express from "express";
import { ApiError, sendProblem } from "../http/errors.js";
import { requireWallet, type WalletRequest } from "../middleware/walletAuth.js";
import {
  createOrJoinGroupOrder,
  getGroupOrderById,
} from "../services/groupOrderService.js";

const router = express.Router();

router.post("/group-orders", requireWallet, async (req: WalletRequest, res, next) => {
  try {
    if (!req.walletAddress) {
      throw new ApiError(401, "Unauthorized", "Missing wallet");
    }

    const result = await createOrJoinGroupOrder({
      productId: String(req.body?.productId ?? ""),
      buyerWallet: req.walletAddress,
      quantity: String(req.body?.quantity ?? ""),
      targetQuantity:
        req.body?.targetQuantity !== undefined ? String(req.body.targetQuantity) : undefined,
      expiresInMinutes:
        typeof req.body?.expiresInMinutes === "number" ? req.body.expiresInMinutes : undefined,
    });

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/group-orders/:id", requireWallet, async (req: WalletRequest, res, next) => {
  try {
    if (!req.walletAddress) {
      throw new ApiError(401, "Unauthorized", "Missing wallet");
    }

    const result = await getGroupOrderById(String(req.params["id"] ?? ""));
    if (
      result.farmerWallet.toLowerCase() !== req.walletAddress.toLowerCase() &&
      !result.contributions.some((contribution) =>
        contribution.buyerWallet.toLowerCase() === req.walletAddress?.toLowerCase(),
      )
    ) {
      throw new ApiError(403, "Forbidden", "You do not have access to this group order");
    }

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

export function groupOrderErrorHandler(
  error: unknown,
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  if (error instanceof ApiError) {
    sendProblem(res, req, error);
    return;
  }

  next(error);
}

export default router;

