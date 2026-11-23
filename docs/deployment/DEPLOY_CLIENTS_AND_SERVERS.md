# Agrocylo — Deploying the Clients & Servers

Agrocylo is an Agro-DeFi platform on Stellar/Soroban. This repository ships two
independent applications, each with its own backend and Next.js frontend, plus
the Soroban contracts they talk to. This guide covers deploying the four apps.

- `server/` — marketplace API (Node/Express + Prisma), port **5000**
- `client/` — marketplace web app (Next.js), port **3000**
- `agro-production/server/` — campaign/investment API (Node/Express + Prisma), port **5001**
- `agro-production/client/` — campaign web app (Next.js), port **3001**
- `contracts/` — Soroban contracts, deployed separately

> Contracts are **not** covered here. See [`CONTRACTS.md`](./CONTRACTS.md) to
> deploy and wire them, and [`MAINNET_LAUNCH.md`](./MAINNET_LAUNCH.md) for the
> mainnet cutover. The authoritative list of every environment variable is
> [`environment.md`](./environment.md).

## What you are deploying

| App | Path | Port | Health check | Notes |
|---|---|---|---|---|
| Marketplace API | `server/` | 5000 | `GET /health` | Stateless; Postgres + Supabase Storage |
| Marketplace web | `client/` | 3000 | `GET /` | Next.js standalone; `NEXT_PUBLIC_*` baked at build |
| Campaign API | `agro-production/server/` | 5001 | `GET /health` | Stateless; separate Postgres DB |
| Campaign web | `agro-production/client/` | 3001 | `GET /` | Next.js standalone; `NEXT_PUBLIC_*` baked at build |

Both backends keep all state in Postgres and Supabase Storage. Neither needs a
persistent disk, so any long-lived Node host works. The frontends are Next.js
server builds (not static exports), so they need a Node runtime too.

## Prerequisites

- Node.js **22.13.x** and npm **10.9.x** — the exact versions are in `.nvmrc` and
  the root `package.json`. Run `npm run check:toolchain` at the repo root.
- Rust **1.89.0** with the `wasm32v1-none` target, the `stellar` CLI, and `jq`
  — only if you are deploying the contracts.
- Two PostgreSQL databases (one per backend). They must be separate databases.
- A Supabase project for image storage.
- Redis (recommended in production; used for queues/rate limiting).
- A Stellar network (testnet or mainnet), a funded deployer identity for the
  contracts, and a Freighter-compatible wallet for end users.
- A host for the four apps: Fly.io (configs included), or Render/Railway for the
  servers and Vercel for the Next.js clients.

## Database & storage setup

### 1. PostgreSQL — two databases

Create **two separate databases** — one for `server/`, one for
`agro-production/server/`. Never point both servers at the same database.

Any managed Postgres works (Supabase, Neon, Fly Postgres, RDS). If you use
Supabase:

1. Create two Supabase projects (one per backend) — a Supabase project has one
   database — or use another managed Postgres instance with two databases.
2. **Project Settings → Database → Connection string**.
3. Use the **transaction pooler** URI (port `6543`) for the app's runtime
   `DATABASE_URL`. The **direct connection** (port `5432`) is IPv6-only on
   Supabase and fails from many IPv4-only hosts/CI runners.
4. Run migrations with the **session pooler** or direct connection if
   `prisma migrate deploy` fails against the transaction pooler (DDL through a
   transaction pooler can be rejected).

Set the result as `DATABASE_URL` for each server. The value is injected at
runtime; never pass it as a Docker build argument.

### 2. Supabase Storage — image buckets

1. **Project Settings → API** → copy the **Project URL**, the **`anon`** key,
   and the **`service_role`** key.
2. **Storage → New bucket**, create two **public** buckets:
   - `product-images` — marketplace product images (`server/`)
   - `campaign-images` — campaign images (`agro-production/server/`)
3. Server-side uploads use the **`service_role`** key. Never put that key in a
   frontend or a `NEXT_PUBLIC_*` variable. The frontends only read the public
   URLs returned by the APIs.

If you leave `SUPABASE_SERVICE_ROLE_KEY` empty in development, `server/` falls
back to local filesystem uploads under `server/uploads/`. Production requires
the service-role key. See [`STORAGE.md`](./STORAGE.md).

