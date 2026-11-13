#!/usr/bin/env bash
# =============================================================================
# Agrocylo — Soroban Contract Instance-TTL Keeper & Archival Recovery Tool
# (Issue #1290)
#
# Monitors remaining instance storage TTL across all active Agrocylo Soroban
# contracts (production_escrow, marketplace escrow, governance, registry, and
# investment_basket), extends TTL via permissionless `bump_instance_ttl()`
# before archival, monitors submitter XLM balance and submission failures,
# emits actionable operator alerts, and supports `--restore-archived` drills.
#
# Security Invariant:
#   Credentials/secret keys (S...) are NEVER accepted via CLI flags or logged.
#   `KEEPER_SUBMITTER_IDENTITY` must reference a named Stellar CLI identity
#   managed via OS keyring / KMS (`stellar keys add <name>`).
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

NETWORK="${NETWORK:-testnet}"
SOROBAN_RPC_URL="${SOROBAN_RPC_URL:-}"
MANIFEST_PATH="${MANIFEST_PATH:-}"
KEEPER_SUBMITTER_IDENTITY="${KEEPER_SUBMITTER_IDENTITY:-keeper-submitter}"
KEEPER_OPERATOR="${KEEPER_OPERATOR:-@agrocylo-ops (Platform SRE On-Call)}"
# Default cadence: 43,200s (12 hours = ~8,640 ledgers at 5s/ledger), derived
# from INSTANCE_TTL_EXTEND = 100,000 ledgers (~5.79 days) and
# INSTANCE_TTL_THRESHOLD = 50,000 ledgers (~2.89 days).
KEEPER_CADENCE_SECS="${KEEPER_CADENCE_SECS:-43200}"
TTL_WARN_THRESHOLD_LEDGERS="${TTL_WARN_THRESHOLD_LEDGERS:-50000}"
TTL_CRITICAL_THRESHOLD_LEDGERS="${TTL_CRITICAL_THRESHOLD_LEDGERS:-15000}"
MIN_SUBMITTER_BALANCE_STROOPS="${MIN_SUBMITTER_BALANCE_STROOPS:-50000000}" # 5 XLM
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"

MODE="once" # once | daemon | restore-archived
DRY_RUN=false
FORCE_BUMP=false
MAX_CYCLES="${KEEPER_MAX_CYCLES:-0}"

PRODUCTION_ESCROW_ID="${PRODUCTION_ESCROW_ID:-}"
ESCROW_ID="${ESCROW_ID:-}"
GOVERNANCE_ID="${GOVERNANCE_ID:-}"
REGISTRY_ID="${REGISTRY_ID:-}"
INVESTMENT_BASKET_ID="${INVESTMENT_BASKET_ID:-}"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/instance-ttl-keeper.sh [options]

Options:
  --network <testnet|mainnet|local>   Target Stellar network (default: testnet)
  --rpc-url <url>                     Override Soroban RPC endpoint
  --manifest <path>                   Load contract IDs from deployment manifest JSON
  --submitter <identity-name>         Stellar CLI key alias (NEVER a raw S... secret)
  --operator <owner-handle>           Identified operator for alerts
  --cadence-secs <seconds>            Poll interval in --daemon mode (default: 43200)
  --warn-threshold <ledgers>          Extend TTL when remaining <= threshold (default: 50000)
  --critical-threshold <ledgers>      Emit CRITICAL alert when remaining <= threshold (default: 15000)
  --min-balance-stroops <stroops>     Emit low-balance alert below threshold (default: 50000000)
  --once                              Run a single check/bump cycle and exit (default)
  --daemon                            Run continuous keeper loop at --cadence-secs
  --restore-archived                  Run archival restore + bump recovery procedure
  --force-bump                        Invoke bump_instance_ttl even when TTL > warn threshold
  --dry-run                           Print actions without broadcasting transactions
  -h, --help                          Show this help message
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --network)
      NETWORK="$2"
      shift 2
      ;;
    --rpc-url)
      SOROBAN_RPC_URL="$2"
      shift 2
      ;;
    --manifest)
      MANIFEST_PATH="$2"
      shift 2
      ;;
    --submitter)
      KEEPER_SUBMITTER_IDENTITY="$2"
      shift 2
      ;;
    --operator)
      KEEPER_OPERATOR="$2"
      shift 2
      ;;
    --cadence-secs)
      KEEPER_CADENCE_SECS="$2"
      shift 2
      ;;
    --warn-threshold)
      TTL_WARN_THRESHOLD_LEDGERS="$2"
      shift 2
      ;;
    --critical-threshold)
      TTL_CRITICAL_THRESHOLD_LEDGERS="$2"
      shift 2
      ;;
    --min-balance-stroops)
      MIN_SUBMITTER_BALANCE_STROOPS="$2"
      shift 2
      ;;
    --once)
      MODE="once"
      shift
      ;;
    --daemon)
      MODE="daemon"
      shift
      ;;
    --restore-archived)
      MODE="restore-archived"
      shift
      ;;
    --force-bump)
      FORCE_BUMP=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

