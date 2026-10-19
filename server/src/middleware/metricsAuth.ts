import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';

/**
 * Guard for the Prometheus `/metrics` endpoint.
 *
 * Policy: open-by-default. When `METRICS_API_KEY` is unset the endpoint is
 * served without authentication (with a one-time startup warning) so that
 * local/dev scraping keeps working. When the key is configured, requests must
 * present a matching `Authorization: Bearer <key>` header (or `x-api-key`).
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

export function metricsAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.METRICS_API_KEY;

  if (!expected) {
    if (!warnedMissingKey) {
      warnedMissingKey = true;
      // eslint-disable-next-line no-console
      console.warn(
        '[metricsAuth] METRICS_API_KEY is not set; /metrics is open. Set METRICS_API_KEY to require authentication.'
      );
    }
    next();
    return;
  }

  const header = req.headers.authorization;
  const bearer = header && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
  const provided = bearer ?? (req.headers['x-api-key'] as string | undefined);

  if (!provided || !safeEqual(provided, expected)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}