### 3. Redis

Provision a Redis instance (Fly Redis, Upstash, ElastiCache, etc.) and set
`REDIS_URL` on both backends. The root server defaults to
`redis://127.0.0.1:6379`, which will not exist on most hosts, so set it
explicitly in production.

### 4. Contract IDs

Deploy the contracts with:

```bash
DEPLOYER=<stellar-identity> \
FEE_COLLECTOR=<address> \
SUPPORTED_TOKENS=<XLM_SAC>,<USDC_SAC> \
scripts/deploy-contracts.sh --network testnet
```

This writes `deployments/deployed-addresses.<network>.json`, which is the
canonical mapping. Copy the IDs into the app env vars:

| Contract | Server var | Client var |
|---|---|---|
| marketplace escrow | `CONTRACT_ID` (`server`) / `ESCROW_CONTRACT_ID` (`agro-production/server`) | `NEXT_PUBLIC_CONTRACT_ID` (`client`) |
| governance | `GOVERNANCE_CONTRACT_ID` (`server`) | — |
| production escrow | `PRODUCTION_CONTRACT_ID` / `PRODUCTION_ESCROW_CONTRACT_ID` | `NEXT_PUBLIC_PRODUCTION_CONTRACT_ID` (`agro-production/client`) |
| registry | `REGISTRY_CONTRACT_ID` | — |
| investment basket | `BASKET_CONTRACT_ID` | — |

Set `NEXT_PUBLIC_NATIVE_TOKEN_CONTRACT_ID` (XLM SAC) and, when USDC checkout is
enabled, `NEXT_PUBLIC_TOKEN_CONTRACT_ID_USDC` on `client/`. Source the escrow
contract ID from the selected network's deployment manifest; token SAC IDs
must be supplied by maintainers for that network. Production builds require
the escrow and native-token IDs and reject `NEXT_PUBLIC_DEMO_MODE=true`.

## Local setup

### Fast path — Docker Compose

From the repo root:

```bash
cp .env.example .env      # development defaults; edit as needed
docker compose up
```

This starts all four apps plus two Postgres databases, Redis, and a Caddy
reverse proxy:

| URL | App |
|---|---|
| http://localhost | Marketplace (proxied) |
| http://localhost/agro | Campaigns (proxied) |
| http://localhost:5000 | Marketplace API |
| http://localhost:5001 | Campaign API |

`agro-client` requires `NEXT_PUBLIC_PRODUCTION_CONTRACT_ID` to be set (Compose
fails fast if it is missing). Migration one-shot services run
`prisma migrate deploy` before the backends start.

### npm path

Frontends are npm workspaces and share the root lockfile. Install once at the
root; do not run `npm install` inside `client/` or `agro-production/client/`.

```bash
# Repository root
nvm use
npm ci
npm run check:toolchain

# Client env files
cp client/.env.example client/.env.local
cp agro-production/client/.env.example agro-production/client/.env.local
```

Backends install separately:

```bash
# Marketplace API
cd server
npm ci
cp .env.example .env          # fill in DATABASE_URL, SUPABASE_*, JWT_SECRET
npx prisma migrate deploy
npm run dev                   # http://localhost:5000

# Campaign API
cd ../agro-production/server
npm ci
cp .env.example .env          # fill in DATABASE_URL, JWT_SECRET, contract IDs
npx prisma migrate deploy
npm run dev                   # http://localhost:5001
```

Start the frontends from the repo root:

```bash
npm run dev:marketplace       # http://localhost:3000
npm run dev:production        # http://localhost:3001
# or both:
npm run dev
```

Local API URLs:

- `client/.env.local` → `NEXT_PUBLIC_API_URL=http://localhost:5000`
- `agro-production/client/.env.local` → `NEXT_PUBLIC_API_URL=http://localhost:5001/api/v1`

See [`FRONTEND_SETUP.md`](../FRONTEND_SETUP.md) for the full frontend setup and
troubleshooting guide.

## Deployment

Deploy in this order:

1. **Contracts** (if not already deployed) — the apps need their IDs.
2. **Databases + storage + Redis** — the backends need them to start.
3. **Backends** — the frontends need their URLs.
4. **Frontends** — the backends need the frontend URLs for CORS, so expect a
   second pass to close the loop.
