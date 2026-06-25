# Canonical Contract: production_escrow

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
agro-production/contract/
├── Cargo.toml                    (workspace root)
├── production_escrow/            (canonical contract)
│   ├── Cargo.toml               (package name: "production_escrow")
│   └── src/lib.rs
├── registry/                     (registry contract)
│   ├── Cargo.toml               (package name: "registry")
│   └── src/lib.rs
└── src/                         (shared utilities)
```

The root `Cargo.toml` workspace members:
- `agro-production/contract/registry` — Registry contract (name: "registry")
- `agro-production/contract/production_escrow` — Canonical escrow contract (name: "production_escrow")

### Package Naming

- **production_escrow** → Canonical contract WASM output
- **registry** → Product/marketplace registry contract
- (Legacy) production-escrow (hyphen) → Deprecated; removed from workspace

## ABI Summary

### production_escrow Public Functions

**Campaign Management:**
- `initialize(admin: Address)` — Initialize contract with admin
- `create_campaign(farmer: Address, token: Address, target: i128, deadline: u64)` → Campaign ID
- `invest(campaign_id: u64, investor: Address, amount: i128)` → Investment recorded
- `settle_campaign(campaign_id: u64)` → Revenue distribution
- `produce(campaign_id: u64)` → Transition to IN_PRODUCTION
- `harvest(campaign_id: u64)` → Transition to HARVESTED
- `mark_failed(campaign_id: u64)` → Transition to FAILED
- `mark_disputed(campaign_id: u64)` → Transition to DISPUTED
- `claim_tranche(campaign_id: u64, investor: Address)` → Release tranche payment
- `refund_investment(campaign_id: u64, investor: Address)` → Refund if failed

**Order Management:**
- `create_order(campaign_id: u64, buyer: Address, quantity: u64, price_per_unit: i128)` → Order ID
- `confirm_order(order_id: u64)` → Mark CONFIRMED

**Dispute Resolution:**
- `open_dispute(campaign_id: u64, order_id: Option<u64>, initiator: Address, respondent: Address)` → Dispute ID
- `submit_evidence(dispute_id: u64, submitter: Address, evidence_url: String, evidence_hash: String)` → Recorded
- `resolve_dispute(dispute_id: u64, outcome: String, notes: Option<String>)` → Marked RESOLVED
- `dismiss_dispute(dispute_id: u64, reason: Option<String>)` → Marked DISMISSED

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

- **Testnet** → (if deployed: provide contract ID)
- **Futurenet** → (if deployed: provide contract ID)
- **Mainnet** → (pending deployment)

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
cd agro-production/contract
cargo build --target wasm32-unknown-unknown --release -p production_escrow
# Output: target/wasm32-unknown-unknown/release/production_escrow.wasm
```

### Run Contract Tests

```bash
cd agro-production/contract
cargo test --workspace
# Runs tests for production_escrow, registry, and any other workspace members
```

## Related Issues

- **#450** — Dispute lifecycle indexing and REST endpoints
- **#451** — Product/marketplace APIs
- **#452** — Backend CI workflow
- **#459** — Dual-contract event reading (transition period)
- **#455, #456, #457** — Prior improvements to production_escrow

## Naming & Artifacts

The canonical contract's Soroban compiler output is:
- **WASM file**: `production_escrow.wasm`
- **Package name**: `production_escrow` (in Cargo.toml)
- **Crate name**: `production_escrow`

This naming is unambiguous and matches the canonical source crate name, avoiding collisions with legacy `production-escrow-hyphen` or placeholder `registry` packages.
