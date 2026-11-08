#!/usr/bin/env bash
# Regression test suite for Issue #1283:
# - Rejects single-key configuration
# - Rejects multi-signer configuration where one signer alone satisfies med/high threshold
# - Rejects deadlocked threshold where total weight < threshold
# - Rejects malformed or unavailable account lookups before any mainnet write
# - Rejects missing ADMIN/GUARDIAN, ADMIN==DEPLOYER, or secret-key env vars on mainnet
# - Accepts verified 2-of-3 multisig configuration for all privileged roles
# - Verifies contract-account authority (C...) support when ALLOW_CONTRACT_ROLE_AUTH=true and get_quorum >= 2

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/deploy-contracts.sh"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/scripts" "$TMP_DIR/fixtures" "$TMP_DIR/deployments"
cp "$SCRIPT" "$TMP_DIR/scripts/deploy-contracts.sh"
chmod +x "$TMP_DIR/scripts/deploy-contracts.sh"

# Public addresses (valid 56-char G... / C... base32 format)
DEPLOYER_PUB="GDEPLOYER22222222222222222222222222222222222222222222222"
VALID_ADMIN="GADMIN2OF32222222222222222222222222222222222222222222222"
VALID_GUARDIAN="GGUARD2OF32222222222222222222222222222222222222222222222"
SINGLE_KEY="GSINGLEKEY2222222222222222222222222222222222222222222222"
WEAK_MULTISIG="GWEAKMULTI2222222222222222222222222222222222222222222222"
DEADLOCKED="GDEADLOCK22222222222222222222222222222222222222222222222"
MALFORMED="GMALFORMED2222222222222222222222222222222222222222222222"
UNAVAILABLE="GUNAVAILAB2222222222222222222222222222222222222222222222"
CONTRACT_AUTH="CCONTRACTA2222222222222222222222222222222222222222222222"

# 1. Valid 2-of-3 fixture (3 signers weight=1, master weight=0, med=2, high=2)
cat > "$TMP_DIR/fixtures/${VALID_ADMIN}.json" <<JSON
{
  "id": "$VALID_ADMIN",
  "thresholds": { "low_threshold": 1, "med_threshold": 2, "high_threshold": 2 },
  "signers": [
    { "key": "$VALID_ADMIN", "weight": 0, "type": "ed25519_public_key" },
    { "key": "GSIGNERA222222222222222222222222222222222222222222222222", "weight": 1, "type": "ed25519_public_key" },
    { "key": "GSIGNERB222222222222222222222222222222222222222222222222", "weight": 1, "type": "ed25519_public_key" },
    { "key": "GSIGNERC222222222222222222222222222222222222222222222222", "weight": 1, "type": "ed25519_public_key" }
  ]
}
JSON
cp "$TMP_DIR/fixtures/${VALID_ADMIN}.json" "$TMP_DIR/fixtures/${VALID_GUARDIAN}.json"

# 2. Single-key fixture
cat > "$TMP_DIR/fixtures/${SINGLE_KEY}.json" <<JSON
{
  "id": "$SINGLE_KEY",
  "thresholds": { "low_threshold": 0, "med_threshold": 0, "high_threshold": 0 },
  "signers": [
    { "key": "$SINGLE_KEY", "weight": 1, "type": "ed25519_public_key" }
  ]
}
JSON

# 3. Weak multi-signer fixture (3 signers, but one signer has weight 2 which alone meets med_threshold=2)
cat > "$TMP_DIR/fixtures/${WEAK_MULTISIG}.json" <<JSON
{
  "id": "$WEAK_MULTISIG",
  "thresholds": { "low_threshold": 1, "med_threshold": 2, "high_threshold": 2 },
  "signers": [
    { "key": "$WEAK_MULTISIG", "weight": 2, "type": "ed25519_public_key" },
    { "key": "GSIGNERA222222222222222222222222222222222222222222222222", "weight": 1, "type": "ed25519_public_key" },
    { "key": "GSIGNERB222222222222222222222222222222222222222222222222", "weight": 1, "type": "ed25519_public_key" }
  ]
}
JSON

# 4. Deadlocked fixture (total weight 2 < high_threshold 3)
cat > "$TMP_DIR/fixtures/${DEADLOCKED}.json" <<JSON
{
  "id": "$DEADLOCKED",
  "thresholds": { "low_threshold": 1, "med_threshold": 2, "high_threshold": 3 },
  "signers": [
    { "key": "GSIGNERA222222222222222222222222222222222222222222222222", "weight": 1, "type": "ed25519_public_key" },
    { "key": "GSIGNERB222222222222222222222222222222222222222222222222", "weight": 1, "type": "ed25519_public_key" }
  ]
}
JSON

# 5. Malformed fixture
printf '{"id":"%s","thresholds":"invalid"}' "$MALFORMED" > "$TMP_DIR/fixtures/${MALFORMED}.json"

MOCK_CLI="$TMP_DIR/mock-stellar.sh"
cat > "$MOCK_CLI" << 'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "${MOCK_LOG_FILE:?}"
if [[ "$1" == "keys" && "$2" == "address" ]]; then
    echo "${MOCK_DEPLOYER_PUB:?}"
    exit 0
