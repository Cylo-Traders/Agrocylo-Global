# Persistent Storage TTL Extension Policy (Issue #456)

**Last verified against commit:** `ff4c53b` (call sites in `src/lib.rs`).

## Overview

All data stored in Soroban persistent contract storage must have their Time-To-Live (TTL) explicitly managed to prevent loss. This document specifies when and how TTL is extended for each data key across the production escrow contract.

## TTL Configuration Constants

All TTL extension operations use the following named constants (defined in `lib.rs`):

```rust
const TTL_THRESHOLD: u32 = 1_000;   // Extend when TTL falls below 1,000 ledgers
const TTL_EXTEND: u32 = 100_000;    // Extend TTL by 100,000 ledgers on each operation
```

These constants ensure:
- TTL does not expire during normal contract operations.
- Extension overhead is minimized (each extension adds ~100,000 ledgers of validity).
- Data survives infrequent access patterns (if unused for 1 million ledgers, data is still available).

## Data Key TTL Policies

### Campaign Records

**Key**: `DataKey::Campaign(campaign_id)`
**Storage Type**: Persistent
**Owner**: Farmer (creates), Admin (reads/modifies)
**Lifetime**: Campaign + 2 years (disputes may be resolved long after completion)

| Trigger | TTL Extension Call | Reason |
|---------|-------------------|--------|
| Creation (`create_campaign`) | ✅ Extended immediately after set | Campaign must survive investor interest phase |
| Status transition (funded, production, harvested, settled) | ✅ Extended via `save_campaign()` | Investors read status before claiming |
| Dispute resolution | ✅ Extended in `resolve_dispute()` | Final state must persist for audit |

**Implementation**: `save_campaign()` helper handles all Campaign writes with automatic TTL extension.

---

### Campaign Contributions

**Key**: `DataKey::Contribution(campaign_id, investor)` (one indexed entry per
investor — not a per-campaign map)
**Storage Type**: Persistent
**Owner**: Protocol (stores investor → amount)
**Lifetime**: Campaign + 3 months (for refund audits after settlement)

| Trigger | TTL Extension Call | Reason |
|---------|-------------------|--------|
| Creation (first investment) | ✅ Extended in `invest()` | Must survive entire funding phase |
| Investment added | ✅ Extended in `invest()` | Each new investor access needs refresh |
| Claim read | ✅ Extended in `claim_returns()` before reading the contribution | Proof of investment is required for the payout |
| Refund read | ✅ Extended in `refund()` before reading the contribution | Proof of investment is required for the refund |
| Batch refund | ✅ Extended in `batch_refund_investors()` | Refund records for swept campaigns stay auditable |

**Implementation**: `claim_returns` and `refund` call
`extend_ttl(&contribution_key, TTL_THRESHOLD, TTL_EXTEND)` immediately after
the `get`; `invest` and `batch_refund_investors` extend on write. The earlier
note that contribution TTL was "Currently NOT extended" on claim/refund is
fixed by the verified call sites above.

---

### Investor Claims (Proof of Payout)

**Key**: `DataKey::Claimed(campaign_id, investor)`
**Storage Type**: Persistent
**Owner**: Protocol (double-claim prevention flag)
**Lifetime**: Campaign + 6 months (for dispute audits)

| Trigger | TTL Extension Call | Reason |
|---------|-------------------|--------|
| First claim (`claim_returns`) | ✅ Extended on set | Prevents double-claims in disputes |
| First refund (`refund`) | ✅ Extended on set | Prevents double-refunds in disputes |
| Batch refund | ✅ Extended in `batch_refund_investors()` | Batch operations must protect all claims |

**Implementation**: `set(&claim_key, &true)` is followed by implicit TTL extension in all payout paths.

---

### Order Records

**Key**: `DataKey::Order(order_id)`
**Storage Type**: Persistent
**Owner**: Buyer/Farmer (buyer creates, farmer marks delivered, buyer confirms)
**Lifetime**: Campaign + 3 months (for delivery disputes)

