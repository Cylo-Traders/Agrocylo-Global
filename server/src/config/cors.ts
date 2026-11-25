import type { CorsOptions } from 'cors';
import { config } from './index';

export const ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'Idempotency-Key',
  'X-Idempotency-Key',
];

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    // Non-browser clients (curl, server-to-server) send no Origin header.
    if (!origin || config.allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    // Don't pass an Error: that turns into a 500 from the error handler.
    // Deny cleanly and leave a server-side trace for debugging.
    console.warn(`[cors] blocked origin ${origin}; allowed: ${config.allowedOrigins.join(', ')}`);
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ALLOWED_HEADERS,
  credentials: true,
  maxAge: 600,
};
