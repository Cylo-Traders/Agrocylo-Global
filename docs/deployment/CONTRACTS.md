# Contract Deployment — `scripts/deploy-contracts.sh`

One command deploys and fully cross-wires the entire Soroban contract set to a
clean network, then verifies the wiring actually took. Re-running is safe and
converges to the same state.

> Background on multisig admin/guardian custody and reproducible-WASM
> verification lives in [`CONTRACTS.md`](./CONTRACTS.md). This page is the
> operational runbook for the deploy script itself.

## The contract set

| Contract | Crate | Role |
|---|---|---|
| `governance` | `agro-production/contract/governance` | Proposals, voting, timelocked execution |
| `escrow` | `contracts/escrow` | Marketplace order escrow + path-payment settlement |
| `production_escrow` | `agro-production/contract/production_escrow` | Campaign escrow |
| `registry` | `agro-production/contract/registry` | Order / reputation registry, escrow↔production link |
| `investment_basket` | `agro-production/contract/investment_basket` | Batched campaign investments |

## What the script does

1. **Build** all five contracts (`wasm32v1-none`, `release`, pinned toolchain).
2. **Deploy** each instance with a deterministic salt (`sha256("agrocylo:<network>:<contract>")`)
   so a first deploy is reproducible; existing IDs in the manifest are reused.
3. **Initialize** each contract (`AlreadyInitialized` is tolerated).
4. **Cross-wire**, in dependency order:
   - `escrow.set_registry_contract(registry)`
   - `escrow.set_path_payment_router(router)` — only if `PATH_PAYMENT_ROUTER` set
   - `escrow.set_fee_config(fee_collector, fee_rate_bps)` — only if `FEE_RATE_BPS > 0`
   - `production_escrow.set_registry_contract(registry)`
   - `escrow.set_governance_contract(governance)`
   - `production_escrow.set_governance_contract(governance)`
   - `registry.set_governance_contract(governance)`
   - `investment_basket.set_governance_contract(governance)`

   Governance wiring is **last**: once `set_governance_contract` lands, every
   other setter on that contract becomes governance-gated and can no longer be
   driven by the raw admin key. Each wiring step reads the current on-chain
   value first and is skipped when it already matches — that is what makes a
   re-run converge instead of erroring on the now-gated setters.
5. **Verify** — reads back every configured `registry` / `governance` address
   (and `registry.get_contract_refs`) and asserts each equals what was just
   deployed. Any mismatch prints `FAIL …` and exits `1`, so a contract that
   shipped with the registry or governance unset fails the deploy instead of a
   later audit.
6. **Write** `deployments/deployed-addresses.<network>.json` — contract IDs,
   WASM hashes, salts, and the wiring map. See
   [`deployed-addresses.example.json`](../../deployments/deployed-addresses.example.json).

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

### Local sandbox

```bash
DEPLOYER=local-admin \
FEE_COLLECTOR=$(stellar keys address local-admin) \
SUPPORTED_TOKENS=$NATIVE_SAC,$USDC_SAC \
scripts/deploy-contracts.sh --network local
```

### Testnet

```bash
DEPLOYER=testnet-deployer \
FEE_COLLECTOR=GB…FEE \
SUPPORTED_TOKENS=CB…XLM,CB…USDC \
FEE_RATE_BPS=50 \
PATH_PAYMENT_ROUTER=CB…ROUTER \
scripts/deploy-contracts.sh --network testnet
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
