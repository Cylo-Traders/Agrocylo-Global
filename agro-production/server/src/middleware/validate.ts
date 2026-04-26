import type { NextFunction, Request, Response } from "express";
import { z, ZodError } from "zod";

/**
 * Factory that returns an Express middleware validating req.body against a
 * Zod schema. Returns 400 with structured errors on failure.
 */
export function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json(formatZodError(result.error));
      return;
    }
    req.body = result.data;
    next();
  };
}

/**
 * Factory for validating req.query.
 */
export function validateQuery<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      res.status(400).json(formatZodError(result.error));
      return;
    }
    req.query = result.data as typeof req.query;
    next();
  };
}

/**
 * Factory for validating req.params.
 */
export function validateParams<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      res.status(400).json(formatZodError(result.error));
      return;
    }
    req.params = result.data as typeof req.params;
    next();
  };
}

function formatZodError(error: ZodError) {
  return {
    error: "Validation failed",
    details: error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
      code: issue.code,
    })),
  };
}
