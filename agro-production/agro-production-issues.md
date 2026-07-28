# Agro Production — Issues and Contribution Opportunities

This file enumerates bugs, integration checks, and feature ideas for the `agro-production` subproject. Each entry is ready to copy into a GitHub issue.

---

## 1) Missing root README and setup docs
- Labels: documentation, good first issue
- Description: The `agro-production/README.md` is empty. New contributors need clear setup and run instructions (dev/build/test, env vars, contract deployment steps).
- Files: [agro-production/README.md](agro-production/README.md)
- Suggested tasks:
  - Add a comprehensive README with environment vars, quick start, and architecture diagram.
  - Link to `client/README.md` and `server` setup notes.
- Difficulty: easy

## 2) Persist Soroban event listener high-watermark
- Labels: backend, reliability
- Description: The Soroban event listener tracks per-contract watermarks in memory only; a restart will cause event replays or missed events. Persist the high-watermark ledger per contract to the database so the listener resumes exactly where it left off.
- Files: [server/src/services/sorobanEventListener.ts](server/src/services/sorobanEventListener.ts)
- Suggested tasks:
  - Add a `soroban_watermarks` table (contract_id, watermark, updated_at).
  - On startup, load persisted watermarks and continue from there.
  - Update the persisted value after each successful poll.
- Difficulty: medium

## 3) Improve Soroban polling resilience and backoff
- Labels: backend, reliability
- Description: The listener polls every 5s without exponential backoff on repeated RPC failures; this can overload the RPC endpoint and cause noisy logs.
- Files: [server/src/services/sorobanEventListener.ts](server/src/services/sorobanEventListener.ts)
- Suggested tasks:
  - Implement retry/backoff per-contract on repeated errors.
  - Add metrics + circuit-breaker behavior to temporarily stop polling a failing RPC endpoint.
- Difficulty: medium

## 4) Duplicate/garbled WebSocket implementation (build/runtime bug)
- Labels: bug, backend
- Description: `server/src/services/wsServer.ts` contains duplicate/conflicting implementations concatenated together. This likely causes build/runtime errors and makes the WebSocket API unreliable.
- Files: [server/src/services/wsServer.ts](server/src/services/wsServer.ts)
- Suggested tasks:
  - Clean up and consolidate the exported WebSocket API (single `attachWebSocketServer`, `broadcast`, `close` surface).
  - Add unit tests for broadcast and connection handling.
- Difficulty: medium

## 5) Unify and document environment variables
- Labels: docs, infra
- Description: Env naming is inconsistent across layers (server uses `PRODUCTION_CONTRACT_ID` / `ESCROW_CONTRACT_ID`, client expects `NEXT_PUBLIC_PRODUCTION_CONTRACT_ID`, etc.). Provide a single documented mapping and example `.env` files for local dev and CI.
- Files: [server/src/config/index.ts](server/src/config/index.ts), [client/README.md](client/README.md), [client/src/lib/contractService.ts](client/src/lib/contractService.ts)
- Suggested tasks:
  - Add `agro-production/.env.example` showing both server and client vars (NEXT_PUBLIC_* for client).
  - Consider a short script to export the right NEXT_PUBLIC_* vars when running the frontend.
- Difficulty: easy

## 6) Replace client polling for indexing with server push
- Labels: enhancement, frontend, backend
- Description: The client polls the REST API to wait for indexed investments (`waitForIndexedInvestment`). The server already supports WebSocket broadcasting — leverage it to notify clients when a transaction is indexed to improve UX and reduce polling load.
- Files: [client/src/services/investmentService.ts](client/src/services/investmentService.ts), [server/src/services/wsServer.ts](server/src/services/wsServer.ts)
- Suggested tasks:
  - Emit a `campaign.invested` / `order.*` event from the server when events are indexed.
  - Add a lightweight websocket hook on the client to resolve indexing waits.
- Difficulty: medium

## 7) Add end-to-end integration tests (client ↔ server ↔ contract)
- Labels: tests, integration
- Description: While contracts have extensive unit/tests snapshots, full integration tests that exercise the client building XDR, signing (mocked), submitting, server indexing, and REST read-model would catch regressions across layers.
- Files: test scaffolding: [client/__tests__](client/src/__tests__), [server/src/test](server/src/test), [contract/test_snapshots](contract/production_escrow/test_snapshots)
- Suggested tasks:
  - Create an E2E harness that runs a local Soroban RPC (or mocked RPC), deploys the contract fixture, runs the server, then simulates the client flow.
  - Add CI job for these tests (optional: gated on a separate job to keep runs fast).
- Difficulty: hard

