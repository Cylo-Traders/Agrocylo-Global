# Persistent & Instance Storage TTL Extension Policy (Issues #456, #777, #1290)

## Overview

All data stored in Soroban contract storage must have its Time-To-Live (TTL) explicitly managed to prevent archival loss. This document specifies:
1. How **Instance Storage** (`env.storage().instance()`) is maintained across active operations and quiet periods via `scripts/instance-ttl-keeper.sh`.
2. How **Persistent Storage** (`env.storage().persistent()`) is extended per `DataKey` across the escrow and registry contracts, and how persistent-entry retention differs from instance maintenance.

## TTL Configuration Constants

All TTL extension operations use the following named constants (defined in `lib.rs`):

```rust
// Per-record persistent storage constants
const TTL_THRESHOLD: u32 = 1_000;          // Extend persistent key when remaining TTL <= 1,000 ledgers
const TTL_EXTEND: u32 = 100_000;           // Set persistent key live_until_ledger_seq = current + 100,000 ledgers

// Contract instance storage constants (Issue #777 / #1290)
pub const INSTANCE_TTL_THRESHOLD: u32 = 50_000; // Extend instance TTL when remaining TTL <= 50,000 ledgers (~2.89 days)
pub const INSTANCE_TTL_EXTEND: u32 = 100_000;   // Set instance live_until_ledger_seq = current + 100,000 ledgers (~5.79 days)
```

### Important Semantics of `extend_ttl(threshold, extend_to)`

- `extend_ttl(threshold, extend_to)` is a **no-op** whenever the entry's current remaining TTL is strictly greater than `threshold`.
- When `remaining_ttl <= threshold`, Soroban sets `live_until_ledger_seq = current_ledger + extend_to` (`100,000` ledgers, which is **~5.79 days** at 5 seconds/ledger).
- Extensions do **not** accumulate across calls (calling `extend_ttl` ten times in one ledger still results in a `100,000`-ledger TTL, never `1,000,000` ledgers).
- Explicit keeper calls to `bump_instance_ttl()` invoke `extend_ttl(INSTANCE_TTL_EXTEND, INSTANCE_TTL_EXTEND)` so that scheduled keeper runs unconditionally reset the instance TTL to the full `100,000` ledgers even during total user inactivity.
- See [`docs/deployment/INSTANCE_TTL_KEEPER.md`](../../docs/deployment/INSTANCE_TTL_KEEPER.md) for the keeper schedule, alerting, and archival restore drill.

---

## Instance Storage vs. Persistent-Entry Retention

- **Instance Storage (`bump_instance_ttl`)**: Protects the contract instance itself (`Admin`, `GovernanceContract`, `Paused`, `SupportedTokens`, `FeeRateBps`, `SchemaVersion`, counters, and caps) across `production_escrow`, `escrow`, `governance`, `registry`, and `investment_basket`. Maintained during quiet periods by `scripts/instance-ttl-keeper.sh`.
- **Persistent Storage (`DataKey::*`)**: Each `Campaign(id)`, `Contributions(id)`, `Claimed(campaign_id, investor)`, `Order(id)`, and `SplitOrder(id)` is a separate ledger entry with its own TTL. Calling `bump_instance_ttl()` does **not** extend persistent entries. If a campaign or order remains untouched for `> 100,000` ledgers (~5.79 days), its persistent key must be restored from the Soroban hot archive (`stellar contract restore`) prior to settlement or claim.

---

## Persistent Data Key TTL Policies

### Campaign Records

**Key**: `DataKey::Campaign(campaign_id)`
**Storage Type**: Persistent
**Owner**: Farmer (creates), Admin/Governance (reads/modifies)

| Trigger | TTL Extension Call | Reason |
|---------|-------------------|--------|
| Creation (`create_campaign`) | Extended immediately after set | Campaign must survive funding phase |
| Status transition (funded, production, harvested, settled, failed, cancelled) | Extended via `save_campaign()` | Investors read status before claiming/refunding |
| Dispute resolution | Extended in `resolve_dispute_internal()` | Final state must persist for claims and audit |