5. **CORS / cross-links** — update and redeploy.

`NEXT_PUBLIC_*` values are **compiled into the frontend at build time**. Changing
them later requires a rebuild, not just a restart.

### Option A — Fly.io (repo-supported)

The repo ships a `fly.toml` and `Dockerfile` for each app. `flyctl` deploys the
server images from their own directories, and the client images from the
repository root (their Dockerfiles use the root workspace).

```bash
# Install and authenticate
curl -L https://fly.io/install.sh | sh
flyctl auth login

# Create the apps
flyctl apps create agrocylo-marketplace
flyctl apps create agrocylo-client
flyctl apps create agrocylo-production
flyctl apps create agrocylo-agro-client
```

Provision Postgres and Redis (Fly Postgres/Fly Redis or external managed
services), then set the backend secrets.

**Marketplace API** (`server/`):

```bash
flyctl secrets set --app agrocylo-marketplace \
  NODE_ENV=production \
  DATABASE_URL='postgresql://...' \
  JWT_SECRET="$(openssl rand -base64 48)" \
  SUPABASE_URL='https://YOUR_PROJECT_REF.supabase.co' \
  SUPABASE_ANON_KEY='...' \
  SUPABASE_SERVICE_ROLE_KEY='...' \
  SUPABASE_PRODUCT_IMAGES_BUCKET=product-images \
  ALLOWED_ORIGINS='https://your-marketplace.example.com' \
  METRICS_API_KEY="$(openssl rand -hex 32)" \
  INTEGRATOR_API_KEY_PEPPER="$(openssl rand -hex 32)" \
  USSD_PROVIDER_SECRET="$(openssl rand -hex 32)" \
  RPC_URL='https://soroban-testnet.stellar.org'
```

Add `CONTRACT_ID` and `GOVERNANCE_CONTRACT_ID`, and set
`RUN_CONTRACT_WATCHER=true`, if the marketplace indexer should run. In
production the root server validates `METRICS_API_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `USSD_PROVIDER_SECRET`, and a non-default
`INTEGRATOR_API_KEY_PEPPER` on boot, and requires `ALLOWED_ORIGINS` to be
`https://` origins. If the frontend URL is not known yet, use a placeholder
`https://` origin for the first deploy and replace it in the close-the-loop
step.

**Campaign API** (`agro-production/server/`):

```bash
flyctl secrets set --app agrocylo-production \
  NODE_ENV=production \
  DATABASE_URL='postgresql://...' \
  JWT_SECRET="$(openssl rand -base64 48)" \
  RPC_URL='https://soroban-testnet.stellar.org' \
  PRODUCTION_CONTRACT_ID='C...' \
  ESCROW_CONTRACT_ID='C...' \
  REGISTRY_CONTRACT_ID='C...' \
  BASKET_CONTRACT_ID='C...' \
  SUPABASE_URL='https://YOUR_PROJECT_REF.supabase.co' \
  SUPABASE_ANON_KEY='...' \
  SUPABASE_SERVICE_ROLE_KEY='...' \
  SUPABASE_CAMPAIGN_IMAGES_BUCKET=campaign-images \
  CORS_ORIGINS='https://your-campaigns.example.com' \
  METRICS_API_KEY="$(openssl rand -hex 32)"
```

In production this server requires `DATABASE_URL`, `RPC_URL`,
`PRODUCTION_CONTRACT_ID`, `ESCROW_CONTRACT_ID`, `JWT_SECRET`,
`METRICS_API_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.

Run migrations **before** deploying (or as a release command). Use a session /
direct connection if the transaction pooler rejects DDL:

```bash
cd server
DATABASE_URL='postgresql://...' npx prisma migrate deploy

cd ../agro-production/server
DATABASE_URL='postgresql://...' npx prisma migrate deploy
```

Deploy the servers:

```bash
# From the repository root. When a working directory is given, --config is
# resolved relative to that directory.
flyctl deploy server \
  --config fly.toml --app agrocylo-marketplace

flyctl deploy agro-production/server \
  --config fly.toml --app agrocylo-production
