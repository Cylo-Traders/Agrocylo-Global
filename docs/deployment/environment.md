# Environment Variables — Authoritative Reference

This is the **single source of truth** for every environment variable across the
four apps (`server`, `client`, `agro-production/server`, `agro-production/client`)
and the contract set. Each app's `README.md` links here. Each app also ships a
`.env.example`; `scripts/check-env-drift.js` (run in CI) fails if an
`.env.example` and the app's code disagree on which variables exist.

- **Secrets backend:** platform-native environment variables (Fly.io secrets for
  the servers, Vercel/Fly build env for the clients). No Vault / SOPS at this
  stage. Production secrets are set with `flyctl secrets set` per app and in the
  GitHub Actions environment (`staging` / `production`) for the CD pipeline.
- **Never commit real values.** `.env` is git-ignored; `.env.example` holds
  placeholders only. Secret scanning (TruffleHog) runs in CI.

---

## Shared variables (must stay consistent across apps)

| Variable | Consumed by | Notes |
|---|---|---|
| `DATABASE_URL` | `server`, `agro-production/server` | Separate Postgres database per server. Same URL format, never the same DB. |
| `RPC_URL` / `NEXT_PUBLIC_SOROBAN_RPC_URL` | all four | Soroban RPC. Server var is `RPC_URL`; browser var is `NEXT_PUBLIC_SOROBAN_RPC_URL`. Both must point at the **same network** as the passphrase below. |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | both clients | `Test SDF Network ; September 2015` (testnet) / `Public Global Stellar Network ; September 2015` (mainnet). Must match the RPC endpoint. |
| Contract IDs | see table below | Sourced from `deployments/deployed-addresses.<network>.json` (produced by `scripts/deploy-contracts.sh`). This file is the canonical mapping; every app's contract-ID env var is copied from it. |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | `server`, `agro-production/server` | Same Supabase project; the two servers use different storage buckets. |
| JWT signing | `server`, `agro-production/server` | Both servers sign their own API JWTs with a per-service `JWT_SECRET` (HS256, ≥ 32 bytes). They are **not** shared — rotating one does not affect the other. Supabase's own RLS JWT verification uses the secret configured in the Supabase dashboard, not an app env var (the servers connect with the service-role key, which bypasses RLS). |

### Contract IDs — one name per contract

| Contract | Server var | Client var | Source |
|---|---|---|---|
| marketplace escrow | `CONTRACT_ID` (`server`) | `NEXT_PUBLIC_CONTRACT_ID` (`client`) | `deployed-addresses.<net>.json → contracts.escrow.id` |
| governance | `GOVERNANCE_CONTRACT_ID` (`server`) | — | `…contracts.governance.id` |
| production escrow | `PRODUCTION_ESCROW_CONTRACT_ID` / `PRODUCTION_CONTRACT_ID` (alias) | `NEXT_PUBLIC_PRODUCTION_CONTRACT_ID` | `…contracts.production_escrow.id` |
| registry | `REGISTRY_CONTRACT_ID` | — | `…contracts.registry.id` |
| investment basket | `BASKET_CONTRACT_ID` | — | `…contracts.investment_basket.id` |

> **Naming note:** the marketplace escrow ID is `CONTRACT_ID` in `server` but
> `ESCROW_CONTRACT_ID` in `agro-production/server` (both are read by their
> respective code and documented here). Converging on
> `<CONTRACT>_CONTRACT_ID` everywhere would require a coordinated code + infra
> change and is left as a follow-up.

---

## Per-app reference

Authoritative list of what each app reads. When you add or remove a variable in
code, update that app's `.env.example` **and** this section — CI enforces the
first, review enforces the second.

### `server/` (marketplace backend, port 5000)

