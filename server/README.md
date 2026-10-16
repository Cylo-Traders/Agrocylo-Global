# Agrocylo Backend Server

The Express + TypeScript backend for Agrocylo-Global. It exposes a REST API, manages data via Prisma + PostgreSQL (Supabase), handles product image uploads, and watches a Stellar Soroban smart contract for on-chain escrow events.

> **Environment variables:** the authoritative reference for every variable this app reads — plus the JWT/API-key rotation procedures — is [`docs/deployment/environment.md`](../docs/deployment/environment.md). `.env.example` is checked against code by `scripts/check-env-drift.js` in CI.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Choose the correct backend](#choose-the-correct-backend)
- [Setup from a clean checkout](#setup-from-a-clean-checkout)
- [Environment](#environment)
- [Prisma generation versus migrations](#prisma-generation-versus-migrations)
- [Running the server](#running-the-server)
- [Running tests](#running-tests)
- [Known issues](#known-issues)
- [PrismaClient export-error recovery](#prismaclient-export-error-recovery)
- [Architecture Overview](#architecture-overview)
- [Project Structure](#project-structure)
- [Integrator API](#integrator-api)
- [Contributing](#contributing)

---

## Prerequisites

The root marketplace server is tested with this toolchain:

| Tool       | Supported version           |
| ---------- | --------------------------- |
| Node.js    | 22.13.x (`>=22.13.0 <23`) |
| npm        | 10.9.x (`>=10.9.0 <11`)   |
| PostgreSQL | 15+ (or a Supabase project) |

From `server/`, `nvm use` reads the checked-in `.nvmrc` (`22.13.0`). The install
and documented npm entry points also run an early version check with an
actionable error when Node or npm is unsupported.

### Why this range, and what was tested

| Component | Pinned / tested version | Notes |
| --------- | ----------------------- | ----- |
| Node.js | 22.13.0 | Also the CI `NODE_VERSION`, `server/.nvmrc`, and `server/Dockerfile` base image |
| npm | 10.9.2 | `packageManager` pin; `devEngines` equivalent enforced by `engines` |
| `prisma` (CLI) | 7.10.0 | Pinned exactly so the CLI never drifts below the client |
| `@prisma/client` | 7.10.0 | |
| `@prisma/adapter-pg` | 7.10.0 | |

Prisma Client 7.10.0 declares `^20.19 || ^22.12 || >=24.0`. The former
`server/Dockerfile` base image was `node:20-alpine`, so the container ran a Node
major that the locked Prisma package rejects. The range above is a subset of
the locked toolchain's supported range, is what this repository actually
exercises, and is what `scripts/check-runtime.cjs` enforces.

Verified on this runtime: `npm ls` resolves `prisma`, `@prisma/client`, and
`@prisma/adapter-pg` to `7.10.0`; `prisma generate` succeeds; the real ESM
`import { PrismaClient } from "@prisma/client"` succeeds; and
`npm run smoke:graphql-import` loads a production build under plain Node with no
test-runner globals. `npx tsc --noEmit` is not yet clean — see
[Known issues](#known-issues).

Frontend and `agro-production/server` toolchains are tracked separately; this
policy covers `server/` only.

## Choose the correct backend

This repository has two independent backend applications:

- `server/` is the root marketplace API on port 5000. It has its own
  `package.json`, `package-lock.json`, Prisma schema, migrations, and install.
- `agro-production/server/` is the production/campaign API on port 5001. Run
  its setup commands from that directory and do not use its dependencies or
  migrations for the root server.

The steps below are only for `server/`. Do not run the repository-root
frontend install as a substitute for the server-local install.

## Setup from a clean checkout

Run the complete flow from the repository root:

```bash
cd server
nvm use

# Prisma reads its config while generating, so create .env first.
cp .env.example .env
# Edit .env and provide at least a valid DATABASE_URL and required app secrets.

# Reproduce the server's own lockfile exactly.
npm ci

# Generate code; this does not connect to or change the database schema.
npm run prisma:generate

# Apply migrations; this connects to DATABASE_URL and changes the dev database.
npx prisma migrate dev

# RUN_CONTRACT_WATCHER=false and RUN_WORKERS=false are suitable for API-only work.
npm run dev
```

The API is served at `http://localhost:5000` by default. Keep
`RUN_CONTRACT_WATCHER=false` for local REST/GraphQL development. Set it to
`true` only after configuring `CONTRACT_ID` and a reachable `RPC_URL`.
Likewise, enable `RUN_WORKERS` only when local Redis and background processing
are required.

`npm run setup` is an optional shortcut for only `npm ci` plus
`npm run prisma:generate`. Run it from `server/` after creating `.env`; it
does not migrate the database or start the API.

### Environment

The checked-in example documents every expected variable:

```bash
cp .env.example .env
```

At minimum, replace the example values for `DATABASE_URL`, Supabase
credentials, and `JWT_SECRET`. See
[the environment reference](../docs/deployment/environment.md) for required
values and secret-rotation guidance. Never commit `.env`.

### Prisma generation versus migrations

`npm run prisma:generate` writes the TypeScript/JavaScript Prisma Client under
`node_modules`; it does not need a reachable database and does not alter the
schema. Prisma still requires a syntactically valid URL while loading
`prisma.config.ts), so local generation reads `DATABASE_URL` from `.env`.
Artifact-only automation may instead set
`PRISMA_GENERATE_DATABASE_URL=postgresql://prisma-generate:unused@localhost:5432/prisma_generate`.

`npx prisma migrate dev` is a separate, state-changing development command. It
requires the database in `DATABASE_URL` to be available. Deployment automation
must use `npx prisma migrate deploy`, not `migrate dev` or `db push`.

To inspect the configured database after migrations:

```bash
npx prisma studio
```

## Running the server

Development with hot reload:

```bash
npm run dev
```

Production build and startup:

```bash
npm run build
npm start
```

## Running tests

```bash
npm test
```

Use `npx vitest` for watch mode.

## Known issues

`npx tsc --noEmit` is not clean yet, so `npm run build` exits non-zero even
though it does emit `dist/`. The remaining errors are pre-existing and
unrelated to the toolchain, Prisma, or GraphQL work in this repository — they
are concentrated in `reconciliationService`, `contractWatcher`,
`orderMetadataService`, the `ussd/` services, and their tests. Track and fix
them on their own issue; do not work around them by relaxing `tsconfig.json`.

`npx eslint .` likewise still reports pre-existing errors. The GraphQL gateway,
`scripts/`, and toolchain-check files are lint-clean.

## PrismaClient export-error recovery

If ESM reports that `@prisma/client` has no `PrismaClient` export, keep the
existing import (`import { PrismaClient } from "@prisma/client"`) and diagnose
from `server/`. `prisma.config.ts` loads `.env`, so create it first (or set
`PRISMA_GENERATE_DATABASE_URL` to a nonsecret placeholder) before running the
Prisma steps:

```bash
# 1. Missing package: all three entries must resolve.
npm ls prisma @prisma/client @prisma/adapter-pg

# 2. Incompatible CLI/client: declared and locked major versions must agree.
node ../scripts/check-prisma-versions.js
npx prisma version

# 3. Missing generated client: this directory should contain generated files.
ls node_modules/.prisma/client

# 4. Regenerate without changing the database, then verify the real ESM export.
npm run prisma:generate
node --input-type=module -e "import('@prisma/client').then(({ PrismaClient }) => console.log(typeof PrismaClient))"
```

Interpret the result before taking action:

- If `npm ls` reports a missing package, run `npm ci` from `server/`.
- If the version check fails, align `prisma`, `@prisma/client`, and
  `@prisma/adapter-pg` in both `server/package.json` and its lockfile. Do not
  work around it by changing ESM import syntax.
- If packages resolve but `node_modules/.prisma/client` is absent or the ESM
  check fails, run `npm run prisma:generate`; no database reset is needed.
- If generation and the ESM check pass but migration or startup reports
  `P1001`, `ECONNREFUSED`, DNS, or authentication errors, the client is
  healthy and the database is unavailable or `DATABASE_URL` is wrong. Start
  PostgreSQL or correct the URL; do not reinstall Prisma.

Only use `npm install` when intentionally changing dependency versions.
Normal clean-checkout recovery uses the committed lockfile with `npm ci`.
Never use `prisma migrate reset` to recover a missing generated client.

---

## Architecture Overview

```
HTTP Request
│
▼
[ Express Router ] (src/routes/)
│
▼
[ Middleware ] walletAuth (JWT validation), multer (file uploads)
│
▼
[ Controllers ] (src/controllers/) — parse & validate input, call services
│
▼
[ Services ] (src/services/) — business logic, DB access via Prisma
│
├──► [ Prisma / PostgreSQL ] (Users, Orders, Products, Notifications)
└──► [ Supabase Storage ] (Product image uploads)

[ Contract Watcher ] (runs independently on server start)
│
▼
[ Ingestion Service ] polls Stellar RPC for new Soroban events
│
▼
[ Parser → Mapper ] decodes raw event XDR/JSON into typed domain events
│
▼
[ Projection Service ] writes event outcomes (order status changes, etc.) to DB
```

### Queue & Event Pipeline

The escrow event pipeline in `src/services/events/` follows an **ingest → parse → map → project** pattern:

1. **Ingestion** (`escrowEventIngestionService.ts`) — polls the Soroban RPC at a set interval and fetches new contract events since the last processed ledger.
2. **Parsing** (`escrowEventParser.ts`) — converts raw event payloads into structured intermediate objects.
3. **Mapping** (`escrowEventMapper.ts`) — translates parsed events to application-level domain types defined in `src/types/escrowEvent.ts`.
4. **Projection** (`escrowEventProjectionService.ts`) — applies the domain events to the database (e.g. updating order status, creating notifications).

This separation keeps each concern testable in isolation, which is why each stage has its own test file.

---

## Project Structure

```
server/
├── src/
│ ├── index.ts # Entry point — starts Express + contract watcher
│ ├── app.ts # Express app setup, middleware registration
│ ├── config/
│ │ ├── database.ts # Prisma client initialisation
│ │ ├── supabase.ts # Supabase client initialisation
│ │ ├── logger.ts # Winston logger config
│ │ └── index.ts # Re-exports all config
│ ├── controllers/ # Route handlers (thin — delegate to services)
│ ├── middleware/
│ │ ├── walletAuth.ts # JWT auth middleware (validates wallet-signed tokens)
│ │ └── upload.ts # Multer config for image uploads
│ ├── routes/ # Express routers, one file per resource
│ ├── services/
│ │ ├── contractWatcher.ts # Starts the Soroban event polling loop
│ │ ├── events/ # Escrow event pipeline (ingest/parse/map/project)
│ │ └── \*.ts # Auth, cart, order, product, profile, location services
│ ├── http/
│ │ └── errors.ts # Typed HTTP error classes
│ └── types/
│ └── escrowEvent.ts # Domain types for on-chain escrow events
├── prisma/
│ └── schema.prisma # DB schema — User, Product, Order, Notification
├── .env.example # Template for required environment variables
├── openapi.yaml # OpenAPI 3 spec for all API endpoints
├── package.json
└── tsconfig.json
```

---

## Integrator API

The Integrator API provides secure, scoped data access for external organizations such as NGOs, cooperatives, and government programs. This enables partner organizations to integrate AgroCylo data into their own dashboards, reporting systems, and analytics platforms.

### Use Cases

- **NGO Program Monitoring**: Track farmer participation and transaction volume within supported regions or cohorts.
- **Cooperative Reporting**: Generate aggregated reports for member farmers without exposing individual transaction details.
- **Government Oversight**: Monitor agricultural commerce activity and platform health metrics across specific geographic areas.

### How It Works

1. **Request API Key**: Contact the platform administrator to request an integrator API key.
2. **Key Scoping**: The administrator creates a key scoped to:
   - **Specific farmer wallets** (e.g., members of your cooperative), OR
   - **A geographic region** (e.g., "Kumasi, Ghana")
3. **Access Reports**: Use the API key to query anonymized, aggregated data endpoints.

### Requesting an API Key

To request an integrator API key:

1. **Contact Administrator**: Reach out to the platform admin team with:
   - **Organization Name**: The name of your NGO, cooperative, or program
   - **Scope Requirements**: Which farmers or regions you need access to
   - **Use Case**: A brief description of how you plan to use the data

2. **Admin Issues Key**: The administrator will use the admin panel or API to create your scoped key.

3. **Receive Key**: You'll receive an API key string (e.g., `int_abc123...`). **Store this securely** as it won't be shown again.

### Using the API

Include your API key in the `x-integrator-api-key` header:

```bash
curl -H "x-integrator-api-key: YOUR_API_KEY" \\
"https://api.agrocylo.com/integrator/v1/reports/farmers?limit=100&format=json"
```

#### Available Endpoints

| Endpoint                               | Description                              | Formats   |
| -------------------------------------- | ---------------------------------------- | --------- |
| `GET /integrator/v1/reports/farmers` | Aggregated farmer data within your scope | JSON, CSV |
| `GET /integrator/v1/reports/orders`  | Aggregated order transaction data        | JSON, CSV |

**Parameters:**

- `limit` (optional): Max records to return (default: 100, max: 500)
- `format` (optional): Response format, either `json` or `csv` (default: json)

**Rate Limits:**

- 30 requests per minute per API key

#### Example Response (JSON)

```json
{
"data": [
{
"farmer_wallet": "GDQP2K...",
"total_orders": 12,
"total_volume": "1250.50",
"region": "Kumasi"
}
],
"count": 1
}
```

#### CSV Export

Add `?format=csv` to download reports as CSV files for use in Excel, Google Sheets, or data analysis tools.

### Security & Privacy

- **Scoped Access**: Keys only return data within the defined farmer wallet list or region.
- **Anonymized Data**: Individual transaction details are aggregated to protect farmer privacy.
- **Rate Limited**: Prevents abuse and ensures fair access for all integrators.
- **Audit Logging**: All API key usage is logged and available to administrators.

### Revoking a Key

If an API key is compromised or no longer needed:

1. Contact the platform administrator to revoke the key
2. The key will be immediately disabled and cannot be reused
3. Request a new key if continued access is needed

### Full API Documentation

See [openapi.yaml](openapi.yaml) for complete endpoint specifications, request/response schemas, and error codes.

---

## Contributing

### Contributor setup checklist

Use the single [clean-checkout setup](#setup-from-a-clean-checkout) above. In
short, work from `server/`, create `.env` before Prisma reads its config,
install from `server/package-lock.json`, generate the client, then migrate:

```bash
cp .env.example .env
# Edit .env before continuing.
npm ci
npm run prisma:generate
npx prisma migrate dev
npm run dev
```

`npm run setup` replaces only the `npm ci` and generation lines. Generation
creates client code; migration is the separate command that changes the
database.

### Fixing a Server Issue

1. **Reproduce** — run `npm run dev` and confirm the bug locally.
2. **Locate** — use the project structure above to find the relevant service or controller.
3. **Test first** — add or update a test in the appropriate `\*.test.ts` file before changing logic.
4. **Fix** — make your change and verify `npm test` passes.
5. **Build check** — run `npm run build` to ensure no TypeScript errors.
6. **PR** — open a pull request against `main` referencing the issue number.

### Adding a New Route

1. Create a service in `src/services/`.
2. Create a controller in `src/controllers/`.
3. Add a router file in `src/routes/` and register it in `src/app.ts`.
4. Document the endpoint in `openapi.yaml`.

### Useful Commands

```bash
npm run dev # Start dev server with hot reload
npm run build # Compile TypeScript
npm start # Run compiled output
npm test # Run all tests
npx vitest # Run tests in watch mode
npx prisma migrate dev # Apply schema changes to DB
npx prisma studio # Open Prisma visual DB explorer
```