```

> If the marketplace image build fails at `prisma generate` with
> `DATABASE_URL is required for database commands`, the Docker build has no
> datasource URL. Supply a non-secret placeholder through
> `PRISMA_GENERATE_DATABASE_URL` (for example
> `postgresql://prisma-generate:unused@localhost:5432/prisma_generate`) as a
> build argument/env in the Dockerfile or your build platform. The campaign
> server's Dockerfile already sets this placeholder.

Deploy the clients from the repository root (the Dockerfiles copy the workspace
root). All `NEXT_PUBLIC_*` values must be supplied as build args:

```bash
# Campaign client — all required values are declared in its Dockerfile
flyctl deploy . \
  --config agro-production/client/fly.toml \
  --dockerfile agro-production/client/Dockerfile \
  --app agrocylo-agro-client \
  --build-arg NEXT_PUBLIC_API_URL='https://agrocylo-production.fly.dev/api/v1' \
  --build-arg NEXT_PUBLIC_WS_URL='wss://agrocylo-production.fly.dev/ws' \
  --build-arg NEXT_PUBLIC_SOROBAN_RPC_URL='https://soroban-testnet.stellar.org' \
  --build-arg NEXT_PUBLIC_HORIZON_URL='https://horizon-testnet.stellar.org' \
  --build-arg NEXT_PUBLIC_NETWORK_PASSPHRASE='Test SDF Network ; September 2015' \
  --build-arg NEXT_PUBLIC_STELLAR_ENV=testnet \
  --build-arg NEXT_PUBLIC_PRODUCTION_CONTRACT_ID='C...' \
  --build-arg NEXT_PUBLIC_AGRO_PRODUCTION_ENABLED=true
```

For the marketplace client:

```bash
flyctl deploy . \
  --config client/fly.toml \
  --dockerfile client/Dockerfile \
  --app agrocylo-client \
  --build-arg NEXT_PUBLIC_API_URL='https://<marketplace-api-origin>' \
  --build-arg NEXT_PUBLIC_SOROBAN_RPC_URL='https://soroban-testnet.stellar.org' \
  --build-arg NEXT_PUBLIC_HORIZON_URL='https://horizon-testnet.stellar.org' \
  --build-arg NEXT_PUBLIC_NETWORK_PASSPHRASE='Test SDF Network ; September 2015' \
  --build-arg NEXT_PUBLIC_STELLAR_ENV=testnet \
  --build-arg NEXT_PUBLIC_CONTRACT_ID='<escrow-id-from-manifest>' \
  --build-arg NEXT_PUBLIC_NATIVE_TOKEN_CONTRACT_ID='<native-token-sac-id>' \
  --build-arg NEXT_PUBLIC_TOKEN_CONTRACT_ID_USDC='<usdc-sac-id>' \
  --build-arg NEXT_PUBLIC_DEMO_MODE=false
```

The deployment workflow passes marketplace values from its deployment
environment (`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_CONTRACT_ID`,
`NEXT_PUBLIC_NATIVE_TOKEN_CONTRACT_ID`, and
`NEXT_PUBLIC_TOKEN_CONTRACT_ID_USDC`); configure these variables for each
target network. `NEXT_PUBLIC_DEMO_MODE` is pinned to `false` in the workflow.
`docker compose build client` uses the testnet values in `client/.env.example`
unless overridden in the root `.env`.

`NEXT_PUBLIC_AGRO_PRODUCTION_ENABLED` must be exactly `true` for the campaign
client to serve the app; any other value renders a "build not available" page.
Do not set `NEXT_PUBLIC_BASE_PATH` on Fly — it is only for the Caddy sub-path
setup.

### Option B — Render/Railway + Vercel

**Servers:** create one service per backend, using the Dockerfile in its
directory.

| Setting | Marketplace API | Campaign API |
|---|---|---|
| Root directory / context | `server` | `agro-production/server` |
| Dockerfile | `server/Dockerfile` | `agro-production/server/Dockerfile` |
| Health check | `/health` | `/health` |
| Start command | image `CMD` (`node dist/index.js`) | image `CMD` (`npm start`) |

Set the same secrets listed in Option A. Run `npx prisma migrate deploy` as a
pre-deploy/release command (or once from a machine that can reach the database).
Render's free tier spins down after inactivity, so the first request may take
30–60s; upgrade if that matters.

