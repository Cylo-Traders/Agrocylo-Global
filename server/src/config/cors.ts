import type { CorsOptions } from 'cors';
import { config } from './index.js';

/**
 * Browser request-header contract. Wallet identity is carried only by the
 * signed Bearer JWT; `x-wallet-address` is tolerated for legacy client calls
 * but is never trusted for authentication.
 */
export const CORS_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'Idempotency-Key',
  'x-api-key',
  'x-request-id',
  'x-wallet-address',
];

export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (!origin || config.allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
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
