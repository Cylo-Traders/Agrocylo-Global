import express from "express";
import { requireWallet, type WalletRequest } from "../middleware/walletAuth.js";
import { ApiError } from "../http/errors.js";
import { createBuyerDemand, listBuyerDemands } from "../services/demandService.js";
import { createFarmerSupply, listFarmerSupplies } from "../services/supplyService.js";

const router = express.Router();

router.get("/demand", async (req, res) => {
  const result = await listBuyerDemands({
    buyerWallet: typeof req.query['buyerWallet'] === 'string' ? req.query['buyerWallet'] : undefined,
    cropName: typeof req.query['cropName'] === 'string' ? req.query['cropName'] : undefined,
    region: typeof req.query['region'] === 'string' ? req.query['region'] : undefined,
    page: typeof req.query['page'] === 'string' ? req.query['page'] : undefined,
    pageSize: typeof req.query['page_size'] === 'string' ? req.query['page_size'] : undefined,
  });
  res.status(200).json(result);
});

router.get("/supply", async (req, res) => {
  const result = await listFarmerSupplies({
    farmerWallet: typeof req.query['farmerWallet'] === 'string' ? req.query['farmerWallet'] : undefined,
    cropName: typeof req.query['cropName'] === 'string' ? req.query['cropName'] : undefined,
    page: typeof req.query['page'] === 'string' ? req.query['page'] : undefined,
    pageSize: typeof req.query['page_size'] === 'string' ? req.query['page_size'] : undefined,
  });
  res.status(200).json(result);
});

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
