# Backend Architecture

## Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 20, TypeScript |
| Framework | Express 4 |
| ORM | Prisma 7 + pg |
| Auth | Stellar SDK + JWT |
| Storage | Supabase (PostgreSQL + Storage) |
| Blockchain | Stellar Soroban |
| Logging | Winston |
| Testing | Vitest + Supertest |
| Validation | Zod |

## System diagram

Client (Browser / Mobile)
        |
        v
Express Server (src/app.ts) port 5000
        |  CORS · JSON body parser · walletAuth middleware
        |
  ------+------------------------------------------
  Routes
  /auth  /products  /cart  /orders
  /profiles  /locations  /orders/metadata
  ------------------+---------------------------
                    |
           ---------+---------
           |                 |
     Supabase DB       Prisma + PostgreSQL
     (profiles,        (orders, users,
      products,         notifications)
      carts, images)
           |
           v
     Supabase Storage
     (product images)

Background:
  Contract Watcher (every 5s)
        |
        v
  Stellar RPC -> Soroban Events -> Notifications table

## Authentication flow

1. Client calls POST /auth/nonce with Stellar public key
2. Server stores a nonce with 5 minute TTL and returns it
3. Client signs the nonce with their Stellar private key
4. Client calls POST /auth/verify with wallet and base64 signature
5. Server verifies using Keypair.verify() from Stellar SDK
6. Server issues JWT (15 min) and refresh token (7 days)
7. Protected routes validated by requireWallet middleware via x-wallet-address header

## Contract Watcher

- Polls Stellar RPC every 5 seconds for Soroban escrow events
- Handles created, confirmed, and refunded events
- Saves notifications to the Prisma Notification table
- Skips gracefully if CONTRACT_ID is not set in .env
- NOTE: lastKnownLedger is held in memory. For production persist it to DB to avoid re-processing events on restart.

## Data models (Prisma)

| Model | Key fields |
|-------|-----------|
| User | walletAddress (unique), role |
| Product | farmerWallet, name, pricePerUnit, isAvailable |
| Order | orderIdOnChain (unique), buyerAddress, sellerAddress, status |
| Notification | walletAddress, message, type, isRead |

## Directory structure

server/
  src/
    index.ts          - Bootstrap
    app.ts            - Express setup
    config/           - Env, DB, logger, Supabase
    routes/           - One file per resource
    controllers/      - orderController
    services/         - Business logic
      events/         - Escrow event ingestion
    middleware/
      walletAuth.ts   - x-wallet-address validation
      upload.ts       - Multer image upload config
    http/errors.ts    - ApiError and RFC 7807 responses
    types/            - Typed interfaces
  prisma/             - Schema and migrations
  supabase/           - SQL migrations and seed
  docs/               - This folder
  .env.example
