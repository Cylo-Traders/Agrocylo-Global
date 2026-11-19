# Canonical Contract: production_escrow

**Last verified against commit:** `ff4c53b`. ABI/package names below were
reconciled against `agro-production/contract/production_escrow/Cargo.toml`,
`src/lib.rs` and `scripts/deploy-contracts.sh` (not a hand-maintained spec).

## Selection

The **production_escrow** contract (located at `agro-production/contract/production_escrow/`) has been selected as the canonical Soroban contract for the Agrocylo production system.

### Rationale

1. **Newer Implementation**: production_escrow is the more recent contract and contains the latest improvements to campaign, order, dispute, fee, and settlement semantics.
2. **Feature Complete**: Supports all three primary event domains:
   - Campaign lifecycle (created, invested, settled, produce, harvest, failed, disputed, claimed, refunded, tranche)
   - Order management (created, confirmed)
   - Dispute resolution (opened, evidence_submitted, resolved, dismissed)
3. **Active Development**: This contract has been the focus of improvements in recent issues (#455, #456, #457) and ongoing maintenance.

## Workspace Configuration

### Current Structure

```
Cargo.toml                         (workspace root)
├── contracts/escrow               (legacy marketplace escrow)
├── agro-production/contract/
│   ├── governance                 (package: governance)
│   ├── production_escrow          (package: production-escrow-v2)
│   ├── registry                   (package: registry)
│   └── investment_basket          (package: investment-basket)
```

Workspace members are declared in the repository-root `Cargo.toml` (there is no
`agro-production/contract/Cargo.toml`).

### Package Naming

- **production-escrow-v2** → Canonical campaign escrow crate (Rust crate name
  `production_escrow_v2`, WASM output `production_escrow_v2.wasm`)
- **registry**, **governance**, **investment-basket** → supporting crates
- (Legacy) `contracts/escrow` → marketplace escrow, still deployed separately

## ABI Summary

Names below are taken from the `#[contractimpl]` block in `src/lib.rs` at the
verified commit; earlier hand-written names such as `settle_campaign`,
`harvest`, or `claim_tranche` do not exist in this crate.

**Bootstrap / administration:** `initialize(admin, supported_tokens,
fee_collector, fee_rate_bps)`, `upgrade`, `set_guardian`, `pause`, `unpause`,
`is_paused`, `bump_instance_ttl`, `migrate`, `get_schema_version`,
`get_guardian`, `set_registry_contract`, `set_fee_config`,
`set_governance_contract`, `update_supported_tokens`, `get_admin`,
`get_supported_tokens`, `get_governance_contract`, `set_attester`,
`set_arbitrators`, `get_arbitrators`, `get_quorum`.

**Campaign lifecycle:** `create_campaign`, `invest`, `start_production`,
`mark_harvest(farmer, attester, campaign_id)`, `set_milestone_configs`,
`advance_milestone(caller, attester, campaign_id)`, `settle`, `claim_returns`,
`finalize_failed`, `mark_campaign_failed`, `refund`, `refundable_amount`,
`get_campaign`, `get_contribution`, `get_milestone_configs`.

**Orders / disputes:** `create_order`, `cancel_order`, `confirm_order`,
`create_split_order`, `fund_split_order`, `confirm_split_receipt`,
`open_split_dispute`, `resolve_split_dispute`, `get_split_order`, `open_dispute`,
`resolve_dispute`, `vote_to_resolve`, `transfer_investment`,
`batch_refund_investors`, `batch_refund_orders`, `get_order`,
`register_campaign`, `verify`.

### Event Topics

All events use base64-encoded Soroban symbol_short!() topics:

- **order** — `AAAADwAAAAVvcmRlcg==`
  - order.created
  - order.confirmed

- **campaign** — `AAAADwAAAAhjYW1wYWlnbg==`
  - campaign.created
  - campaign.invested
  - campaign.settled
  - campaign.produce
  - campaign.harvest
  - campaign.failed
  - campaign.disputed
  - campaign.claimed
  - campaign.refunded
  - campaign.tranche

- **dispute** — `AAAADwAAAAdkaXNwdXRl`
  - dispute.opened
  - dispute.evidence_submitted
  - dispute.resolved
  - dispute.dismissed

## Deployed Contract ID

The committed manifest is the source of truth for deployed IDs, WASM hashes,
salts and wiring:
[`deployments/deployed-addresses.testnet.json`](../../deployments/deployed-addresses.testnet.json).
Do not copy IDs into this document; verify with
`scripts/deploy-contracts.sh --network testnet --verify-only`.

## Migration & Deprecation Plan

### Existing Deployments

- Any existing deployed `production-escrow-hyphen` contracts remain live and indexed as legacy contracts.
- The server's event listener **dual-reads both event schemas** during the transition period (see issue #459).
- New orders/campaigns are created against the canonical `production_escrow` contract only.

### Transition Timeline

1. **Phase 1 (Now)**: Canonical selection; dual-reading of both schemas in indexer.
2. **Phase 2 (TBD)**: Migrate all active campaigns/orders to canonical contract.
3. **Phase 3 (TBD)**: Deprecate legacy contract; remove dual-reading from indexer.

## Server & Client Integration

### Backend Contract Bindings

Update `agro-production/server/src/services/sorobanEventListener.ts` to:

```typescript
const PRODUCTION_ESCROW_CONTRACT_ID = process.env.PRODUCTION_ESCROW_CONTRACT_ID;
// Listen to production_escrow events (canonical)
topicFilters: [
  [ORDER_TOPIC, '*'],
  [CAMPAIGN_TOPIC, '*'],
  [DISPUTE_TOPIC, '*'],
]
```

### Client Contract Bindings

Update `agro-production/client/src/lib/contractService.ts` to use the canonical contract ID from the environment:

```typescript
const CONTRACT_ID = process.env.REACT_APP_PRODUCTION_ESCROW_CONTRACT_ID;
```

## Building & Testing

### Build Canonical Contract

```bash
# From the repository root (workspace root)
cargo build --target wasm32v1-none --release -p production-escrow-v2
# Output: target/wasm32v1-none/release/production_escrow_v2.wasm
```

### Run Contract Tests

```bash
# From the repository root
cargo test -p production-escrow-v2
```

## Related Issues

- **#450** — Dispute lifecycle indexing and REST endpoints
- **#451** — Product/marketplace APIs
- **#452** — Backend CI workflow
- **#459** — Dual-contract event reading (transition period)
- **#455, #456, #457** — Prior improvements to production_escrow

## Naming & Artifacts

The canonical contract's Soroban compiler output is:
- **WASM file**: `production_escrow_v2.wasm` (matches `scripts/deploy-contracts.sh`)
- **Package name**: `production-escrow-v2` (in `Cargo.toml`)
- **Crate name**: `production_escrow_v2`

This naming is unambiguous and matches the canonical source crate name, avoiding collisions with the legacy `contracts/escrow` crate.
