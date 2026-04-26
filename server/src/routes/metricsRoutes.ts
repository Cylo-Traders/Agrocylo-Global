import express from "express";
import { requireMetricsAuth } from "../middleware/metricsAuth.js";
import { getPlatformMetrics } from "../services/metricsService.js";

const router = express.Router();

router.get("/metrics", requireMetricsAuth, async (_req, res, next) => {
  try {
    const payload = await getPlatformMetrics();
    res.status(200).type("application/json").json(payload);
  } catch (error) {
    next(error);
  }
});

export default router;