Validated by a Zod schema in [`server/src/config/index.ts`](../../server/src/config/index.ts).

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | Postgres connection string |
| `SUPABASE_URL` | ✅ | — | Supabase project URL |
| `SUPABASE_ANON_KEY` | ✅ | — | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ prod | `""` | Server-side Supabase key (image uploads) |
| `SUPABASE_PRODUCT_IMAGES_BUCKET` | | `product-images` | |
| `PRODUCT_IMAGE_PLACEHOLDER_URL` | | placehold.co URL | |
| `JWT_SECRET` | ✅ | — | API JWT signing key, HS256, ≥ 32 bytes. See rotation below. |
| `REDIS_URL` | | `redis://127.0.0.1:6379` | Queues / rate limiting |
| `RUN_WORKERS` | | `false` | Enable background workers |
| `RUN_CONTRACT_WATCHER` | | `false` | Enable the on-chain event watcher |
| `CONTRACT_ID` | watcher | `""` | marketplace escrow ID (required when watcher on) |
| `GOVERNANCE_CONTRACT_ID` | watcher | `""` | governance ID (required when watcher on) |
| `RPC_URL` | | testnet RPC | Soroban RPC endpoint |
| `WS_PATH` | | `/ws` | Socket.io path |
| `METRICS_API_KEY` | ✅ prod | `""` | Bearer token for `/metrics`; blank denies access |
| `INTEGRATOR_API_KEY_PEPPER` | ✅ prod | development-only value | HMAC secret for integrator API-key digests |
| `INTEGRATOR_MONTHLY_QUOTA` | | `10000` | Maximum requests per integrator key per UTC month |
| `SENTRY_DSN` | | `""` | Error reporting (blank = disabled) |
| `SENTRY_TRACES_SAMPLE_RATE` | | `0.1` | |
| `ALLOWED_ORIGINS` | ✅ prod | `http://localhost:3000` | Comma-separated CORS origins; HTTPS only in production |
| `ADMIN_WALLETS` | | `""` | Comma-separated Stellar public keys that receive `ADMIN` JWTs on login. See [`admin.md`](./admin.md). |
| `PORT`, `NODE_ENV` | | `5000` / `development` | Log level is derived from `NODE_ENV`, not a separate var |

### `client/` (marketplace frontend, port 3000)

All browser vars are `NEXT_PUBLIC_*`. `SENTRY_DSN` (build-time, non-public) is
read by `sentry.*.config.ts`.

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | ✅ | Backend base URL (REST + Socket.io) |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | ✅ | Soroban RPC (match passphrase) |
| `NEXT_PUBLIC_HORIZON_URL` | | Horizon endpoint; overrides the per-network default in `src/lib/stellar.ts` |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | ✅ | App refuses to start if unset |
| `NEXT_PUBLIC_STELLAR_NETWORK` | | `testnet` / `mainnet` selector |
| `NEXT_PUBLIC_CONTRACT_ID` | ✅ | marketplace escrow contract |
| `NEXT_PUBLIC_ESCROW_CONTRACT_ID` | | explicit escrow alias |
| `NEXT_PUBLIC_MARKET_CONTRACT_ID` | | market contract (if split) |
| `NEXT_PUBLIC_NATIVE_TOKEN_CONTRACT_ID` | ✅ | XLM SAC — required by `/orders/new` |
| `NEXT_PUBLIC_TOKEN_CONTRACT_ID_USDC` | | USDC token contract (checkout) |
| `NEXT_PUBLIC_MAX_FEE_STROOPS` | | tx fee ceiling |
| `NEXT_PUBLIC_AGRO_PRODUCTION_URL` | | nav link to sub-app |
| `NEXT_PUBLIC_APP_URL` | | canonical app URL |
| `NEXT_PUBLIC_ANALYTICS_ENABLED`, `NEXT_PUBLIC_ANALYTICS_ENDPOINT` | | first-party analytics |
| `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN` | | error reporting |
| `NEXT_PUBLIC_DEMO_MODE` | | deterministic dummy data (E2E/dev only) |

### `agro-production/server/` (port 5001)

