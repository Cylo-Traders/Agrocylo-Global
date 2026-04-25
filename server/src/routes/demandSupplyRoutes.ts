import express from "express";
import { requireWallet, type WalletRequest } from "../middleware/walletAuth.js";
import { ApiError } from "../http/errors.js";
import { createBuyerDemand } from "../services/demandService.js";
import { createFarmerSupply } from "../services/supplyService.js";

const router = express.Router();

router.post("/demand", requireWallet, async (req: WalletRequest, res, next) => {
  try {
    if (!req.walletAddress) {
      throw new ApiError(401, "Unauthorized", "Missing wallet", "https://cylos.io/errors/unauthorized");
    }
    const data = await createBuyerDemand(req.walletAddress, req.body ?? {});
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

router.post("/supply", requireWallet, async (req: WalletRequest, res, next) => {
  try {
    if (!req.walletAddress) {
      throw new ApiError(401, "Unauthorized", "Missing wallet", "https://cylos.io/errors/unauthorized");
    }
    const data = await createFarmerSupply(req.walletAddress, req.body ?? {});
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

export default router;
