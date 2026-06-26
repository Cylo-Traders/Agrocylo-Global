# Agrocylo Production

End-to-end system for agricultural production-escrow crowdfunding on Stellar/Soroban.

## Structure

| Directory | Purpose |
|-----------|---------|
| `client/` | Next.js frontend — marketplace, dashboards, wallet integration |
| `server/` | Express indexer + REST API — Soroban event watcher, Prisma DB |
| `contract/` | Soroban smart contracts (Rust) — production-escrow, registry |

---

## Running E2E Tests Locally

The E2E suite exercises the full invest flow end-to-end:

```
client builds XDR → mock sign → submit → event indexed → WS notified → REST confirms
```

It uses a **mock Soroban RPC** (no node required) and a **real PostgreSQL** database.

### Prerequisites

1. **Node.js ≥ 22** and **npm**
2. A running **PostgreSQL** instance with an empty test database

### Setup

```bash
# 1. Install server dependencies
cd agro-production/server
npm ci

# 2. Install client dependencies (E2E imports contractService from the client)
cd ../client
npm ci
cd ../server

# 3. Generate the Prisma client
npx prisma generate
```

### Running the tests

```bash
# From agro-production/server/
E2E_DATABASE_URL="postgresql://user:pass@localhost:5432/agro_e2e" npm run test:e2e
```

The `test:e2e` script will:

1. Reset the test database schema (`prisma db push --force-reset`)
2. Start a mock Soroban JSON-RPC server (random port)
3. Start the Express server + WebSocket in-process
4. Run four test suites:
   - **Event indexing pipeline** — `EventPersister → DB → WS broadcast → REST`
   - **Watcher integration** — mock RPC events → watcher polls → DB → REST
   - **Client XDR building** — `buildInvest()` against the mock RPC
   - **Layer break detection** — asserts failure propagates correctly

### What each test validates

| Test | Layer verified |
|------|---------------|
| `indexes a campaign.created event…` | EventPersister + DB write + REST read |
| `indexes a campaign.invested event…` | EventPersister + WS broadcast + REST |
| `picks up campaign.created from mock RPC` | Watcher polling + parser + persister |
| `picks up campaign.invested from mock RPC` | Watcher → WS broadcast |
| `buildInvest returns XDR` | Client contractService + mock Soroban RPC |
| `/health returns UP` | Server health layer |

### CI

The E2E suite runs automatically in CI on every PR or push that touches:
- `agro-production/server/**`
- `agro-production/contract/**`
- `agro-production/client/src/lib/contractService.ts`

See `.github/workflows/server-e2e.yml`. The job spins up a PostgreSQL service container, runs `npm run test:e2e`, and must complete within **10 minutes**.

### Troubleshooting

| Symptom | Fix |
|---------|-----|
| `E2E_DATABASE_URL is not set` | Set the env var before running |
| `Database error` during setup | Ensure the test DB exists and the user has `CREATE TABLE` permission |
| `WS timeout` in tests | Check that the server started correctly (look for `attachWebSocketServer` errors) |
| `buildInvest returned error` logged | Acceptable; mock RPC simulation is minimal. XDR-build correctness is validated by unit tests in `client/__tests__/` |

---

## Unit Tests

```bash
# Server unit tests
cd agro-production/server
npm test

# Client unit tests
cd agro-production/client
npm test
```

## Contract Tests

```bash
cd agro-production/contract
cargo test
```
