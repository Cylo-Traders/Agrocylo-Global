# AGROCYLO🌾
### Overview

Agrocylo is an Agro-DeFi platform. The aim is to make life easier for farmers (especially homegrown/urban), enabling exchange of agro-goods and services using an escrow system. It eliminates middlemen, allows peer-to-peer trade between farmers and consumers, and gives both parties access to Blockchain, Native DeFi, and Digital services. 

Each purchase is secured using an escrow mechanism: funds are locked when a customer places an order and are released only after the buyer confirms receipt of goods. This guarantees protection for both parties while maintaining full user custody.

**Configuration:** [`docs/deployment/environment.md`](docs/deployment/environment.md) is the authoritative environment-variable reference for all four apps and the contract set, including secret-management and key-rotation procedures. Drift between each app's `.env.example` and its code is caught by `scripts/check-env-drift.js` in CI.

### ✨ Features
* On-chain escrow settlement - Funds are locked in an escrow smart contract until buyers confirm receipt of goods.

* Non-custodial payments - Users retain full control of funds at all times.

* Peer-to-peer Farmer-Consumer Marketplace - Farmers sell directly to consumers without middlemen, retaining price control and increasing income.

* Token-based payment - Supports stablecoin and token payments (USDC and XLM)

* Buyer-confirmed settlement - Funds are never released to farmer/seller until the buyer confirms receipt of goods.

* Unlimited parallel transactions - Unlimited concurrent trades can be carried out at a time, and each transaction is tracked by ID, time, status, amount, and associated addresses.

* Order indexing by role - Buyers can view all their purchases and order statuses. Farmers can track incoming orders and pending payments.

* Real-time updates and notifications - On-chain events are indexed and transmitted off-chain to deliver real-time order updates and notifications.

### 🎯 Why Agrocylo
* Wider market reach and ease of payment - Small scale farmers face limited market access and fragmented payment systems.
* Post-harvest loss reduction - Farmers incure losses due to lack of storage facilities and limited market access 
* Higher farmer profit and lower consumer cost - enabled by peer-to-peer interaction between farmer and consumer (Absence of middleman).
* Digital transformation of agriculture - price discovery tools, demand/supply aggregation tools to aid data-driven production.

###  Target Users
a. Primary users
    * Farmers/Producers
    * Consumers/buyers

b. Secondary stakeholders
    * Platform operators: analytics, monitoring and support.
    * NGO’s, cooperatives or government programs promoting farmer inclusion


### 🏗 COMPONENTS (DEVELOPMENT) 

#### Smart Contracts

Escrow creation

Order lifecycle management

Dispute handling 

#### Frontend

Farmer dashboards

Consumer checkout & order tracking

Wallet integration

#### Off-Chain Services

Event indexing

Notifications (email, push, in-app)

Analytics and reporting

### 🧱 Architecture
Frontend (Web / Mobile)

   ↓
Smart Contracts (Escrow)

   ↓
Stellar Network

   ↓
Off-Chain Indexers & Notification Services

┌─────────────────┐
│   FRONTEND      │
│ (Web/Mobile)    │
└────────┬────────┘
         │
         ├
         │
         └---------─┐
                    │
               ┌────▼───────────┐
               │Smart Contracts │
               │ (Soroban Rust) │----------─┐
               └────┬───────────┘           |
                                            │
                                       ┌────▼───────────┐
                                       │   Backend      |
                                       │                │
                                       └────────────────┘

### 🛠️ Tech Stack

Network: Stellar Testnet

Smart Contracts: Rust (Soroban)

Frontend: Next.js (React)

Wallets: Freighter 

Indexing: Custom event indexer / Subgraph-style service

Notifications: In-app (DB-persisted, delivered via REST API)

### 📦 Project Goals

Enable swift, fair, and transparent trade

### 🔒 Security

Found a vulnerability? Please report it privately — see [SECURITY.md](SECURITY.md)
for scope, response SLAs, and how to reach us. Do not open a public issue for
security findings.