Validated in [`agro-production/server/src/config/index.ts`](../../agro-production/server/src/config/index.ts);
`REQUIRED_IN_PRODUCTION` = `JWT_SECRET`, `RPC_URL`, `PRODUCTION_CONTRACT_ID`,
`ESCROW_CONTRACT_ID`, `METRICS_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | Postgres (separate DB from root server) |
| `JWT_SECRET` | ✅ prod | dev fallback | API JWT signing, HS256, ≥ 32 bytes. See rotation. |
| `RPC_URL` | ✅ prod | testnet RPC | Soroban RPC |
| `PRODUCTION_CONTRACT_ID` | ✅ prod | `""` | production escrow (alias of `PRODUCTION_ESCROW_CONTRACT_ID`) |
| `ESCROW_CONTRACT_ID` | ✅ prod | `""` | marketplace escrow |
| `PRODUCTION_ESCROW_CONTRACT_ID` | | `""` | canonical production escrow ID |
| `REGISTRY_CONTRACT_ID` | | `""` | registry contract |
| `BASKET_CONTRACT_ID` | | `""` | investment basket contract |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | ✅ prod (service role) | — | Campaign image storage |
| `SUPABASE_CAMPAIGN_IMAGES_BUCKET` | | `campaign-images` | |
| `CAMPAIGN_IMAGE_PLACEHOLDER_URL` | | placehold.co URL | |
| `REDIS_URL` | | local Redis | |
| `METRICS_API_KEY` | ✅ prod | — | `/metrics` bearer token |
| `CORS_ORIGINS` | | `""` (all in dev) | Comma-separated origins |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX_REQUESTS` / `RATE_LIMIT_WRITE_MAX_REQUESTS` | | `60000` / `100` / `10` | |
| `SHUTDOWN_TIMEOUT_MS` | | `15000` | Graceful shutdown |
| `EVENT_POLL_INTERVAL_MS` / `CONFIRMATION_DEPTH` | | — | On-chain event watcher tuning |
| `RUN_RECONCILIATION_SWEEP` / `RECONCILIATION_SWEEP_INTERVAL_MS` | | `false` / — | Ledger reconciliation job |
| `SENTRY_DSN` / `SENTRY_TRACES_SAMPLE_RATE` | | `""` / `0.1` | |
| `PORT`, `NODE_ENV`, `LOG_LEVEL` | | `5001` / `development` / `debug` | |

### `agro-production/client/` (port 3001)

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | ✅ | agro backend base URL |
| `NEXT_PUBLIC_WS_URL` | | WebSocket URL (auto-derived if omitted) |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | ✅ | Soroban RPC (match passphrase) |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | ✅ | |
| `NEXT_PUBLIC_PRODUCTION_CONTRACT_ID` | ✅ | production escrow contract |
| `NEXT_PUBLIC_MAIN_CLIENT_URL` | | nav back to marketplace app |
| `NEXT_PUBLIC_FEE_PERCENTILE` / `NEXT_PUBLIC_FEE_HEADROOM` / `NEXT_PUBLIC_MAX_INCLUSION_FEE` | | dynamic tx-fee estimation |
| `NEXT_PUBLIC_TELEMETRY_ENABLED` / `NEXT_PUBLIC_TELEMETRY_URL` | | client telemetry |
| `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_DSN` | | error reporting |

---

## Setting secrets in each deployment target

```bash
# Fly.io servers (repeat per app: agrocylo-marketplace, agrocylo-production, …)
flyctl secrets set --app agrocylo-marketplace \
  DATABASE_URL='postgres://…' \
  JWT_SECRET="$(openssl rand -base64 48)" \
  SUPABASE_SERVICE_ROLE_KEY='…'

# GitHub Actions (used by .github/workflows/deploy.yml) — set as
# environment secrets/vars under Settings → Environments → staging / production.
```

Client (`NEXT_PUBLIC_*`) values are build-time: set them in the Fly/Vercel build
environment for the client apps, not as runtime secrets.

---

## Key rotation

