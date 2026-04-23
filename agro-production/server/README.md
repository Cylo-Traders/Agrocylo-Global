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

