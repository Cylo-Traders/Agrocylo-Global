# Deployment Guide

This document describes the CI/CD pipeline, how to deploy, how to roll back, and who has access.

> **Launching on mainnet?** Follow [`MAINNET_LAUNCH.md`](./MAINNET_LAUNCH.md) — the
> ordered contract → backend → indexer → frontend cutover, the go/no-go gates, the
> per-phase rollback plan, and the capped soft-launch ramp.

## Architecture Overview

```
merge to main ──► CI (ci.yml) ──► Deploy (deploy.yml) ──► staging
tag v*         ──► CI (ci.yml) ──► Deploy (deploy.yml) ──► production
```

### Four applications

| App | Path | Port | Stack |
|-----|------|------|-------|
| Root marketplace backend | `server/` | 5000 | Node.js + Express + Prisma |
| Root marketplace client | `client/` | 3000 | Next.js (standalone) |
| Agro-production backend | `agro-production/server/` | 5001 | Node.js + Express + Prisma |
| Agro-production client | `agro-production/client/` | 3001 | Next.js (standalone) |

### Infrastructure targets

| Component | Staging | Production |
|-----------|---------|------------|
| Compute | Fly.io (shared-cpu-1x, 512 MB) | Fly.io (shared-cpu-1x, 512 MB) |
| Container images | ghcr.io | ghcr.io |
| Database (root) | Fly Postgres / managed PG | Fly Postgres / managed PG |
| Database (agro) | Fly Postgres / managed PG | Fly Postgres / managed PG |
| Redis | Fly Redis / Upstash | Fly Redis / Upstash |

**Why Fly.io?** Free tier available, native Docker support, `flyctl` integrates with GitHub Actions, built-in rollback via release history, and each app gets its own isolated machine. Alternative platforms (Railway, Render, AWS ECS/Fargate) follow the same image-based workflow — swap the deploy step.

## Environments

### Staging

- **Trigger:** Every merge to `main`
- **URLs:**
  - Root server: `https://agrocylo-marketplace-staging.fly.dev`
  - Root client: `https://agrocylo-client-staging.fly.dev`
  - Agro server: `https://agrocylo-production-staging.fly.dev`
  - Agro client: `https://agrocylo-agro-client-staging.fly.dev`
- **Database:** Separate staging PostgreSQL instances
- **Purpose:** Integration validation, QA, stakeholder review

### Production

- **Trigger:** Push a tag matching `v*` (e.g. `v1.0.0`)
- **URLs:**
  - Root server: `https://agrocylo-marketplace.fly.dev`
  - Root client: `https://agrocylo-client.fly.dev`
  - Agro server: `https://agrocylo-production.fly.dev`
  - Agro client: `https://agrocylo-agro-client.fly.dev`
- **Database:** Separate production PostgreSQL instances
- **Purpose:** End users

## Pipeline steps

The `deploy.yml` workflow runs these stages in order:

1. **Resolve environment** — Determines staging vs production from the trigger.
2. **Build images** — Builds 4 Docker images in parallel, pushes to `ghcr.io`.
3. **Deploy** — Updates all 4 Fly.io machines with the new images.
4. **Migrate** — Runs `prisma migrate deploy` against each database.
5. **Smoke test** — Hits `/health` on both backends and `/` on both frontends. Retries up to 5 times with 10 s backoff.
6. **Rollback** — If any smoke test fails, runs `flyctl releases rollback` on all 4 apps and fails the workflow.

## How to deploy

### Automatic (recommended)

```bash
# Staging — merge a PR to main
git checkout main && git merge feature/my-change && git push origin main

# Production — push a version tag
git tag v1.0.0 && git push origin v1.0.0
```

### Manual

Use the GitHub Actions **workflow_dispatch** trigger:

1. Go to **Actions → Deploy → Run workflow**.
2. Select `staging` or `production`.
3. Click **Run workflow**.

## How to roll back

### Automatic rollback

If smoke tests fail after a deploy, the workflow automatically rolls back all 4 apps to the previous release.

### Manual rollback

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Set the API token
export FLY_API_TOKEN=<your-token>

# Roll back a specific app to its previous release
flyctl releases rollback --app agrocylo-marketplace
flyctl releases rollback --app agrocylo-client
flyctl releases rollback --app agrocylo-production
flyctl releases rollback --app agrocylo-agro-client
```

To roll back to a specific release:

```bash
flyctl releases list --app agrocylo-marketplace
flyctl deploy --image <image-from-release> --app agrocylo-marketplace
```

### Database rollback

Prisma migrations are forward-only. If a migration causes issues:

1. Roll back the application code first (above).
2. Write a compensating migration if the schema change is problematic:
   ```bash
   cd server && npx prisma migrate dev --name fix_compensation
   ```
3. Deploy the compensating migration via the normal pipeline.

## Environment variables

### GitHub Secrets required

| Secret | Used by | Description |
|--------|---------|-------------|
| `FLY_API_TOKEN` | deploy.yml | Fly.io API token (create at fly.io/account/tokens) |
| `STAGING_DATABASE_URL` | deploy.yml | Staging root server PostgreSQL connection string |
| `STAGING_AGRO_DATABASE_URL` | deploy.yml | Staging agro-production server PostgreSQL connection string |
| `PRODUCTION_DATABASE_URL` | deploy.yml | Production root server PostgreSQL connection string |
| `PRODUCTION_AGRO_DATABASE_URL` | deploy.yml | Production agro-production server PostgreSQL connection string |

### Fly.io secrets (set per app)

```bash
# Root server
flyctl secrets set \
  DATABASE_URL="postgresql://..." \
  JWT_SECRET="..." \
  REDIS_URL="redis://..." \
  SUPABASE_URL="..." \
  SUPABASE_ANON_KEY="..." \
  SUPABASE_SERVICE_ROLE_KEY="..." \
  SUPABASE_JWT_SECRET="..." \
  --app agrocylo-marketplace

