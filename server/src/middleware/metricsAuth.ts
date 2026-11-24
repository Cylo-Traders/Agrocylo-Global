import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { config } from '../config/index.js';

/**
 * Guard for the Prometheus `/metrics` and `/metrics/prom` endpoints.
 *
 * Policy:
 * - Production: fail-closed. When `METRICS_API_KEY` is missing or unset, requests
 *   are rejected with 401 Unauthorized to prevent operational data leakage.
 * - Non-production (development/test): open-by-default with a one-time startup
 *   warning when unset so local scraping continues to work.
 * - When configured: requests must present a matching `Authorization: Bearer <key>`
 *   or `x-api-key` header.
 */
let warnedMissingKey = false;

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function requireMetricsAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = config.metricsApiKey || process.env.METRICS_API_KEY;
  const isProduction = (config.nodeEnv || process.env.NODE_ENV) === 'production';

  if (!expected) {
    if (isProduction) {
      if (!warnedMissingKey) {
        warnedMissingKey = true;
        console.warn(
          '[metricsAuth] METRICS_API_KEY is not configured in production. Rejecting request (fail-closed).'
        );
      }
      res.status(401).json({ error: 'Unauthorized: METRICS_API_KEY is not configured' });
      return;
    }

    if (!warnedMissingKey) {
      warnedMissingKey = true;
      console.warn(
        '[metricsAuth] METRICS_API_KEY is not set; /metrics is open. Set METRICS_API_KEY to require authentication.'
      );
    }
    next();
    return;
  }

  const header = req.header('authorization');
  const bearer =
    header && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
  const provided = bearer ?? req.header('x-api-key');

  if (!provided || !safeEqual(provided, expected)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

export const metricsAuth = requireMetricsAuth;