### 🌐 Frontend network configuration (fail-fast)

The `client/` app talks to exactly one Stellar network, chosen by a single
switch. It **fails fast** rather than silently falling back to testnet — a
mainnet deployment missing a variable renders a configuration-error state
instead of quietly signing real transactions against the wrong ledger.

| Variable | Required | Notes |
|----------|----------|-------|
| `NEXT_PUBLIC_STELLAR_ENV` | recommended | `testnet` \| `mainnet`. The single source of truth. Unset ⇒ inferred from the passphrase, else `testnet` (local dev only). |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | **yes** | `Test SDF Network ; September 2015` or `Public Global Stellar Network ; September 2015`. In `mainnet` mode a missing/testnet value is a hard error. |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | **yes** | Soroban RPC endpoint; must match the network. |
| `NEXT_PUBLIC_CONTRACT_ID` | **yes** for on-chain UI | Deployed escrow contract. Gates transaction-capable UI via `isContractConfigured()`. |
| `NEXT_PUBLIC_HORIZON_URL` | optional | Overrides the Horizon endpoint; defaults follow `NEXT_PUBLIC_STELLAR_ENV`. |

Fail-fast contract:

- **Build time** — `next.config.ts` throws on a production build if
  `NEXT_PUBLIC_SOROBAN_RPC_URL` or `NEXT_PUBLIC_NETWORK_PASSPHRASE` is unset.
- **Runtime, mainnet mode** — `getNetworkConfig()`, `getExpectedNetworkPassphrase()`,
  `getRpcServer()` / `getServer()` (`src/lib/stellar.ts`) and
  `resolveNetworkPassphrase()` (`src/lib/signTransaction.ts`) throw instead of
  returning testnet defaults when wallet/network detection fails.
- **Runtime, testnet / unset** — the testnet fallback is retained for local dev.
- **Wallet mismatch** — if the connected wallet's network differs from
  `NEXT_PUBLIC_STELLAR_ENV`, a persistent banner is shown and signing/submission
  is refused with a `NetworkMismatchError` (`src/context/WalletContext.tsx`,
  `src/components/NetworkMismatchBanner.tsx`).

See `client/.env.example` for the full list.

### 🤝 Contributing

Contributions are welcome! Whether you're fixing bugs, adding features, improving docs, or writing tests, your help is valued.

**See [CONTRIBUTING.md](CONTRIBUTING.md) for:**
- Local setup instructions per app (Rust contracts, Node.js backend, Next.js frontend)
- Pre-PR expectations (test requirements, Rust-specific checks like `cargo check`, etc.)
- Merge & review practices (especially important for Rust contracts holding real funds)
- Stellar Wave bounty workflow for external contributors

**Quick start:**
1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/Agrocylo-Global.git`
3. Create a feature branch: `git checkout -b fix/issue-number`
4. Follow the setup in [CONTRIBUTING.md](CONTRIBUTING.md)
5. Open a PR referencing the issue(s) it closes

### 🧪 Running Tests

#### Unit Tests
```bash
# Client unit tests (vitest + jsdom)
cd client && npm test

# Server unit tests (vitest + node)
cd server && npm run test:coverage

# Contract tests (Rust soroban-sdk)
cargo test --workspace 
# Or test individual crates:
cargo test -p escrow
cargo test -p weather-insurance
cargo test -p registry
cargo test -p production-escrow-v2
cargo test -p investment-basket
cargo test -p governance
```

#### E2E Tests
```bash
# Run Playwright E2E tests
cd client && npm run test:e2e

