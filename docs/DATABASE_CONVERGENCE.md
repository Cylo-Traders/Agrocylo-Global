# Architectural Specification: Database Relationship & Convergence Plan (Issue #646)

## Executive Summary

This document specifies the target relationship, schema alignment strategy, cross-service identity model, and migration path between the two primary backend service databases:

1. **Legacy Backend Database (`agrocylo_db`)**: Serves non-custodial marketplace listings, buyer demands, farmer supplies, locations, equipment rentals, cart sessions, notification preferences, and user profiles (`server/prisma/schema.prisma`).
2. **Agro-Production Database (`agrocylo_production`)**: Serves production escrow funding campaigns, investor positions, tranche releases, dispute resolutions, and real-time Soroban ledger indexing (`agro-production/server/prisma/schema.prisma`).

---

## 1. Primary Foreign Key & Canonical User Identity (`walletAddress`)

Although the two services currently run against separate PostgreSQL databases (`agrocylo_db` and `agrocylo_production`), user identity is strictly unified across both services through the Stellar wallet public key (`walletAddress`, e.g., `G...`).

- `User.walletAddress` is unique, persistent, and non-mutable in both schemas.
- In `agrocylo_db`, user metadata, roles (`FARMER`, `BUYER`, `DISTRIBUTOR`), and profile details live in the `profiles` table keyed by `wallet_address`.
- In `agrocylo_production`, on-chain campaign ownership, investor records, and order histories live in `users`, `campaigns`, `investments`, and `orders` tables keyed by `walletAddress`.
- All cross-service lookups (reputation snapshots, order histories, campaign activity) use `walletAddress` as the join key.

---

## 2. Cross-Referencing API Contracts

To allow client applications and gateways to render a single composite profile for a user across both market ecosystems:

1. **Agro-Production API**: Exposes `GET /api/v1/users/:walletAddress`, returning:
   - Wallet public key & role
   - Campaign count & total funding activity
   - Order count & dispute history
   - Computed on-chain reputation score
2. **Legacy Server API**: Exposes `GET /profiles/:wallet_address` and `GET /profiles/:wallet_address/reputation`, returning off-chain profile details, location metadata, and rating snapshots.

Clients aggregate both endpoints via `walletAddress` to construct full user identity without requiring database-level joins.

---

## 3. Schema Divergence Reconciliation & Convergence Plan

### Model Mapping Comparison

| Domain Entity | Legacy `agrocylo_db` | Agro-Production `agrocylo_production` | Target Unified Schema |
|---|---|---|---|
| User & Role | `User` (role: `String?`), `Profile` (role: enum) | `User` (role: `String` default `"INVESTOR"`) | Unified `User` model with canonical `Role` enum (`INVESTOR`, `FARMER`, `BUYER`, `DISTRIBUTOR`, `ADMIN`) |
| Authentication | `Nonce`, `RefreshToken` | `AuthNonce` | Unified `AuthNonce` / JWT refresh tokens table |
| Campaigns | — | `Campaign`, `Investment` | Primary `Campaign` and `Investment` models |
| Marketplace Orders | `Order`, `OrderItem` | `Order` (on-chain escrow) | Separate `OffChainOrder` vs `OnChainEscrowOrder` or polymorphic `Order` |
| Notifications | `Notification`, `notification_preferences` | — | Shared `Notification` table |
| Disputes | — | `Dispute`, `DisputeEvidence`, `DisputeAuditEntry` | Shared `Dispute` domain models |

---

## 4. Phase-by-Phase Migration Plan

### Phase 1: Dual-Service Operation with `walletAddress` Join (Current Phase)
- Backends operate independently using `walletAddress` as the cross-system key.
- Shared REST endpoints (`GET /api/v1/users/:walletAddress`) allow non-blocking cross-referencing.

### Phase 2: Schema Union & Migration Preparation
- Create a consolidated Prisma schema combining all models under a single schema file.
- Reconcile `User.role` values:
  - Map `INVESTOR` → `INVESTOR`
  - Map `FARMER` → `FARMER`
  - Map `BUYER` → `BUYER`
  - Map `DISTRIBUTOR` → `DISTRIBUTOR`

### Phase 3: Single Database Migration
1. Deploy consolidated database instance (`agrocylo_unified`).
2. Run database migration script copying `users`, `profiles`, `campaigns`, `investments`, `orders`, and `transactions`.
3. Apply relational foreign key constraints referencing `users(walletAddress)`.

### Phase 4: Route Convergence & Sunset
- Update router configurations so both server modules query the unified database via shared Prisma client instance.
