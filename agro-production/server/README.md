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

