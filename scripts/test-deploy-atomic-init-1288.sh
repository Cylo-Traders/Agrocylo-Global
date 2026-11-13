#!/usr/bin/env bash
# Regression test matrix for Issue #1288:
# - Mandatory atomic mainnet initialization
# - Rejection of ATOMIC_INIT=false / ATOMIC_INIT_DISABLE=true on mainnet before any mutation
# - Honoring ATOMIC_INIT=true opt-in on testnet/local
# - Ignoring forged/manipulated manifest "initialized": true when on-chain state is uninitialized
# - Resuming verified existing on-chain instances without redeploying

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/deploy-contracts.sh"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Copy script into isolated temp workspace so manifest writes don't touch repo
mkdir -p "$TMP_DIR/scripts" "$TMP_DIR/target/wasm32v1-none/release" "$TMP_DIR/deployments"
cp "$SCRIPT" "$TMP_DIR/scripts/deploy-contracts.sh"
chmod +x "$TMP_DIR/scripts/deploy-contracts.sh"

for w in governance.wasm escrow.wasm production_escrow_v2.wasm registry.wasm investment_basket.wasm; do
    printf 'mock-wasm' > "$TMP_DIR/target/wasm32v1-none/release/$w"
done

MOCK_CLI="$TMP_DIR/mock-stellar.sh"
cat > "$MOCK_CLI" << 'EOF'
#!/usr/bin/env bash
set -euo pipefail
LOG_FILE="${MOCK_LOG_FILE:?}"
ONCHAIN_INIT="${MOCK_ONCHAIN_INIT:-false}"
ADMIN_ADDR="${MOCK_ADMIN_ADDR:-GADMIN11111111111111111111111111111111111111111111111111}"

echo "$*" >> "$LOG_FILE"

if [[ "$1" == "keys" && "$2" == "address" ]]; then
    echo "$ADMIN_ADDR"
    exit 0
fi

if [[ "$1" == "contract" && "$2" == "install" ]]; then
    echo "hash_mock_123456"
    exit 0
fi

if [[ "$1" == "contract" && "$2" == "deploy" ]]; then
    echo "C_DEPLOYED_CONTRACT_ID"
    exit 0
fi

if [[ "$1" == "contract" && "$2" == "invoke" ]]; then
    # Find "--" separator
    while [[ $# -gt 0 && "$1" != "--" ]]; do shift; done
    shift || true
    fn="${1:-}"
    case "$fn" in
        get_admin)
            if [[ "$ONCHAIN_INIT" == "true" ]]; then
                echo "\"$ADMIN_ADDR\""
            else
                echo ""
                exit 1
            fi
            ;;
        get_registry_contract)
            echo "\"C_DEPLOYED_CONTRACT_ID\""
            ;;
        get_governance_contract)
            echo "\"C_DEPLOYED_CONTRACT_ID\""
            ;;
        get_contract_refs)
            echo '{"escrow_contract":"C_DEPLOYED_CONTRACT_ID","production_contract":"C_DEPLOYED_CONTRACT_ID"}'
            ;;
        *)
            echo "ok"
            ;;
    esac
    exit 0
fi
EOF
chmod +x "$MOCK_CLI"

export DEPLOYER="deployer-id"
export ADMIN="GADMIN11111111111111111111111111111111111111111111111111"
export FEE_COLLECTOR="GFEECOLLECTOR1111111111111111111111111111111111111111111"
export SUPPORTED_TOKENS="CTOKEN1,CTOKEN2"
export STELLAR_CLI="$MOCK_CLI"

echo "=== Case 1: Mainnet rejects ATOMIC_INIT_DISABLE=true before any mutation ==="
export MOCK_LOG_FILE="$TMP_DIR/case1.log"
: > "$MOCK_LOG_FILE"
rm -f "$TMP_DIR/deployments/deployed-addresses.mainnet.json"
if ATOMIC_INIT_DISABLE=true "$TMP_DIR/scripts/deploy-contracts.sh" --network mainnet --skip-build 2>/dev/null; then
    echo "FAIL: mainnet allowed ATOMIC_INIT_DISABLE=true" >&2
    exit 1
fi
[[ ! -s "$MOCK_LOG_FILE" ]] || { echo "FAIL: CLI was invoked before mainnet disable rejection" >&2; exit 1; }
[[ ! -f "$TMP_DIR/deployments/deployed-addresses.mainnet.json" ]] || { echo "FAIL: manifest mutated before rejection" >&2; exit 1; }
echo "  PASS"

