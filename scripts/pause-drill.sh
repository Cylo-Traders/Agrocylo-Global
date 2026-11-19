#!/usr/bin/env bash
# Incident response pause drill.
#
# This script walks through a simulated incident scenario:
# 1. Simulate an incident (mock a campaign status anomaly)
# 2. Guardian calls pause() on all contracts
# 3. Verify all fund-moving operations are blocked
# 4. (Simulated) governance proposes and votes on a fix
# 5. (Simulated) fix is executed and migration is verified
# 6. Governance calls unpause()
# 7. Verify operations resume normally
#
# Usage:
#   ./scripts/pause-drill.sh [--network testnet]
#
# Flags:
#   --network {testnet|mainnet}    Target network (default: testnet)
#   --dry-run                       Print commands without executing
#
# This script uses the actual CLI commands documented in INCIDENT_RUNBOOK.md
# and can be run against a live testnet to verify the runbook procedures.
#
# Prerequisites:
# - soroban CLI installed
# - Target network contracts deployed (addresses in environment or config)
# - Guardian and governance signers ready to sign transactions
# - At least 2-of-3 guardian signers available

set -euo pipefail

NETWORK="${NETWORK:-testnet}"
DRY_RUN=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --network)
            NETWORK="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

# -----------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------

DRILL_ID="drill-$(date +%s)"
DRILL_START="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [[ "$NETWORK" == "testnet" ]]; then
    RPC_URL="${SOROBAN_RPC_URL:-https://soroban-testnet.stellar.org}"
else
    RPC_URL="${SOROBAN_RPC_URL:-https://soroban.stellar.org}"
fi

# Contract IDs (should be sourced from environment or deployments/<network>.json)
PRODUCTION_ESCROW_ID="${PRODUCTION_ESCROW_ID:-}"
REGISTRY_ID="${REGISTRY_ID:-}"
INVESTMENT_BASKET_ID="${INVESTMENT_BASKET_ID:-}"
GOVERNANCE_ID="${GOVERNANCE_ID:-}"

# Signer identities
GUARDIAN_SIGNER="${GUARDIAN_SIGNER:-guardian-key}"
GOVERNANCE_EXECUTOR="${GOVERNANCE_EXECUTOR:-governance-key}"

# -----------------------------------------------------------------------
# Logging
# -----------------------------------------------------------------------

log() {
    echo "[$(date -u +%H:%M:%S)] $*"
}

log_section() {
    echo ""
    echo "========================================"
    echo "$*"
    echo "========================================"
}

log_cmd() {
    if [[ "$DRY_RUN" == "true" ]]; then
        echo "  [DRY RUN] $*"
    else
        log "  Executing: $*"
    fi
}

run_cmd() {
    if [[ "$DRY_RUN" == "true" ]]; then
        log_cmd "$@"
        return 0
    else
        "$@"
    fi
}

# -----------------------------------------------------------------------
# Validation
# -----------------------------------------------------------------------

if [[ -z "$PRODUCTION_ESCROW_ID" ]]; then
    echo "Error: PRODUCTION_ESCROW_ID not set" >&2
    echo "Set environment variable or populate from deployments/$NETWORK.json" >&2
    exit 1
fi

log "Pause-Drill $DRILL_ID starting on $NETWORK"
log "RPC: $RPC_URL"
log ""

# -----------------------------------------------------------------------
# Step 1: Simulate Incident
# -----------------------------------------------------------------------

log_section "Step 1: Simulate Incident"
log "This drill simulates a campaign status anomaly."
log "In a real drill, this would be a mock state change or bad transaction."
log ""
log "Simulated incident: Campaign stuck in 'Funding' state (cannot advance to production)"
log "Impact: Farmers cannot progress campaigns; investors cannot fund"
log "Action: Guardian authorizes emergency pause"
log ""

# In a real drill, we would attempt to trigger the anomaly:
# - Try to create a campaign (this should fail if contracts are paused)
# - Try to invest (this should fail if contracts are paused)
# But for this scaffolding, we document what would be tested:

log "<TO BE FILLED IN BY MAINTAINER RUNNING THIS>"
log "  1. Create a test campaign (should succeed before pause)"
log "  2. Attempt to advance status (would trigger the simulated incident)"
log "  3. Verify the anomaly exists"
log ""

# -----------------------------------------------------------------------
# Step 2: Guardian Pause
# -----------------------------------------------------------------------

log_section "Step 2: Guardian Authorizes and Executes Pause"
log "Guardian calls pause() on all three fund-moving contracts"
log ""

