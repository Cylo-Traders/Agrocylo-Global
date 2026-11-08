# Persistent & Instance Storage TTL Extension Policy (Issue #456 / Issue #1300)

> **Last verified against commit:** `25d942522b76e4252752249142326a757d3d78d6`

## Overview

All data stored in Soroban persistent and instance contract storage in `contracts/production_escrow/src/lib.rs` (`production-escrow-v2`) has its Time-To-Live (TTL) explicitly managed. This document specifies the exact storage keys and extension call sites implemented in `lib.rs`.

## TTL Configuration Constants (`contracts/production_escrow/src/lib.rs`)

```rust
const TTL_THRESHOLD: u32 = 1_000;          // Persistent storage threshold (ledgers)
const TTL_EXTEND: u32 = 100_000;           // Persistent storage extension (ledgers)
const INSTANCE_TTL_THRESHOLD: u32 = 1_000; // Instance storage threshold (ledgers)
const INSTANCE_TTL_EXTEND: u32 = 100_000;  // Instance storage extension (ledgers)
```

Instance storage TTL is extended via `bump_instance(&env)` on state-mutating entry points and can also be extended permissionlessly during quiet periods via `bump_instance_ttl(env)`.

---

## Implemented Persistent Storage Key TTL Policies

### 1. Campaign Records

- **Key**: `DataKey::Campaign(campaign_id)`
- **Storage Type**: Persistent
- **Helper**: `save_campaign(env, &campaign)` sets `DataKey::Campaign(c.id)` and immediately calls `extend_ttl(&DataKey::Campaign(c.id), TTL_THRESHOLD, TTL_EXTEND)`.
- **Call Sites**: `create_campaign`, `invest`, `start_production`, `mark_harvest`, `advance_milestone`, `confirm_split_receipt`, `resolve_split_dispute`, `confirm_order`, `settle`, `finalize_failed`, `mark_campaign_failed`, `open_dispute`, `resolve_dispute_internal`.

### 2. Per-Investor Contributions (Indexed O(1) Keys)

- **Key**: `DataKey::Contribution(campaign_id, investor)` *(replaces the legacy `DataKey::Contributions(campaign_id)` map)*
- **Storage Type**: Persistent
- **Implemented Extension Call Sites**:
  - `invest()`: extended after writing updated investor contribution.
  - `claim_returns()`: **extended on read** before computing payout (`lib.rs:1678`).
  - `refund()`: **extended on read** before computing refund (`lib.rs:1702`).
  - `batch_refund_investors()`: **extended on read** for each refunded investor (`lib.rs:1891`).
  - `transfer_investment()`: extended on `from` (when non-zero remainder remains) and on `to` (`lib.rs:2044, 2055`).

### 3. Investor Claim / Refund Flags

- **Key**: `DataKey::Claimed(campaign_id, investor)`
- **Storage Type**: Persistent
- **Implemented Extension Call Sites**:
  - `claim_returns()`: extended immediately after setting `Claimed` to `true`.
  - `refund()`: extended immediately after setting `Claimed` to `true`.
  - `batch_refund_investors()`: extended for each investor processed in the batch.
  - `transfer_investment()`: when transferring to an address that previously claimed, removes the stale `Claimed` flag on `to`.

### 4. Ordinary Order Records

- **Key**: `DataKey::Order(order_id)`
- **Storage Type**: Persistent
- **Implemented Extension Call Sites**:
  - `create_order()`: extended immediately after storing new `OrderStatus::Pending` record.
  - `cancel_order()`: extended after transitioning to `OrderStatus::Refunded`.
  - `confirm_order()`: extended after transitioning to `OrderStatus::Confirmed`.
  - `batch_refund_orders()`: extended for each expired order transitioned to `OrderStatus::Refunded`.

### 5. Multi-Party Split Orders

- **Key**: `DataKey::SplitOrder(order_id)`
- **Storage Type**: Persistent
- **Helper**: `save_split_order(env, order_id, &order)` sets `DataKey::SplitOrder(order_id)` and calls `extend_ttl(&DataKey::SplitOrder(order_id), TTL_THRESHOLD, TTL_EXTEND)`.
- **Call Sites**: `create_split_order`, `fund_split_order`, `confirm_split_receipt`, `open_split_dispute`, `resolve_split_dispute`.

### 6. Milestone Configurations & Arbitrator Votes

- **Key**: `DataKey::MilestoneConfigs(campaign_id)` — Persistent; extended in `set_milestone_configs()`.
- **Key**: `DataKey::ArbitratorVote(campaign_id, arbitrator)` — Persistent; extended in `vote_to_resolve()`.

---

## Summary Table (`contracts/production_escrow/src/lib.rs`)

| Key | Storage Type | Implemented TTL Extension Points |
|-----|--------------|----------------------------------|
| `Campaign(id)` | Persistent | `save_campaign()` on creation and every campaign mutation |
| `Contribution(campaign_id, investor)` | Persistent | `invest`, `claim_returns`, `refund`, `batch_refund_investors`, `transfer_investment` |
| `Claimed(campaign_id, investor)` | Persistent | `claim_returns`, `refund`, `batch_refund_investors` |
| `Order(order_id)` | Persistent | `create_order`, `cancel_order`, `confirm_order`, `batch_refund_orders` |
| `SplitOrder(order_id)` | Persistent | `save_split_order()` across all split-order lifecycle mutations |
| `MilestoneConfigs(campaign_id)` | Persistent | `set_milestone_configs` |
| `ArbitratorVote(campaign_id, arbitrator)` | Persistent | `vote_to_resolve` |
| Instance keys (`Admin`, `Attester`, `GovernanceContract`, `SupportedTokens`, `FeeCollector`, `FeeRateBps`, `Paused`, etc.) | Instance | `bump_instance()` across mutators + permissionless `bump_instance_ttl()` |

---

## Remaining Follow-Up Gaps

- Pure read-only view functions (`get_campaign`, `get_order`, `get_split_order`, `get_contribution`, `refundable_amount`) do not mutate or extend TTL so that off-chain RPC simulations remain free of storage-write footprints. Keepers should invoke `bump_instance_ttl` for instance keys during extended idle periods.