| Trigger | TTL Extension Call | Reason |
|---------|-------------------|--------|
| Creation (`create_order`) | ✅ Extended in `create_order()` | Order must survive confirmation phase |
| Confirmation (`confirm_order`) | ✅ Extended via `write_order()` helper | Confirmed state must persist |
| Batch refund (`batch_refund_orders`) | ✅ Extended on set after status change | Refund state must persist |

**Implementation**: `create_order`, `confirm_order` and `batch_refund_orders`
extend the `Order(order_id)` key directly in `production_escrow/src/lib.rs`.
There is no `write_order()` helper in this crate; the helper reference in
`contracts/escrow` does not apply here.

---

## Cross-Crate TTL Policies

### `production_escrow/src/lib.rs`

| Key | Storage Type | TTL Extension Points |
|-----|--------------|----------------------|
| `Campaign(id)` | Persistent | create, `save_campaign()` (all mutations) |
| `Contribution(campaign_id, investor)` | Persistent | invest, claim_returns (read), refund (read), batch_refund_investors |
| `Claimed(campaign_id, investor)` | Persistent | claim_returns, refund, batch_refund_investors |
| `Order(id)` | Persistent | create_order, confirm_order, batch_refund_orders |
| `MilestoneConfigs(campaign_id)` | Persistent | ⚠️ **not extended** (written once in `set_milestone_configs`) — tracked as a follow-up gap |

### Outstanding gaps

- `MilestoneConfigs(campaign_id)` is written without an `extend_ttl` call. A
  campaign configured long before milestones are advanced could see the config
  archived; add an extension in `set_milestone_configs` (and on read in
  `advance_milestone`) in a follow-up.
- Read-only getters (`get_campaign`, `get_order`, `get_milestone_configs`,
  `refundable_amount`) do not extend TTL. Only the payout-path reads listed
  above do.

---

### `registry/src/lib.rs`

| Key | Storage Type | TTL Extension Points |
|-----|--------------|----------------------|
| `Farmer(address)` | Persistent | register_farmer, on any farmer read |
| `Campaign(id)` | Persistent | register_campaign |
| `FarmerCampaigns(farmer)` | Persistent | on creation and farmer access |

---


---

## Ledger Advance Testing

To verify TTL policy is working:

1. **Setup**: Create a campaign, invest funds, confirm orders.
2. **Advance Ledger**: Jump forward ~95,000 ledgers (near TTL threshold).
3. **Verify Operations**: Call `claim_returns()`, `refund()`, order confirmation—all should succeed.
4. **Assert TTL Extended**: After each operation, verify the key was extended.

**Test Example**:
```rust
#[test]
fn test_ttl_extended_on_claim() {
    let t = setup();
    // ... create campaign, invest, settle ...
    let ledger_before = t.env.ledger().sequence();
    t.client.claim_returns(&t.investor1, &campaign_id);
    // TTL should now reflect an extension
}
```

---

## Best Practices

1. **Always Use Helpers**: Use `save_campaign()` and `write_order()` helpers instead of direct `set()` calls.
2. **Extend on Read**: Implemented on the payout-path reads (`claim_returns`, `refund`). Generic getters do not extend TTL yet (see gaps above).
3. **Extend on Write**: Every mutation must extend TTL immediately after the write.
4. **Document New Keys**: If new persistent keys are added, update this policy immediately.
5. **Test TTL Scenarios**: Add tests for near-threshold ledger states to catch missed extensions.

---

## Migration Path (Future)

If TTL thresholds need adjustment:
1. Update `TTL_THRESHOLD` and `TTL_EXTEND` constants.
2. Deploy a new contract version.
3. Migrate data by re-extending all keys in the migration function.
4. Inform users to update contract references in registries.

---

**Issue Reference**: #456 (persistent storage TTL policy)