fi
if [[ "$1" == "contract" && "$2" == "invoke" ]]; then
    while [[ $# -gt 0 && "$1" != "--" ]]; do shift; done
    shift || true
    fn="${1:-}"
    case "$fn" in
        get_quorum)
            echo "${MOCK_CONTRACT_QUORUM:-2}"
            ;;
        get_admin)
            echo "\"${ADMIN}\""
            ;;
        get_guardian)
            echo "\"${GUARDIAN}\""
            ;;
        get_registry_contract)
            echo "\"C_REGISTRY\""
            ;;
        get_governance_contract)
            echo "\"C_GOV\""
            ;;
        get_contract_refs)
            echo '{"escrow_contract":"C_ESCROW","production_contract":"C_PROD_ESCROW"}'
            ;;
        *)
            echo "ok"
            ;;
    esac
    exit 0
fi
EOF
chmod +x "$MOCK_CLI"

cat > "$TMP_DIR/deployments/deployed-addresses.mainnet.json" <<JSON
{
  "network": "mainnet",
  "updated": "",
  "contracts": {
    "governance": { "id": "C_GOV", "initialized": true },
    "escrow": { "id": "C_ESCROW", "initialized": true },
    "production_escrow": { "id": "C_PROD_ESCROW", "initialized": true },
    "registry": { "id": "C_REGISTRY", "initialized": true },
    "investment_basket": { "id": "C_BASKET", "initialized": true }
  },
  "wiring": {}
}
JSON

export DEPLOYER="deployer-id"
export MOCK_DEPLOYER_PUB="$DEPLOYER_PUB"
export FEE_COLLECTOR="GFEECOLLECTOR2222222222222222222222222222222222222222222"
export SUPPORTED_TOKENS="CTOKEN1,CTOKEN2"
export STELLAR_CLI="$MOCK_CLI"
export ACCOUNT_FIXTURE_DIR="$TMP_DIR/fixtures"
export MOCK_LOG_FILE="$TMP_DIR/cli.log"

run_expect_fail() {
    local label="$1"; shift
    : > "$MOCK_LOG_FILE"
    if env "$@" "$TMP_DIR/scripts/deploy-contracts.sh" --network mainnet --verify-only >/dev/null 2>&1; then
        echo "FAIL: $label unexpectedly succeeded" >&2
        exit 1
    fi
    if grep -q "contract install\|contract deploy" "$MOCK_LOG_FILE"; then
        echo "FAIL: $label invoked install/deploy before failing" >&2
        exit 1
    fi
    echo "  PASS ($label rejected)"
}

echo "=== 1. Rejects missing ADMIN or GUARDIAN on mainnet ==="
run_expect_fail "missing ADMIN" ADMIN="" GUARDIAN="$VALID_GUARDIAN"
run_expect_fail "missing GUARDIAN" ADMIN="$VALID_ADMIN" GUARDIAN=""

echo "=== 2. Rejects ADMIN == DEPLOYER on mainnet ==="
run_expect_fail "ADMIN == DEPLOYER" ADMIN="$DEPLOYER_PUB" GUARDIAN="$VALID_GUARDIAN"

echo "=== 3. Rejects single-key ADMIN or GUARDIAN ==="
run_expect_fail "single-key ADMIN" ADMIN="$SINGLE_KEY" GUARDIAN="$VALID_GUARDIAN"
run_expect_fail "single-key GUARDIAN" ADMIN="$VALID_ADMIN" GUARDIAN="$SINGLE_KEY"

echo "=== 4. Rejects multi-signer where one signer alone meets threshold ==="
run_expect_fail "weak multi-signer ADMIN" ADMIN="$WEAK_MULTISIG" GUARDIAN="$VALID_GUARDIAN"
run_expect_fail "weak multi-signer GUARDIAN" ADMIN="$VALID_ADMIN" GUARDIAN="$WEAK_MULTISIG"

echo "=== 5. Rejects deadlocked, malformed, and unavailable account lookups ==="
run_expect_fail "deadlocked threshold" ADMIN="$DEADLOCKED" GUARDIAN="$VALID_GUARDIAN"
run_expect_fail "malformed account JSON" ADMIN="$MALFORMED" GUARDIAN="$VALID_GUARDIAN"
run_expect_fail "unavailable account lookup" ADMIN="$UNAVAILABLE" GUARDIAN="$VALID_GUARDIAN"

echo "=== 6. Accepts verified 2-of-3 multisig for ADMIN and GUARDIAN ==="
: > "$MOCK_LOG_FILE"
ADMIN="$VALID_ADMIN" GUARDIAN="$VALID_GUARDIAN" "$TMP_DIR/scripts/deploy-contracts.sh" --network mainnet --verify-only >/dev/null
echo "  PASS (verified 2-of-3 accepted)"

echo "=== 7. Contract-account role requires ALLOW_CONTRACT_ROLE_AUTH=true and on-chain quorum >= 2 ==="
run_expect_fail "contract-account without ALLOW_CONTRACT_ROLE_AUTH" ADMIN="$CONTRACT_AUTH" GUARDIAN="$VALID_GUARDIAN" ALLOW_CONTRACT_ROLE_AUTH="false"
run_expect_fail "contract-account with quorum=1" ADMIN="$CONTRACT_AUTH" GUARDIAN="$VALID_GUARDIAN" ALLOW_CONTRACT_ROLE_AUTH="true" MOCK_CONTRACT_QUORUM="1"
ADMIN="$CONTRACT_AUTH" GUARDIAN="$VALID_GUARDIAN" ALLOW_CONTRACT_ROLE_AUTH="true" MOCK_CONTRACT_QUORUM="2" "$TMP_DIR/scripts/deploy-contracts.sh" --network mainnet --verify-only >/dev/null
echo "  PASS (verified contract-account authority accepted)"

echo "✅ All Issue #1283 effective multisig custody tests passed."
