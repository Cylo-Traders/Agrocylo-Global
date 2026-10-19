# Agrocylo Event Specification (v1)

This document specifies the canonical event names, payloads, and emission contracts for all Soroban smart contract events. It serves as the source of truth for off-chain indexers and clients.

## Event Registry

### Registry Contract Events

#### `farmer:farm_reg`
Emitted when a farmer registers with the registry.
- **Topic:** `["farmer", "farm_reg"]`
- **Data:** `Address` (farmer address)
- **Source:** `registry::register_farmer()`

#### `campaign:camp_reg`
Emitted when a campaign is registered with the registry.
- **Topic:** `["campaign", "camp_reg"]`
- **Data:** `(u64, Address)` (campaign_id, farmer_address)
- **Source:** `registry::register_campaign()`

#### `registry:updated`
Emitted when the registry is initialized or contract references change.
- **Topic:** `["registry", "updated"]`
- **Data:** `(Address, Address)` (escrow_contract, production_contract)
- **Source:** `registry::initialize()`

---

### Production Escrow Contract Events

#### `campaign:created`
Emitted when a new campaign is created.
- **Topic:** `["campaign", "created"]`
- **Data:** `(u64, Address, Address, i128, u64)` (campaign_id, farmer, token, target_amount, deadline)
- **Source:** `production_escrow::create_campaign()`

#### `campaign:invested`
Emitted when an investor makes a contribution to a campaign.
- **Topic:** `["campaign", "invested"]`
- **Data:** `(u64, Address, i128, i128)` (campaign_id, investor, amount, total_raised)
- **Source:** `production_escrow::invest()`

#### `campaign:produce`
Emitted when a farmer signals production has started (releasing start tranche).
- **Topic:** `["campaign", "produce"]`
- **Data:** `(u64, Address)` (campaign_id, farmer)
- **Source:** `production_escrow::start_production()`
- **Note:** May be renamed to `campaign:started` in future versions.

#### `campaign:harvest`
Emitted when a farmer marks harvest as complete (releasing harvest tranche).
- **Topic:** `["campaign", "harvest"]`
- **Data:** `(u64, Address)` (campaign_id, farmer)
- **Source:** `production_escrow::mark_harvest()`
- **Note:** May be renamed to `campaign:harvested` in future versions.

#### `campaign:funded`
Emitted when a campaign reaches its funding target.
- **Topic:** `["campaign", "funded"]`
- **Data:** `(u64, i128, i128)` (campaign_id, total_raised, target_amount)
- **Source:** `production_escrow::invest()` (automatic when target reached)

#### `campaign:settled`
Emitted when a campaign transitions to Settled state.
- **Topic:** `["campaign", "settled"]`
- **Data:** `(u64, i128)` (campaign_id, total_revenue)
- **Source:** `production_escrow::settle()`, `production_escrow::resolve_dispute()`

#### `campaign:failed`
Emitted when a campaign fails (deadline passed or dispute resolved as failure).
- **Topic:** `["campaign", "failed"]`
- **Data:** `u64` (campaign_id)
- **Source:** `production_escrow::finalize_failed()`, `production_escrow::resolve_dispute()`

#### `campaign:disputed`
Emitted when a campaign enters Disputed state.
- **Topic:** `["campaign", "disputed"]`
- **Data:** `(u64, Address)` (campaign_id, caller)
- **Source:** `production_escrow::open_dispute()`

#### `campaign:claimed`
Emitted when an investor claims their proportional share on settlement.
- **Topic:** `["campaign", "claimed"]`
- **Data:** `(u64, Address, i128)` (campaign_id, investor, payout)
- **Source:** `production_escrow::claim_returns()`

#### `campaign:refunded`
Emitted when an investor is refunded on campaign failure.
- **Topic:** `["campaign", "refunded"]`
- **Data:** `(u64, Address, i128)` (campaign_id, investor, contribution)
- **Source:** `production_escrow::refund()`

#### `campaign:tranche`
Emitted when a tranche is released to the farmer.
- **Topic:** `["campaign", "tranche"]`
- **Data:** `(u64, i128, i128)` (campaign_id, tranche_amount, cumulative_released)
- **Source:** `production_escrow::release_tranche_internal()`

#### `campaign:batch_ref`
Emitted after a batch refund operation completes.
- **Topic:** `["campaign", "batch_ref"]`
- **Data:** `(u64, u32, i128)` (campaign_id, count, total_refunded)
- **Source:** `production_escrow::batch_refund_investors()`

---

### Order Events

#### `order:created`
Emitted when a buyer creates an order for produce.
- **Topic:** `["order", "created"]`
- **Data:** `(u64, Address, u64, i128)` (order_id, buyer, campaign_id, amount)
- **Source:** `production_escrow::create_order()`

#### `order:confirmed`
Emitted when a buyer confirms receipt of an order.
- **Topic:** `["order", "confirmed"]`
- **Data:** `(u64, Address, u64)` (order_id, buyer, campaign_id)
- **Source:** `production_escrow::confirm_order()`

#### `order:batch_ref`
Emitted after a batch refund of expired orders completes.
- **Topic:** `["order", "batch_ref"]`
- **Data:** `(u32, i128)` (count, total_refunded)
- **Source:** `production_escrow::batch_refund_orders()`

---

## Migration & Backwards Compatibility

### Legacy Event Names (Deprecated)

The following event names were misspelled or inconsistent in early deployments and MUST NOT be used in new code:

- `farmer:registerd` → Use `farmer:farm_reg` (typo: 'd' instead of nothing)
- `campaign:registerd` → Use `campaign:camp_reg` (typo: 'd' instead of nothing)

**Migration Timeline:**
- Off-chain indexers SHOULD support both legacy and canonical names for at least 6 months after this spec is published.
- Legacy names MAY be emitted by older deployed contracts; treat them equivalently to canonical names.
- Newly deployed contracts MUST use only canonical names.

---

## Symbol Encoding

All event topic and topic symbols are encoded as 9-character Soroban symbols using `symbol_short!()`.
Example: `symbol_short!("campaign")` → `"campaign"`

---

## Notes for Implementers

1. **Indexing:** Always check both the symbol topic and the data payload structure when matching events. Do not rely on symbol names alone.
2. **Type Safety:** Soroban SDK ensures that published events match the declared data types; no extra runtime validation is needed.
3. **Event Ordering:** Events are published synchronously; they reflect the order of operations within a transaction.
4. **Chain ID:** Event emission is ledger-specific; events from different blockchains must be reconciled via explicit message passing.