## 8) Validate and surface contract error messages in UI
- Labels: frontend, ux
- Description: Contract and Soroban runtime errors can be opaque. Improve mapping from simulation/submit errors to readable UI messages and add telemetry for failed simulations.
- Files: [client/src/lib/errorHandling.ts](client/src/lib/errorHandling.ts), [client/src/lib/signTransaction.ts](client/src/lib/signTransaction.ts)
- Suggested tasks:
  - Create friendly user-facing messages for common error classes (simulation failed, insufficient balance, denied by wallet).
  - Track errors via `/api/errors` and add helpful troubleshooting links in the UI.
- Difficulty: easy

## 9) Review rate limiting and sensitive endpoints
- Labels: security, backend
- Description: The server exposes write endpoints that should be rate-limited and protected; review `express-rate-limit` configuration and confirm write limits are strict enough for production use.
- Files: [server/src/config/index.ts](server/src/config/index.ts), server app middlewares
- Suggested tasks:
  - Verify read/write rate limit separation and tighten write limits.
  - Add automated tests to ensure rate limits are enforced under load.
- Difficulty: medium

## 10) Add monitoring, alerting, and health endpoints
- Labels: ops, enhancement
- Description: Add health-check endpoints (DB connectivity, RPC reachability, latest indexed ledger) and basic Prometheus metrics for uptime, event ingestion rate, and ws client count.
- Files: [server/src/index.ts](server/src/index.ts), [server/src/services/sorobanEventListener.ts](server/src/services/sorobanEventListener.ts), [server/src/services/wsServer.ts](server/src/services/wsServer.ts)
- Suggested tasks:
  - Add `/health` and `/metrics` endpoints.
  - Emit metrics for last processed ledger and event rates.
- Difficulty: medium

## 11) Add navigation from main frontend to agro-production app
+- Labels: enhancement, frontend, navigation
+- Description: Users need a clear way to navigate from the main `client/` frontend to the agro-production app (e.g., a button or link in the main navigation or a dedicated landing page). This improves user discovery and seamless access to the agro-production module.
+- Directory: `/client/src/` (main client frontend)
+- Suggested implementation:
+  - Add a new route or button in the main app header/navbar that links to the agro-production app.
+  - The link should point to the agro-production app URL (env var: `NEXT_PUBLIC_AGRO_PRODUCTION_URL` or similar).
+  - Consider adding a dedicated card/section on the home page or landing page showing "Agro Production" with a call-to-action button.
+  - Ensure the link works in both development (localhost:3000) and production environments.
+- Acceptance criteria:
+  - [ ] A visible navigation link/button exists in the main app header that says "Agro Production" or similar.
+  - [ ] Clicking the link navigates the user to the agro-production app.
+  - [ ] The link correctly uses the environment variable for the agro-production URL.
+  - [ ] The link is accessible (keyboard navigation, screen reader support).
+  - [ ] The link works in both dev and production builds.
+- Tests needed:
+  - [ ] Unit test to verify the navigation component renders correctly.
+  - [ ] E2E test (Playwright) to verify clicking the link navigates to the agro-production app (or mocked destination).
+  - [ ] Accessibility test to verify keyboard and screen reader support.
+- Difficulty: easy
+
+## 12) Add navigation from agro-production app back to main frontend
+- Labels: enhancement, frontend, navigation
+- Description: Users need a clear way to navigate back from the agro-production app to the main `client/` frontend (e.g., a "Back" button or branding link in the header). This provides a complete navigation loop and improves UX.
+- Directory: `/agro-production/client/src/` (agro-production client frontend)
+- Suggested implementation:
+  - Add a new button/link in the agro-production app header (or footer) that links back to the main client.
+  - The link should point to the main client URL (env var: `NEXT_PUBLIC_MAIN_CLIENT_URL` or similar).
+  - Consider adding a logo or branding link in the top-left that returns to the main app.
+  - Ensure the link works in both development and production environments.
+  - Optionally preserve state when navigating back (e.g., remember the last campaign viewed).
+- Acceptance criteria:
+  - [ ] A visible navigation link/button exists in the agro-production app header that links back to the main client (e.g., "Back to Agrocylo" or a logo link).
+  - [ ] Clicking the link navigates the user to the main client app.
+  - [ ] The link correctly uses the environment variable for the main client URL.
+  - [ ] The link is accessible (keyboard navigation, screen reader support).
+  - [ ] The link works in both dev and production builds.
+  - [ ] (Optional) App state is preserved or gracefully handled when switching apps.
+- Tests needed:
+  - [ ] Unit test to verify the navigation component renders correctly.
+  - [ ] E2E test (Playwright) to verify clicking the link navigates to the main client (or mocked destination).
+  - [ ] Accessibility test to verify keyboard and screen reader support.
+  - [ ] (Optional) E2E test to verify state is preserved when navigating between apps.
+- Difficulty: easy
+
+---
+
+If you want, I can open PR drafts for any of these (start with the README and the WebSocket bug). Which two should I prioritize? 
