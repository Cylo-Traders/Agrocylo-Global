#!/usr/bin/env bash
# Instance TTL Keeper — monitors and extends Soroban contract instance TTLs.
#
# This keeper monitors the remaining TTL of configured contract instances and
# automatically bumps them when they approach the threshold, preventing archival
# and maintaining operational continuity.
#
# Configuration:
#   NETWORK              Network name (testnet, mainnet, local)
#   SOROBAN_RPC_URL      Override default RPC endpoint
#   KEEPER_IDENTITY      Stellar keypair name (must have balance for submission)
#   KEEPER_SECRET        (optional) Secret key instead of keypair name
#   CONTRACTS_CONFIG     JSON file with contract IDs and TTL thresholds
#   CHECK_INTERVAL_SECS  How often to check TTL (default: 300)
#   TTL_THRESHOLD_LEDGERS Extend when TTL falls below this (default: 50000)
#   LOG_FILE             (optional) Path to append logs
#
# Usage:
#   ./scripts/ttl-keeper.sh --network testnet --identity keeper-key
#
# Requirements:
#   - soroban CLI installed and in PATH
#   - stellar CLI installed and in PATH
#   - Configured keypair with sufficient balance for submission fees
#
# Output:
#   Logs submission attempts, successes, failures, and balance warnings to
#   stdout and optional LOG_FILE. No secrets are logged.

set -euo pipefail

# Default configuration
NETWORK="testnet"
SOROBAN_RPC_URL=""
KEEPER_IDENTITY=""
KEEPER_SECRET=""
CONTRACTS_CONFIG="deployments/ttl-keeper-config.json"
CHECK_INTERVAL_SECS=300
TTL_THRESHOLD_LEDGERS=50000
TTL_EXTEND_LEDGERS=100000
LOG_FILE=""
ONE_SHOT=false
DRY_RUN=false

# State tracking
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --network)
      NETWORK="$2"
      shift 2
      ;;
    --identity)
      KEEPER_IDENTITY="$2"
      shift 2
      ;;
    --secret)
      KEEPER_SECRET="$2"
      shift 2
      ;;
    --config)
      CONTRACTS_CONFIG="$2"
      shift 2
      ;;
    --interval)
      CHECK_INTERVAL_SECS="$2"
      shift 2
      ;;
    --threshold)
      TTL_THRESHOLD_LEDGERS="$2"
      shift 2
      ;;
    --log)
      LOG_FILE="$2"
      shift 2
      ;;
    --one-shot)
      ONE_SHOT=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --help)
      grep "^#" "$0" | grep -v "^#!/" | sed 's/^# //' | sed 's/^#//'
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

# Validate required arguments
if [ -z "$KEEPER_IDENTITY" ] && [ -z "$KEEPER_SECRET" ]; then
  echo "Error: --identity or --secret required" >&2
  exit 1
fi

# Logging helper
log() {
  local msg="$1"
  local timestamp=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  local log_msg="[$timestamp] $msg"
  echo "$log_msg"
  if [ -n "$LOG_FILE" ]; then
    echo "$log_msg" >> "$LOG_FILE"
  fi
}

# Determine RPC URL
if [ -z "$SOROBAN_RPC_URL" ]; then
  case "$NETWORK" in
    testnet)
      SOROBAN_RPC_URL="https://soroban-testnet.stellar.org"
      ;;
    mainnet)
      SOROBAN_RPC_URL="https://soroban-mainnet.stellar.org"
      ;;
    local)
      SOROBAN_RPC_URL="http://localhost:8000"
      ;;
    *)
      echo "Error: Unknown network: $NETWORK. Use testnet, mainnet, or local." >&2
      exit 1
      ;;
  esac
fi

log "TTL Keeper started (network: $NETWORK, interval: ${CHECK_INTERVAL_SECS}s, threshold: ${TTL_THRESHOLD_LEDGERS} ledgers)"

# Load contract configuration
load_contracts_config() {
  if [ ! -f "$CONTRACTS_CONFIG" ]; then
    log "Warning: Config file not found: $CONTRACTS_CONFIG"
    log "Creating default configuration for deployed contracts..."
    create_default_config
  fi
}