echo "=== Case 2: Mainnet rejects ATOMIC_INIT=false before any mutation ==="
export MOCK_LOG_FILE="$TMP_DIR/case2.log"
: > "$MOCK_LOG_FILE"
if ATOMIC_INIT=false "$TMP_DIR/scripts/deploy-contracts.sh" --network mainnet --skip-build 2>/dev/null; then
    echo "FAIL: mainnet allowed ATOMIC_INIT=false" >&2
    exit 1
fi
[[ ! -s "$MOCK_LOG_FILE" ]] || { echo "FAIL: CLI was invoked before mainnet ATOMIC_INIT=false rejection" >&2; exit 1; }
echo "  PASS"

echo "=== Case 3: Testnet honors ATOMIC_INIT=true opt-in ==="
export MOCK_LOG_FILE="$TMP_DIR/case3.log"
: > "$MOCK_LOG_FILE"
rm -f "$TMP_DIR/deployments/deployed-addresses.testnet.json"
export MOCK_ONCHAIN_INIT="false"
# Run deploy step; verify --init-fn initialize is passed on testnet when ATOMIC_INIT=true
ATOMIC_INIT=true "$TMP_DIR/scripts/deploy-contracts.sh" --network testnet --skip-build >/dev/null 2>&1 || true
grep -q -- "--init-fn initialize" "$MOCK_LOG_FILE" || { echo "FAIL: testnet ignored ATOMIC_INIT=true" >&2; exit 1; }
echo "  PASS"

echo "=== Case 4: Testnet default uses non-atomic deploy ==="
export MOCK_LOG_FILE="$TMP_DIR/case4.log"
: > "$MOCK_LOG_FILE"
rm -f "$TMP_DIR/deployments/deployed-addresses.testnet.json"
unset ATOMIC_INIT ATOMIC_INIT_DISABLE
"$TMP_DIR/scripts/deploy-contracts.sh" --network testnet --skip-build >/dev/null 2>&1 || true
if grep -q -- "--init-fn initialize" "$MOCK_LOG_FILE"; then
    echo "FAIL: testnet default unexpectedly used --init-fn initialize" >&2
    exit 1
fi
echo "  PASS"

echo "=== Case 5: Manipulated manifest initialized:true on mainnet cannot bypass atomic init when uninitialized on-chain ==="
export MOCK_LOG_FILE="$TMP_DIR/case5.log"
: > "$MOCK_LOG_FILE"
export MOCK_ONCHAIN_INIT="false"
cat > "$TMP_DIR/deployments/deployed-addresses.mainnet.json" <<JSON
{
  "network": "mainnet",
  "updated": "",
  "contracts": {
    "governance": { "id": "C_FORGED_GOV", "initialized": true }
  },
  "wiring": {}
}
JSON
"$TMP_DIR/scripts/deploy-contracts.sh" --network mainnet --skip-build >/dev/null 2>&1 || true
grep -q -- "--init-fn initialize" "$MOCK_LOG_FILE" || { echo "FAIL: forged manifest bypassed mainnet atomic init" >&2; exit 1; }
echo "  PASS"

echo "=== Case 6: Verified existing on-chain deployment on mainnet is reused without redeploy ==="
export MOCK_LOG_FILE="$TMP_DIR/case6.log"
: > "$MOCK_LOG_FILE"
export MOCK_ONCHAIN_INIT="true"
cat > "$TMP_DIR/deployments/deployed-addresses.mainnet.json" <<JSON
{
  "network": "mainnet",
  "updated": "",
  "contracts": {
    "governance": { "id": "C_DEPLOYED_CONTRACT_ID", "initialized": true },
    "escrow": { "id": "C_DEPLOYED_CONTRACT_ID", "initialized": true },
    "production_escrow": { "id": "C_DEPLOYED_CONTRACT_ID", "initialized": true },
    "registry": { "id": "C_DEPLOYED_CONTRACT_ID", "initialized": true },
    "investment_basket": { "id": "C_DEPLOYED_CONTRACT_ID", "initialized": true }
  },
  "wiring": {}
}
JSON
"$TMP_DIR/scripts/deploy-contracts.sh" --network mainnet --skip-build >/dev/null
if grep -q "contract deploy" "$MOCK_LOG_FILE"; then
    echo "FAIL: verified existing deployment was unnecessarily redeployed" >&2
    exit 1
fi
echo "  PASS"

echo "✅ All Issue #1288 atomic initialization matrix tests passed."
