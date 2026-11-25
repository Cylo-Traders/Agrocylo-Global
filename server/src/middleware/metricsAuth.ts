import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { config } from '../config/index.js';

/**
 * Guard for the `/metrics` and `/metrics/prom` endpoints (Issue #1425).
 *
 * Policy:
 * - In `production`, fail closed when `METRICS_API_KEY` is unset: return `503`
 *   with `code: "METRICS_UNAVAILABLE"` (and log a one-time warning) so no
 *   exposed deployment ever leaks operational metrics without authentication.
 * - In `development` / `test`, when `METRICS_API_KEY` is unset, allow only
 *   loopback or RFC1918 private-network callers (with a one-time warning) so
 *   local Prometheus scraping and dev smoke checks continue to work while
 *   non-private callers are rejected with `401`.
 * - Whenever `METRICS_API_KEY` is configured, all callers must present a
 *   matching `Authorization: Bearer <key>` (or `x-api-key` / `x-metrics-api-key`).
 */
let warnedMissingKey = false;
let warnedMissingKeyProd = false;

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function isLoopbackOrPrivateIp(ip: string | undefined): boolean {
  if (!ip) return true;
  const normalized = ip.trim().replace(/^::ffff:/i, '');
  if (
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === 'localhost' ||
    normalized.startsWith('127.')
  ) {
    return true;
  }
  if (normalized.startsWith('10.') || normalized.startsWith('192.168.')) {
    return true;
  }
  const match172 = /^172\.(\d{1,3})\./.exec(normalized);
  if (match172) {
    const secondOctet = Number(match172[1]);
    if (secondOctet >= 16 && secondOctet <= 31) {
      return true;
    }
  }
  if (
    normalized.toLowerCase().startsWith('fc') ||
    normalized.toLowerCase().startsWith('fd') ||
    normalized.toLowerCase().startsWith('fe80:')
  ) {
    return true;
  }
  return false;
}

export function resetMetricsAuthWarningsForTests(): void {
  warnedMissingKey = false;
  warnedMissingKeyProd = false;
}

export function requireMetricsAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const expected = (config.metricsApiKey || process.env.METRICS_API_KEY || '').trim();
  const nodeEnv = config.nodeEnv || process.env.NODE_ENV || 'development';

  if (!expected) {
    if (nodeEnv === 'production') {
      if (!warnedMissingKeyProd) {
        warnedMissingKeyProd = true;
        console.warn(
          '[metricsAuth] METRICS_API_KEY is not configured in production; failing closed on /metrics.'
        );
      }
      res.status(503).json({
        error: 'Metrics endpoint is disabled because METRICS_API_KEY is not configured',
        code: 'METRICS_UNAVAILABLE',
      });
      return;
    }

    const remoteIp =
      req.ip ||
      (req.socket && typeof req.socket.remoteAddress === 'string'
        ? req.socket.remoteAddress
        : undefined);
    if (!isLoopbackOrPrivateIp(remoteIp)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!warnedMissingKey) {
      warnedMissingKey = true;
      console.warn(
        '[metricsAuth] METRICS_API_KEY is not set; allowing unauthenticated local/private /metrics access in non-production. Set METRICS_API_KEY to require authentication.'
      );
    }
    next();
    return;
  }

  const header = req.header('authorization');
  const bearer =
    header && header.startsWith('Bearer ')
      ? header.slice('Bearer '.length).trim()
      : undefined;
  const provided =
    bearer ?? req.header('x-api-key') ?? req.header('x-metrics-api-key');

  if (!provided || !safeEqual(provided, expected)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

export const metricsAuth = requireMetricsAuth;
