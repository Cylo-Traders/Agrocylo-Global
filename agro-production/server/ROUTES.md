# API Routes Documentation

## Route Registration

All routes are registered in [src/app.ts](src/app.ts) with the following structure:

- **Auth & Campaign Image Routes** (`src/routes/auth.ts`, `src/routes/campaignImageRoutes.ts`) — Available at root and `/api/v1`
- **Campaign, Order, Transaction, Product, Analytics Routes** — Mounted at `/api/v1` and at root (`/`) for client compatibility (Issue #1189)

## Middleware Stack

### Global Middleware
1. CORS (configurable via `CORS_ORIGINS`)
2. `express.json()` body parser
3. `defaultLimiter` — Rate limiting (100 req/60s by default)
4. Shutdown checker
5. Route handlers
6. 404 handler
7. `globalErrorHandler` — Consolidated error handler

### Route-Level Middleware

#### Authentication Routes (`/auth/*`)
- `authLimiter` — Strict rate limiting (10 req/60s by default, failed attempts only)
- `validateBody` or `validateQuery` — Zod schema validation
- Custom error handling via `problemDetail`

#### Write Operations (mutations)
- `writeLimiter` — Strict rate limiting (10 req/60s by default)
- `requireWallet` — Wallet authentication
- `validateBody` — Request body validation

#### Read Operations
- `validateQuery` or `validateParams` — Parameter validation
- `validateResponse` — Response schema validation

#### File Upload
- `requireWallet` — Wallet authentication
- `validateParams` — Parameter validation
- Multer upload handler
- Error handling via `globalErrorHandler`

## Error Handling

All errors are handled by `globalErrorHandler` which normalizes responses to RFC 7807 Problem Detail format:
- Multer errors (413 Payload Too Large)
- Storage errors
- HTTP errors (custom errors thrown by handlers)
- Unhandled errors (500 Internal Server Error)

## Rate Limiting

Rate limits can be configured via environment variables:
- `RATE_LIMIT_WINDOW_MS` — Window duration in milliseconds (default: 60000)
- `RATE_LIMIT_MAX_REQUESTS` — Default limit (default: 100)
- `RATE_LIMIT_WRITE_MAX_REQUESTS` — Mutation limit (default: 10)

Auth endpoints use 1/10 of the default limit with `skipSuccessfulRequests: true` for brute force protection.
