# Admin Bootstrapping

Admin endpoints (`/admin/*`, `/admin/reconciliation/*`, `POST /admin/integrator/keys`) are
protected by `middleware/adminAuth.ts::requireAdmin`. That middleware checks two
things in order:

1. `jwt.role === 'ADMIN'` in the verified JWT.
2. A live DB cross-check: `users.role === 'ADMIN'` (or `profile.role` fallback) for the wallet
   in the JWT. A stale token whose holder has since been demoted is rejected with
   `403 Admin privileges have been revoked`.

Until this fix, `authService` signed every JWT with the literal `role: 'USER'`
(which is not a value in the `users`/`profile` enum `FARMER | BUYER | ADMIN`),
so no wallet could ever satisfy (1) without hand-forging a token.

## Source of truth for admin

There are **two** supported sources. Either is sufficient; both are checked on
every `verifySignature` / `refreshAccessToken` call via `resolveWalletRole()`
and the resulting DB-enum value is placed verbatim into the JWT.

### Option A — Env allowlist `ADMIN_WALLETS` (fast bootstrap / emergency)

```
ADMIN_WALLETS=GABC...,GDEF...,GHIJ...
```

* Comma-separated list of Stellar public keys (case-insensitive).
* Parsed in `server/src/config/index.ts` as `config.adminWallets`.
* Checked **first** on login, before any DB query. A wallet listed here receives
  `role: 'ADMIN'` on its very next login even if no `users` row exists yet.
* Empty by default (no admins). Set it as a Fly.io / local env var:
  ```bash
  flyctl secrets set ADMIN_WALLETS="GABC...,GDEF..." --app agrocylo-marketplace
  # local dev
  echo 'ADMIN_WALLETS=GABC...' >> server/.env
  ```
* Rotate by updating the secret and restarting the server. Existing JWTs keep
  their old role until refresh/expiry; demoting a wallet this way does not
  retroactively invalidate already-issued ADMIN tokens beyond the 15-minute
  expiry, but the DB cross-check will still block them if a `users` row with
  `BUYER` exists. Prefer Option B for durable demotion.

### Option B — DB `users.role = 'ADMIN'` (durable, auditable)

Managed with the bootstrap CLI:

```bash
# from repo root, with DATABASE_URL set (same value the server uses)
cd server
npm run grant-admin -- GABC...               # promote
npm run grant-admin -- GABC... --revoke      # demote to BUYER

# directly with npx
npx tsx scripts/grant-admin.ts GABC...
```

What it does:

* Validates the argument is a Stellar public key (`Keypair.fromPublicKey`).
* `prisma.user.upsert({ walletAddress, role: 'ADMIN' })` — the canonical table
  read by `resolveWalletRole` and `requireAdmin`.
* If a `profile` row exists for that wallet, keeps `profile.role` in sync.
* Does **not** create a profile if none exists.

To list admins:

```sql
SELECT walletAddress, role FROM users WHERE role = 'ADMIN';
SELECT wallet_address, role  FROM profile WHERE role = 'ADMIN';
```

## Login / refresh flow

```
POST /auth/nonce  →  POST /auth/verify { walletAddress, signature, message }
                       │
                       ├─► verify Stellar signature
                       ├─► resolveWalletRole(wallet)  ← ADMIN_WALLETS ∪ users ∪ profile
                       ├─► jwt.sign({ walletAddress, role }, ...)  // role is FARMER|BUYER|ADMIN
                       └─► return { accessToken (15m), refreshToken (7d) }

POST /auth/refresh { refreshToken }
                       ├─► lookup refreshToken hash, rotate
                       ├─► resolveWalletRole(wallet)  ← fresh read, so a demotion takes effect on refresh
                       └─► jwt.sign({ walletAddress, role }, ...)
```

JWT vocabulary is exactly the DB enum — `FARMER | BUYER | ADMIN`. The legacy
literal `USER` is no longer issued.

## Verifying the fix

* **Admin wallet** (`ADMIN_WALLETS` or `users.role='ADMIN'`) logging in via the
  normal flow receives a JWT whose payload contains `role:'ADMIN'`:
  ```bash
  # after setting ADMIN_WALLETS or running grant-admin
  curl -s http://localhost:5000/auth/nonce -H 'Content-Type: application/json' -d '{"walletAddress":"GADMIN..."}'
  # ... sign with Stellar secret, POST /auth/verify, decode JWT at jwt.io
  ```
* **Non-admin wallet** never receives `ADMIN`, even if it replays an old admin
  token — `requireAdmin` re-checks the DB and returns `403`.
* Unit tests: `server/src/services/authService.test.ts` — admin wallet → admin
  JWT; non-admin → BUYER/FARMER JWT; refresh reflects current DB role.

## Revocation

* CLI demotion: `npm run grant-admin -- GXXX --revoke` (immediate DB effect;
  outstanding JWTs expire in ≤15 min and are blocked on next admin request by
  the DB cross-check).
* Allowlist removal: delete the wallet from `ADMIN_WALLETS` and restart/redeploy.
* For immediate kill, do **both** and, if needed, delete the wallet's
  `RefreshToken` rows: `DELETE FROM "RefreshToken" WHERE "walletAddress" = 'GXXX';`.

## Security notes

* Keep `ADMIN_WALLETS` and the `users` table as the **only** admin sources.
  Do not branch admin checks on client-supplied headers or query params.
* `requireAdmin` must stay as both JWT-claim **and** DB checks — the DB is the
  revocation path for replayed tokens.
* Audit admin changes: `git log -- server/scripts/grant-admin.ts`, DB audit
  trail on `users.updatedAt`, and Fly.io secret change history.
