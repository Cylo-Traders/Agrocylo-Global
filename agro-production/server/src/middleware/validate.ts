import type { NextFunction, Request, Response } from 'express';
import type { ZodError, ZodTypeAny } from 'zod';
import logger from '../config/logger.js';

export interface ValidationIssue {
  field: string;
  message: string;
  code: string;
}

export interface ValidationProblemDetail {
  type: string;
  title: 'Validation Failed';
  status: 400;
  instance: string;
  errors: ValidationIssue[];
}

/**
 * Factory that returns an Express middleware validating req.body against a
 * Zod schema. Returns RFC 7807 Problem Detail on failure.
 */
export function validateBody<T extends ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res
        .status(400)
        .type('application/problem+json')
        .json(formatZodError(result.error, req.path));
      return;
    }
    req.body = result.data;
    next();
  };
}

/**
 * Factory for validating req.query.
 */
export function validateQuery<T extends ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      res
        .status(400)
        .type('application/problem+json')
        .json(formatZodError(result.error, req.path));
      return;
    }
    req.query = result.data as typeof req.query;
    next();
  };
}

/**
 * Factory for validating req.params.
 */
export function validateParams<T extends ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      res
        .status(400)
        .type('application/problem+json')
        .json(formatZodError(result.error, req.path));
      return;
    }
    req.params = result.data as typeof req.params;
    next();
  };
}

/**
 * Wraps res.json to validate the outgoing payload against a Zod schema.
 * Logs a warning on mismatch without altering the HTTP response.
 */
export function validateResponse<T extends ZodTypeAny>(schema: T) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      const result = schema.safeParse(body);
      if (!result.success) {
        logger.warn('Response failed schema validation', {
          path: res.req?.path,
          issues: result.error.issues,
        });
      }
      return originalJson(body);
    };
    next();
  };
}

export function formatZodError(
  error: ZodError,
  instance: string,
): ValidationProblemDetail {
  return {
    type: 'https://agrocylo.io/errors/validation-failed',
    title: 'Validation Failed',
    status: 400,
    instance,
    errors: error.issues.map((issue) => ({
      field: issue.path.join('.') || '(root)',
      message: issue.message,
      code: issue.code,
    })),
  };
}

/** Serialize a validated payload for res.json after response schema parsing. */
export function jsonValidated<T extends ZodTypeAny>(
  res: Response,
  schema: T,
  statusCode: number,
  payload: unknown,
): void {
  const result = schema.safeParse(payload);
  if (!result.success) {
    logger.warn('Handler returned data that failed response schema', {
      issues: result.error.issues,
    });
    res.status(statusCode).json(payload);
    return;
  }
  res.status(statusCode).json(result.data);
}
