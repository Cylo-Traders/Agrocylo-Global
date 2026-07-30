# Agrocylo Backend Server

The Express + TypeScript backend for Agrocylo-Global. It exposes a REST API, manages data via Prisma + PostgreSQL (Supabase), handles product image uploads, and watches a Stellar Soroban smart contract for on-chain escrow events.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment Setup](#environment-setup)
- [Running the Server](#running-the-server)
- [Running Tests](#running-tests)
- [Architecture Overview](#architecture-overview)
- [Project Structure](#project-structure)
- [Contributing](#contributing)

---

## Prerequisites

| Tool       | Version                       |
| ---------- | ----------------------------- |
| Node.js    | >= 20.x                       |
| npm        | >= 10.x                       |
| PostgreSQL | >= 15 (or a Supabase project) |

---

## Installation

\`\`\`bash

# From the repo root

cd server

# Install dependencies

npm install
\`\`\`

---

## Environment Setup

Copy the example env file and fill in your values:

\`\`\`bash
cp .env.example .env
\`\`\`

Then edit \`.env\`:

| Variable                           | Description                                                                                  |
| ---------------------------------- | -------------------------------------------------------------------------------------------- |
| \`PORT\`                           | Port the server listens on. Default: \`5000\`                                                |
| \`NODE_ENV\`                       | \`development\` or \`production\`                                                            |
| \`DATABASE_URL\`                   | PostgreSQL connection string, e.g. \`postgresql://USER:PASSWORD@localhost:5432/agrocylo_db\` |
| \`SUPABASE_URL\`                   | Your Supabase project URL, e.g. \`https://xxxx.supabase.co\`                                 |
| \`SUPABASE_ANON_KEY\`              | Supabase anonymous/public key                                                                |
| \`SUPABASE_SERVICE_ROLE_KEY\`      | Supabase service role key (bypasses RLS — keep secret)                                       |
| \`SUPABASE_PRODUCT_IMAGES_BUCKET\` | Supabase Storage bucket name for product images. Default: \`product-images\`                 |
| \`PRODUCT_IMAGE_PLACEHOLDER_URL\`  | Fallback image URL shown when no product image exists                                        |
| \`SUPABASE_JWT_SECRET\`            | JWT secret from your Supabase project settings (used for RLS wallet policies)                |
| \`JWT_SECRET\`                     | Secret used to sign/verify your own JWTs. Must be at least 32 characters                     |
| \`CONTRACT_ID\`                    | Stellar Soroban contract address to watch for escrow events                                  |
| \`RPC_URL\`                        | Stellar RPC endpoint. Default: \`https://soroban-testnet.stellar.org\`                       |

> ⚠️ Never commit your \`.env\` file. Only \`.env.example\` (with placeholder values) should be in version control.

### Database Migration

After configuring \`DATABASE_URL\`, apply the Prisma schema to your database:

\`\`\`bash
npx prisma migrate dev
\`\`\`

To explore your database visually:

\`\`\`bash
npx prisma studio
\`\`\`

---

## Running the Server

### Development (with hot reload)

\`\`\`bash
npm run dev
\`\`\`

This uses \`tsx watch\` to automatically restart on file changes. The server starts on the port defined in your \`.env\` (default \`5000\`).

### Production

\`\`\`bash
npm run build # Compiles TypeScript → dist/
npm start # Runs dist/index.js
\`\`\`

### Contract Watcher

The Stellar Soroban contract watcher (\`src/services/contractWatcher.ts\`) is started automatically when the server boots. It polls the RPC endpoint defined by \`RPC_URL\` and listens for escrow events on \`CONTRACT_ID\`.

Requirements for the watcher to function:

- \`CONTRACT_ID\` must be a valid deployed Soroban contract address.
- \`RPC_URL\` must be reachable from your environment (testnet or mainnet).
- Events are ingested via \`escrowEventIngestionService\`, mapped and parsed, then projected into the database.

If you only want the REST API without the watcher (e.g. during local UI development), you can temporarily comment out the watcher initialisation in \`src/index.ts\`.

---

## Running Tests

\`\`\`bash
npm test
\`\`\`

This runs all tests with [Vitest](https://vitest.dev/). Tests live alongside the source files they cover:

| Test file                                                   | What it covers                        |
| ----------------------------------------------------------- | ------------------------------------- |
| \`src/controllers/orderController.test.ts\`                 | Order controller unit tests           |
| \`src/routes/api.integration.test.ts\`                      | API route integration tests           |
| \`src/services/events/escrowEventIngestionService.test.ts\` | Event ingestion logic                 |
| \`src/services/events/escrowEventMapper.test.ts\`           | On-chain event → domain model mapping |
| \`src/services/events/escrowEventParser.test.ts\`           | Raw event payload parsing             |

To run tests in watch mode during development:

\`\`\`bash
npx vitest
\`\`\`

---

## Architecture Overview

\`\`\`
HTTP Request
│
▼
[ Express Router ] (src/routes/)
│
▼
[ Middleware ] walletAuth (JWT validation), multer (file uploads)
│
▼
[ Controllers ] (src/controllers/) — parse & validate input, call services
│
▼
[ Services ] (src/services/) — business logic, DB access via Prisma
│
├──► [ Prisma / PostgreSQL ] (Users, Orders, Products, Notifications)
└──► [ Supabase Storage ] (Product image uploads)

[ Contract Watcher ] (runs independently on server start)
│
▼
[ Ingestion Service ] polls Stellar RPC for new Soroban events
│
▼
[ Parser → Mapper ] decodes raw event XDR/JSON into typed domain events
│
▼
[ Projection Service ] writes event outcomes (order status changes, etc.) to DB
\`\`\`

### Queue & Event Pipeline

The escrow event pipeline in \`src/services/events/\` follows an **ingest → parse → map → project** pattern:

1. **Ingestion** (\`escrowEventIngestionService.ts\`) — polls the Soroban RPC at a set interval and fetches new contract events since the last processed ledger.
2. **Parsing** (\`escrowEventParser.ts\`) — converts raw event payloads into structured intermediate objects.
3. **Mapping** (\`escrowEventMapper.ts\`) — translates parsed events to application-level domain types defined in \`src/types/escrowEvent.ts\`.
4. **Projection** (\`escrowEventProjectionService.ts\`) — applies the domain events to the database (e.g. updating order status, creating notifications).

This separation keeps each concern testable in isolation, which is why each stage has its own test file.

---

## Project Structure

\`\`\`
server/
├── src/
│ ├── index.ts # Entry point — starts Express + contract watcher
│ ├── app.ts # Express app setup, middleware registration
│ ├── config/
│ │ ├── database.ts # Prisma client initialisation
│ │ ├── supabase.ts # Supabase client initialisation
│ │ ├── logger.ts # Winston logger config
│ │ └── index.ts # Re-exports all config
│ ├── controllers/ # Route handlers (thin — delegate to services)
│ ├── middleware/
│ │ ├── walletAuth.ts # JWT auth middleware (validates wallet-signed tokens)
│ │ └── upload.ts # Multer config for image uploads
│ ├── routes/ # Express routers, one file per resource
│ ├── services/
│ │ ├── contractWatcher.ts # Starts the Soroban event polling loop
│ │ ├── events/ # Escrow event pipeline (ingest/parse/map/project)
│ │ └── \*.ts # Auth, cart, order, product, profile, location services
│ ├── http/
│ │ └── errors.ts # Typed HTTP error classes
│ └── types/
│ └── escrowEvent.ts # Domain types for on-chain escrow events
├── prisma/
│ └── schema.prisma # DB schema — User, Product, Order, Notification
├── .env.example # Template for required environment variables
├── openapi.yaml # OpenAPI 3 spec for all API endpoints
├── package.json
└── tsconfig.json
\`\`\`

---

## Integrator API

The Integrator API provides secure, scoped data access for external organizations such as NGOs, cooperatives, and government programs. This enables partner organizations to integrate AgroCylo data into their own dashboards, reporting systems, and analytics platforms.

### Use Cases

- **NGO Program Monitoring**: Track farmer participation and transaction volume within supported regions or cohorts.
- **Cooperative Reporting**: Generate aggregated reports for member farmers without exposing individual transaction details.
- **Government Oversight**: Monitor agricultural commerce activity and platform health metrics across specific geographic areas.

### How It Works

1. **Request API Key**: Contact the platform administrator to request an integrator API key.
2. **Key Scoping**: The administrator creates a key scoped to:
   - **Specific farmer wallets** (e.g., members of your cooperative), OR
   - **A geographic region** (e.g., "Kumasi, Ghana")
3. **Access Reports**: Use the API key to query anonymized, aggregated data endpoints.

### Requesting an API Key

To request an integrator API key:

1. **Contact Administrator**: Reach out to the platform admin team with:
   - **Organization Name**: The name of your NGO, cooperative, or program
   - **Scope Requirements**: Which farmers or regions you need access to
   - **Use Case**: A brief description of how you plan to use the data

2. **Admin Issues Key**: The administrator will use the admin panel or API to create your scoped key.

3. **Receive Key**: You'll receive an API key string (e.g., `int_abc123...`). **Store this securely** as it won't be shown again.

### Using the API

Include your API key in the `x-integrator-api-key` header:

\`\`\`bash
curl -H "x-integrator-api-key: YOUR_API_KEY" \\
"https://api.agrocylo.com/integrator/v1/reports/farmers?limit=100&format=json"
\`\`\`

#### Available Endpoints

| Endpoint                               | Description                              | Formats   |
| -------------------------------------- | ---------------------------------------- | --------- |
| \`GET /integrator/v1/reports/farmers\` | Aggregated farmer data within your scope | JSON, CSV |
| \`GET /integrator/v1/reports/orders\`  | Aggregated order transaction data        | JSON, CSV |

**Parameters:**

- \`limit\` (optional): Max records to return (default: 100, max: 500)
- \`format\` (optional): Response format, either \`json\` or \`csv\` (default: json)

**Rate Limits:**

- 30 requests per minute per API key

#### Example Response (JSON)

\`\`\`json
{
"data": [
{
"farmer_wallet": "GDQP2K...",
"total_orders": 12,
"total_volume": "1250.50",
"region": "Kumasi"
}
],
"count": 1
}
\`\`\`

#### CSV Export

Add \`?format=csv\` to download reports as CSV files for use in Excel, Google Sheets, or data analysis tools.

### Security & Privacy

- **Scoped Access**: Keys only return data within the defined farmer wallet list or region.
- **Anonymized Data**: Individual transaction details are aggregated to protect farmer privacy.
- **Rate Limited**: Prevents abuse and ensures fair access for all integrators.
- **Audit Logging**: All API key usage is logged and available to administrators.

### Revoking a Key

If an API key is compromised or no longer needed:

1. Contact the platform administrator to revoke the key
2. The key will be immediately disabled and cannot be reused
3. Request a new key if continued access is needed

### Full API Documentation

See [openapi.yaml](openapi.yaml) for complete endpoint specifications, request/response schemas, and error codes.

---

## Contributing

### Contributor Setup Checklist

Before running `npm run build` or `npm test`, complete these steps or they will fail:

```bash
# 1. Install dependencies
npm install

# 2. Generate the Prisma client (required before build/test)
npx prisma generate

# 3. Copy and fill in environment variables
cp .env.example .env
# Edit .env with your DATABASE_URL, JWT_SECRET, etc.

# 4. Apply database migrations
npx prisma migrate dev
```

> **Shortcut:** `npm run setup` runs steps 1 and 2 for you.

### Fixing a Server Issue

1. **Reproduce** — run \`npm run dev\` and confirm the bug locally.
2. **Locate** — use the project structure above to find the relevant service or controller.
3. **Test first** — add or update a test in the appropriate \`\*.test.ts\` file before changing logic.
4. **Fix** — make your change and verify \`npm test\` passes.
5. **Build check** — run \`npm run build\` to ensure no TypeScript errors.
6. **PR** — open a pull request against \`main\` referencing the issue number.

### Adding a New Route

1. Create a service in \`src/services/\`.
2. Create a controller in \`src/controllers/\`.
3. Add a router file in \`src/routes/\` and register it in \`src/app.ts\`.
4. Document the endpoint in \`openapi.yaml\`.

### Useful Commands

\`\`\`bash
npm run dev # Start dev server with hot reload
npm run build # Compile TypeScript
npm start # Run compiled output
npm test # Run all tests
npx vitest # Run tests in watch mode
npx prisma migrate dev # Apply schema changes to DB
npx prisma studio # Open Prisma visual DB explorer
\`\`\`
