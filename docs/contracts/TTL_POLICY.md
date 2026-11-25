# Production Escrow & Contract Storage TTL Policy

This document specifies the Soroban storage Time-To-Live (TTL) extension parameters, data key categories, and retention policies used across the canonical [`production_escrow`](./CANONICAL_CONTRACT.md) contract and supporting workspace crates (`governance`, `registry`, `investment_basket`, and legacy `escrow`).

For operational execution of periodic instance bumps, see the [TTL Keeper Runbook](./TTL_KEEPER.md).

---

## 1. Storage Tiers & Ledger Constants

Soroban contracts separate state into **instance storage** (contract WASM + instance configuration map) and **persistent storage** (per-campaign, per-order, per-dispute, and per-investor records).

| Parameter | Constant | Ledgers | Approx. Wall-Clock Duration (~5s/ledger) |
|---|---|---|---|
| Minimum Remaining TTL Threshold | `TTL_THRESHOLD` | `17_280` | ~1 day (24 hours) |
| Target Extended TTL | `TTL_BUMP` | `518_400` | ~30 days |

Whenever a state-mutating entrypoint or explicit `bump_instance_ttl` call executes, any touched storage entry whose remaining TTL is below `TTL_THRESHOLD` (`17_280` ledgers) is extended to at least `TTL_BUMP` (`518_400` ledgers).

---

## 2. Data Key Extension Rules

### Instance Storage (`env.storage().instance()`)
- Holds global contract configuration (`Admin`, `Guardian`, `Paused`, `FeeConfig`, `GovernanceContract`, `RegistryContract`, `SupportedTokens`, `SchemaVersion`, and counters).
- Extended automatically on critical write operations and via the public permissionless `bump_instance_ttl(env)` entrypoint invoked by [`scripts/ttl-keeper.sh`](./TTL_KEEPER.md).

### Persistent Storage (`env.storage().persistent()`)
- **`DataKey::Campaign(campaign_id)`**: Extended on `create_campaign`, `invest`, `start_production`, `mark_harvest`, `advance_milestone`, `settle`, `claim_returns`, `finalize_failed`, `mark_campaign_failed`, and `refund`.
- **`DataKey::Contribution(campaign_id, investor)`**: Extended on `invest`, `claim_returns`, `refund`, and `transfer_investment`.
- **`DataKey::Order(order_id)` / `DataKey::SplitOrder(order_id)`**: Extended on `create_order`, `confirm_order`, `cancel_order`, `create_split_order`, `fund_split_order`, and `confirm_split_receipt`.
- **`DataKey::Dispute(dispute_id)`**: Extended on `open_dispute`, `vote_to_resolve`, and `resolve_dispute`.

---

## 3. Related References

- [Canonical Contract (`production_escrow`)](./CANONICAL_CONTRACT.md)
- [Soroban Contract TTL Keeper Runbook](./TTL_KEEPER.md)
