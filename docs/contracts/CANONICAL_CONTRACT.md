# Canonical Contract: production_escrow

> **Last verified against commit**: `e54fafd` (Issue #1300)

## Selection

The **production_escrow** contract (located at `contracts/production_escrow/`) has been selected as the canonical Soroban contract for the Agrocylo production system.

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
contracts/
├── escrow/                       (standalone escrow crate)
├── governance/                   (governance multisig and timelock)
├── investment_basket/            (basket custody contract)
├── production_escrow/            (canonical contract)
│   ├── Cargo.toml                (package name: "production-escrow-v2")
│   └── src/lib.rs
└── registry/                     (registry contract)
    ├── Cargo.toml                (package name: "registry")
    └── src/lib.rs
```

The root `Cargo.toml` workspace members:
- `contracts/escrow`
- `contracts/registry`
- `contracts/production_escrow` (package name: `production-escrow-v2`)
- `contracts/investment_basket`
- `contracts/governance`

### Package Naming

- **production-escrow-v2** → Package name in `contracts/production_escrow/Cargo.toml`
- **production_escrow_v2.wasm** → Canonical contract WASM compiler output
- **registry** → Product/marketplace registry contract

## ABI Summary

### production_escrow Public Functions

**Initialization & Config:**
- `initialize(admin: Address, supported_tokens: Vec<Address>, fee_collector: Address, fee_rate_bps: u32)` — Initialize contract
- `set_attester(admin: Address, attester: Address)` — Configure attester address
- `set_arbitrators(admin: Address, arbitrators: Vec<Address>)` — Configure dispute arbitrators

**Campaign Management:**
- `create_campaign(farmer: Address, token: Address, target_amount: i128, deadline: u64)` → Campaign ID
- `invest(investor: Address, campaign_id: u64, amount: i128)` → Investment recorded
- `start_production(farmer: Address, campaign_id: u64)` → Transition to `InProduction`
- `mark_harvest(farmer: Address, attester_caller: Address, campaign_id: u64)` → Attester-verified transition to `Harvested`
- `settle(farmer: Address, campaign_id: u64)` → Transition to `Settled` and transfer farmer net earnings
- `mark_campaign_failed(caller: Address, campaign_id: u64)` → Mark campaign failed if deadline passed
- `claim_returns(investor: Address, campaign_id: u64)` → Release proportional investor returns after settlement
- `refund(investor: Address, campaign_id: u64)` → Refund investment principal if campaign failed

**Order Management:**
- `create_order(buyer: Address, farmer: Address, campaign_id: u64, amount: i128, token: Address)` → Order ID
- `confirm_order(order_id: u64, buyer: Address)` → Mark `Confirmed` and transfer funds to farmer

**Dispute Resolution:**
- `open_dispute(caller: Address, order_id: u64, reason: String)` → Dispute recorded
- `resolve_dispute(caller: Address, order_id: u64, refund_buyer: bool)` → Resolve dispute with refund or release

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
cd contracts
cargo build --target wasm32-unknown-unknown --release -p production_escrow
# Output: target/wasm32-unknown-unknown/release/production_escrow.wasm
```

### Run Contract Tests

```bash
cd contracts
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
