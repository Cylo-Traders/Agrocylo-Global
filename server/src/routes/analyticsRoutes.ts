import express from "express";
import { getPriceIndex } from "../services/priceIndexService.js";
import { ApiError, sendProblem } from "../http/errors.js";
import { analyticsRateLimiter } from "../middleware/rateLimiter.js";
import { ingestAnalyticsBatch } from "../services/analyticsService.js";

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

// POST /api/analytics — consent-respecting batch ingestion.
// Contract mirrors client/src/lib/analytics.ts transport: { consent?, events[] }.
router.post("/api/analytics", analyticsRateLimiter, async (req, res, next) => {
  try {
    const rawSize = req.headers["content-length"] ? Number(req.headers["content-length"]) : undefined;
    const result = ingestAnalyticsBatch(req.body ?? {}, Number.isFinite(rawSize) ? rawSize : undefined);
    const status = result.stored === 0 && result.skipped > 0 ? 202 : 200;
    res.status(status).json(result);
  } catch (error) {
    next(error);
  }
});

export function analyticsErrorHandler(
  error: unknown,
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  if (error instanceof ApiError) {
    sendProblem(res, req, error);
    return;
  }
  if (error instanceof SyntaxError || (error as { type?: string })?.type === "entity.too.large") {
    sendProblem(
      res,
      req,
      new ApiError(400, "Bad Request", "Invalid or oversized analytics payload", "https://cylos.io/errors/validation"),
    );
    return;
  }
  next(error);
}

export default router;
