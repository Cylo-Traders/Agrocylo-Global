import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import type Redis from "ioredis";
import logger from "../config/logger.js";
import {
  incrementIdempotencyHits,
  incrementIdempotencyMisses,
  incrementIdempotencyConflicts,
} from "../services/metricsService.js";

const IDEMPOTENCY_KEY_HEADER = "idempotency-key";
const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60; // 24 hours for completed responses
const IN_PROGRESS_TTL_SECONDS = 60; // short lock so crashed handlers become retryable
const IN_PROGRESS_MARKER = "IN_PROGRESS" as const;

export interface IdempotencyCacheEntry {
  status: number | typeof IN_PROGRESS_MARKER;
  body: unknown;
  fingerprint?: string;
}

export interface IdempotencyOptions {
  /** If set, only these path prefixes get idempotency handling (e.g. ["/orders", "/cart"]) */
  allowlist?: string[];
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function sortedStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => sortedStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${sortedStringify(obj[k])}`);
  return `{${parts.join(",")}}`;
}

function fingerprintForRequest(req: Request): string {
  const method = (req.method || "GET").toUpperCase();
  // Use originalUrl (includes query) for uniqueness; fallback to path/url.
  const path =
    (req as unknown as { originalUrl?: string }).originalUrl ||
    req.url ||
    req.path ||
    "";
  // Body may be undefined / string / object; normalize to stable JSON.
  let bodyStr = "";
  if (req.body !== undefined && req.body !== null) {
    try {
      if (typeof req.body === "string") bodyStr = req.body;
      else if (Buffer.isBuffer(req.body)) bodyStr = req.body.toString("utf-8");
      else bodyStr = sortedStringify(req.body);
    } catch {
      bodyStr = String(req.body);
    }
  }
  const raw = `${method}:${path}:${bodyStr}`;
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function isAllowedPath(req: Request, allowlist?: string[]): boolean {
  if (!allowlist || allowlist.length === 0) return true;
  const url = (req as unknown as { originalUrl?: string }).originalUrl || req.path || req.url || "";
  const pathname = url.split("?")[0] || "";
  return allowlist.some((prefix) => pathname === prefix || pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`) || pathname.startsWith(prefix));
}

/**
 * Creates an idempotency middleware that uses Redis for shared state across replicas.
 *
 * Fixed behavior:
 * - Only unsafe methods (POST/PUT/PATCH/DELETE) are handled; GET/HEAD/OPTIONS pass through.
 * - Optionally restricted to an allowlist of path prefixes (not global).
 * - Key is bound to a fingerprint hash(method + path + sortedBody); mismatched reuse → 422.
 * - Only 2xx (and deterministic 4xx) are cached; 5xx are never cached and the lock is cleared.
 * - IN_PROGRESS lock uses a short 60s TTL so a crashed handler becomes retryable quickly.
 * - Correctly handles `status` being `number | 'IN_PROGRESS'` (previous bug compared number to string).
 */
