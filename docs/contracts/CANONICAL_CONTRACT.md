# Canonical Campaign Escrow Contract: `production-escrow-v2`

> **Last verified against commit:** `25d942522b76e4252752249142326a757d3d78d6`

## Product Surface & Workspace Architecture

As documented in `contracts/SECURITY_AUDIT.md` (§14.5), Agrocylo ships two distinct escrow contracts for two distinct product surfaces, alongside shared governance, registry, and basket contracts:

1. **`contracts/production_escrow`** (Cargo package: `production-escrow-v2`, WASM artifact: `production_escrow_v2.wasm`) — **Canonical crowdfunded production campaign escrow** (`create_campaign`, `invest`, `start_production`, `mark_harvest`, `advance_milestone`, `create_order`, `confirm_order`, `settle`, `claim_returns`, `refund`, split orders, and arbitrator/admin dispute resolution).
2. **`contracts/escrow`** (Cargo package: `escrow`, WASM artifact: `escrow.wasm`) — Direct buyer↔farmer marketplace order escrow.
3. **`contracts/registry`** (Cargo package: `registry`, WASM artifact: `registry.wasm`) — Farmer/campaign registration, provenance batches, and reputation tracking.
4. **`contracts/governance`** (Cargo package: `governance`, WASM artifact: `governance.wasm`) — Weighted voting and timelocked execution for parameter changes and WASM upgrades.
5. **`contracts/investment_basket`** (Cargo package: `investment_basket`, WASM artifact: `investment_basket.wasm`) — Diversified multi-campaign investment baskets.

## Workspace Configuration

Root `Cargo.toml` workspace members:

```toml
[workspace]
resolver = "2"
exclude = ["archive/weather-insurance"]
members = [
    "contracts/escrow",
    "contracts/registry",
    "contracts/production_escrow",
    "contracts/investment_basket",
    "contracts/governance",
]
```

### Package & Artifact Naming (`contracts/production_escrow/Cargo.toml` & `scripts/deploy-contracts.sh`)

- **Directory**: `contracts/production_escrow`
- **Cargo package name**: `production-escrow-v2`
- **Compiled WASM artifact**: `target/wasm32v1-none/release/production_escrow_v2.wasm`

---

## Verified Public ABI Summary (`contracts/production_escrow/src/lib.rs`)

### Initialization, Governance, Pause & Upgrades
- `initialize(env, admin: Address, supported_tokens: Vec<Address>, fee_collector: Address, fee_rate_bps: u32) -> Result<(), EscrowError>`
- `upgrade(env, caller: Address, new_wasm_hash: BytesN<32>) -> Result<(), EscrowError>`
- `migrate(env, caller: Address) -> Result<u32, EscrowError>`
- `get_schema_version(env) -> u32`
- `set_guardian(env, caller: Address, guardian: Address) -> Result<(), EscrowError>`
- `get_guardian(env) -> Option<Address>`
- `pause(env, caller: Address) -> Result<(), EscrowError>`
- `unpause(env, caller: Address) -> Result<(), EscrowError>`
- `is_paused(env) -> bool`
- `bump_instance_ttl(env)`
- `set_governance_contract(env, caller: Address, governance: Address) -> Result<(), EscrowError>`
- `get_governance_contract(env) -> Option<Address>`
- `set_registry_contract(env, admin_caller: Address, registry: Address) -> Result<(), EscrowError>`
- `set_fee_config(env, admin_caller: Address, fee_collector: Address, fee_rate_bps: u32) -> Result<(), EscrowError>`
- `update_supported_tokens(env, admin_caller: Address, supported_tokens: Vec<Address>) -> Result<(), EscrowError>`
- `set_attester(env, admin_caller: Address, attester: Address) -> Result<(), EscrowError>`
- `set_arbitrators(env, caller: Address, arbitrators: Vec<Address>, quorum: u32) -> Result<(), EscrowError>`
- `get_arbitrators(env) -> Vec<Address>`
- `get_quorum(env) -> u32`

