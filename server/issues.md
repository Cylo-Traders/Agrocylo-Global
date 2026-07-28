# Backend Issues for `server`

This document collects backend improvement opportunities for the Agrocylo `server` app.

All work should be scoped to `/Agrocylo-Global/server`.

## 1. Contract watcher resilience and event processing

**Objective / Summary**
- Improve reliability and correctness of the Soroban contract watcher pipeline so blockchain events are processed safely and replayed consistently after failures.

**Path**
- `/Agrocylo-Global/server/src/services/contractWatcher.ts`
- `/Agrocylo-Global/server/src/services/events/`
- `/Agrocylo-Global/server/src/config/database.ts`

**Proposed solution**
- Replace the current `setInterval` polling loop with a restartable, backoff-aware watcher.
- Ensure event processing is sequential and checkpoint persistence is atomic.
- Add stronger duplicate event detection and recovery handling when the watcher falls behind the latest ledger.
- Centralize ingestion of blockchain events instead of importing event handlers dynamically in each polling cycle.

**Acceptance criteria**
- Contract watcher resumes correctly after temporary RPC failures.
- Checkpoint ledger updates only after event ingestion succeeds.
- Duplicate or replayed events do not corrupt the database state.
- Startup logs clearly indicate whether watcher mode is enabled and where it will resume from.

**Tests needed**
- Unit tests for `dispatchEvent()` and checkpoint recovery logic.
- Integration test simulating RPC failures and ensuring the watcher resumes without data loss.

## 2. Unified API error handling and RFC7807 responses

**Objective / Summary**
- Make backend error handling consistent across routes and ensure API clients receive structured problem details.

**Path**
- `/Agrocylo-Global/server/src/app.ts`
- `/Agrocylo-Global/server/src/http/errors.ts`
- `/Agrocylo-Global/server/src/routes/**/*.ts`

**Proposed solution**
- Add a shared global error handler that translates thrown `ApiError` instances and unexpected errors into RFC7807 responses.
- Replace manual `res.status(...).json({ error: ... })` patterns in controllers and routes with a unified error strategy.
- Ensure missing or invalid user input returns proper 4xx problem responses.

**Acceptance criteria**
- Most route failures return `application/problem+json` when the error is an `ApiError`.
- Unexpected failures still return a sanitized 500 problem response.
- No route should bypass the central error formatting and return ad hoc JSON error shapes.

**Tests needed**
- Integration tests verifying problem responses for validation errors and internal server errors.
- Regression tests ensuring existing auth and order routes still return expected HTTP statuses.

## 3. Improve WebSocket authentication and broadcast robustness

**Objective / Summary**
- Harden backend WebSocket behavior and ensure event broadcasts reach authenticated clients reliably.

**Path**
- `/Agrocylo-Global/server/src/services/wsManager.ts`
- `/Agrocylo-Global/server/src/services/notificationService.ts`
- `/Agrocylo-Global/server/src/index.ts`

**Proposed solution**
- Validate and parse WebSocket auth tokens more explicitly, with clear error statuses.
- Add heartbeat/ping handling to detect stale/disconnected clients.
- Ensure broadcast methods handle uppercase/lowercase wallet normalization consistently.
- Add telemetry for connected clients and dropped messages.

**Acceptance criteria**
- Auth failures close WebSocket connections with a clear code and message.
- Clients are removed cleanly when disconnected or unresponsive.
- `broadcastTo()` consistently routes notifications to the correct wallet address even with mixed-case keys.

**Tests needed**
- Unit tests for WebSocket auth and wallet matching logic.
- Integration test that verifies authenticated client receives `notification:new` messages.

## 4. Optimize Prisma queries and order stats aggregation

**Objective / Summary**
- Reduce slow database operations and avoid unnecessary in-memory aggregation for order/notification routes.

**Path**
- `/Agrocylo-Global/server/src/controllers/orderController.ts`
- `/Agrocylo-Global/server/src/services/orderService.ts`
- `/Agrocylo-Global/server/src/services/notificationService.ts`

**Proposed solution**
- Replace current in-memory order stats calculations with Prisma aggregate queries.
- Add appropriate indexes for frequent filters such as `sellerAddress`, `walletAddress`, `orderId`, and `createdAt`.
- Ensure notification queries use descending ordering for recent-first consumption if the frontend expects newest notifications first.

**Acceptance criteria**
- Seller stats endpoint is backed by DB aggregates and avoids loading all orders into memory.
- Notification list queries are performant under large volume.
- No major order/list endpoints exhibit N+1 query patterns.

**Tests needed**
- Service tests validating correct aggregation results for seller stats.
- Performance regression benchmark or query explain validation for the orders endpoint.

## 5. Harden authentication and wallet token lifecycle

**Objective / Summary**
- Improve security and reliability of wallet-based authentication, nonce handling, refresh, and logout flows.

**Path**
- `/Agrocylo-Global/server/src/routes/authRoutes.ts`
- `/Agrocylo-Global/server/src/services/authService.ts`
- `/Agrocylo-Global/server/src/middleware/*`

**Proposed solution**
- Confirm nonce expiry and one-time use semantics in the auth service.
- Add refresh token revocation or rotation support if not already implemented.
- Validate JWT secrets and token expiry behavior on startup.