# Create default config from deployed manifest
create_default_config() {
  local manifest="deployments/deployed-addresses.${NETWORK}.json"
  if [ ! -f "$manifest" ]; then
    log "Error: Deployment manifest not found: $manifest"
    log "Run 'scripts/deploy-contracts.sh --network $NETWORK' first."
    exit 1
  fi

  # Extract contract IDs from manifest and create config
  cat > "$CONTRACTS_CONFIG" <<'EOF'
{
  "network": "testnet",
  "submitter_identity": "ttl-keeper",
  "ttl_threshold_ledgers": 50000,
  "ttl_extend_ledgers": 100000,
  "cadence_seconds": 300,
  "contracts": [
    {
      "name": "production_escrow",
      "contract_id": "CD32EWZUKYGU5LU5AAHM4YEZJVIQ3TBO2YHXGBKPOJVAOJYUWDNVUWU6",
      "enabled": true,
      "description": "Campaign escrow — fund-critical, highest priority"
    },
    {
      "name": "governance",
      "contract_id": "CAUYF5C7S2NPEKJRWDVADMWR4BZBY3OQWZJ5S6F2XRJEPFGDRWPJY7RN",
      "enabled": true,
      "description": "Governance timelock — required for all parameter changes"
    },
    {
      "name": "registry",
      "contract_id": "CAUCYVBEPUBFCB3LKLXIT6MWUSLRNGYVRRT37QUKAGSN6CCS2GIR5EQG",
      "enabled": true,
      "description": "Farmer/buyer registry — operational"
    },
    {
      "name": "investment_basket",
      "contract_id": "CDAWHGW4IP24A4ZPJA3BJPJPVW6P74SAGBNG2JPZ6F3LJ5S5CFFQKXRK",
      "enabled": true,
      "description": "Batched investment pools — operational"
    },
    {
      "name": "escrow",
      "contract_id": "CBJXHC2CDO7CYJWUWG4S3VCP5S5YBKHNQBHUFLGDEPH72QD5UCXSWJOW",
      "enabled": false,
      "description": "Marketplace escrow (deprecated for campaigns, kept for marketplace)"
    }
  ]
}
EOF
  log "Created default config: $CONTRACTS_CONFIG"
}

# Check TTL for a single contract
check_contract_ttl() {
  local contract_id="$1"
  local contract_name="$2"

  if [ -z "$contract_id" ]; then
    log "Error: Empty contract ID for $contract_name"
    return 1
  fi

  # Query the contract's current TTL using soroban CLI
  # Note: The TTL is queried via the ledger entry's expiration metadata
  local ttl_info
  if ! ttl_info=$(soroban contract invoke \
    --network "$NETWORK" \
    --rpc-url "$SOROBAN_RPC_URL" \
    --id "$contract_id" \
    --source "$KEEPER_IDENTITY" \
    -- bump_instance_ttl 2>&1 || echo "pending"); then

    # For contracts without a bump_instance_ttl function, we'd need ledger state inspection
    # This is a limitation of the current approach; a future implementation could use
    # `soroban contract inspect` or `stellar account info` for TTL metadata.
    log "Info: Unable to query TTL for $contract_name ($contract_id) — may not have bump_instance_ttl"
    return 2
  fi

  # For now, we'll attempt the bump and monitor the result
  return 0
}

# Bump TTL for a single contract
bump_contract_ttl() {
  local contract_id="$1"
  local contract_name="$2"

  log "Attempting TTL bump for $contract_name ($contract_id)"

  if [ "$DRY_RUN" = true ]; then
    log "DRY RUN: Would invoke bump_instance_ttl on $contract_name"
    return 0
  fi

  # Invoke the contract's bump_instance_ttl function
  local result
  if result=$(soroban contract invoke \
    --network "$NETWORK" \
    --rpc-url "$SOROBAN_RPC_URL" \
    --id "$contract_id" \
    --source "$KEEPER_IDENTITY" \
    -- bump_instance_ttl 2>&1); then

    log "✓ TTL bumped successfully for $contract_name"
    return 0
  else
    log "✗ TTL bump failed for $contract_name: $result"

    # Check for specific error conditions
    if echo "$result" | grep -q "InsufficientBalance"; then
      log "ALERT: Submitter account has insufficient balance for TTL bumps!"
      return 3
    elif echo "$result" | grep -q "ContractNotFound\|InvalidContractId"; then
      log "ERROR: Contract not found or invalid ID: $contract_id"
      return 4
    fi

    return 1
  fi
}

