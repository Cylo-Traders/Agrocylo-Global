# Agrocylo-Global Architecture & Repository Map

This document explains the repository structure, the relationship between the two main applications (root `client/server` vs `agro-production/client/server`), and how the five deployable Soroban contract crates fit into the system.

---

## Overview

Agrocylo-Global is an npm/Turborepo workspace on Stellar/Soroban with two active product surfaces:

1. **Root `client/` + `server/`** — Marketplace application (peer-to-peer agricultural trade with escrow, cart, orders, and real-time updates).
2. **`agro-production/client/` + `agro-production/server/`** — Campaign-based production crowdfunding (investors fund agricultural campaigns and claim returns).

Both applications use Stellar wallet integrations, on-chain contracts, and WebSocket-based updates. They are independent deployables that share repo tooling and some patterns.

---

## Application Structure

### 1. Marketplace (`client/` + `server/`)

**Use case:** Peer-to-peer goods trade with escrow-backed settlement.

#### `client/`
- Next.js 16 (App Router), React 19, TypeScript.
- **Wallet:** `@stellar/freighter-api` and wallet adapter flows used by the app.
- **State/data:** React Query hooks, React context, and service modules.
- **Features:** product listing/search, cart/checkout, order management, escrow actions, notifications.
- **Key paths:**
  - `src/app/(root)/market/` — marketplace listing and product views
  - `src/hooks/queries/useProducts.ts` — product query hook
  - `src/services/productService.ts` — product API calls
  - `src/lib/apiConfig.ts` / `src/lib/apiHelper.ts` — API base URL and request wrapper

#### `server/`
- Express + TypeScript, Prisma/PostgreSQL.
- **Services:** REST API for products/orders/auth/cart, Socket.io real-time updates, Stellar/Soroban integration.
- **Key paths:**
  - `src/routes/` — REST routes
  - `src/controllers/` — request handlers/business logic
  - `docs/API.md` and `openapi.yaml` — API documentation/contracts

**Primary contract:** `contracts/escrow/`.

---

### 2. Campaign Production App (`agro-production/client/` + `agro-production/server/`)

**Use case:** Campaign-based crowdfunding for agricultural production.

#### `agro-production/client/`
- Next.js 16 (App Router), React 19, TypeScript.
- **Features:** campaign creation/browsing, investment flow, dashboards, claims, real-time updates.
- **Key paths:** `src/app/`, `src/lib/`, `src/hooks/`, `src/services/`.

#### `agro-production/server/`
- Express + TypeScript, Prisma/PostgreSQL.
- **Features:** campaign/investment API, Soroban event watcher/indexing, WebSocket broadcasts.
- **Key paths:** `src/routes/`, `src/controllers/`, `src/services/`.

**Contracts used:** `contracts/production_escrow/`, `contracts/registry/`, `contracts/investment_basket/`, and related governance/infrastructure contracts as needed.

---

## Smart Contracts (5 Deployable Rust Crates)