**Acceptance criteria**
- Nonces cannot be replayed after successful verification.
- Refresh tokens are invalidated after logout.
- Auth endpoints return consistent 401/403 codes for invalid or expired credentials.

**Tests needed**
- Unit tests for nonce generation, signature verification, and refresh behavior.
- Integration tests for auth refresh and logout edge cases.

## 6. Add API rate limiting and upload validation

**Objective / Summary**
- Protect the backend from abusive upload and auth traffic, and guard the API against malformed input.

**Path**
- `/Agrocylo-Global/server/src/routes/productImageRoutes.ts`
- `/Agrocylo-Global/server/src/routes/authRoutes.ts`
- `/Agrocylo-Global/server/src/middleware/upload.ts`

**Proposed solution**
- Add rate limiting middleware for sensitive endpoints like `/auth`, `/orders`, and image uploads.
- Enforce file size, file type, and total upload count limits in `multer` configuration.
- Return clear `429 Too Many Requests` and `400 Bad Request` responses for invalid submissions.

**Acceptance criteria**
- Auth and upload routes are rate-limited in development and production.
- Product image uploads reject unsupported formats and oversized files gracefully.
- The server logs rate-limit events without crashing.

**Tests needed**
- Integration tests for rate limit behavior.
- Upload tests ensuring invalid file payloads are rejected with proper HTTP status.

## 7. Add backend observability and health checks

**Objective / Summary**
- Improve operational visibility with better health checks, metrics, and logging around system dependencies.

**Path**
- `/Agrocylo-Global/server/src/routes/metricsRoutes.ts`
- `/Agrocylo-Global/server/src/app.ts`
- `/Agrocylo-Global/server/src/config/index.ts`

**Proposed solution**
- Extend `/health` to verify database and Supabase connectivity.
- Add application metrics for request counts, error rates, and contract watcher status.
- Make metrics route accessible to Prometheus or external monitoring.

**Acceptance criteria**
- Health endpoint returns `DOWN` when DB or Supabase is unavailable.
- Metrics endpoint exposes request and error counters.
- Startup logs include config values for required external services (without secrets).

**Tests needed**
- Health check test that simulates a failing database connection.
- Metrics route test verifying exposed counters and gauge values.

## 8. Improve backend test coverage for critical services

**Objective / Summary**
- Strengthen server-side regression protection by adding tests around blockchain event ingestion, auth, and error propagation.

**Path**
- `/Agrocylo-Global/server/src/services/**/*.test.ts`
- `/Agrocylo-Global/server/src/routes/api.integration.test.ts`
- `/Agrocylo-Global/server/src/controllers/*.test.ts`

**Proposed solution**
- Add targeted tests for the watcher event pipeline, WebSocket notification routing, and auth token lifecycle.
- Consolidate existing integration and unit tests to cover failure modes and expected problem responses.
- Add fixtures for mocked RPC events and Prisma queries.

**Acceptance criteria**
- Test coverage improves for key backend modules like contract watcher, WebSocket manager, and auth services.
- Critical failure paths are covered by automated tests.
- `npm test` passes with the new coverage additions.

**Tests needed**
- Unit tests for `wsManager` and `NotificationService` broadcast logic.
- Integration tests for auth and health endpoints.
- Event pipeline tests covering `dispatchEvent()` and duplicate handling.

## 9. Add backend documentation and contributor guidance

**Objective / Summary**
- Help external contributors understand backend setup, environment requirements, and developer workflows.

**Path**
- `/Agrocylo-Global/server/README.md`
- `/Agrocylo-Global/server/.env.example`
- `/Agrocylo-Global/server/CONTRIBUTING.md`

**Proposed solution**
- Add a backend-specific `CONTRIBUTING.md` or expand the existing README with a contributor section.
- Document how to run the server, contract watcher, workers, and test suites locally.
- Include a clear issue/PR checklist for backend changes.

**Acceptance criteria**
- Contributors can follow the repo docs to run the server and tests locally.
- Environment requirements are clearly documented and aligned with `.env.example`.
- There is a short developer workflow section for backend bug fixes and features.

**Tests needed**
- Manual validation that the README steps work in a clean checkout.
- Optional docs linting if supported by the repo.

## 10. Add contract configuration validation at startup

**Objective / Summary**
- Prevent the backend from starting in a partially configured contract-watch mode with invalid or missing Soroban contract settings.

**Path**
- `/Agrocylo-Global/server/src/config/index.ts`
- `/Agrocylo-Global/server/src/services/contractWatcher.ts`
- `/Agrocylo-Global/server/src/index.ts`

**Proposed solution**
- Validate `CONTRACT_ID`, `RPC_URL`, and related env vars at startup.
- If `RUN_CONTRACT_WATCHER` is enabled without valid config, fail fast with a clear startup error.
- Document the requirement in `README.md` and `.env.example`.

**Acceptance criteria**
- Startup fails cleanly when required contract watcher env vars are missing or malformed.
- The server logs the missing configuration and exits instead of silently skipping the watcher.
- Non-watcher REST-only workflows can still start if the config is intentionally absent.

**Tests needed**
- Unit test for startup config validation logic.
- Manual test verifying the server fails fast with invalid contract watcher config.