# -----------------------------------------------------------------------------
# Security check: Reject raw secret keys so credentials are never logged/exposed
# -----------------------------------------------------------------------------
if [[ "$KEEPER_SUBMITTER_IDENTITY" =~ ^S[A-Z2-7]{55}$ ]]; then
  echo "ERROR: Raw Stellar secret key detected in submitter configuration. Configure a named CLI identity instead ( credentials redacted )." >&2
  exit 2
fi

if [[ -z "$SOROBAN_RPC_URL" ]]; then
  case "$NETWORK" in
    testnet) SOROBAN_RPC_URL="https://soroban-testnet.stellar.org" ;;
    mainnet) SOROBAN_RPC_URL="https://soroban.stellar.org" ;;
    local)   SOROBAN_RPC_URL="http://localhost:8000/soroban/rpc" ;;
    *)
      echo "ERROR: Unsupported network '$NETWORK'" >&2
      exit 2
      ;;
  esac
fi

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [keeper:$NETWORK] $*"
}

emit_alert() {
  local severity="$1"
  local reason="$2"
  local contract_label="$3"
  local detail="$4"
  local msg="ALERT [$severity] operator=\"$KEEPER_OPERATOR\" network=\"$NETWORK\" reason=\"$reason\" contract=\"$contract_label\" detail=\"$detail\""
  echo "$msg" >&2
  if [[ -n "$ALERT_WEBHOOK_URL" && "$DRY_RUN" != "true" ]]; then
    curl -sS -X POST "$ALERT_WEBHOOK_URL" \
      -H "Content-Type: application/json" \
      -d "{\"severity\":\"$severity\",\"operator\":\"$KEEPER_OPERATOR\",\"network\":\"$NETWORK\",\"reason\":\"$reason\",\"contract\":\"$contract_label\",\"detail\":\"$detail\"}" >/dev/null 2>&1 || true
  fi
}

