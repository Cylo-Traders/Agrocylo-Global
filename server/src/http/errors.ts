import type { Request, Response } from 'express';
import logger from '../config/logger.js';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly title: string,
    detail: string,
    public readonly type = 'about:blank',
    public readonly code?: string,
    public readonly details?: Record<string, unknown> | Array<unknown>,
  ) {
    super(detail);
    this.name = 'ApiError';
  }
}

export class NotFoundError extends ApiError {
  constructor(resource: string, identifier?: string) {
    const detail = identifier ? `${resource} not found: ${identifier}` : `${resource} not found`;
    super(404, 'Not Found', detail, 'https://cylos.io/errors/not-found', 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends ApiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(400, 'Bad Request', message, 'https://cylos.io/errors/validation', 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class AuthError extends ApiError {
  constructor(message = 'Authentication required') {
    super(401, 'Unauthorized', message, 'https://cylos.io/errors/unauthorized', 'UNAUTHORIZED');
    this.name = 'AuthError';
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = 'You do not have permission to perform this action') {
    super(403, 'Forbidden', message, 'https://cylos.io/errors/forbidden', 'FORBIDDEN');
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends ApiError {
  constructor(message: string) {
    super(409, 'Conflict', message, 'https://cylos.io/errors/conflict', 'CONFLICT');
    this.name = 'ConflictError';
  }
}

export class ServiceUnavailableError extends ApiError {
  constructor(message = 'Service temporarily unavailable') {
    super(
      503,
      'Service Unavailable',
      message,
      'https://cylos.io/errors/service-unavailable',
      'SERVICE_UNAVAILABLE',
    );
    this.name = 'ServiceUnavailableError';
  }
}

export function sendProblem(res: Response, req: Request, error: ApiError): void {
  const requestId =
    (typeof res.getHeader === 'function' ? (res.getHeader('x-request-id') as string) : undefined) ||
    req.header('x-request-id') ||
    undefined;

  const defaultCode =
    error.code ||
    (error.status === 400
      ? 'BAD_REQUEST'
      : error.status === 401
        ? 'UNAUTHORIZED'
        : error.status === 403
          ? 'FORBIDDEN'
          : error.status === 404
            ? 'NOT_FOUND'
            : error.status === 409
              ? 'CONFLICT'
              : error.status === 413
                ? 'PAYLOAD_TOO_LARGE'
                : error.status === 415
                  ? 'UNSUPPORTED_MEDIA_TYPE'
                  : error.status === 503
                    ? 'SERVICE_UNAVAILABLE'
                    : 'INTERNAL_SERVER_ERROR');

  const problemResponse: Record<string, unknown> = {
    type: error.type,
    title: error.title,
    status: error.status,
    detail: error.message,
    // Compatibility fields for diverse frontend consumers (Issue #1188)
    message: error.message,
    error: error.message,
    code: defaultCode,
    instance: req.originalUrl || req.url,
    timestamp: new Date().toISOString(),
  };

  if (requestId) {
    problemResponse.requestId = requestId;
  }

  if (error.details) {
    problemResponse.details = error.details;
  }

  res
    .status(error.status)
    .type('application/problem+json')
    .json(problemResponse);
}

export function handleServiceError(err: unknown, req: Request, res: Response): void {
  if (err instanceof ApiError) {
    logger.warn(`[${err.name}] ${err.message}`, { path: req.path, method: req.method, status: err.status });
    sendProblem(res, req, err);
    return;
  }

  const error = err instanceof Error ? err : new Error(String(err));
  logger.error('Unhandled service error', {
    error: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
  });

  // Never leak internal database or runtime error details to clients
  sendProblem(
    res,
    req,
    new ApiError(
      500,
      'Internal Server Error',
      'An unexpected error occurred. Please try again later.',
      'about:blank',
      'INTERNAL_SERVER_ERROR',
    ),
  );
}
