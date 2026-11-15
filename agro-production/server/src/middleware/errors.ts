import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import logger from '../config/logger.js';
import { Sentry } from '../config/sentry.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class StorageError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly originalError?: unknown,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

/**
 * RFC 7807 Problem Detail shape.
 * https://datatracker.ietf.org/doc/html/rfc7807
 */
export interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  [key: string]: unknown;
}

export function problemDetail(
  res: Response,
  req: Request,
  status: number,
  title: string,
  detail?: string,
  extra?: Record<string, unknown>,
): void {
  const body: ProblemDetail = {
    type: `https://agrocylo.io/errors/${slugify(title)}`,
    title,
    status,
    instance: req.path,
    ...(detail ? { detail } : {}),
    ...extra,
  };
  res.status(status).type('application/problem+json').json(body);
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '-');
}

// Global error handler: consolidates all error types (must have 4 params for Express).
export function globalErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Multer file upload errors
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    problemDetail(res, req, 413, 'Payload Too Large', 'Max image size is 5MB');
    return;
  }

  // Storage service errors
  if (err instanceof StorageError) {
    // 5xx-rate tracking happens once, generically, in the `finish`-based
    // metrics middleware in app.ts (it reads the final res.statusCode
    // regardless of which handler set it) — only Sentry capture, which needs
    // the actual exception object, belongs here.
    if (err.status >= 500) {
      Sentry.captureException(err);
    }
    problemDetail(res, req, err.status, 'Storage Error', err.message);
    return;
  }

  // HTTP errors (e.g., from route handlers)
  if (err instanceof HttpError) {
    if (err.status >= 500) {
      Sentry.captureException(err);
    }
    problemDetail(res, req, err.status, 'Request Error', err.message);
    return;
  }

  // Unhandled errors
  logger.error('Unhandled request error', { error: err, path: req.path });
  Sentry.captureException(err);
  problemDetail(res, req, 500, 'Internal Server Error');
}