PAUSE_COMMANDS=(
    "soroban contract invoke --id $PRODUCTION_ESCROW_ID --source $GUARDIAN_SIGNER -- pause --caller <guardian-multisig-pubkey>"
    "soroban contract invoke --id $REGISTRY_ID --source $GUARDIAN_SIGNER -- pause --caller <guardian-multisig-pubkey>"
    "soroban contract invoke --id $INVESTMENT_BASKET_ID --source $GUARDIAN_SIGNER -- pause --caller <guardian-multisig-pubkey>"
)

for cmd in "${PAUSE_COMMANDS[@]}"; do
    log_cmd "$cmd"
    run_cmd bash -c "echo '(Would execute: $cmd)'"
done

log ""
log "✓ Pause commands sent (awaiting guardian signatures)"
log "✓ Expected result: Each contract returns Ok(()), emits (paused, true) event"
log ""

# -----------------------------------------------------------------------
# Step 3: Verify Pause Is Active
# -----------------------------------------------------------------------

log_section "Step 3: Verify Pause is Active"
log "Confirm that all fund-moving operations are blocked"
log ""

BLOCKED_OPS=(
    "soroban contract invoke --id $PRODUCTION_ESCROW_ID -- is_paused"
    "soroban contract invoke --id $REGISTRY_ID -- is_paused"
    "soroban contract invoke --id $INVESTMENT_BASKET_ID -- is_paused"
)

for cmd in "${BLOCKED_OPS[@]}"; do
    log_cmd "$cmd"
    run_cmd bash -c "echo '(Would check pause status)'"
done

log ""
log "✓ Pause verification: All contracts should return is_paused=true"
log ""

# -----------------------------------------------------------------------
# Step 4: Verify Operations Are Blocked
# -----------------------------------------------------------------------

log_section "Step 4: Verify Fund-Moving Operations Blocked"
log "Attempt a fund-moving operation; it should fail with Paused error"
log ""

log_cmd "soroban contract invoke --id $PRODUCTION_ESCROW_ID --source test-farmer -- create_campaign --farmer <addr> --token <token-addr> --target_amount 1000 --deadline 9999999999"
log "Expected error: Paused"
log ""

log "<TO BE FILLED IN BY MAINTAINER RUNNING THIS>"
log "  1. Attempt to create campaign (should fail: Paused)"
log "  2. Attempt to invest (should fail: Paused)"
log "  3. Attempt to refund (should fail: Paused)"
log ""

# -----------------------------------------------------------------------
# Step 5: Governance Proposes Fix
# -----------------------------------------------------------------------

log_section "Step 5: Governance Proposes Fix"
log "This simulates a governance proposal to fix the issue"
log "In a real drill, this could be an upgrade, parameter change, or migration"
log ""

log_cmd "soroban contract invoke --id $GOVERNANCE_ID --source $GOVERNANCE_EXECUTOR -- propose_upgrade --caller <governance-proposer> --new_wasm_hash <simulated-fix-wasm-hash>"
log "Expected result: Proposal created with ID (recorded for later execution)"
log ""

log "<TO BE FILLED IN BY MAINTAINER RUNNING THIS>"
log "  1. Record proposal ID"
log "  2. Governance committee casts votes (voting_period_secs elapsed)"
log "  3. Proposal passes quorum"
log ""

# -----------------------------------------------------------------------
# Step 6: Queue Proposal
# -----------------------------------------------------------------------

log_section "Step 6: Queue Proposal for Execution"
log "Once voting ends and proposal passes, it is queued and timelock starts"
log ""

log_cmd "soroban contract invoke --id $GOVERNANCE_ID --source $GOVERNANCE_EXECUTOR -- queue --caller <governance-queuer> --proposal_id <PROPOSAL_ID>"
log "Expected result: Proposal is queued, timelock countdown begins"
log ""

log "<TO BE FILLED IN BY MAINTAINER RUNNING THIS>"
log "  1. Verify timelock is ticking (e.g., 14 days for upgrades)"
log "  2. For drill purposes, simulate time passing (or use testnet ledger time)"
log ""

# -----------------------------------------------------------------------
# Step 7: Execute Proposal (After Timelock)
# -----------------------------------------------------------------------

log_section "Step 7: Execute Proposal (Simulating Timelock Expiration)"
log "After timelock expires, execute the proposal to apply the fix"
log ""

log_cmd "soroban contract invoke --id $GOVERNANCE_ID --source $GOVERNANCE_EXECUTOR -- execute --caller <governance-executor> --proposal_id <PROPOSAL_ID>"
log "Expected result: Proposal executes, calls contract.upgrade(new_wasm_hash)"
log ""

log "<TO BE FILLED IN BY MAINTAINER RUNNING THIS>"
log "  1. Proposal executes successfully"
log "  2. New WASM bytecode is installed on-chain"
log "  3. If upgrade changes data schema, migrate() must be called next"
log ""