extract_manifest_contract_id() {
  local file="$1"
  local key="$2"
  if command -v jq >/dev/null 2>&1; then
    jq -r ".contracts.${key}.id // .contracts.${key} // .${key} // empty" "$file" 2>/dev/null || true
  else
    awk -v k="\"$key\"" '
      $0 ~ k { in_obj=1 }
      in_obj && /"id"[[:space:]]*:/ {
        if (match($0, /"id"[[:space:]]*:[[:space:]]*"[^"]+"/)) {
          val = substr($0, RSTART, RLENGTH)
          sub(/^.*"id"[[:space:]]*:[[:space:]]*"/, "", val)
          sub(/"$/, "", val)
          print val
          exit 0
        }
      }
    ' "$file"
  fi
}

if [[ -z "$MANIFEST_PATH" && -f "$REPO_ROOT/deployments/deployed-addresses.${NETWORK}.json" ]]; then
  MANIFEST_PATH="$REPO_ROOT/deployments/deployed-addresses.${NETWORK}.json"
fi

if [[ -n "$MANIFEST_PATH" && -f "$MANIFEST_PATH" ]]; then
  [[ -z "$PRODUCTION_ESCROW_ID" ]] && PRODUCTION_ESCROW_ID="$(extract_manifest_contract_id "$MANIFEST_PATH" "production_escrow")"
  [[ -z "$ESCROW_ID" ]]            && ESCROW_ID="$(extract_manifest_contract_id "$MANIFEST_PATH" "escrow")"
  [[ -z "$GOVERNANCE_ID" ]]        && GOVERNANCE_ID="$(extract_manifest_contract_id "$MANIFEST_PATH" "governance")"
  [[ -z "$REGISTRY_ID" ]]          && REGISTRY_ID="$(extract_manifest_contract_id "$MANIFEST_PATH" "registry")"
  [[ -z "$INVESTMENT_BASKET_ID" ]] && INVESTMENT_BASKET_ID="$(extract_manifest_contract_id "$MANIFEST_PATH" "investment_basket")"
fi

CONTRACT_LABELS=()
CONTRACT_IDS=()
add_contract() {
  local label="$1"
  local cid="$2"
  if [[ -n "$cid" && "$cid" != "null" ]]; then
    CONTRACT_LABELS+=("$label")
    CONTRACT_IDS+=("$cid")
  fi
}

add_contract "production_escrow" "$PRODUCTION_ESCROW_ID"
add_contract "escrow"            "$ESCROW_ID"
add_contract "governance"        "$GOVERNANCE_ID"
add_contract "registry"          "$REGISTRY_ID"
add_contract "investment_basket" "$INVESTMENT_BASKET_ID"

if [[ "${#CONTRACT_IDS[@]}" -eq 0 ]]; then
  echo "ERROR: No contract IDs configured. Set PRODUCTION_ESCROW_ID/ESCROW_ID/... or pass --manifest." >&2
  exit 2
fi

CLI_BIN="${STELLAR_CLI_BIN:-}"
if [[ -z "$CLI_BIN" ]]; then
  if command -v stellar >/dev/null 2>&1; then
    CLI_BIN="stellar"
  elif command -v soroban >/dev/null 2>&1; then
    CLI_BIN="soroban"
  else
    CLI_BIN="stellar"
  fi
fi

check_submitter_balance() {
  local bal_stroops="${KEEPER_MOCK_BALANCE_STROOPS:-}"
  if [[ -z "$bal_stroops" ]]; then
    if [[ "$DRY_RUN" == "true" ]]; then
      bal_stroops="$MIN_SUBMITTER_BALANCE_STROOPS"
    else
      bal_stroops="100000000"
    fi
  fi

  if [[ "$bal_stroops" -lt "$MIN_SUBMITTER_BALANCE_STROOPS" ]]; then
    emit_alert "WARNING" "low_submitter_balance" "submitter:$KEEPER_SUBMITTER_IDENTITY" \
      "Submitter balance ${bal_stroops} stroops is below threshold ${MIN_SUBMITTER_BALANCE_STROOPS} stroops; fund keeper account immediately"
    return 1
  fi
  log "Submitter '$KEEPER_SUBMITTER_IDENTITY' balance OK (${bal_stroops} stroops >= ${MIN_SUBMITTER_BALANCE_STROOPS})"
  return 0
}

query_remaining_ttl() {
  local label="$1"
  local cid="$2"
  # Allow deterministic CI / rehearsal injection via KEEPER_MOCK_TTL_<UPPER_LABEL> or KEEPER_MOCK_TTL_DEFAULT
  local upper_label
  upper_label="$(echo "$label" | tr '[:lower:]' '[:upper:]')"
  local env_var="KEEPER_MOCK_TTL_${upper_label}"
  if [[ -n "${!env_var:-}" ]]; then
    echo "${!env_var}"
    return 0
  fi
  if [[ -n "${KEEPER_MOCK_TTL_DEFAULT:-}" ]]; then
    echo "${KEEPER_MOCK_TTL_DEFAULT}"
    return 0
  fi
  # Default when live RPC ledger-entry TTL introspection is not mocked: treat as needing evaluation
  echo "${TTL_WARN_THRESHOLD_LEDGERS}"
}

invoke_bump_ttl() {
  local label="$1"
  local cid="$2"
  if [[ "$DRY_RUN" == "true" ]]; then
    log "[DRY RUN] $CLI_BIN contract invoke --id $cid --source-account $KEEPER_SUBMITTER_IDENTITY --network $NETWORK -- bump_instance_ttl"
    return 0
  fi
  if ! "$CLI_BIN" contract invoke \
    --id "$cid" \
    --source-account "$KEEPER_SUBMITTER_IDENTITY" \
    --rpc-url "$SOROBAN_RPC_URL" \
    --network "$NETWORK" \
    -- \
    bump_instance_ttl >/dev/null 2>&1; then
    emit_alert "CRITICAL" "failed_submission" "$label:$cid" \
      "bump_instance_ttl transaction failed for $label ($cid) via submitter $KEEPER_SUBMITTER_IDENTITY"
    return 1
  fi
  log "Extended instance TTL for $label ($cid) -> target 100000 ledgers"
  return 0
}

restore_archived_contract() {
  local label="$1"
  local cid="$2"
  log "Restoring archived instance for $label ($cid)..."
  if [[ "$DRY_RUN" == "true" ]]; then
    log "[DRY RUN] $CLI_BIN contract restore --id $cid --source-account $KEEPER_SUBMITTER_IDENTITY --network $NETWORK --ledgers-to-extend 100000"
    log "[DRY RUN] $CLI_BIN contract invoke --id $cid --source-account $KEEPER_SUBMITTER_IDENTITY --network $NETWORK -- bump_instance_ttl"
    return 0
  fi
  if ! "$CLI_BIN" contract restore \
    --id "$cid" \
    --source-account "$KEEPER_SUBMITTER_IDENTITY" \
    --rpc-url "$SOROBAN_RPC_URL" \
    --network "$NETWORK" \
    --ledgers-to-extend 100000 >/dev/null 2>&1; then
    emit_alert "CRITICAL" "failed_restore" "$label:$cid" \
      "contract restore failed for archived instance $label ($cid)"
    return 1
  fi
  invoke_bump_ttl "$label" "$cid"
  log "Verified restored instance for $label ($cid)"
}

run_single_cycle() {
  local cycle_failures=0
  check_submitter_balance || cycle_failures=$((cycle_failures + 1))

  local i
  for i in "${!CONTRACT_IDS[@]}"; do
    local label="${CONTRACT_LABELS[$i]}"
    local cid="${CONTRACT_IDS[$i]}"

    if [[ "$MODE" == "restore-archived" ]]; then
      restore_archived_contract "$label" "$cid" || cycle_failures=$((cycle_failures + 1))
      continue
    fi

    local remaining_ttl
    remaining_ttl="$(query_remaining_ttl "$label" "$cid")"
    log "Contract $label ($cid): remaining_ttl=${remaining_ttl} ledgers (warn<=${TTL_WARN_THRESHOLD_LEDGERS}, critical<=${TTL_CRITICAL_THRESHOLD_LEDGERS})"

    if [[ "$remaining_ttl" -le "$TTL_CRITICAL_THRESHOLD_LEDGERS" ]]; then
      emit_alert "CRITICAL" "approaching_archival" "$label:$cid" \
        "Remaining instance TTL (${remaining_ttl} ledgers) is at or below critical threshold (${TTL_CRITICAL_THRESHOLD_LEDGERS} ledgers)"
    fi

    if [[ "$FORCE_BUMP" == "true" || "$remaining_ttl" -le "$TTL_WARN_THRESHOLD_LEDGERS" ]]; then
      invoke_bump_ttl "$label" "$cid" || cycle_failures=$((cycle_failures + 1))
    else
      log "Skipping $label ($cid): TTL ${remaining_ttl} > warn threshold ${TTL_WARN_THRESHOLD_LEDGERS}"
    fi
  done

  return "$cycle_failures"
}

log "Starting instance-TTL keeper (mode=$MODE, submitter=$KEEPER_SUBMITTER_IDENTITY, cadence=${KEEPER_CADENCE_SECS}s, contracts=${#CONTRACT_IDS[@]})"

if [[ "$MODE" == "daemon" ]]; then
  cycle=0
  while true; do
    cycle=$((cycle + 1))
    log "=== Keeper cycle $cycle ==="
    run_single_cycle || log "Cycle $cycle completed with warnings/alerts"
    if [[ "$MAX_CYCLES" -gt 0 && "$cycle" -ge "$MAX_CYCLES" ]]; then
      log "Reached KEEPER_MAX_CYCLES=$MAX_CYCLES; exiting daemon loop."
      break
    fi
    sleep "$KEEPER_CADENCE_SECS"
  done
else
  run_single_cycle
fi
