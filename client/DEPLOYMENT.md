# Deployment Guide

## Prerequisites

- Node.js 20+
- npm 10+
- Stellar network access (testnet or mainnet)
- PostgreSQL database (for backend)
- Freighter wallet for admin operations

## Environment Configuration

### Client (.env.local)
```env
NEXT_PUBLIC_API_URL=http://localhost:5000
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
NEXT_PUBLIC_NATIVE_TOKEN_CONTRACT_ID=<XLM SAC contract ID>
```

### Server (.env)
```env
DATABASE_URL=postgresql://user:pass@localhost:5432/agrocylo
PORT=5000
NODE_ENV=development
```

## Build & Deploy

### Client (Next.js)
```bash
cd client
npm install
npm run build
npm start  # production server on :3000
```

### Static Export (Alternative)
```bash
npm run build
# Output in client/out/ - deploy to Vercel, Netlify, or any static host
```

### Server
```bash
cd server
npm install
npx prisma migrate deploy
npm start  # production server on :5000
```

## Docker Deployment

```dockerfile
# Client Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

```bash
docker build -t agrocylo-client ./client
docker build -t agrocylo-server ./server
docker-compose up -d
```

## Production Checklist

- [ ] Set `NEXT_PUBLIC_API_URL` to production backend URL
- [ ] Set `NEXT_PUBLIC_SOROBAN_RPC_URL` to mainnet RPC
- [ ] Set `NEXT_PUBLIC_NATIVE_TOKEN_CONTRACT_ID` to mainnet XLM SAC
- [ ] Configure proper CORS on server
- [ ] Enable HTTPS
- [ ] Set up database backups
- [ ] Configure monitoring and logging
- [ ] Set up error tracking (Sentry or similar)