`INTEGRATOR_API_KEY_PEPPER` cannot be rotated in place because changing it
invalidates every stored HMAC digest. Issue replacement integrator keys first,
deploy the new pepper, then revoke the old keys. Never retain raw API keys or
the previous pepper in the database.

### `JWT_SECRET` (both API servers) — tested procedure

API JWTs are HS256, signed and verified with `JWT_SECRET`. Default token TTL is
short (< 24h), so a rotation with a brief dual-verify window causes zero forced
logouts.

1. **Generate** a new secret: `openssl rand -base64 48` (≥ 32 bytes after
   decode; the config schema rejects anything shorter or a known dev value).
2. **Dual-verify window** (optional, zero-downtime): deploy a release that
   verifies against both `JWT_SECRET` and `JWT_SECRET_PREVIOUS` but signs only
   with `JWT_SECRET`. Set `JWT_SECRET_PREVIOUS` to the current value, then set
   `JWT_SECRET` to the new one:
   ```bash
   flyctl secrets set --app <app> \
     JWT_SECRET_PREVIOUS="$OLD" JWT_SECRET="$NEW"
   ```
   *(If the code does not yet support `JWT_SECRET_PREVIOUS`, skip to step 3 and
   accept that all sessions issued before the swap are invalidated — acceptable
   given the short TTL; do it during a low-traffic window.)*
3. **Swap**: `flyctl secrets set --app <app> JWT_SECRET="$NEW"`. Fly restarts the
   app; the config schema validates the new secret on boot and the server
   refuses to start if it is weak.
4. **Verify**: hit an authenticated endpoint with a freshly issued token
   (`curl -H "Authorization: Bearer <new-token>" $API/health/authed`) — expect
   `200`. Confirm a token issued > TTL ago now returns `401`.
5. **Clean up**: after one token-TTL has elapsed,
   `flyctl secrets unset --app <app> JWT_SECRET_PREVIOUS`.
6. **Rollback**: `flyctl secrets set JWT_SECRET="$OLD"` (and unset
   `JWT_SECRET_PREVIOUS`). Safe within the dual-verify window.

Rotate the two servers **independently** — they have separate secrets and
separate user sessions.

**Test it in staging first:** run steps 1–5 against `agrocylo-marketplace-staging`
/ `agrocylo-production-staging` and confirm the smoke tests
(`.github/workflows/deploy.yml → smoke-test`) stay green.

### Other keys

| Key | Where | Rotation |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` | both servers / clients | Rotate in the Supabase dashboard → API → "Reset". Set the new value via `flyctl secrets set` on both servers and redeploy the clients. Old key is invalidated immediately, so swap all consumers in one change. |
| Supabase project JWT secret | Supabase dashboard only (not an app env var) | Dashboard → Settings → API → JWT. Rotating forces all Supabase-issued tokens invalid; only relevant if a client ever talks to Supabase directly with the anon key. |
| `METRICS_API_KEY` | both servers | Free-form bearer token. Generate `openssl rand -hex 32`, set via `flyctl secrets set`, update the scraper (Grafana Agent / Prometheus) config, redeploy. No user impact. |
| Integrator / referral API keys | `server` DB (hashed), not env | Rotate per-integrator via the admin API; see `docs/` for the integrator key-management endpoints. Env only holds the signing pepper if configured. |
| Fly deploy token (`FLY_API_TOKEN`) | GitHub Actions secret | `flyctl tokens create deploy`, update the repo secret, revoke the old token with `flyctl tokens revoke`. |

---

## Drift check

`node scripts/check-env-drift.js` runs in CI as a merge-blocking check
(`.github/workflows/env-drift.yml`). It fails when:

- a variable is declared in an `.env.example` but never referenced in that app's
  source (**stale config**), or
- a variable is read in code (`process.env.X`, `import.meta.env.X`,
  `getEnv('X')`, `requireEnv('X')`) but missing from the `.env.example`
  (**undocumented dependency**).

Genuinely platform-injected variables (`NODE_ENV`, `VERCEL_*`, test-only
toggles) are listed in `ALLOWLIST` at the top of the script.
