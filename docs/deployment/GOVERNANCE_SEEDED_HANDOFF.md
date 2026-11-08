# Governance Voter Seeding & Reachable Quorum Handoff (Issue #1285)

## Overview

When `governance` is initialized on Soroban, it begins with `TotalWeight = 0`. If `deploy-contracts.sh` crosses-wires dependent contracts (`escrow`, `production_escrow`, `registry`, `investment_basket`) to governance before configuring any voter weights, governance proposals become permanently unreachable. Once contracts are handed to governance, their parameters can only be altered through the `propose -> vote -> queue -> execute` cycle. If `TotalWeight < QuorumWeight`, no proposal can ever reach quorum.

To prevent governance deadlock, `scripts/deploy-contracts.sh` enforces voter seeding and verifies that the electorate's combined voting weight meets or exceeds quorum **before** handing dependent contracts over to governance.

## Configuration

Set voter addresses and their respective weights via the `GOV_VOTERS` environment variable:

```bash
GOV_VOTERS="GADDR1...:60,GADDR2...:50,GADDR3...:10"
```

### Environment Parameters

| Variable | Description | Default | Requirement |
|---|---|---|---|
| `GOV_QUORUM_WEIGHT` | Minimum voting weight needed to pass a proposal | `1` | Optional |
| `GOV_VOTING_PERIOD_SECS` | Duration in seconds during which votes can be cast | `259200` (3 days) | Optional |
| `GOV_TIMELOCK_SECS` | Timelock delay between queue and execution | `172800` (2 days) | Optional |
| `GOV_UPGRADE_TIMELOCK_SECS` | Timelock delay for contract upgrades | `604800` (7 days) | Optional (must be $\ge$ `GOV_TIMELOCK_SECS`) |
| `GOV_VOTERS` | Comma-separated `address:weight` list | Admin on testnet/local | **Mandatory on mainnet** |

## Enforcement & Verification Gates

1. **Pre-Handoff Seeding**:
   - Voters are seeded with `governance::set_voter_weight(admin, voter, weight)` prior to calling `set_governance_contract` on dependent contracts.
   - If total weight is less than `GOV_QUORUM_WEIGHT`, the deployment script aborts immediately and blocks handoff.
2. **On-Chain Readback Verification**:
   - `governance.quorum_weight` matches `GOV_QUORUM_WEIGHT`
   - `governance.total_weight` matches sum of weights and is $\ge$ `GOV_QUORUM_WEIGHT`
   - `governance.voting_period_secs`, `governance.timelock_delay_secs`, and `governance.upgrade_timelock_delay` match configured values
   - Every voter's weight is verified on-chain via `governance.get_voter_weight(voter)`
3. **Idempotence**:
   - On re-runs, existing voter weights are inspected first. Matches are skipped to avoid redundant transactions.

## Operational Rehearsal

A local or testnet lifecycle rehearsal can be run using `scripts/rehearse-governance.sh`:

```bash
# Dry run verification
scripts/rehearse-governance.sh --network testnet --dry-run

# Live rehearsal
DEPLOYER=ci-deployer scripts/rehearse-governance.sh --network testnet
```