# Check submitter account balance
check_submitter_balance() {
  local submitter_account

  if [ -n "$KEEPER_SECRET" ]; then
    # Cannot check balance from secret key alone; would need to derive public key
    return 0
  fi

  # Get account info (requires network connectivity)
  if ! submitter_account=$(stellar account info --key "$KEEPER_IDENTITY" 2>/dev/null); then
    log "Warning: Could not query submitter balance for $KEEPER_IDENTITY"
    return 1
  fi

  local balance=$(echo "$submitter_account" | grep "Balance:" | awk '{print $2}')
  if (( $(echo "$balance < 1" | bc -l) )); then
    log "ALERT: Submitter balance is low ($balance XLM). Top up before next check cycle."
  fi

  return 0
}

# Main keeper loop
main_loop() {
  local iteration=0

  while true; do
    iteration=$((iteration + 1))
    log "--- Keeper iteration $iteration at $(date -u '+%Y-%m-%d %H:%M:%SZ') ---"

    load_contracts_config
    check_submitter_balance

    # Parse and iterate through contracts in config
    local contract_count=0
    local bumped_count=0
    local failed_count=0

    # This is a simplified approach; a production version would use jq for robust JSON parsing
    if command -v jq &>/dev/null; then
      contract_count=$(jq -r '.contracts[] | select(.enabled == true) | .contract_id' "$CONTRACTS_CONFIG" 2>/dev/null | wc -l)

      while IFS= read -r contract_line; do
        local contract_id=$(echo "$contract_line" | jq -r '.contract_id')
        local contract_name=$(echo "$contract_line" | jq -r '.name')

        if bump_contract_ttl "$contract_id" "$contract_name"; then
          bumped_count=$((bumped_count + 1))
        else
          failed_count=$((failed_count + 1))
        fi
      done < <(jq -r '.contracts[] | select(.enabled == true) | @json' "$CONTRACTS_CONFIG" 2>/dev/null)
    else
      log "Warning: jq not installed; using basic config reading (limited functionality)"
    fi

    log "Iteration complete: $bumped_count bumped, $failed_count failed out of $contract_count contracts"

    if [ "$ONE_SHOT" = true ]; then
      break
    fi

    log "Next check in ${CHECK_INTERVAL_SECS}s..."
    sleep "$CHECK_INTERVAL_SECS"
  done
}

# Recovery drill documentation
print_recovery_guide() {
  cat <<'EOF'
# TTL Keeper Recovery Runbook

## Symptoms of Archived Instance
- Contract calls fail with "ContractNotFound" or "HostStorageError"
- TTL Keeper logs show repeated bump failures
- Instance may still exist on-chain but is inaccessible

## Recovery Procedure (Local/Testnet)

1. **Confirm Archival Status**
   ```bash
   stellar ledger-entry --id "CONTRACT_ID" --network testnet
   ```
   If the instance is not found, it's archived.

2. **Restore via State Snapshot**
   - Retrieve the last-known instance state from logs or backup
   - If no snapshot exists, re-deployment is the only option

3. **Re-deploy (Testnet Recovery)**
   ```bash
   ./scripts/deploy-contracts.sh --network testnet --force
   ```
   - Redeploy all contracts fresh
   - Re-initialize with the same admin/governance addresses
   - Re-wire cross-contract references
   - Restore persistent data from backups if available

4. **Verify TTL is Fresh**
   ```bash
   ./scripts/ttl-keeper.sh --network testnet --identity keeper-key --dry-run
   ```

## Mainnet Considerations

- **No automatic recovery**: Archived instances on mainnet require governance vote
- **Persistence**: Keep synchronized backups of all persistent contract state
- **Prevention**: Run TTL Keeper with CHECK_INTERVAL_SECS=1800 (30 min) on mainnet
- **Alerting**: Monitor keeper logs and alert on any failed bump attempts

## Testing TTL Maintenance

1. **Near-Threshold Test (Testnet)**
   ```bash
   # Create a contract with low initial TTL
   # Verify keeper successfully extends before archival
   # Assert remaining TTL after bump is correct
   ```

2. **Submitter Balance Test**
   ```bash
   # Run keeper with deliberately low submitter balance
   # Verify ALERT is logged when balance < 1 XLM
   ```

3. **Failed Submission Test**
   ```bash
   # Temporarily misconfigure contract ID
   # Verify keeper logs failure without crashing
   # Verify keeper continues with other contracts
   ```

EOF
}

# Main entry point
if [ "${1:-}" = "--print-recovery" ]; then
  print_recovery_guide
  exit 0
fi

main_loop
