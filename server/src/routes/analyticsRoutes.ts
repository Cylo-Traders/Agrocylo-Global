import express from "express";
import { getPriceIndex } from "../services/priceIndexService.js";

const router = express.Router();

router.get("/api/v1/analytics/price-index", async (req, res, next) => {
  try {
    const crop = typeof req.query.crop === "string" ? req.query.crop : undefined;
    const region = typeof req.query.region === "string" ? req.query.region : undefined;

    const entries = await getPriceIndex({ crop, region });
    res.status(200).json({ data: entries });
  } catch (error) {
    next(error);
  }
});

export default router;