**Frontends:** deploy `client/` and `agro-production/client/` as two Next.js
projects on Vercel. Because both clients are npm workspaces that depend on
`packages/instrumentation`, point the project at the repo root and build the
workspace explicitly (e.g. build command `npm run build --workspace=client` or
`npm run build --workspace=agro-production-client`), or enable "include files
outside the root directory" and install from the repo root. Set every
`NEXT_PUBLIC_*` variable in the project's build environment — Vercel does not
need the Docker build args. Set `NEXT_PUBLIC_AGRO_PRODUCTION_ENABLED=true` on
the campaign project.

### Option C — Existing GitHub Actions pipeline

The repository already has a full pipeline in `.github/workflows/deploy.yml`:
build four images → push to GHCR → run migrations → deploy to Fly → smoke test →
automatic rollback on failure.

- Merge to `main` → staging
- Push a tag matching `v*` → production
- Manual run: **Actions → Deploy → Run workflow**

Required GitHub secrets: `FLY_API_TOKEN`, `STAGING_DATABASE_URL`,
`STAGING_AGRO_DATABASE_URL`, `PRODUCTION_DATABASE_URL`,
`PRODUCTION_AGRO_DATABASE_URL`, and `TESTNET_DEPLOYER_SECRET` for contract
deploys. Required environment variables include the contract IDs and the
`NEXT_PUBLIC_*` values listed in [`environment.md`](./environment.md). See
[`README.md`](./README.md) for the full pipeline, rollback, and access-control
details.

### Close the loop (CORS and cross-links)

Once both frontends have URLs, update the backends and redeploy/restart:

- `server/`: `ALLOWED_ORIGINS=https://marketplace.example.com`
- `agro-production/server/`: `CORS_ORIGINS=https://campaigns.example.com`
- Both are comma-separated. In production, the root server requires `https://`
  origins.

Also set the cross-app links and rebuild the frontends:

- `client/`: `NEXT_PUBLIC_AGRO_PRODUCTION_URL=https://campaigns.example.com`
- `agro-production/client/`: `NEXT_PUBLIC_MAIN_CLIENT_URL=https://marketplace.example.com`
- `agro-production/client/`: `NEXT_PUBLIC_APP_URL=https://campaigns.example.com`

## Environment variables

Only the minimum is listed here. Use [`environment.md`](./environment.md) for
every variable, defaults, and rotation procedures.

### `server/` — marketplace API

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Marketplace Postgres |
| `JWT_SECRET` | yes | HS256, ≥ 32 bytes; generate with `openssl rand -base64 48` |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | yes | Supabase project |
| `SUPABASE_SERVICE_ROLE_KEY` | yes in prod | Server-side uploads |
| `ALLOWED_ORIGINS` | yes in prod | Comma-separated `https://` origins |
| `METRICS_API_KEY` | yes in prod | Bearer token for `/metrics` |
| `INTEGRATOR_API_KEY_PEPPER` | yes in prod | Must not be the dev default |
| `USSD_PROVIDER_SECRET` | yes in prod | Required by the production schema even if USSD is unused |
| `RPC_URL` | yes for chain access | Must match the network |
| `CONTRACT_ID`, `GOVERNANCE_CONTRACT_ID` | when watcher on | With `RUN_CONTRACT_WATCHER=true` |
| `REDIS_URL` | recommended | Queues / rate limiting |
| `ADMIN_WALLETS` | optional | Comma-separated Stellar public keys; see [`admin.md`](./admin.md) |

### `agro-production/server/` — campaign API

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Separate campaign Postgres |
| `JWT_SECRET` | yes in prod | ≥ 32 bytes; separate from the marketplace secret |
| `RPC_URL` | yes in prod | Must match the network |
| `PRODUCTION_CONTRACT_ID` | yes in prod | Production escrow |
| `ESCROW_CONTRACT_ID` | yes in prod | Marketplace escrow |
| `REGISTRY_CONTRACT_ID`, `BASKET_CONTRACT_ID` | recommended | From the deployment manifest |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | yes in prod | Campaign image storage |
| `CORS_ORIGINS` | recommended | Comma-separated frontend origins |
| `METRICS_API_KEY` | yes in prod | `/metrics` bearer token |
| `REDIS_URL` | recommended | Cache / queues |