### Campaign Lifecycle & Investments
- `create_campaign(env, farmer: Address, token: Address, target_amount: i128, deadline: u64) -> Result<u64, EscrowError>`
- `invest(env, investor: Address, campaign_id: u64, amount: i128) -> Result<(), EscrowError>`
- `transfer_investment(env, from: Address, to: Address, campaign_id: u64, amount: i128) -> Result<(), EscrowError>`
- `start_production(env, farmer: Address, campaign_id: u64) -> Result<(), EscrowError>`
- `mark_harvest(env, farmer: Address, attester_caller: Address, campaign_id: u64) -> Result<(), EscrowError>`
- `set_milestone_configs(env, admin_caller: Address, campaign_id: u64, configs: Vec<MilestoneConfig>) -> Result<(), EscrowError>`
- `advance_milestone(env, caller: Address, attester_caller: Address, campaign_id: u64) -> Result<(), EscrowError>`
- `settle(env, caller: Address, campaign_id: u64) -> Result<(), EscrowError>`
- `claim_returns(env, investor: Address, campaign_id: u64) -> Result<i128, EscrowError>`

### Orders & Multi-Party Split Orders
- `create_order(env, buyer: Address, campaign_id: u64, amount: i128) -> Result<u64, EscrowError>`
- `cancel_order(env, buyer: Address, order_id: u64) -> Result<(), EscrowError>`
- `confirm_order(env, buyer: Address, order_id: u64) -> Result<(), EscrowError>`
- `batch_refund_orders(env, order_ids: Vec<u64>) -> Result<(u32, i128), EscrowError>`
- `create_split_order(env, initiator: Address, campaign_id: u64, co_buyers: Vec<Address>, shares: Vec<i128>) -> Result<u64, SplitOrderError>`
- `fund_split_order(env, co_buyer: Address, order_id: u64) -> Result<(), SplitOrderError>`
- `confirm_split_receipt(env, co_buyer: Address, order_id: u64) -> Result<(), SplitOrderError>`
- `open_split_dispute(env, caller: Address, order_id: u64) -> Result<(), SplitOrderError>`
- `resolve_split_dispute(env, admin_caller: Address, order_id: u64, resolution: SplitOrderResolution) -> Result<(), SplitOrderError>`
- `get_split_order(env, order_id: u64) -> Result<SplitOrder, SplitOrderError>`

### Failure Recovery & Disputes
- `finalize_failed(env, campaign_id: u64) -> Result<(), EscrowError>`
- `mark_campaign_failed(env, caller: Address, campaign_id: u64) -> Result<(), EscrowError>`
- `refund(env, investor: Address, campaign_id: u64) -> Result<i128, EscrowError>`
- `refundable_amount(env, investor: Address, campaign_id: u64) -> i128`
- `batch_refund_investors(env, campaign_id: u64, investors: Vec<Address>) -> Result<(u32, i128), EscrowError>`
- `open_dispute(env, caller: Address, campaign_id: u64) -> Result<(), EscrowError>`
- `resolve_dispute(env, admin_caller: Address, campaign_id: u64, resolution: DisputeResolution) -> Result<(), EscrowError>`
- `vote_to_resolve(env, arbitrator: Address, campaign_id: u64, resolution: DisputeResolution) -> Result<(), EscrowError>`

### Read-Only Views
- `get_campaign(env, campaign_id: u64) -> Result<Campaign, EscrowError>`
- `get_order(env, order_id: u64) -> Result<Order, EscrowError>`
- `get_contribution(env, campaign_id: u64, investor: Address) -> i128`
- `get_supported_tokens(env) -> Vec<Address>`
- `get_admin(env) -> Result<Address, EscrowError>`
- `get_milestone_configs(env, campaign_id: u64) -> Vec<MilestoneConfig>`

---

## Building & Testing

```bash
# Run unit tests for production-escrow-v2 from workspace root
cargo test -p production-escrow-v2 --lib

# Build deployable WASM artifact (outputs target/wasm32v1-none/release/production_escrow_v2.wasm)
cargo build -p production-escrow-v2 --target wasm32v1-none --release
```
