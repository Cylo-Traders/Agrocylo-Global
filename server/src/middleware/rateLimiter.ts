import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';
import logger from '../config/logger.js';
import { ApiError, sendProblem } from '../http/errors.js';

const isTest = process.env['NODE_ENV'] === 'test';

function rateLimitHandler(req: Request, res: Response): void {
  logger.warn('[RateLimit] Request throttled', {
    ip: req.ip,
    path: req.path,
    method: req.method,
  });
  sendProblem(res, req, new ApiError(
    429,
    'Too Many Requests',
    'You have exceeded the request limit. Please try again later.',
    'https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/429',
  ));
}

// 10 requests per 15-minute window per IP for auth endpoints (nonce + verify)
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: rateLimitHandler,
  skip: () => isTest,
});

// 5 uploads per minute per IP
export const uploadRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: rateLimitHandler,
  skip: () => isTest,
});