All contracts are written in Rust for Soroban (Stellar's smart contract platform).

### Root Escrow Contracts

#### 1. `contracts/escrow/`
- **Purpose:** Direct payment escrow for root marketplace (peer-to-peer trade)
- **Events:**
  - `order.created` — buyer initiates escrow
  - `order.confirmed` — buyer receives goods and releases payment
  - `order.disputed` — buyer/seller dispute
  - `order.refunded` — payment returned to buyer
- **Consumed by:** `server/` (contract watcher), `client/` (order management)

#### Archived prototype: `archive/weather-insurance/`
- **Purpose:** Weather-based parametric insurance for farmers (complementary feature)
- **Status:** Standalone; future integration planned
- **Consumed by:** Not yet integrated into main app flows

### Production Crowdfunding Contracts

#### 3. `contracts/production_escrow/`
- **Purpose:** Campaign-based escrow for crowdfunded agricultural production
- **Key interactions:**
  - `create_campaign()` — farmer initiates campaign (target amount, deadline)
  - `invest()` — investor locks funds in campaign
  - `settle_campaign()` — campaign settles when deadline passes
  - `claim_returns()` — investor claims proportional returns from campaign results
- **Events:**
  - `campaign.created` — campaign initialized
  - `campaign.invested` — investor deposits
  - `campaign.settled` — campaign reached deadline
  - `campaign.claimed` — investor withdrew returns
- **Consumed by:** `agro-production/server/` (watcher), `agro-production/client/` (invest flow)

#### 4. `contracts/registry/`
- **Purpose:** Farmer/investor identity and KYC registration on-chain
- **Key interactions:**
  - `register_farmer()` — on-board farmer with identity
  - `register_investor()` — on-board investor
  - `get_farmer()` — look up farmer details
- **Consumed by:** `agro-production/server/` (campaign creation validation), `agro-production/client/` (farmer onboarding)

#### 5. `contracts/investment_basket/`
- **Purpose:** Manages investor fund pooling and returns distribution
- **Key interactions:**
  - `deposit()` — investor adds funds to pool
  - `distribute()` — distribute returns proportionally to investors
- **Status:** Used by production_escrow for multi-investor campaigns
- **Consumed by:** `production_escrow/` (internally)

#### 6. `contracts/governance/`
- **Purpose:** DAO-style governance for platform decisions (future feature)
- **Status:** Under development; not yet integrated into main flows
- **Planned interactions:**
  - `propose()` — propose platform changes
  - `vote()` — vote on proposals
- **Consumed by:** Planned for future releases

---

## Data Flow

### Root Marketplace Order Flow
```
Client                  Server              Stellar Ledger
  │                       │                      │
  ├─ User creates order ──→ REST POST /orders   │
  │                        ├─ Save to DB         │
  │                        └─ Broadcast WS      ├─ Contract initialized
  │                                             │
  ├─ User signs escrow XDR ──→ POST /orders/:id/confirm
  │  and submits to Stellar   ├─ Submit to ledger ──→ Escrow locked
  │                           └─ Broadcast WS
  │
  ├─ Buyer waits for ────────→ Contract watcher polls RPC
  │  delivery           ├─ Detects escrow confirmation
  │                     ├─ Updates DB + broadcasts WS
  └─ User confirms/refunds ──→ POST /orders/:id/action
     and signs XDR            ├─ Submit to Stellar ──→ Funds released
                              └─ Broadcast WS
```

### Campaign Investment Flow
```
Client                       Server              Stellar Ledger
  │                            │                      │
  ├─ User creates campaign ──→ POST /campaigns       │
  │  (farmer)                   ├─ Save to DB        ├─ production_escrow initialized
  │                             └─ Broadcast WS      │
  │
  ├─ Investor browses campaigns ────→ GET /campaigns │
  │                               ├─ Query DB        │
  │                               └─ Return list     │
  │
  ├─ Investor reviews campaign ──→ GET /campaigns/:id
  │                              └─ Return details
  │
  ├─ contractService.buildInvest() ──→ (local to client)
  │  (builds XDR against mock RPC)
  │
  ├─ User signs invest XDR ──→ POST /campaigns/:id/invest
  │  and submits to Stellar    ├─ Submit to ledger ──→ Funds locked in pool
  │                            └─ Broadcast WS
  │
  │ (campaign lifecycle)
  └─ After deadline, ────────→ Contract watcher detects
     investor claims returns   settlement + auto-broadcasts
                               ├─ POST /campaigns/:id/claim_returns
                               ├─ Submit to ledger ──→ Returns released
                               └─ Broadcast WS
```

---

## Key Architectural Patterns

### Transaction Lifecycle
Both apps follow the same pattern:
1. **XDR Building** — Client builds transaction (sometimes with mock RPC for testing)
2. **Signing** — User signs with Freighter wallet
3. **Submission** — Send to Stellar network
4. **Indexing Polling** — Server polls Soroban RPC for confirmation
5. **DB Update & Broadcast** — Once indexed, update DB and notify WebSocket clients

### Real-time Updates
- WebSocket server broadcasts events from `contract watcher` to connected clients
- Events are keyed by wallet address (e.g., `farmer:0x...`, `investor:0x...`)
- Clients subscribe to wallet-specific channels after authentication

### Error Classification
Both apps use `classifyError()` utility to categorize contract errors:
- **User errors** (e.g., insufficient funds) → 400 Bad Request
- **Contract logic** (e.g., CampaignNotSettled) → 422 Unprocessable Entity
- **Network errors** → 503 Service Unavailable
- **Unexpected errors** → 500 Internal Server Error

---

## Development Focus

Active work is tracked in GitHub Issues and current campaign boards. Use issue labels and recent PRs as the source of truth for priority rather than static status claims in this document.

---

## Environment Configuration

Environment variables and ports evolve; use these maintained sources:

- Frontend setup: [`docs/FRONTEND_SETUP.md`](docs/FRONTEND_SETUP.md)
- Deployment/environment reference: [`docs/deployment/environment.md`](docs/deployment/environment.md)
- Backend unification notes: [`docs/architecture/backend-unification.md`](docs/architecture/backend-unification.md)
- Local examples: `.env.example`, `client/.env.example`, `server/.env.example`, `agro-production/*/.env.example`

---

## Getting Started

### New Contributors

1. **Pick the surface:** marketplace (`client/`, `server/`), production (`agro-production/`), or contracts (`contracts/`).
2. **Read local setup docs:** [`docs/FRONTEND_SETUP.md`](docs/FRONTEND_SETUP.md), [`server/README.md`](server/README.md), and app-specific READMEs.
3. **Use GitHub Issues** with repository labels (`Frontend`, `Backend`, `Contract`, `bug`, `enhancement`, `documentation`, `good first issue`, `Stellar Wave`).

---

## Questions?

- **Repo structure:** this document
- **Frontend setup:** [`docs/FRONTEND_SETUP.md`](docs/FRONTEND_SETUP.md)
- **Deployment/environment:** [`docs/deployment/environment.md`](docs/deployment/environment.md)
- **Backend unification:** [`docs/architecture/backend-unification.md`](docs/architecture/backend-unification.md)
- **API docs:** [`server/docs/API.md`](server/docs/API.md), [`client/API.md`](client/API.md), [`server/openapi.yaml`](server/openapi.yaml)
- **Security audit:** [`contracts/SECURITY_AUDIT.md`](contracts/SECURITY_AUDIT.md)
- **Contracts:** [`docs/contracts/`](docs/contracts/)
- **CI workflows:** [`.github/workflows/`](.github/workflows/)
