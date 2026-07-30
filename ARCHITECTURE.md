# Agrocylo-Global Architecture & Repository Map

This document explains the repository structure, the relationship between the two main applications (root `client/server` vs `agro-production/client/server`), and how the 6 Soroban contract crates fit into the system.

---

## Overview

Agrocylo-Global is a dual-application Agro-DeFi platform on Stellar/Soroban:

1. **Root `client/` + `server/`** — Original marketplace application (peer-to-peer farmer-consumer trade with escrow)
2. **`agro-production/client/` + `agro-production/server/`** — Campaign-based production crowdfunding (investors fund agricultural campaigns and claim returns)

Both applications use Stellar wallets, on-chain escrow, and WebSocket-based real-time updates. They are **independent** but share some architectural patterns and contract infrastructure.

---

## Application Structure

### 1. Root Marketplace (`client/` + `server/`)

**Status:** Earlier-stage, simpler escrow pattern
**Use case:** Peer-to-peer goods trade with immediate payment-on-delivery escrow

#### `client/`
- Next.js 13+ (App Router)
- **Wallet:** Freighter API (`@stellar/freighter-api`)
- **State:** React Context (WalletContext, OrderContext)
- **Features:**
  - Product listing and search
  - Order creation and tracking
  - Escrow state transitions (confirm/refund/dispute)
  - Notifications and real-time updates via WebSocket
- **Key files:**
  - `src/app/(root)/orders/` — order detail and management
  - `src/components/` — reusable UI components
  - `src/services/stellar/` — contract interaction, transaction signing
  - `src/context/` — global state (wallet, orders)

#### `server/`
- Express.js
- Prisma ORM with PostgreSQL
- **Services:**
  - Order and product management (REST API)
  - WebSocket server for real-time notifications
  - Event indexing from Stellar ledger (via Soroban RPC)
  - Contract watcher for escrow state changes
- **Key files:**
  - `src/routes/` — REST API endpoints (orders, products, auth)
  - `src/services/contractWatcher.ts` — polls RPC for escrow events
  - `src/services/wsManager.ts` — WebSocket client/subscription management
  - `src/controllers/` — business logic for orders, products

**Contracts used:** `contracts/escrow/` (direct payment escrow)

---

### 2. Campaign Production App (`agro-production/client/` + `agro-production/server/`)

**Status:** Current development focus (Stellar Wave bounty program)
**Use case:** Campaign-based crowdfunding for agricultural production (investors lock funds, farmers execute production, investors claim returns)

#### `agro-production/client/`
- Next.js 14+ (App Router)
- **Wallet:** Freighter API (same pattern as root client)
- **State:** React Context + custom hooks
- **Features:**
  - Campaign creation (by farmers)
  - Campaign browsing and details
  - Investment flow (XDR building, transaction signing, indexing polls)
  - Investor dashboards and return claims
  - Real-time campaign status updates
- **Key files:**
  - `src/app/campaigns/` — campaign listing and details
  - `src/app/invest/` — investment flow
  - `src/lib/contractService.ts` — builds invest XDR, interacts with production_escrow contract
  - `src/lib/signTransaction.ts` — signs and submits transactions
  - `src/hooks/` — custom React hooks (useInvest, useCampaign, etc.)

#### `agro-production/server/`
- Express.js
- Prisma ORM with PostgreSQL
- **Services:**
  - Campaign and investment REST API
  - WebSocket for real-time campaign/investment updates
  - Soroban event watcher (polls RPC for production_escrow events)
  - Image upload endpoint for campaign photos
- **Key files:**
  - `src/routes/` — REST API for campaigns, investments, auth
  - `src/services/contractWatcher.ts` — indexes production_escrow events (campaign.created, campaign.invested)
  - `src/services/wsManager.ts` — broadcasts Soroban events to WebSocket clients
  - `src/controllers/campaignController.ts` — campaign business logic

**Contracts used:** 
- `agro-production/contract/production_escrow/` — main crowdfunding escrow
- `agro-production/contract/registry/` — campaign/farmer registration
- `agro-production/contract/investment_basket/` — investor pool management
- `agro-production/contract/governance/` — DAO/governance features (future)

---

## Smart Contracts (6 Rust Crates)

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

#### 2. `contracts/weather-insurance/`
- **Purpose:** Weather-based parametric insurance for farmers (complementary feature)
- **Status:** Standalone; future integration planned
- **Consumed by:** Not yet integrated into main app flows

### Production Crowdfunding Contracts

#### 3. `agro-production/contract/production_escrow/`
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

#### 4. `agro-production/contract/registry/`
- **Purpose:** Farmer/investor identity and KYC registration on-chain
- **Key interactions:**
  - `register_farmer()` — on-board farmer with identity
  - `register_investor()` — on-board investor
  - `get_farmer()` — look up farmer details
- **Consumed by:** `agro-production/server/` (campaign creation validation), `agro-production/client/` (farmer onboarding)

#### 5. `agro-production/contract/investment_basket/`
- **Purpose:** Manages investor fund pooling and returns distribution
- **Key interactions:**
  - `deposit()` — investor adds funds to pool
  - `distribute()` — distribute returns proportionally to investors
- **Status:** Used by production_escrow for multi-investor campaigns
- **Consumed by:** `production_escrow/` (internally)

#### 6. `agro-production/contract/governance/`
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

### Current (Stellar Wave Program)
- **Production escrow campaigns** (`agro-production/`) — MVP for agricultural crowdfunding
- Critical issues: wallet auth, contract integration, error handling, observability

### Next Phase
- Weather insurance integration (`contracts/weather-insurance/`)
- Governance features (`agro-production/contract/governance/`)
- Root marketplace enhancements

### Not Active
- `client/` and `server/` (root marketplace) — production-ready but not under active development for Stellar Wave

---

## Environment Configuration

### Frontend (both client/ and agro-production/client/)
```
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
NEXT_PUBLIC_CONTRACT_ID=<address>  # agro-production/client only
```

### Backend (both server/ and agro-production/server/)
```
DATABASE_URL=postgresql://...
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
CONTRACT_ID=<address>
RUN_CONTRACT_WATCHER=true
PORT=3001
```

---

## Getting Started

### New Contributors

1. **Understand the split:**
   - **For campaign/production features:** Work in `agro-production/`
   - **For marketplace features:** Work in root `client/` and `server/`
   - **For shared contracts:** Check which app(s) consume it

2. **Pick an area:**
   - Backend: `agro-production/server/` (contract watcher, API routes, WebSocket)
   - Frontend: `agro-production/client/` (investment flow, campaign pages)
   - Contracts: `agro-production/contract/` (Rust/Soroban)

3. **Run locally:**
   - See `agro-production/README.md` for E2E test setup
   - See `client/README.md` and `server/README.md` in each directory

4. **File issues:**
   - Use GitHub Issues with appropriate labels (`area:frontend`, `area:backend`, `type:bug`, etc.)
   - Reference this document if explaining architectural decisions

---

## Questions?

- **Repo structure:** See this ARCHITECTURE.md
- **API endpoints:** See `server/API.md` or `agro-production/server/API.md`
- **Contract interfaces:** See Rust crate READMEs in `contract/` and `agro-production/contract/`
- **Deployment:** Check CI workflows in `.github/workflows/`