### `client/` — marketplace web

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | yes | Marketplace API URL; build-time |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | yes in prod | Must match the passphrase |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | yes in prod | Testnet or mainnet passphrase |
| `NEXT_PUBLIC_STELLAR_ENV` | recommended | `testnet` or `mainnet` |
| `NEXT_PUBLIC_CONTRACT_ID` | yes for on-chain UI | Marketplace escrow |
| `NEXT_PUBLIC_NATIVE_TOKEN_CONTRACT_ID` | yes for `/orders/new` | XLM SAC |
| `NEXT_PUBLIC_TOKEN_CONTRACT_ID_USDC` | if using USDC | USDC SAC |
| `NEXT_PUBLIC_DEMO_MODE` | no | Must be `false` in production |

### `agro-production/client/` — campaign web

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | yes | Must end in `/api/v1` |
| `NEXT_PUBLIC_WS_URL` | recommended | `wss://.../ws`; same-origin fallback if omitted |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | yes in prod | Must match the passphrase |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | yes in prod | Testnet or mainnet passphrase |
| `NEXT_PUBLIC_STELLAR_ENV` | recommended | `testnet` or `mainnet` |
| `NEXT_PUBLIC_PRODUCTION_CONTRACT_ID` | yes | Production escrow |
| `NEXT_PUBLIC_AGRO_PRODUCTION_ENABLED` | yes | Must be exactly `true` to serve the app |
| `NEXT_PUBLIC_MAIN_CLIENT_URL` | optional | Link back to the marketplace |
| `NEXT_PUBLIC_APP_URL` | optional | Canonical URL / WalletConnect metadata |

## Verify the deployment

Check each app directly:

```bash
curl -fsS https://agrocylo-marketplace.fly.dev/health
curl -fsS https://agrocylo-production.fly.dev/health
curl -fsS -o /dev/null -w '%{http_code}\n' https://agrocylo-client.fly.dev/
curl -fsS -o /dev/null -w '%{http_code}\n' https://agrocylo-agro-client.fly.dev/
```

`scripts/smoke-test.sh <base_url>` checks `/server/health`,
`/agro-server/health`, `/client/`, and `/agro-client/`. That layout matches the
single-origin Caddy setup, not four separate Fly apps — use the per-app `curl`
checks above for separate deployments.

Then verify in a browser:

1. Load both frontends and confirm there are no console/CORS errors.
2. Connect a wallet on the correct network; a mismatched wallet should show the
   network banner and block signing.
3. Create a small test campaign/order end-to-end and confirm it appears in the
   UI and is indexed by the backend.
4. Check the backends' logs for failed migrations, auth, or RPC errors.

## Before going live

- **Generate real secrets.** Never leave placeholders. Use
  `openssl rand -base64 48` for each `JWT_SECRET`; the two servers must have
  different secrets. Never reuse a Supabase key as a JWT secret.
- **Set `NODE_ENV=production`** on both backends. This enables the stricter
  startup validation and turns on production logging behavior.
- **Keep `NEXT_PUBLIC_DEMO_MODE=false`.** Demo mode returns fake data and must
  not ship to production.
- **Use one network consistently.** RPC URL, Horizon URL, passphrase, and
  contract IDs must all be testnet or all mainnet. The clients fail fast on a
  mainnet/testnet mismatch instead of silently signing on the wrong network.
- **Bootstrap admins.** Set `ADMIN_WALLETS` or run
  `npm run grant-admin -- G...` in `server/`. See [`admin.md`](./admin.md).
- **Run migrations as a release step**, not from application startup or multiple
  replicas. Prisma migrations are forward-only; see
  [`DISASTER_RECOVERY.md`](../../DISASTER_RECOVERY.md) for backups/restores.
- **Back up the databases.** Supabase takes backups on paid plans; on the free
  tier, export the databases periodically. The database is the only copy of the
  off-chain state.
- **Protect `/metrics`** with a real `METRICS_API_KEY`, and configure Sentry if
  you want error reporting.
- **Mainnet only after the gates pass.** Contract deploys and `initialize` are
  permanent. Follow [`MAINNET_LAUNCH.md`](./MAINNET_LAUNCH.md) and
  [`KEY_CUSTODY.md`](./KEY_CUSTODY.md) before pointing real funds at the system.