**Implementation**: `save_campaign()` helper handles all Campaign writes with automatic TTL extension.

---

### Campaign Contributions

**Key**: `DataKey::Contributions(campaign_id)`
**Storage Type**: Persistent
**Owner**: Protocol (stores investor -> amount map)

| Trigger | TTL Extension Call | Reason |
|---------|-------------------|--------|
| Creation (first investment) | Extended on first `invest()` | Must survive funding phase |
| Investment added / transferred | Extended in `invest()` and `transfer_investment()` | Refreshes map on investor activity |
| Claim / Refund read | Extended in `claim_returns()` and `refund()` | Refreshes contribution map during payout waves |

---

### Investor Claims (Proof of Payout)

**Key**: `DataKey::Claimed(campaign_id, investor)`
**Storage Type**: Persistent
**Owner**: Protocol (double-claim prevention flag)

| Trigger | TTL Extension Call | Reason |
|---------|-------------------|--------|
| First claim (`claim_returns`) | Extended on set | Prevents double-claims |
| First refund (`refund`) | Extended on set | Prevents double-refunds |
| Batch refund (`batch_refund_investors`) | Extended on set | Protects all batch-processed claims |

---

### Order & SplitOrder Records

**Key**: `DataKey::Order(order_id)`, `DataKey::SplitOrder(order_id)`
**Storage Type**: Persistent
**Owner**: Buyer/Farmer

| Trigger | TTL Extension Call | Reason |
|---------|-------------------|--------|
| Creation (`create_order`, `create_split_order`) | Extended on creation | Order must survive confirmation/funding window |
| Mutation (`confirm_order`, `cancel_order`, `contribute_split_order`, `cancel_split_order`, `refund_expired_split_order`) | Extended on write (`save_split_order` / `extend_ttl`) | Terminal or updated state must persist |
| Batch refund (`batch_refund_orders`) | Extended on set after status change | Refund state must persist |

---

## Cross-Crate TTL Summary

| Crate | Instance TTL Keeper Endpoint | Persistent TTL Extension Points |
|---|---|---|
| `production_escrow` | `bump_instance_ttl()` (`INSTANCE_TTL_EXTEND = 100_000`) | `Campaign(id)`, `Contributions(id)`, `Claimed(cid, inv)`, `Order(id)`, `SplitOrder(id)` |
| `escrow` (marketplace) | `bump_instance_ttl()` (`INSTANCE_TTL_EXTEND = 100_000`) | `Order(id)`, `Dispute(id)`, `SplitOrder(id)`, `SplitOrderDispute(id)` |
| `governance` | `bump_instance_ttl()` (`INSTANCE_TTL_EXTEND = 100_000`) | `Proposal(id)`, `Vote(id, voter)` |
| `registry` | `bump_instance_ttl()` (`INSTANCE_TTL_EXTEND = 100_000`) | Instance storage bumped on all mutations; persistent entries tracked per key |
| `investment_basket` | `bump_instance_ttl()` (`INSTANCE_TTL_EXTEND = 100_000`) | `Basket(id)`, `Deposit(id, inv)`, `Claimed(id, inv)` |

---

## Ledger Advance & Inactivity Rehearsal Testing

Verified in `contracts/production_escrow/src/test.rs`, `contracts/escrow/src/test.rs`, and `scripts/test-instance-ttl-keeper-1290.sh`:

1. **Near-threshold test** (`test_bump_instance_ttl_near_threshold_extends_live_ttl`): Advances `sequence_number` until remaining instance TTL is `900` ledgers, invokes `bump_instance_ttl()`, and asserts `get_ttl() == 100_000`.
2. **Inactivity rehearsal** (`test_instance_ttl_keeper_inactivity_rehearsal_keeps_quiet_instance_live`): Advances `320,000` ledgers (> 3x the single-extension lifetime) with zero user transactions and periodic keeper bumps every `40,000` ledgers, asserting the instance remains live and queryable throughout.
