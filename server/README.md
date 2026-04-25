# Agrocylo Backend

> Issue #160 — Backend Documentation

## Quick start (< 30 mins)

### 1. Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 20.x |
| npm | 10.x |
| PostgreSQL | 15+ |

### 2. Clone & install

\`\`\`bash
git clone https://github.com/Cylo-Traders/Agrocylo-Global.git
cd Agrocylo-Global/server
npm install
\`\`\`

### 3. Environment variables

\`\`\`bash
cp .env.example .env
\`\`\`

Edit \`.env\`:

| Variable | Description |
|----------|-------------|
| \`DATABASE_URL\` | PostgreSQL connection string |
| \`SUPABASE_URL\` | Supabase project URL |
| \`SUPABASE_ANON_KEY\` | Supabase anon key |
| \`SUPABASE_SERVICE_ROLE_KEY\` | Supabase service role key |
| \`SUPABASE_JWT_SECRET\` | Supabase JWT secret |
| \`JWT_SECRET\` | Secret for signing access tokens |
| \`CONTRACT_ID\` | Stellar Soroban contract ID (optional in dev) |
| \`RPC_URL\` | Stellar RPC endpoint |

### 4. Database setup

\`\`\`bash
sudo service postgresql start
sudo -u postgres psql -c "CREATE USER agrocylo WITH PASSWORD 'agrocylo123';"
sudo -u postgres psql -c "CREATE DATABASE agrocylo_db OWNER agrocylo;"
\`\`\`

Update \`DATABASE_URL\` in \`.env\`:
\`\`\`
DATABASE_URL="postgresql://agrocylo:agrocylo123@localhost:5432/agrocylo_db"
\`\`\`

### 5. Run migrations & start

\`\`\`bash
npx prisma migrate dev --name init
npx prisma generate
npm run dev
\`\`\`

Verify:
\`\`\`bash
curl http://localhost:5000/health
\`\`\`

### 6. Run tests

\`\`\`bash
npm test
\`\`\`

---

## Architecture

\`\`\`
Client
  │
  ▼
Express Server (port 5000)
  │  CORS · JSON body parser · walletAuth middleware
  │
  ├── /auth              → authRoutes         → authService
  ├── /products          → productRoutes      → productService
  ├── /products/:id/image→ productImageRoutes → productImageService
  ├── /cart              → cartRoutes         → cartService
  ├── /orders            → orderRoutes        → orderController
  ├── /orders/metadata   → orderMetadataRoutes→ orderMetadataService
  ├── /profiles          → profileRoutes      → profileService
  ├── /locations         → locationRoutes     → locationService
  └── /health            → 200 OK
  │
  ├── PostgreSQL (via Prisma)
  │     Users, Orders, Products, Notifications
  │
  ├── Supabase (PostgreSQL + Storage)
  │     Profiles, Locations, Carts, OrderMetadata, Images
  │
  └── Contract Watcher (background, every 5s)
        Stellar RPC → Soroban escrow events → Notifications
\`\`\`

### Authentication flow

1. \`POST /auth/nonce\` — client sends Stellar public key, gets a nonce (5 min TTL)
2. Client signs nonce with Stellar private key
3. \`POST /auth/verify\` — server verifies signature, issues JWT (15 min) + refresh token (7 days)
4. Protected routes require \`x-wallet-address\` header

---

## API Reference

**Base URL:** \`http://localhost:5000\`
**Auth header:** \`x-wallet-address: <stellar-public-key>\` (🔒 = required)

### Health
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | \`/health\` | — | Server status |

### Auth
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | \`/auth/nonce\` | — | Generate sign challenge |
| POST | \`/auth/verify\` | — | Verify signature, get tokens |
| POST | \`/auth/refresh\` | — | Refresh access token |
| DELETE | \`/auth/logout\` | — | Revoke refresh token |

### Products
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | \`/products\` | — | List products |
| GET | \`/products/:id\` | — | Get product |
| POST | \`/products\` | 🔒 | Create product |
| PATCH | \`/products/:id\` | 🔒 | Update product |
| DELETE | \`/products/:id\` | 🔒 | Soft delete |
| POST | \`/products/:id/image\` | 🔒 | Upload image |
| DELETE | \`/products/:id/image\` | 🔒 | Delete image |

### Cart
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | \`/cart\` | 🔒 | Get active cart |
| POST | \`/cart/items\` | 🔒 | Add item |
| PATCH | \`/cart/items/:id\` | 🔒 | Update quantity |
| DELETE | \`/cart/items/:id\` | 🔒 | Remove item |
| DELETE | \`/cart\` | 🔒 | Clear cart |
| POST | \`/cart/checkout\` | 🔒 | Checkout |

### Orders
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | \`/orders\` | — | List all orders |
| GET | \`/orders/:id\` | — | Get by on-chain ID |
| GET | \`/orders/buyer/:address\` | — | Orders by buyer |
| GET | \`/orders/seller/:address\` | — | Orders by seller |
| POST | \`/orders/metadata\` | 🔒 | Create metadata |
| GET | \`/orders/metadata/:id\` | 🔒 | Get metadata |

### Profiles
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | \`/profiles/:wallet_address\` | — | Get profile |
| POST | \`/profiles\` | 🔒 | Create profile |
| PATCH | \`/profiles/:wallet_address\` | 🔒 | Update profile |

### Locations
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | \`/locations/farmers\` | — | List farmer locations |
| POST | \`/locations\` | 🔒 | Set location |
| PATCH | \`/locations/:wallet_address\` | 🔒 | Update location |
| DELETE | \`/locations/:wallet_address\` | 🔒 | Delete location |

---

## Error format (RFC 7807)

\`\`\`json
{ "type": "...", "title": "Bad Request", "status": 400, "detail": "..." }
\`\`\`

| Code | Meaning |
|------|---------|
| 400 | Missing or invalid field |
| 401 | Missing or invalid wallet header |
| 403 | Wallet does not own the resource |
| 404 | Not found |
| 409 | Conflict |
| 413 | Image exceeds 5MB |
| 415 | Unsupported image type |
| 500 | Internal server error |

---

## Scripts

| Command | Description |
|---------|-------------|
| \`npm run dev\` | Start with hot reload |
| \`npm run build\` | Compile TypeScript |
| \`npm start\` | Run compiled output |
| \`npm test\` | Run Vitest tests |
