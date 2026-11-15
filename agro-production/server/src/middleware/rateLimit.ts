import rateLimit from 'express-rate-limit';
import { config } from '../config/index.js';
import { incrementRateLimitHit } from './rateLimitMetrics.js';

/** Default limiter applied to all routes. */
export const defaultLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMaxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, _next, options) => {
    incrementRateLimitHit('default');
    res.status(options.statusCode).send(options.message);
  },
  message: {
    error: 'Too many requests',
    retryAfter: `${config.rateLimitWindowMs / 1000}s`,
  },
});

/** Stricter limiter for mutating endpoints (invest, create order, etc.). */
export const writeLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: Math.max(1, config.rateLimitWriteMaxRequests),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, _next, options) => {
    incrementRateLimitHit('write');
    res.status(options.statusCode).send(options.message);
  },
  message: {
    error: 'Too many write requests',
    retryAfter: `${config.rateLimitWindowMs / 1000}s`,
  },
});

/** Very strict limiter for authentication endpoints (brute force protection). */
export const authLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: Math.max(1, Math.floor(config.rateLimitMaxRequests / 10)),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (req, res, _next, options) => {
    incrementRateLimitHit('auth');
    res.status(options.statusCode).send(options.message);
  },
  message: {
    error: 'Too many authentication attempts',
    retryAfter: `${config.rateLimitWindowMs / 1000}s`,
  },
});
