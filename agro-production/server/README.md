## Redis (BullMQ)

This folder contains production-oriented assets for the backend queue system.

Start Redis:

```bash
docker compose -f docker-compose.redis.yml up -d
```

Then run the backend worker process from the root `server/` package:

```bash
cd server
npm run worker:dev
```

## Buyer demand & farmer supply APIs

Implemented in the root `server/` app (run migrations from `server/`).

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/demand` | Buyer expresses demand (stored with `buyer_wallet` from `x-wallet-address`) |
| `POST` | `/supply` | Farmer declares supply (stored with `farmer_wallet` from `x-wallet-address`) |

Headers: `x-wallet-address` (required), `Content-Type: application/json`.

Apply DB migration:

```bash
cd server
npx prisma migrate deploy
```

## Platform metrics

Implemented in the root `server/` app.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/metrics` | JSON snapshot: `orders_per_day`, `campaigns_created`, `total_volume`, `active_users` |

Optional auth: set `METRICS_API_KEY` in the server environment, then send the same value as `x-metrics-api-key` or `Authorization: Bearer <METRICS_API_KEY>`.

**Field definitions**

- **orders_per_day** — Count of `orders` rows with `createdAt` on the current **UTC calendar day**.
- **campaigns_created** — Count of **product listings** (`products` rows) created that same UTC day (used as farmer/market “campaigns” until a dedicated campaigns feature exists).
- **total_volume** — Sum of `orders.amount` where the value parses as a finite number (all time).
- **active_users** — Distinct buyer or seller wallet addresses appearing on any order in the **last 30 days**.

