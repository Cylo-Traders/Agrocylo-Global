# Production Contract Deployment Guide

This document describes how to deploy the four production Soroban contracts to Stellar testnet or mainnet, verify WASM integrity, and manage the multisig admin/guardian roles.

**Issue References:** #778, #779, #843

## Overview

The contracts form an interdependent system (all six contracts' `initialize`
gates on the admin's authorization as of #843):
- **governance** — Manages proposals, voting, and timelocked execution of parameter changes and upgrades
- **production_escrow** — Holds investor funds in escrow, manages campaign lifecycle
- **registry** — Tracks orders and cross-links escrow/production contracts
- **investment_basket** — Manages batched fund investments
- **escrow** — Marketplace escrow (`contracts/escrow`)
- **weather-insurance** — Parametric weather policies (`contracts/weather-insurance`, deployed outside `deploy-contracts.sh`)

They must be deployed and cross-wired in a specific dependency order to ensure all references are valid.

## Deployment Architecture

### Contract Dependency Order

Derived from reading `initialize` and setter functions in each contract:

1. **governance** (standalone, no external dependencies)
   - `initialize(admin, voting_period_secs, timelock_delay_secs, upgrade_timelock_delay_secs, quorum_weight)`

2. **production_escrow, registry, investment_basket** (can deploy in parallel)
   - `production_escrow.initialize(admin, supported_tokens, fee_collector, fee_rate_bps)`
   - `registry.initialize(admin, escrow_contract, production_contract)`
   - `investment_basket.initialize(admin, escrow_contract)`

3. **Wire registry reference** (production_escrow depends on registry address)
   - `production_escrow.set_registry_contract(registry_id)`

4. **Wire governance** (all contracts reference governance once configured)
   - `production_escrow.set_governance_contract(governance_id)`
   - `registry.set_governance_contract(governance_id)`
   - `investment_basket.set_governance_contract(governance_id)`

5. **Set guardian** (governance-gated, requires multisig after #779)
   - `production_escrow.set_guardian(guardian_address)`
   - `registry.set_guardian(guardian_address)`
   - `investment_basket.set_guardian(guardian_address)`

6. **Set attester** (admin-only, production_escrow only)
   - `production_escrow.set_attester(attester_address)`

### Why This Order Matters

- **governance first** — Other contracts check governance exists before accepting governance-gated operations. Deploying it first ensures `set_governance_contract` calls won't fail on a missing address.
- **registry before set_registry_contract** — production_escrow's `set_registry_contract` must point to an already-deployed registry instance.
- **governance before set_governance_contract** — Same reasoning: all contracts must have a live governance address to wire.
- **set_guardian after governance** — The `set_guardian` functions themselves are governance-gated (once governance is configured), so governance must already be deployed and wired.

## Prerequisites

- `stellar` CLI (or legacy `soroban`) on `PATH`, and `jq`
- Rust `1.89.0` (`rust-toolchain.toml`) with the `wasm32v1-none` target
- A funded signing identity configured via `stellar keys add <name>`

## Environment

| Var | Required | Default | Notes |
|---|---|---|---|
| `DEPLOYER` | ✅ | — | `stellar keys` identity name used as source account |
| `ADMIN` | | address of `DEPLOYER` | admin for every `initialize()` |
| `FEE_COLLECTOR` | ✅ (deploy) | — | fee collector address |
| `SUPPORTED_TOKENS` | ✅ (deploy) | — | comma-separated token contract IDs (escrow needs ≥ 2) |
| `FEE_RATE_BPS` | | `0` | |
| `PATH_PAYMENT_ROUTER` | | — | router contract for `escrow.set_path_payment_router` |
| `GOV_VOTING_PERIOD_SECS` | | `259200` | |
| `GOV_TIMELOCK_SECS` | | `172800` | |
| `GOV_UPGRADE_TIMELOCK_SECS` | | `604800` | must be ≥ `GOV_TIMELOCK_SECS` |
| `GOV_QUORUM_WEIGHT` | | `1` | |
| `SOROBAN_RPC_URL` | | per-network default | override RPC |

## Commands per network

> **MAINNET REQUIREMENT (Issue #843):** initialization must happen **in the same
> transaction as deployment** — do **not** run `contract deploy` and `invoke
> initialize` as separate steps on mainnet. A window between the two lets an
> attacker front-run `initialize` and become admin (`initialize` now requires
> the admin's authorization on all six contracts, but the deploy+init gap must
> also be closed). Use `deploy-contracts.sh` (it performs constructor-style
> atomic init on mainnet automatically), or pass `--init-fn initialize
> --init-args '<json>'` to every `stellar contract deploy`. `scripts/deploy-contracts.sh` is the supported path.
>
> If you run any manual `invoke initialize` on mainnet, you MUST do it in the
> same transaction as the deploy for that contract (constructor-style init).

For each contract in dependency order, call `initialize` then cross-wiring setters:

```bash
DEPLOYER=local-admin \
FEE_COLLECTOR=$(stellar keys address local-admin) \
SUPPORTED_TOKENS=$NATIVE_SAC,$USDC_SAC \
scripts/deploy-contracts.sh --network local
```

### Step 4: Verify Deployment

After each step (or at the end), verify contract state. `deploy-contracts.sh`
does this automatically in its verification pass; if deploying manually, run
each readback and assert the value:

```bash
# Read back initialized values
soroban contract invoke --id C_PRODUCTION_ESCROW_ID -- get_admin
soroban contract invoke --id C_GOVERNANCE_ID -- get_admin
soroban contract invoke --id C_REGISTRY_ID -- get_admin
soroban contract invoke --id C_BASKET_ID -- get_admin

# Verify governance was wired
soroban contract invoke --id C_PRODUCTION_ESCROW_ID -- get_governance_contract
# Should return C_GOVERNANCE_ID
```

**Mandatory pre-funding gate (Issue #843):** before any funds move on mainnet,
every `get_admin` readback **must** equal the expected multisig account. The
deploy script asserts `get_admin` per contract and fails the run (exit 1) on
any mismatch; it also verifies `get_registry_contract`,
`get_governance_contract`, registry `get_contract_refs`, and — when `GUARDIAN`
is set — `get_guardian` on every contract that exposes it. A failing readback
means the contract must **not** receive funds until it is fixed.

### Step 5: Update Deployment Manifest

Update `deployments/<network>.json` with actual contract IDs, WASM hashes, and ledger sequence:

```json
{
  "network": "testnet",
  "deployment_timestamp": "2025-09-15T14:30:00Z",
  "deployer_account": "GDEVACCOUNT...",
  "ledger_sequence": 12345678,
  "contracts": {
    "governance": {
      "id": "CGOVGOV...",
      "wasm_hash": "abc123..."
    },
    "production_escrow": {
      "id": "CESCROW...",
      "wasm_hash": "def456...",
      "initializations": {
        "admin": "GADMIN...",
        "supported_tokens": ["CUSDC..."],
        "fee_collector": "GFEE...",
        "fee_rate_bps": 300
      }
    },
    "registry": {
      "id": "CREG...",
      "wasm_hash": "ghi789...",
      "initializations": {
        "admin": "GADMIN...",
        "escrow_contract": "CESCROW...",
        "production_contract": "CESCROW..."
      }
    },
    "investment_basket": {
      "id": "CBASKET...",
      "wasm_hash": "jkl012...",
      "initializations": {
        "admin": "GADMIN...",
        "escrow_contract": "CESCROW..."
      }
    }
  },
  "deployment_steps": [
    "Deployed governance",
    "Deployed production_escrow, registry, investment_basket",
    "Initialized all contracts",
    "Wired governance references",
    "Set guardian and attester roles"
  ]
}
```

### Mainnet

```bash
DEPLOYER=mainnet-deployer \
ADMIN=CB…MULTISIG \
FEE_COLLECTOR=CB…FEE \
SUPPORTED_TOKENS=CB…XLM,CB…USDC \
FEE_RATE_BPS=50 \
PATH_PAYMENT_ROUTER=CB…ROUTER \
GOV_QUORUM_WEIGHT=3 \
scripts/deploy-contracts.sh --network mainnet
```

## Flags

| Flag | Effect |
|---|---|
| `--force` | Ignore existing manifest IDs and redeploy fresh WASM |
| `--skip-build` | Reuse WASM already in `target/wasm32v1-none/release/` |
| `--verify-only` | Run only the read-back verification pass against the manifest |

## Re-running / config changes

Safe. Deploy is skipped for contracts already in the manifest; `initialize`
tolerates `AlreadyInitialized`; each wiring step is a no-op when the on-chain
value already matches. To roll out a config change (e.g. a new
`PATH_PAYMENT_ROUTER`) set the env var and re-run — note that once governance is
wired, parameter setters must go through a governance proposal rather than this
script.

## CI/CD

`.github/workflows/deploy.yml` runs the script with `--network testnet` against
staging on merge to `main` (job `deploy-contracts`), using the `DEPLOYER_SECRET`
and address env vars from the `staging` environment. Mainnet is run manually by a
maintainer following the command above.
