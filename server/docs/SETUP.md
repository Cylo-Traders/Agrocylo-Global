# Backend Setup Guide

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 20.x |
| npm | 10.x |
| PostgreSQL | 15+ |

## 1. Clone and install

git clone https://github.com/Cylo-Traders/Agrocylo-Global.git
cd Agrocylo-Global/server
npm install

## 2. Environment variables

cp .env.example .env

| Variable | Description |
|----------|-------------|
| DATABASE_URL | PostgreSQL connection string |
| SUPABASE_URL | Supabase project URL |
| SUPABASE_ANON_KEY | Supabase anon key |
| SUPABASE_SERVICE_ROLE_KEY | Supabase service role key |
| SUPABASE_JWT_SECRET | Supabase JWT secret |
| JWT_SECRET | Secret for signing access tokens |
| CONTRACT_ID | Stellar Soroban contract ID (optional in dev) |
| RPC_URL | Stellar RPC endpoint |

## 3. Database setup

sudo service postgresql start
sudo -u postgres psql -c "CREATE USER agrocylo WITH PASSWORD 'agrocylo123';"
sudo -u postgres psql -c "CREATE DATABASE agrocylo_db OWNER agrocylo;"

DATABASE_URL="postgresql://agrocylo:agrocylo123@localhost:5432/agrocylo_db"

## 4. Run migrations and start

npx prisma migrate dev --name init
npx prisma generate
npm run dev

Verify: curl http://localhost:5000/health

## 5. Run tests

npm test

## Scripts

| Command | Description |
|---------|-------------|
| npm run dev | Start with hot reload |
| npm run build | Compile TypeScript |
| npm start | Run compiled output |
| npm test | Run Vitest tests |
