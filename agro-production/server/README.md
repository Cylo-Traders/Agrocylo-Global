# Agrocylo Production Server

Production backend for the Agrocylo platform. It exposes a REST API, indexes on-chain Stellar/Soroban contract events in real-time, and broadcasts updates to connected clients via WebSocket.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment Variables](#environment-variables)
- [Database Setup](#database-setup)
- [Running the Server](#running-the-server)
- [Redis / Queue Worker](#redis--queue-worker)
- [API Reference](#api-reference)
- [Event Architecture](#event-architecture)
- [WebSocket](#websocket)
- [Testing](#testing)

---

## Prerequisites

- Node.js ≥ 20
- PostgreSQL (local or hosted, e.g. Supabase)
- Docker & Docker Compose (for the Redis queue)
- A deployed Stellar/Soroban contract ID

---

## Installation

```bash
cd agro-production/server
npm install
```

---

## Environment Variables

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

| Variable | Default | Required | Description |
|---|---|---|---|
| `PORT` | `5001` | No | Port the HTTP server listens on |
| `NODE_ENV` | `development` | No | `development` or `production` |
| `LOG_LEVEL` | `debug` | No | Winston log level (`debug`, `info`, `warn`, `error`) |
| `DATABASE_URL` | — | **Yes** | PostgreSQL connection string (`postgresql://user:pass@host/db`) |
| `RPC_URL` | `https://soroban-testnet.stellar.org` | No | Stellar Soroban RPC endpoint |
| `ESCROW_CONTRACT_ID` | — | **Yes** | Contract ID for the primary EscrowContract |
| `PRODUCTION_ESCROW_CONTRACT_ID` | — | **Yes** | Contract ID for the ProductionEscrowContract |
| `PRODUCTION_CONTRACT_ID` | — | No | Alias used by the legacy single-contract watcher (falls back to `PRODUCTION_ESCROW_CONTRACT_ID`) |
| `RATE_LIMIT_WINDOW_MS` | `60000` | No | Rate-limit rolling window in milliseconds |
| `RATE_LIMIT_MAX_REQUESTS` | `100` | No | Max requests per IP per window |
| `RATE_LIMIT_WRITE_MAX_REQUESTS` | `10` | No | Max write requests per IP per window |
| `SUPABASE_URL` | — | For images | Supabase project URL (campaign image uploads) |
| `SUPABASE_ANON_KEY` | — | For images | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | — | For images | Supabase service-role key (bypasses RLS for uploads) |
| `SUPABASE_CAMPAIGN_IMAGES_BUCKET` | `campaign-images` | No | Supabase storage bucket name |
| `CAMPAIGN_IMAGE_PLACEHOLDER_URL` | `https://placehold.co/800x800/png?text=No+Image` | No | Fallback URL when no image is stored |
| `METRICS_API_KEY` | — | No | If set, `/metrics` requires this value as `x-metrics-api-key` or `Authorization: Bearer <key>` |

---

## Database Setup

The server uses Prisma with PostgreSQL.

```bash
# Apply all pending migrations
npx prisma migrate deploy

# (Development only) Create and apply a new migration
npx prisma migrate dev --name <migration-name>

# Open Prisma Studio (visual DB browser)
npx prisma db studio
```

The schema lives in `prisma/schema.prisma`. Models: `User`, `Campaign`, `Investment`, `Order`, `Transaction`.

---

## Running the Server

```bash
# Development (hot-reload via tsx watch)
npm run dev

# Build TypeScript
npm run build

# Production (requires npm run build first)
npm start
```

On startup the server will:

1. Connect to PostgreSQL via Prisma.
2. Start the **multi-contract Soroban event listener** (`src/services/sorobanEventListener.ts`) — watches both `ESCROW_CONTRACT_ID` and `PRODUCTION_ESCROW_CONTRACT_ID`.
3. Start the **single-contract production watcher** (`src/events/watcher.ts`) if `PRODUCTION_CONTRACT_ID` is set — resumes from the last persisted ledger to avoid re-processing events after a restart.
4. Attach the **WebSocket server** on the same HTTP port.
5. Serve the HTTP API.

---

## Redis / Queue Worker

A Redis-backed queue (BullMQ) handles async jobs. Start Redis first:

```bash
docker compose -f docker-compose.redis.yml up -d
```

Then run the worker from the root `server/` package:

```bash
cd server
npm run worker:dev
```

---

## API Reference

All REST endpoints are served on `http://localhost:<PORT>`.

### OpenAPI (auto-generated from Zod)

Request and response contracts are defined as Zod schemas under `src/schemas/`. The OpenAPI 3 document is generated at runtime from those definitions:

```bash
# With the server running:
curl http://localhost:5001/api/docs/openapi.json
```

Import this URL into Swagger UI, Postman, or any OpenAPI client. Validation failures return `application/problem+json` with per-field `errors` (field path, message, and Zod code).

### Health & Readiness

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Shallow liveness probe — always 200 while process is running |
| `GET` | `/livez` | Alias liveness probe — returns uptime |
| `GET` | `/readyz` | Deep readiness probe — checks DB + RPC; returns 503 if either is down |

**`/health` response:**
```json
{ "status": "UP", "service": "agro-production-server", "env": "production", "timestamp": "..." }
```

**`/readyz` response (200 when ready):**
```json
{
  "status": "ready",
  "checks": {
    "database": { "status": "UP" },
    "rpc": { "status": "UP" }
  },
  "lastLedger": 12345,
  "timestamp": "..."
}
```

**`/readyz` response (503 when not ready):**
```json
{
  "status": "not_ready",
  "checks": {
    "database": { "status": "DOWN", "message": "connection refused" },
    "rpc": { "status": "UP" }
  },
  "lastLedger": 0,
  "timestamp": "..."
}
```

### Campaigns

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/campaigns` | List all campaigns |
| `GET` | `/api/v1/campaigns/:id` | Get a single campaign by ID |
| `POST` | `/api/v1/campaigns` | Create a campaign (requires `x-wallet-address` header) |

### Orders

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/orders` | List orders |
| `POST` | `/api/v1/orders` | Create an order (requires `x-wallet-address` header) |

### Campaign Images

| Method | Path | Description |
|---|---|---|
| `POST` | `/campaign-images/upload` | Upload a campaign image (multipart/form-data, field: `image`) |
| `DELETE` | `/campaign-images/:campaignId` | Delete a campaign's image |

### Buyer Demand & Farmer Supply

| Method | Path | Description |
|---|---|---|
| `POST` | `/demand` | Buyer expresses demand (wallet from `x-wallet-address`) |
| `POST` | `/supply` | Farmer declares supply (wallet from `x-wallet-address`) |

### Metrics

| Method | Path | Description |
|---|---|---|
| `GET` | `/metrics` | Prometheus text format — four key platform metrics |
| `GET` | `/metrics/rate-limits` | In-memory rate-limit hit counters (`default_hits`, `write_hits`, `total_hits`) |
| `GET` | `/metrics/events` | In-memory event ingestion counters broken down by action |

**`/metrics` — Prometheus text format (4 metrics):**

| Metric | Type | Description |
|---|---|---|
| `events_processed_total` | counter | Total Soroban events indexed since server start |
| `last_indexed_ledger` | gauge | Last ledger sequence number successfully indexed |
| `ws_clients_connected` | gauge | Number of active WebSocket client connections |
| `api_requests_total` | counter | Total HTTP requests received since server start |

**Sample Prometheus scrape config:**

```yaml
scrape_configs:
  - job_name: agro_production
    static_configs:
      - targets: ['localhost:5001']
    metrics_path: /metrics
    # If METRICS_API_KEY is set:
    params:
      {}
    authorization:
      type: Bearer
      credentials: <your-METRICS_API_KEY>
```

Or send the key as a header:
```
x-metrics-api-key: <your-METRICS_API_KEY>
```

**Auth:** If `METRICS_API_KEY` is set, all `/metrics*` endpoints require `x-metrics-api-key: <key>` or `Authorization: Bearer <key>`. Leave `METRICS_API_KEY` blank to allow unauthenticated access (development).

**Common headers:**

| Header | When required |
|---|---|
| `x-wallet-address` | POST /demand, POST /supply, POST /campaigns, POST /orders |
| `Content-Type: application/json` | All JSON POST requests |

**Rate limiting behavior:**

- Default limiter applies to all routes using `RATE_LIMIT_WINDOW_MS` + `RATE_LIMIT_MAX_REQUESTS`.
- Write limiter applies to mutating endpoints using `RATE_LIMIT_WINDOW_MS` + `RATE_LIMIT_WRITE_MAX_REQUESTS`.
- Each rejection increments in-memory counters exposed at `/metrics/rate-limits`.

---

## Event Architecture

```
Stellar / Soroban network
        │
        │  RPC polling (every 5 s)
        ▼
┌────────────────────────────────────────────────┐
│           Soroban Event Listener               │
│  sorobanEventListener.ts                       │
│  Watches: ESCROW_CONTRACT_ID                   │
│           PRODUCTION_ESCROW_CONTRACT_ID        │
└──────────────────┬─────────────────────────────┘
                   │
                   │  also
                   ▼
┌────────────────────────────────────────────────┐
│         Production Contract Watcher            │
│  events/watcher.ts                             │
│  Watches: PRODUCTION_CONTRACT_ID               │
│  Resumes from last persisted ledger (Prisma)   │
│  Filters: campaign.* and order.* topics        │
└──────────────────┬─────────────────────────────┘
                   │
        ┌──────────┼──────────┐
        ▼          ▼          ▼
   Parser      Persister   WebSocket
(events/     (events/     broadcast
 parser.ts)  persister.ts) (services/
                           wsServer.ts)
        │          │
        └────┬─────┘
             ▼
       PostgreSQL (Prisma)
       campaigns / orders /
       transactions tables
```

**Event flow:**

1. The watcher polls the Soroban RPC for new ledger events matching the contract IDs.
2. `ProductionEventParser` parses raw Soroban events into typed domain events (`campaign.created`, `order.placed`, etc.).
3. `EventPersister` writes the parsed event to PostgreSQL via Prisma.
4. The WebSocket server broadcasts the event to all connected frontend clients.
5. On restart the watcher reads the highest `ledger` from the `transactions` table and resumes from there — no events are re-processed.

### Event idempotency guarantees

- `campaign.created` - uses `campaign.upsert` and unique `transactions(ledger,eventIndex)` checks before writes.
- `campaign.invested` - uses replay-safe `investment.upsert` and duplicate transaction checks in preflight + transaction scope.
- `campaign.settled` - deterministic campaign revenue/status writes guarded by duplicate checks before mutation.
- `order.created` - `order.upsert` by on-chain order ID prevents duplicate order creation.
- `order.confirmed` - duplicate events are dropped before order status and campaign revenue updates.
- `campaign.produce|harvest|failed|disputed` - deterministic status writes are replay-safe and guarded by duplicate checks.

---

## WebSocket

Clients connect to `ws://localhost:<PORT>/ws`. The server pushes JSON messages with the shape:

```ts
{
  event: string;      // e.g. "campaign.created", "order.placed"
  payload: unknown;   // event-specific data
  timestamp: string;  // ISO 8601
}
```

The frontend `useWebSocket` hook (in `agro-production/client/`) handles reconnection with exponential backoff and queues outbound messages while disconnected.

---

## Testing

```bash
# Run all unit tests (vitest)
npm test

# Run a single test file
npx vitest run src/events/parser.test.ts
```

Test files live alongside their source files (`*.test.ts`). Integration tests in `src/test/api.test.ts` require a running database — set `DATABASE_URL` before running them.
