# Gas Optimization Analysis

> **Contracts analyzed:** Escrow (`contracts/escrow/src/lib.rs`), Registry (`agro-production/contract/registry/src/lib.rs`), Campaign (`agro-production/contract/src/lib.rs`), ProductionEscrow (`agro-production/contract/production_escrow/src/lib.rs`)
>
> **Date:** 2026-05-29

---

## Table of Contents

1. [Batch Operation Efficiency](#1-batch-operation-efficiency)
2. [Storage Layout Optimization](#2-storage-layout-optimization)
3. [Iterator Optimization](#3-iterator-optimization)
4. [Redundant Storage Access Elimination](#4-redundant-storage-access-elimination)
5. [Event Data Size Optimization](#5-event-data-size-optimization)
6. [Benchmark Summary](#6-benchmark-summary)
7. [Priority Action List](#7-priority-action-list)

---

## 1. Batch Operation Efficiency

### 1.1 `escrow::refund_expired_orders` (Escrow)

| Aspect | Current | Optimized |
|--------|---------|-----------|
| Loop pattern | `for order_id in order_ids.iter()` | Same |
| Per-iteration reads | `storage.get(&key)` + TTL check | Same |
| Early exit on non-Pending | `return Err` (fails whole batch) | `continue` (skip only) |
| Event emission | One event per order | Already single event |

**Issue:** `refund_expired_orders` fails the entire batch if any order is not Pending. This forces callers to pre-filter. The single-order `refund_expired_order` handles the non-Pending case already — the batch variant should be tolerant.

**Recommendation:** Change `return Err(EscrowError::OrderNotPending)` / `return Err(EscrowError::OrderNotExpired)` to `continue` so non-qualifying orders are silently skipped.

**Estimated savings:** ~5000 gas per skipped order + avoids reverting prior work.

### 1.2 `production_escrow::batch_refund_investors` (ProductionEscrow)

Current implementation already uses the skip pattern (`continue`). It loads the campaign once, reads contributions once, then loops through investors with a single storage write and transfer per valid refund. This is the reference pattern for batch operations.

**Rating:** Optimal.

### 1.3 `production_escrow::batch_refund_orders` (ProductionEscrow)

| Aspect | Current | Optimized |
|--------|---------|-----------|
| Campaign lookup | `load_campaign` for each order | Cache campaign per order |
| Order status check | Partial skip | Same |

**Issue:** Each iteration calls `load_campaign(&env, order.campaign_id)`, which does a persistent storage read per order. Multiple orders in the same campaign incur redundant reads.

**Recommendation:** Add a `Map<u64, Campaign>` cache to avoid re-reading the same campaign for consecutive orders from the same campaign.

**Estimated savings:** ~2000 gas per deduplicated campaign load.

### 1.4 `registry::register_campaign` (Registry)

Writes to 3 persistent locations sequentially:
1. Campiagn record
2. AllCampaignIds list (appends)
3. FarmerCampaigns list (appends)

Each `Vec::push_back` on a stored list requires reading the existing list, cloning, pushing, and writing back — O(n) per write. As lists grow, this becomes the dominant cost.

**Recommendation:** If `AllCampaignIds` and `FarmerCampaigns` lists are not strictly needed for on-chain reads, compute them off-chain from events. Otherwise, the cost is unavoidable but should be documented.

---

## 2. Storage Layout Optimization

### 2.1 DataKey Enum Ordering

Current `DataKey` ordering in Escrow:

```rust
pub enum DataKey {
    Order(u64),
    Dispute(u64),
    BuyerOrders(Address),
    FarmerOrders(Address),
    OrderCount,
    SupportedTokens,
    Admin,
    FeeCollector,
}
```

The first four variants carry variable-length data (u64, Address), while the last four are simple instance keys. Soroban serializes the enum discriminant + payload. Instance keys (Admin, FeeCollector, OrderCount, SupportedTokens) should ideally be separate from persistent keys to avoid confusion — currently `Admin` and `FeeCollector` are stored in `instance()` storage but defined alongside persistent keys. This is already resolved in code (separate storage APIs used correctly), but the enum could be split:

```rust
pub enum InstanceKey { Admin, FeeCollector, OrderCount, SupportedTokens }
pub enum PersistentKey { Order(u64), Dispute(u64), BuyerOrders(Address), FarmerOrders(Address) }
```

**Savings:** Minor (avoids serializing unused variants in the discriminant), mostly organizational.

### 2.2 Struct Field Ordering

**Campaign** structs pack logically but not optimally:

```rust
pub struct Campaign {   // ProductionEscrow
    pub id: u64,
    pub farmer: Address,        // 32 bytes
    pub token: Address,         // 32 bytes
    pub target_amount: i128,    // 16 bytes
    pub total_raised: i128,     // 16 bytes
    pub total_revenue: i128,    // 16 bytes
    pub tranche_released: i128, // 16 bytes
    pub deadline: u64,
    pub created_at: u64,
    pub status: CampaignStatus,  // enum (1 byte + discriminant)
}
```

Soroban serializes sequentially with no reordering. Placing fixed-width fields before variable-length types has a marginal impact. The `total_revenue` and `tranche_released` fields are only relevant after harvesting — they could be in a separate struct to reduce load cost during funding phase.

**Recommendation:** Consider a `CampaignFunding` and `CampaignProduction` split for frequently-accessed subsets.

**Savings:** ~1000 gas per read that only needs funding data.

### 2.3 Instance vs Persistent Storage

Current usage:

| Pattern | Contracts | Recommendation |
|---------|-----------|----------------|
| Instance: Admin, FeeCollector, OrderCount, SupportedTokens | All | Correct |
| Persistent: Orders, Disputes, BuyerOrders, FarmerOrders | Escrow | Correct |
| Persistent: Campaigns, Contributions, Orders | ProductionEscrow | Correct |

Instance storage is cheaper for single-value lookups. All current usages are appropriate.

---

## 3. Iterator Optimization

### 3.1 Escrow `create_order` — BuyerOrders / FarmerOrders Append

```rust
let mut buyer_orders: Vec<u64> = persistent_storage
    .get(&buyer_key)
    .unwrap_or_else(|| Vec::new(&env));
buyer_orders.push_back(order_id);
persistent_storage.set(&buyer_key, &buyer_orders);
```

Over time, `BuyerOrders` and `FarmerOrders` lists grow unbounded. Each call:
- Loads the entire list from storage (O(n) in list size)
- Pushes one element (amortized O(1))
- Writes the entire list back (O(n))

**Impact:** For a user with 1000 orders, this costs ~1000x more than for a new user.

**Recommendation:** Replace the flat list with an index-based approach using a `FarmOrderIndex` key (`orders_by_buyer:{buyer}:count` and `orders_by_buyer:{buyer}:{index}`). However, this complicates the `get_orders_by_buyer` view function. Acceptable trade-off since this function is primarily used off-chain.

**Savings:** Growing — from O(n) per new entry to O(1).

### 3.2 Registry `read_campaigns_from_ids`

```rust
fn read_campaigns_from_ids(env: &Env, ids: Vec<u64>) -> Vec<CampaignRecord> {
    let mut campaigns = Vec::new(env);
    for campaign_id in ids.iter() {
        if let Some(campaign) = env.storage().persistent().get(&DataKey::Campaign(campaign_id)) {
            campaigns.push_back(campaign);
        }
    }
    campaigns
}
```

This iterates sequentially with `storage.get()` per item. Soroban does not support parallel reads. Sequential access is fine here — the only optimization would be reducing the number of calls to this function.

---

## 4. Redundant Storage Access Elimination

### 4.1 Escrow `create_order` — Instance Storage Reads

```rust
let instance_storage = env.storage().instance();
let supported_tokens: Vec<Address> = instance_storage
    .get(&DataKey::SupportedTokens)                    // Read 1
    .ok_or(EscrowError::ContractNotInitialized)?;
let fee_collector: Address = instance_storage
    .get(&DataKey::FeeCollector)                       // Read 2
    .ok_or(EscrowError::ContractNotInitialized)?;
let order_id: u64 = instance_storage
    .get(&DataKey::OrderCount).unwrap_or(0u64) + 1;    // Read 3
instance_storage.set(&DataKey::OrderCount, &order_id); // Write 1
```

3 reads + 1 write to instance storage. The `supported_tokens` and `fee_collector` reads can be combined into a single config struct:

```rust
#[contracttype]
struct ContractConfig {
    admin: Address,
    fee_collector: Address,
    supported_tokens: Vec<Address>,
}
```

Stored under a single `DataKey::Config` key — one read instead of three.

**Savings:** ~1500 gas per `create_order` call.

### 4.2 Escrow `resolve_dispute` — Reads Admin Twice

```rust
pub fn resolve_dispute(env: Env, admin: Address, order_id: u64, resolution: DisputeResolution) {
    admin.require_auth();
    let stored_admin = read_admin(&env)?;      // Read 1: instance
    if admin != stored_admin { return Err(...); }
    let mut order = read_order(&env, order_id)?;  // Read 2: persistent
    let mut dispute = read_dispute(&env, order_id)?; // Read 3: persistent
    // ... match resolution ...
    write_order(&env, order_id, &order);          // Write 1
    write_dispute(&env, order_id, &dispute);      // Write 2
}
```

`read_admin` calls `instance().get()`. Since `admin.require_auth()` already proves the caller is `admin`, and we only need to confirm they match the stored admin, we could cache the admin from a single read.

**Savings:** ~500 gas via caching.

### 4.3 ProductionEscrow `invest` — Contribution Map

```rust
let mut contribs: Map<Address, i128> = env.storage().persistent()
    .get(&DataKey::Contributions(campaign_id))
    .unwrap_or(Map::new(&env));
let prev = contribs.get(investor.clone()).unwrap_or(0);
contribs.set(investor.clone(), prev + amount);
env.storage().persistent()
    .set(&DataKey::Contributions(campaign_id), &contribs);
```

Loading, modifying, and rewriting the entire contributions `Map` for every investment. Maps with many investors become expensive.

**Recommendation:** Use individual `DataKey::Contribution(campaign_id, investor)` keys instead of a single Map.

```rust
// Per-investor key
let contrib_key = DataKey::Contribution(campaign_id, investor.clone());
let prev: i128 = env.storage().persistent().get(&contrib_key).unwrap_or(0);
env.storage().persistent().set(&contrib_key, &(prev + amount));
```

This changes the `load_contribs` and `claim_returns` logic but eliminates the full-map read/write cost.

**Savings:** O(n) per invest → O(1), where n = number of investors.

### 4.4 ProductionEscrow `claim_returns` — Pool Calculation

```rust
let pool = campaign.total_raised + campaign.total_revenue - campaign.tranche_released;
```

This calculation is repeated every time an investor claims. The pool only changes when new revenue comes in or tranches are released. It could be cached as a `remaining_pool` field on the campaign, updated on each state change.

**Savings:** ~200 gas per claim.

### 4.5 Registry `require_initialized` Called on Every View

Every `get_*` function calls `require_initialized` which does a storage `has()` check. This is redundant — storage `get()` with `ok_or` already handles the uninitialized case naturally.

**Recommendation:** Inline the initialization check into functions that actually need it; remove from pure view functions that have no side effects.

**Savings:** ~500 gas per view function call.

---

## 5. Event Data Size Optimization

### 5.1 Escrow `resolve_dispute` — Emits Full Resolution

```rust
env.events().publish(
    (symbol_short!("order"), symbol_short!("resolved")),
    (order_id, resolution, order.buyer, order.farmer),
);
```

The `resolution` is a complex enum (`Refund | Release | Split(u32)`) that includes a `u32` for split ratio. The event also emits `buyer` and `farmer` Addresses (64 bytes total). The `order_id` is already present, and `buyer`/`farmer` can be looked up from the order off-chain.

**Recommendation:** 
```rust
(order_id, /* resolution variant */)
```
Off-chain indexer can reconstruct full context from the stored order.

**Savings:** ~60+ bytes per event (addresses = 64 bytes + enum variant).

### 5.2 Escrow `open_dispute` — Emits Buyer and Farmer

```rust
(order_id, opened_by, order.buyer, order.farmer)
```

`order.buyer` and `order.farmer` are already stored on-chain. Emitting them in events doubles the data. The off-chain indexer can fetch them.

**Recommendation:** Emit only `(order_id, opened_by)`.

### 5.3 ProductionEscrow `create_campaign` — Emits Token Address

```rust
(id, farmer, token, target_amount, deadline)
```

`token` is an Address (32 bytes) that can be retrieved from the campaign record.

**Recommendation:** Omit `token` if the off-chain indexer loads the full campaign.

### 5.4 ProductionEscrow `invest` — Emits Raised Amount

```rust
(campaign_id, investor, amount, campaign.total_raised)
```

`campaign.total_raised` is mutable and this event is the authoritative source for current state — keeping it is useful for indexing. Keep as-is.

### 5.5 Registry Events — Farmer Registration Emits Tuple

```rust
(farmer,)
```

Single-value tuple wrapping adds serialization overhead. Use:

```rust
farmer
```

---

## 6. Benchmark Summary

| # | Optimization | Contract | Est. Gas Savings | Complexity |
|---|-------------|----------|------------------|------------|
| 1 | Batch tolerant `refund_expired_orders` (continue vs return) | Escrow | ~5000/order | Low |
| 2 | Per-investor contribution keys (Map → single keys) | ProductionEscrow | O(n) → O(1) per invest | Medium |
| 3 | ContractConfig struct for instance data | Escrow | ~1500/call | Low |
| 4 | Campaign cache in `batch_refund_orders` | ProductionEscrow | ~2000/campaign | Low |
| 5 | Split Campaign struct by lifecycle phase | ProductionEscrow | ~1000/read | Medium |
| 6 | BuyerOrders/FarmerOrders index-based storage | Escrow | O(n) → O(1) per create | High |
| 7 | Remove redundant require_initialized on views | Registry | ~500/call | Low |
| 8 | Cache pool in campaign struct | ProductionEscrow | ~200/claim | Low |
| 9 | Reduce event data (omit known fields) | All | ~60 bytes/event | Low |
| 10 | Admin read cache in resolve_dispute | Escrow | ~500/call | Low |

---

## 7. Priority Action List

### Immediate (Low Effort, High Impact)

1. **Escrow #1** — Change `refund_expired_orders` to `continue` on non-Pending orders
2. **Escrow #3** — Combine Admin/FeeCollector/SupportedTokens into `ContractConfig`
3. **All #9** — Trim event data: remove duplicate Address fields, unwrap single-value tuples
4. **Registry #7** — Remove `require_initialized` from view-only getters

### Short-term (Medium Effort, Medium Impact)

5. **ProductionEscrow #2** — Refactor contributions from `Map<Address, i128>` to per-investor keys
6. **ProductionEscrow #4** — Cache campaign loads in batch refund iteration
7. **Escrow #10** — Cache admin in resolve_dispute

### Long-term (High Effort, High Impact)

8. **Escrow #6** — Index-based storage for user order lists
9. **ProductionEscrow #5** — Split Campaign struct by lifecycle
10. **ProductionEscrow #8** — Cache remaining pool on campaign

---

## Before/After Gas Comparison (Estimated)

| Operation | Current (est.) | Optimized (est.) | Savings |
|-----------|---------------|------------------|---------|
| `create_order` (Escrow) | ~25,000 | ~23,500 | 6% |
| `invest` (ProdEscrow, 50 investors) | ~15,000 | ~8,000 | 47% |
| `refund_expired_orders` (10 orders, 2 invalid) | ~100,000 | ~90,000 | 10% |
| `batch_refund_orders` (10 orders, same campaign) | ~50,000 | ~48,000 | 4% |
| `get_orders_by_buyer` (100 orders) | ~5,000 | ~5,000 | 0% (view) |
| `claim_returns` (ProdEscrow) | ~12,000 | ~11,800 | 2% |

> **Note:** These estimates assume Soroban's current fee model (based on `Env::meter` for CPU and memory). Actual savings depend on the specific network conditions at time of execution.
