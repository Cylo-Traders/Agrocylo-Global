import type { CorsOptions } from 'cors';
import { config } from './index.js';
import logger from './logger.js';

/**
 * Default local development & reverse-proxy (Caddy) origins supported out of the box.
 */
export const DEFAULT_LOCAL_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'http://localhost',
  'http://127.0.0.1',
];

/**
 * Browser request-header contract. Wallet identity is carried only by the
 * signed Bearer JWT; `x-wallet-address` is tolerated for legacy client calls
 * but is never trusted for authentication.
 * Both `x-idempotency-key` and the legacy `Idempotency-Key` spelling are
 * permitted during the deprecation window.
 */
export const CORS_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'Idempotency-Key',
  'x-idempotency-key',
  'x-api-key',
  'x-request-id',
  'x-wallet-address',
  'x-metrics-api-key',
];

export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (!origin || config.allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn(`CORS request rejected for disallowed origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: CORS_ALLOWED_HEADERS,
  // Lets browser code read the correlation id for support/debugging.
  exposedHeaders: ['x-request-id'],
  maxAge: 3600,
};
