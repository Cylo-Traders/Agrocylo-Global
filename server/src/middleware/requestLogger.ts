import type { NextFunction, Request, Response } from "express";
import logger from "../config/logger.js";

interface AuthenticatedRequest extends Request {
  user?: { id: string };
  id?: string;
}

export function requestLogger(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  const requestId = req.id || req.header("x-request-id") || "unknown";

  // Capture the original end function
  const originalEnd = res.end;

  // Override end to capture any errors
  res.end = function(...args: unknown[]) {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;

    logger.info("HTTP request", {
      requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      userId: req.user?.id,
      contentLength: res.getHeader("content-length"),
    });

    return originalEnd.apply(res, args);
  } as unknown as (data?: unknown, encoding?: BufferEncoding) => Response;

  // Attach error handler for errors thrown during request processing
  res.on("error", (error: unknown) => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const err = error instanceof Error ? error : new Error(String(error));

    logger.error("HTTP request error", {
      requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      userId: req.user?.id,
      error: err.message,
      stack: err.stack,
    });
  });

  next();
}

