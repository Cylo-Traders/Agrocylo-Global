import rateLimit from "express-rate-limit";
import { config } from "../config/index.js";

/** Default limiter applied to all routes. */
export const defaultLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMaxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many requests",
    retryAfter: `${config.rateLimitWindowMs / 1000}s`,
  },
});

/** Stricter limiter for mutating endpoints (invest, create order, etc.). */
export const writeLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: Math.max(1, Math.floor(config.rateLimitMaxRequests / 10)),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many write requests",
    retryAfter: `${config.rateLimitWindowMs / 1000}s`,
  },
});
