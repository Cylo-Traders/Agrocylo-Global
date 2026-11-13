#!/usr/bin/env bash
# =============================================================================
# Regression Test Suite for Issue #1290:
#   Provide an instance-TTL keeper with expiry monitoring and recovery runbook
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEEPER_SCRIPT="$SCRIPT_DIR/instance-ttl-keeper.sh"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

MOCK_CLI="$TMP_DIR/mock-stellar.sh"
CALL_LOG="$TMP_DIR/calls.log"
MANIFEST_FILE="$TMP_DIR/manifest.json"

cat > "$MANIFEST_FILE" <<'EOF'
{
  "network": "testnet",
  "contracts": {
    "production_escrow": { "id": "CPROD111" },
    "escrow":            { "id": "CESCR222" },
    "governance":        { "id": "CGOV333" },
    "registry":          { "id": "CREG444" },
    "investment_basket": { "id": "CBASK555" }
  }
}
EOF

cat > "$MOCK_CLI" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "$MOCK_CALL_LOG"
if [[ "${MOCK_FAIL_CONTRACT:-}" != "" && "$*" == *"${MOCK_FAIL_CONTRACT}"* ]]; then
  echo "Simulated RPC transaction failure" >&2
  exit 1
fi
exit 0
EOF
chmod +x "$MOCK_CLI"

echo "=== Test 1: Rejects raw secret key without logging secret value ==="
FAKE_SECRET="SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
set +e
SECRET_OUT="$("$KEEPER_SCRIPT" --manifest "$MANIFEST_FILE" --submitter "$FAKE_SECRET" 2>&1)"
SECRET_RC=$?
set -e
if [[ "$SECRET_RC" -eq 0 ]]; then
  echo "FAIL: Expected nonzero exit code when passing raw S... secret key" >&2
  exit 1
fi
if [[ "$SECRET_OUT" == *"$FAKE_SECRET"* ]]; then
  echo "FAIL: Secret key was echoed in output!" >&2
  exit 1
fi

echo "=== Test 2: Near-threshold contracts are extended, healthy contracts skipped ==="
: > "$CALL_LOG"
MOCK_CALL_LOG="$CALL_LOG" \
STELLAR_CLI_BIN="$MOCK_CLI" \
KEEPER_MOCK_TTL_PRODUCTION_ESCROW=42000 \
KEEPER_MOCK_TTL_ESCROW=48000 \
KEEPER_MOCK_TTL_GOVERNANCE=85000 \
KEEPER_MOCK_TTL_REGISTRY=90000 \
KEEPER_MOCK_TTL_INVESTMENT_BASKET=30000 \
"$KEEPER_SCRIPT" \
  --network testnet \
  --manifest "$MANIFEST_FILE" \
  --submitter keeper-bot \
  --warn-threshold 50000 \
  --critical-threshold 15000 \
  --once

grep -q "CPROD111.*bump_instance_ttl" "$CALL_LOG"
grep -q "CESCR222.*bump_instance_ttl" "$CALL_LOG"
grep -q "CBASK555.*bump_instance_ttl" "$CALL_LOG"
if grep -q "CGOV333" "$CALL_LOG" || grep -q "CREG444" "$CALL_LOG"; then
  echo "FAIL: Healthy contracts above warn threshold should not have been bumped" >&2
  exit 1
fi

echo "=== Test 3: Actionable alerts with identified operator on critical TTL, low balance, and failed submission ==="
: > "$CALL_LOG"
set +e
ALERT_OUT="$(
  MOCK_CALL_LOG="$CALL_LOG" \
  STELLAR_CLI_BIN="$MOCK_CLI" \
  MOCK_FAIL_CONTRACT="CGOV333" \
  KEEPER_MOCK_BALANCE_STROOPS=10000000 \
  KEEPER_MOCK_TTL_DEFAULT=12000 \
  "$KEEPER_SCRIPT" \
    --network testnet \
    --manifest "$MANIFEST_FILE" \
    --submitter keeper-bot \
    --operator "@agrocylo-sre-oncall" \
    --min-balance-stroops 50000000 \
    --warn-threshold 50000 \
    --critical-threshold 15000 \
    --once 2>&1
)"
ALERT_RC=$?
set -e
if [[ "$ALERT_RC" -eq 0 ]]; then
  echo "FAIL: Expected nonzero exit code when balance is low or submission fails" >&2
  exit 1
fi
echo "$ALERT_OUT" | grep -q 'operator="@agrocylo-sre-oncall"'
echo "$ALERT_OUT" | grep -q 'reason="low_submitter_balance"'
echo "$ALERT_OUT" | grep -q 'reason="approaching_archival"'
echo "$ALERT_OUT" | grep -q 'reason="failed_submission"'

echo "=== Test 4: Inactivity rehearsal across multiple daemon cycles ==="
: > "$CALL_LOG"
MOCK_CALL_LOG="$CALL_LOG" \
STELLAR_CLI_BIN="$MOCK_CLI" \
KEEPER_MAX_CYCLES=3 \
KEEPER_MOCK_TTL_DEFAULT=40000 \
"$KEEPER_SCRIPT" \
  --network testnet \
  --manifest "$MANIFEST_FILE" \
  --submitter keeper-bot \
  --cadence-secs 0 \
  --daemon

BUMP_COUNT="$(grep -c "bump_instance_ttl" "$CALL_LOG")"
if [[ "$BUMP_COUNT" -ne 15 ]]; then
  echo "FAIL: Expected 15 bump_instance_ttl invocations across 3 cycles x 5 contracts, got $BUMP_COUNT" >&2
  exit 1
fi

echo "=== Test 5: Local/Testnet archival restore drill (--restore-archived) ==="
: > "$CALL_LOG"
MOCK_CALL_LOG="$CALL_LOG" \
STELLAR_CLI_BIN="$MOCK_CLI" \
"$KEEPER_SCRIPT" \
  --network testnet \
  --manifest "$MANIFEST_FILE" \
  --submitter keeper-bot \
  --restore-archived

grep -q "contract restore --id CPROD111" "$CALL_LOG"
grep -q "contract invoke --id CPROD111 .* bump_instance_ttl" "$CALL_LOG"
grep -q "contract restore --id CESCR222" "$CALL_LOG"

echo "PASS: All Issue #1290 instance-TTL keeper & restore drill tests succeeded."
