import type { Request, Response, NextFunction } from "express";

const IDEMPOTENCY_KEY_HEADER = "x-idempotency-key";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedResponse {
  status: number;
  body: unknown;
  timestamp: number;
}

const responseCache = new Map<string, CachedResponse>();

export function requireIdempotencyKey(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers[IDEMPOTENCY_KEY_HEADER];
  if (!key || typeof key !== "string" || !key.trim()) {
    res.status(400).json({ error: "X-Idempotency-Key header is required" });
    return;
  }
  (req as any).idempotencyKey = key;
  next();
}

export function getCachedResponse(key: string): CachedResponse | null {
  const cached = responseCache.get(key);
  if (!cached) return null;

  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    responseCache.delete(key);
    return null;
  }

  return cached;
}

export function setCachedResponse(key: string, status: number, body: unknown): void {
  responseCache.set(key, {
    status,
    body,
    timestamp: Date.now(),
  });
}

export function clearIdempotencyCache(key: string): void {
  responseCache.delete(key);
}