# Run E2E tests with interactive UI
cd client && npm run test:e2e:ui
```

E2E tests mock Freighter wallet and use `NEXT_PUBLIC_DEMO_MODE=true` for deterministic responses. See `.github/workflows/e2e.yml` for CI configuration.

### 🐳 Docker Setup

The repository includes Docker Compose orchestration for containerized development and deployment. **Note:** This repo contains multiple app pairings (legacy `server`/`client` and current `agro-production/server`/`agro-production/client`), and the compose setup currently covers only the legacy pair.

**Root docker-compose.yml** (legacy server/client)
- Orchestrates PostgreSQL, Redis, and the backend service from `./server`
- Exposes backend on port 5000
- Recommended for: Contributors working on the legacy server/client apps
- Usage:
  ```bash
  docker-compose up
  ```

**agro-production/server/docker-compose.redis.yml** (Redis only for agro-production)
- Standalone Redis service with persistent storage (`appendonly` mode)
- Exposes Redis on port 6379
- **Currently not linked to a full app compose file** — this repo's primary dev workflow for agro-production apps uses `npm run dev` (see "Running locally" below)
- Usage (if needed for production/staging deployments):
  ```bash
  cd agro-production/server && docker-compose -f docker-compose.redis.yml up
  ```

For local development of `agro-production/server` and `agro-production/client`, see "Running locally" below — the recommended approach is npm-based development, not Docker.

### 🔌 API Documentation

#### Product Endpoints

The quickest way to get the full stack running is a single command:

```bash
docker compose up
```

This brings up **all four applications** (two backends + two frontends) along with
both Postgres databases and Redis:

| Service | Port | Description |
|---------|------|-------------|
| **Caddy proxy** | `80` | Unified entry point (http://localhost) |
| Root client | `3000` | Marketplace frontend |
| Agro-production client | `3001` | Campaign/crowdfunding frontend |
| Root backend | `5000` | Marketplace API |
| Agro-production backend | `5001` | Campaign API |
| Postgres (marketplace) | `5432` | `agrocylo_db` |
| Postgres (campaigns) | `5433` | `agrocylo_production` |
| Redis | `6379` | Shared cache/queues |

**Once running**, visit:

- **http://localhost** — root marketplace (Caddy proxy)
- **http://localhost/agro** — agro-production (Caddy proxy)
- **http://localhost:5000** — root backend API (direct)
- **http://localhost:5001** — agro-production backend API (direct)

**Customising environment variables:**

Edit the `.env` file in the repo root. Sensible development defaults are provided
so `docker compose up` works out-of-the-box from a fresh clone.

**Tearing down:**

```bash
docker compose down -v   # stops containers + wipes database volumes
```

### Running locally without Docker

If you prefer to run services individually, start them from the documented
working directory.

#### Clients

Both frontends use one root npm workspace install and the committed root
lockfile. From the repository root:

```bash
npm ci
npm run dev                 # both: marketplace 3000, production 3001
npm run dev:marketplace     # marketplace only: http://localhost:3000
npm run dev:production      # production only: http://localhost:3001
```

Copy each app's `.env.example` to `.env.local` inside that app. See the
[canonical frontend setup and troubleshooting guide](docs/FRONTEND_SETUP.md)
for the supported Node/npm policy, port overrides, environment files, and
startup recovery.

#### Agro-production server

From `agro-production/server/`, install its server dependencies, configure
`.env`, run `npx prisma migrate deploy`, then `npm run dev`. It listens on
`http://localhost:5001` by default.

#### Root server

From `server/`, install its server dependencies, copy `.env.example` to
`.env`, run `npx prisma migrate deploy`, then `npm run dev`. It listens on
`http://localhost:5000` by default.

### 🔌 API Documentation

#### Product Endpoints

The backend server (`/agro-production/server`) exposes product endpoints for the marketplace.

**Get all products**
```
GET /api/v1/products
```

**Get product by ID**
```
GET /api/v1/products/:id
```

**Environment Variables**

For production, ensure the following are configured (see `.env.example`):
- `NODE_ENV`: Set to `production`
- `DATABASE_URL`: Supabase PostgreSQL connection string (for production data)
- `CORS_ORIGINS`: Comma-separated list of allowed origins

### Contact 
* [Telegram](https://t.me/Tiya_jd)
* [X](https://x.com/Tiya_JD)
* [Community Telegram](https://t.me/AgricCylo)