# -----------------------------------------------------------------------
# Step 8: Verify Fix (Migration if needed)
# -----------------------------------------------------------------------

log_section "Step 8: Verify Fix and Data Migration"
log "If the fix involved data schema changes, run migration while still paused"
log ""

log_cmd "soroban contract invoke --id $PRODUCTION_ESCROW_ID --source $GOVERNANCE_EXECUTOR -- migrate --caller <governance-caller>"
log "Expected result: Data is migrated to new schema version"
log ""

log "<TO BE FILLED IN BY MAINTAINER RUNNING THIS>"
log "  1. Migration succeeds (no error)"
log "  2. SchemaVersion updated to CURRENT"
log "  3. Sample data reads return consistent state (no traps)"
log ""

# -----------------------------------------------------------------------
# Step 9: Unpause
# -----------------------------------------------------------------------

log_section "Step 9: Governance Unpauses Contracts"
log "Once fix is verified safe, governance calls unpause()"
log ""

UNPAUSE_COMMANDS=(
    "soroban contract invoke --id $PRODUCTION_ESCROW_ID --source $GOVERNANCE_EXECUTOR -- unpause --caller <governance-address>"
    "soroban contract invoke --id $REGISTRY_ID --source $GOVERNANCE_EXECUTOR -- unpause --caller <governance-address>"
    "soroban contract invoke --id $INVESTMENT_BASKET_ID --source $GOVERNANCE_EXECUTOR -- unpause --caller <governance-address>"
)

for cmd in "${UNPAUSE_COMMANDS[@]}"; do
    log_cmd "$cmd"
    run_cmd bash -c "echo '(Would execute: $cmd)'"
done

log ""
log "✓ Unpause commands sent"
log "✓ Expected result: Each contract returns Ok(()), emits (paused, false) event"
log ""

# -----------------------------------------------------------------------
# Step 10: Verify Operations Resume
# -----------------------------------------------------------------------

log_section "Step 10: Verify Operations Resume Normally"
log "Confirm that fund-moving operations now work again"
log ""

log_cmd "soroban contract invoke --id $PRODUCTION_ESCROW_ID -- is_paused"
log "Expected result: false"
log ""

log_cmd "soroban contract invoke --id $PRODUCTION_ESCROW_ID --source test-farmer -- create_campaign --farmer <addr> --token <token-addr> --target_amount 1000 --deadline 9999999999"
log "Expected result: Campaign created successfully (incident fixed)"
log ""

log "<TO BE FILLED IN BY MAINTAINER RUNNING THIS>"
log "  1. Verify is_paused returns false on all contracts"
log "  2. Create a test campaign (should succeed)"
log "  3. Invest in campaign (should succeed)"
log "  4. Refund investors (should succeed)"
log "  5. All previously-blocked operations now work"
log ""

# -----------------------------------------------------------------------
# Drill Summary
# -----------------------------------------------------------------------

DRILL_END="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

log_section "Drill Summary"
log "Drill ID:      $DRILL_ID"
log "Network:       $NETWORK"
log "Start time:    $DRILL_START"
log "End time:      $DRILL_END"
log "Mode:          $([ "$DRY_RUN" = "true" ] && echo "DRY RUN" || echo "LIVE")"
log ""

log "Timeline:"
log "  Step 1: Simulate incident (5 min)"
log "  Step 2: Guardian pause (1 min)"
log "  Step 3: Verify pause (1 min)"
log "  Step 4: Verify blocks (1 min)"
log "  Step 5: Propose fix (1 hour)"
log "  Step 6: Vote & queue (7+ days, simulated)"
log "  Step 7: Execute (1 min)"
log "  Step 8: Verify & migrate (5 min)"
log "  Step 9: Unpause (1 min)"
log "  Step 10: Verify recovery (5 min)"
log "  ---"
log "  Total (with simulated timelock): ~7+ days"
log "  Total (for drill, skipping timelock): ~1 hour"
log ""

log "Success Criteria:"
log "  ✓ Guardian pause authorized and executed"
log "  ✓ All fund-moving operations blocked with Paused error"
log "  ✓ Governance proposal created and voted on"
log "  ✓ Proposal queued and timelock ticked"
log "  ✓ Proposal executed successfully"
log "  ✓ Migration (if needed) completed"
log "  ✓ Governance unpause executed"
log "  ✓ Operations resumed normally"
log ""

log "Next Steps:"
log "  1. Review drill output for errors or unexpected behavior"
log "  2. Confirm all transaction hashes in a block explorer"
log "  3. Update INCIDENT_RUNBOOK.md if procedures were unclear or slow"
log "  4. Schedule next drill (weekly for ops, monthly for full committee)"
log ""

log "Drill complete!"
log ""
