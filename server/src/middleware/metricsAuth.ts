import type { NextFunction, Request, Response } from "express";
import { config } from "../config/index.js";

/**
 * When METRICS_API_KEY is set, require it via `x-metrics-api-key` or
 * `Authorization: Bearer <key>`. When unset, metrics are open (use a reverse proxy or key in prod).
 */
export function requireMetricsAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = config.metricsApiKey;
  if (!expected) {
    next();
    return;
  }

  const headerKey = req.header("x-metrics-api-key");
  const auth = req.header("authorization");
  const bearer =
    auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : undefined;

  if (headerKey === expected || bearer === expected) {
    next();
    return;
  }

  res.status(401).json({ message: "Unauthorized: invalid or missing metrics credentials." });
}