# Agro-production server
flyctl secrets set \
  DATABASE_URL="postgresql://..." \
  JWT_SECRET="..." \
  RPC_URL="https://soroban-testnet.stellar.org" \
  PRODUCTION_CONTRACT_ID="C..." \
  ESCROW_CONTRACT_ID="C..." \
  PRODUCTION_ESCROW_CONTRACT_ID="C..." \
  REGISTRY_CONTRACT_ID="C..." \
  BASKET_CONTRACT_ID="C..." \
  SUPABASE_URL="..." \
  SUPABASE_ANON_KEY="..." \
  SUPABASE_SERVICE_ROLE_KEY="..." \
  --app agrocylo-production

# Clients use NEXT_PUBLIC_* vars baked in at build time.
# Set them as build args or in the GitHub Actions env.
```

**Important:** Staging and production must never share database credentials or secrets. Each environment has its own Fly.io apps and its own managed PostgreSQL instances.

## Smoke tests

The `scripts/smoke-test.sh` script can be run locally against any deployed environment:

```bash
./scripts/smoke-test.sh https://agrocylo-marketplace-staging.fly.dev
```

It checks:
- Root server `/health` returns 200
- Agro server `/health` returns 200
- Root client `/` returns 200
- Agro client `/` returns 200

## Admin bootstrapping

Admin wallets are designated either via the `ADMIN_WALLETS` env allowlist or
via the DB `users.role = 'ADMIN'` (managed by `npm run grant-admin -- G...`).
See [`admin.md`](./admin.md) for the full source-of-truth, login flow, and
revocation procedure. `authService` signs JWTs with the real DB-enum role
`FARMER | BUYER | ADMIN` (never the legacy `USER` literal) and `requireAdmin`
enforces both the JWT claim **and** a live DB cross-check.

## Access control

| Action | Who |
|--------|-----|
| Merge to main (triggers staging) | Maintainers with write access |
| Push tags (triggers production) | Maintainers with admin access |
| Fly.io dashboard | Team members added to the Fly.io organization |
| GitHub Secrets | Repository admins |
| Manual rollback | Anyone with `FLY_API_TOKEN` |

## First-time setup

1. **Create Fly.io account and apps:**
   ```bash
   flyctl auth login
   flyctl apps create agrocylo-marketplace
   flyctl apps create agrocylo-client
   flyctl apps create agrocylo-production
   flyctl apps create agrocylo-agro-client
   # Staging:
   flyctl apps create agrocylo-marketplace-staging
   flyctl apps create agrocylo-client-staging
   flyctl apps create agrocylo-production-staging
   flyctl apps create agrocylo-agro-client-staging
   ```

2. **Provision databases:**
   ```bash
   # Option A: Fly Postgres
   flyctl postgres create --name agrocylo-db-staging
   flyctl postgres create --name agrocylo-db-production
   flyctl postgres create --name agrocylo-agro-db-staging
   flyctl postgres create --name agrocylo-agro-db-production

   # Option B: External managed Postgres (Neon, Supabase, etc.)
   # Just set the DATABASE_URL secret accordingly.
   ```

3. **Set GitHub Secrets** (see table above).

4. **Set Fly.io secrets** per app (see section above).

5. **Create GitHub environments:**
   - Go to **Settings → Environments → New environment**.
   - Create `staging` (no protection rules needed).
   - Create `production` with **required reviewers** if desired.

6. **Push to main** to trigger the first staging deploy.

7. **Verify staging** is healthy, then tag `v1.0.0` for the first production deploy.

## Troubleshooting

### Deploy fails with "image not found"

The build job must complete before deploy. Check the `build-images` job logs in the GitHub Actions run.

### Smoke tests fail intermittently

The workflow retries health checks up to 5 times with 10 s delays. If it still fails:
1. Check Fly.io machine status: `flyctl status --app <app-name>`
2. Check logs: `flyctl logs --app <app-name>`
3. Roll back manually if needed.

### Database connection refused

Ensure the `DATABASE_URL` secret points to the correct Postgres instance and the Fly.io app's machines can reach it (same region, or public URL).

### Prisma migration fails

Check that the migration files exist in `prisma/migrations/` and the database user has write access. Run `npx prisma migrate status` locally against the target database to diagnose.
