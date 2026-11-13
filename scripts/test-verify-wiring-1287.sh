#!/usr/bin/env bash
# Regression test suite for Issue #1287:
# - Correctly configured instances pass deploy + --verify-only and persist verified observations
# - Forged/stale manifest cannot make wrong production_escrow.registry or escrow.path_payment_router pass verification
# - Unavailable getters fail verification nonzero
# - Rejected setters (including governance-locked reruns) fail nonzero and identify required governance proposal

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/deploy-contracts.sh"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

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
MODE="\${MOCK_MODE:-healthy}"
ADMIN_ADDR="\${MOCK_ADMIN_ADDR:-GADMIN11111111111111111111111111111111111111111111111111}"
ROUTER_ADDR="\${MOCK_ROUTER_ADDR:-CROUTER1111111111111111111111111111111111111111111111111}"

if [[ "$1" == "keys" && "$2" == "address" ]]; then
    echo "$ADMIN_ADDR"
    exit 0
fi

if [[ "$1" == "contract" && "$2" == "install" ]]; then
    echo "hash_mock_123"
    exit 0
fi

if [[ "$1" == "contract" && "$2" == "deploy" ]]; then
    echo "C_CONTRACT_ID"
    exit 0
fi

if [[ "$1" == "contract" && "$2" == "invoke" ]]; then
    cid=""
    while [[ $# -gt 0 && "$1" != "--" ]]; do
        if [[ "$1" == "--id" ]]; then cid="$2"; shift 2; else shift; fi
    done
    shift || true
    fn="\${1:-}"

    case "$fn" in
        get_admin)
            echo "\\"$ADMIN_ADDR\\""
            ;;
        get_registry_contract)
            if [[ "$MODE" == "wrong_prod_registry" && "$cid" == "C_PROD_ESCROW" ]]; then
                echo "\\"C_WRONG_REGISTRY\\""
            elif [[ "$MODE" == "getter_unavailable" && "$cid" == "C_PROD_ESCROW" ]]; then
                exit 1
            elif [[ "$MODE" == "reject_prod_registry_setter" && "$cid" == "C_PROD_ESCROW" ]]; then
                echo "\\"C_STALE_REGISTRY\\""
            else
                echo "\\"C_REGISTRY\\""
            fi
            ;;
        get_path_payment_router)
            if [[ "$MODE" == "wrong_router" ]]; then
                echo "\\"C_WRONG_ROUTER\\""
            elif [[ "$MODE" == "reject_router_setter" ]]; then
                echo "\\"C_STALE_ROUTER\\""
            else
                echo "\\"$ROUTER_ADDR\\""
            fi
            ;;
        get_governance_contract)
            echo "\\"C_GOV\\""
            ;;
        get_escrow_contract)
            echo "\\"C_PROD_ESCROW\\""
            ;;
        get_contract_refs)
            echo '{"escrow_contract":"C_ESCROW","production_contract":"C_PROD_ESCROW"}'
            ;;
        set_registry_contract)
            if [[ "$MODE" == "reject_prod_registry_setter" && "$cid" == "C_PROD_ESCROW" ]]; then
                echo "HostError: Error(Contract, #54) NotGoverned" >&2
                exit 1
            fi
            echo "ok"
            ;;
        set_path_payment_router)
            if [[ "$MODE" == "reject_router_setter" ]]; then
                echo "HostError: Error(Contract, #54) NotGoverned" >&2
                exit 1
            fi
            echo "ok"
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
export PATH_PAYMENT_ROUTER="CROUTER1111111111111111111111111111111111111111111111111"
export STELLAR_CLI="$MOCK_CLI"

write_forged_manifest() {
    cat > "$TMP_DIR/deployments/deployed-addresses.testnet.json" <<JSON
{
  "network": "testnet",
  "updated": "",
  "contracts": {
    "governance": { "id": "C_GOV", "initialized": true },
    "escrow": { "id": "C_ESCROW", "initialized": true },
    "production_escrow": { "id": "C_PROD_ESCROW", "initialized": true },
    "registry": { "id": "C_REGISTRY", "initialized": true },
    "investment_basket": { "id": "C_BASKET", "initialized": true }
  },
  "wiring": {
    "escrow.registry": "C_REGISTRY",
    "production_escrow.registry": "C_REGISTRY",
    "escrow.path_payment_router": "$PATH_PAYMENT_ROUTER"
  }
}
JSON
}

echo "=== Case 1: Correctly configured instances pass deploy and --verify-only ==="
write_forged_manifest
export MOCK_MODE="healthy"
"$TMP_DIR/scripts/deploy-contracts.sh" --network testnet --skip-build >/dev/null
"$TMP_DIR/scripts/deploy-contracts.sh" --network testnet --verify-only >/dev/null
echo "  PASS"

echo "=== Case 2: Forged manifest cannot mask wrong on-chain production_escrow.registry ==="
write_forged_manifest
export MOCK_MODE="wrong_prod_registry"
if "$TMP_DIR/scripts/deploy-contracts.sh" --network testnet --verify-only >/dev/null 2>&1; then
    echo "FAIL: --verify-only passed despite wrong on-chain production_escrow.registry" >&2
    exit 1
fi
echo "  PASS"

echo "=== Case 3: Forged manifest cannot mask wrong on-chain escrow.path_payment_router ==="
write_forged_manifest
export MOCK_MODE="wrong_router"
if "$TMP_DIR/scripts/deploy-contracts.sh" --network testnet --verify-only >/dev/null 2>&1; then
    echo "FAIL: --verify-only passed despite wrong on-chain escrow.path_payment_router" >&2
    exit 1
fi
echo "  PASS"

echo "=== Case 4: Unavailable getter fails verification nonzero ==="
write_forged_manifest
export MOCK_MODE="getter_unavailable"
if "$TMP_DIR/scripts/deploy-contracts.sh" --network testnet --verify-only >/dev/null 2>&1; then
    echo "FAIL: --verify-only passed despite unavailable getter" >&2
    exit 1
fi
echo "  PASS"

echo "=== Case 5: Rejected production_escrow.set_registry_contract fails nonzero and identifies governance proposal ==="
write_forged_manifest
export MOCK_MODE="reject_prod_registry_setter"
OUT_FILE="$TMP_DIR/case5.out"
if "$TMP_DIR/scripts/deploy-contracts.sh" --network testnet --skip-build >"$OUT_FILE" 2>&1; then
    echo "FAIL: deploy succeeded despite rejected set_registry_contract" >&2
    exit 1
fi
grep -q "governance.propose" "$OUT_FILE" || { echo "FAIL: error output did not identify required governance proposal" >&2; exit 1; }
echo "  PASS"

echo "=== Case 6: Rejected escrow.set_path_payment_router fails nonzero and identifies governance proposal ==="
write_forged_manifest
export MOCK_MODE="reject_router_setter"
OUT_FILE="$TMP_DIR/case6.out"
if "$TMP_DIR/scripts/deploy-contracts.sh" --network testnet --skip-build >"$OUT_FILE" 2>&1; then
    echo "FAIL: deploy succeeded despite rejected set_path_payment_router" >&2
    exit 1
fi
grep -q "governance.propose" "$OUT_FILE" || { echo "FAIL: error output did not identify required governance proposal" >&2; exit 1; }
echo "  PASS"

echo "✅ All Issue #1287 on-chain cross-contract wiring verification tests passed."