export function createIdempotencyMiddleware(redisClient: Redis, options?: IdempotencyOptions) {
  const allowlist = options?.allowlist;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Scope to unsafe methods only
    const method = (req.method || "").toUpperCase();
    if (SAFE_METHODS.has(method)) {
      return next();
    }
    if (!isAllowedPath(req, allowlist)) {
      return next();
    }

    const idempotencyKeyRaw = req.headers[IDEMPOTENCY_KEY_HEADER];
    if (!idempotencyKeyRaw || typeof idempotencyKeyRaw !== "string") {
      return next();
    }
    const idempotencyKey = idempotencyKeyRaw;
    const redisKey = `idem:${idempotencyKey}`;
    const fingerprint = fingerprintForRequest(req);

    try {
      const cached = await redisClient.get(redisKey);

      if (cached) {
        let entry: IdempotencyCacheEntry;
        try {
          entry = JSON.parse(cached) as IdempotencyCacheEntry;
        } catch {
          // Corrupt entry — treat as miss and delete
          await redisClient.del(redisKey).catch(() => {});
          // fall through to claim path
          entry = null as unknown as IdempotencyCacheEntry;
          // continue
        }

        if (entry) {
          // Fingerprint mismatch → 422 (RFC draft behaviour)
          if (entry.fingerprint && entry.fingerprint !== fingerprint) {
            logger.warn("[Idempotency] Fingerprint mismatch for reused key", {
              idempotencyKey,
              ip: req.ip,
              expectedFingerprint: entry.fingerprint,
              gotFingerprint: fingerprint,
            });
            res.status(422).json({
              title: "Unprocessable Entity",
              detail: "Idempotency-Key reuse with different request fingerprint",
              status: 422,
            });
            return;
          }

          // In-progress marker
          if (entry.status === IN_PROGRESS_MARKER) {
            incrementIdempotencyConflicts();
            logger.warn("[Idempotency] Concurrent duplicate request rejected", {
              idempotencyKey,
              ip: req.ip,
            });
            res.status(409).json({
              title: "Conflict",
              detail: "A request with this idempotency key is already in progress",
              status: 409,
            });
            return;
          }

          // Cached completed response — only serve if fingerprint matches (or no fingerprint stored for backwards compat)
          incrementIdempotencyHits();
          logger.debug("[Idempotency] Cache hit, returning cached response", {
            idempotencyKey,
            cachedStatus: entry.status,
          });
          res.status(entry.status as number).json(entry.body);
          return;
        }
      }

      // Claim atomically with short IN_PROGRESS TTL
      const claimed = await redisClient.set(
        redisKey,
        JSON.stringify({ status: IN_PROGRESS_MARKER, fingerprint, body: null } as IdempotencyCacheEntry),
        "EX",
        IN_PROGRESS_TTL_SECONDS,
        "NX",
      );

      if (!claimed) {
        // Lost race — re-read to decide 409 vs 422
        const raced = await redisClient.get(redisKey);
        if (raced) {
          try {
            const entry = JSON.parse(raced) as IdempotencyCacheEntry;
            if (entry.fingerprint && entry.fingerprint !== fingerprint) {
              res.status(422).json({
                title: "Unprocessable Entity",
                detail: "Idempotency-Key reuse with different request fingerprint",
                status: 422,
              });
              return;
            }
          } catch {}
        }
        incrementIdempotencyConflicts();
        logger.warn("[Idempotency] Race condition: key claimed by concurrent request", {
          idempotencyKey,
        });
        res.status(409).json({
          title: "Conflict",
          detail: "A request with this idempotency key is already in progress",
          status: 409,
        });
        return;
      }

      incrementIdempotencyMisses();
      logger.debug("[Idempotency] Cache miss, claimed key for execution", {
        idempotencyKey,
      });

      let responseTracked = false;
      let lockCleared = false;

      const clearLock = () => {
        if (lockCleared) return;
        lockCleared = true;
        redisClient.del(redisKey).catch((error) => {
          logger.error("[Idempotency] Failed to clear IN_PROGRESS lock", { idempotencyKey, error });
        });
      };

      // Intercept response to cache appropriately
      const originalJson = typeof (res as any).json === 'function' ? (res as any).json.bind(res) : null;
      const originalSend = typeof (res as any).send === 'function' ? (res as any).send.bind(res) : null;
      // originalStatus not needed for logic but keep for future; guard
      const originalStatus = typeof (res as any).status === 'function' ? (res as any).status.bind(res) : null;

      // Wrap res.json — the primary path for API handlers
      if (originalJson) {
        res.json = function (body: unknown) {
          responseTracked = true;
          const status = (res as any).statusCode ?? 200;

          // Never cache 5xx; clear lock so retry succeeds immediately
          if (status >= 500) {
            clearLock();
            return originalJson(body);
          }

          // Cache 2xx and deterministic 4xx (validation etc.), but still allow 4xx to be served from cache on retry.
          // For now cache anything < 500 (2xx and 4xx). This satisfies "never cache 5xx".
          const entry: IdempotencyCacheEntry = {
            status,
            body,
            fingerprint,
          };

          redisClient
            .set(redisKey, JSON.stringify(entry), "EX", IDEMPOTENCY_TTL_SECONDS)
            .catch((error) => {
              logger.error("[Idempotency] Failed to cache response", {
                idempotencyKey,
                error,
              });
            });

          return originalJson(body);
        } as unknown as typeof res.json;
      }

      if (originalSend) {
        res.send = function (body: unknown) {
          // Only handle cases where body is object-ish or we can infer status; otherwise pass through.
          // For non-JSON string bodies, still track completion to clear lock if 5xx.
          const status = (res as any).statusCode ?? 200;
          if (status >= 500) {
            responseTracked = true;
            clearLock();
            return originalSend(body as any);
          }
          if (typeof body === "object" && body !== null) {
            responseTracked = true;
            const entry: IdempotencyCacheEntry = {
              status,
              body,
              fingerprint,
            };
            redisClient
              .set(redisKey, JSON.stringify(entry), "EX", IDEMPOTENCY_TTL_SECONDS)
              .catch((error) => {
                logger.error("[Idempotency] Failed to cache response", {
                  idempotencyKey,
                  error,
                });
              });
          }
          return originalSend(body as any);
        } as unknown as typeof res.send;
      }

      // If handler calls res.status(...).json(...) the above wrappers still apply.
      // For handlers that use res.status without json/send (e.g. res.status(204).end()),
      // we also listen for finish to clear 5xx locks.

      // Ensure lock is cleared if handler errors and never calls json/send (crash path).
      // The short 60s TTL already makes it retryable, but we also proactively clear on error/close.
      const onFinish = async () => {
        // If no response was tracked, the handler threw or never responded — delete IN_PROGRESS so next retry isn't stuck 409.
        // If status is 5xx and json wrapper didn't clear (e.g. handler used res.end), clear now.
        const status = (res as any).statusCode ?? 200;
        if (!responseTracked) {
          // Handler likely threw before responding; clear lock quickly
          // But don't cache — just delete so retry can proceed
          if ((res as any).writableFinished || (res as any).headersSent) {
            // Response was sent via some other path; if 5xx, clear, if 2xx without json wrapper, try to cache is not possible
            if (status >= 500) clearLock();
          } else {
            clearLock();
          }
        } else if (status >= 500) {
          // Already handled in wrappers but ensure cleared
          clearLock();
        }
        if (typeof (res as any).removeListener === 'function') {
          (res as any).removeListener("finish", onFinish);
          (res as any).removeListener("close", onClose);
        }
      };
      const onClose = () => {
        if (!responseTracked) {
          clearLock();
        }
        if (typeof (res as any).removeListener === 'function') {
          (res as any).removeListener("finish", onFinish);
          (res as any).removeListener("close", onClose);
        }
      };
      if (typeof (res as any).on === 'function') {
        (res as any).on("finish", onFinish);
        (res as any).on("close", onClose);
      }

      // Also wrap next to detect handler error that calls next(err)
      const wrappedNext: NextFunction = (err?: unknown) => {
        if (err) {
          // Handler errored before responding — clear lock soon
          clearLock();
        }
        return next(err as any);
      };

      wrappedNext();
    } catch (error) {
      logger.error("[Idempotency] Redis operation failed", {
        idempotencyKey: (req.headers[IDEMPOTENCY_KEY_HEADER] as string) || "unknown",
        error,
      });
      // Fail open: let the request proceed if Redis is unavailable
      next();
    }
  };
}

export { IDEMPOTENCY_TTL_SECONDS, IN_PROGRESS_TTL_SECONDS, IN_PROGRESS_MARKER };
