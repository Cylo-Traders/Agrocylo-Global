#!/usr/bin/env bash
# Regression suite for Issue #1302: committed testnet deployment manifest.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/deploy-contracts.sh"
COMMITTED_MANIFEST="$REPO_ROOT/deployments/deployed-addresses.testnet.json"

[[ -f "$COMMITTED_MANIFEST" ]] || {
    echo "FAIL: $COMMITTED_MANIFEST does not exist" >&2
    exit 1
}

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/bin" "$TMP_DIR/scripts" "$TMP_DIR/deployments"
export PATH="$TMP_DIR/bin:$PATH"

if ! command -v jq &>/dev/null; then
    cat > "$TMP_DIR/bin/jq.js" << 'NODESCRIPT'
const fs = require('fs');
const args = process.argv.slice(2);
let raw = false;
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-r' || args[i] === '-cn') raw = true;
  else positional.push(args[i]);
}
const expr = positional[0] || '.';
const file = positional[1];
const input = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8');
const data = input.trim() ? JSON.parse(input) : {};

if (expr === '.') {
  console.log(JSON.stringify(data, null, 2));
  process.exit(0);
}
if (expr.includes('.contracts.governance.id =')) {
  data.contracts.governance.id = 'C…';
  console.log(JSON.stringify(data, null, 2));
  process.exit(0);
}
if (expr.includes('.contracts.escrow.salt =')) {
  data.contracts.escrow.salt = '0'.repeat(64);
  console.log(JSON.stringify(data, null, 2));
  process.exit(0);
}
if (expr.includes('signed_xdr')) {
  data.signed_xdr = 'AAAA...';
  console.log(JSON.stringify(data, null, 2));
  process.exit(0);
}
const cleanExpr = expr.split('//')[0].trim();
const parts = [];
const re = /"([^"]+)"|([A-Za-z0-9_]+)/g;
let m;
while ((m = re.exec(cleanExpr)) !== null) {
  parts.push(m[1] || m[2]);
}
let cur = data;
for (const p of parts) {
  cur = cur != null ? cur[p] : undefined;
}
if (cur === undefined || cur === null) {
  process.stdout.write('');
} else if (raw && typeof cur === 'string') {
  console.log(cur);
} else {
  console.log(JSON.stringify(cur));
}
NODESCRIPT
    cat > "$TMP_DIR/bin/jq" << 'JQE'
#!/usr/bin/env bash
SCRIPT_PATH="$(dirname "$0")/jq.js"
if command -v cygpath &>/dev/null; then
    SCRIPT_PATH="$(cygpath -w "$SCRIPT_PATH")"
    NEW_ARGS=()
    for arg in "$@"; do
        if [[ -f "$arg" ]]; then
            NEW_ARGS+=("$(cygpath -w "$arg")")
        else
            NEW_ARGS+=("$arg")
        fi
    done
    exec node "$SCRIPT_PATH" "${NEW_ARGS[@]}"
else
    exec node "$SCRIPT_PATH" "$@"
fi
JQE
    chmod +x "$TMP_DIR/bin/jq"
fi

cp "$SCRIPT" "$TMP_DIR/scripts/deploy-contracts.sh"
cp "$COMMITTED_MANIFEST" "$TMP_DIR/deployments/deployed-addresses.testnet.json"
chmod +x "$TMP_DIR/scripts/deploy-contracts.sh"

MOCK_CLI="$TMP_DIR/mock-stellar.sh"
cat > "$MOCK_CLI" << 'EOF'
#!/usr/bin/env bash
set -euo pipefail
MANIFEST="$MANIFEST_FOR_MOCK"
ADMIN_ADDR="$(jq -r '.verification.admin' "$MANIFEST")"
GOV_ID="$(jq -r '.contracts.governance.id' "$MANIFEST")"
ESCROW_ID="$(jq -r '.contracts.escrow.id' "$MANIFEST")"
PROD_ID="$(jq -r '.contracts.production_escrow.id' "$MANIFEST")"
REG_ID="$(jq -r '.contracts.registry.id' "$MANIFEST")"
ROUTER_ID="$(jq -r '.wiring."escrow.path_payment_router"' "$MANIFEST")"

if [[ "$1" == "keys" && "$2" == "address" ]]; then
    echo "$ADMIN_ADDR"
    exit 0
fi

if [[ "$1" == "contract" && "$2" == "invoke" ]]; then
    while [[ $# -gt 0 && "$1" != "--" ]]; do shift; done
    shift || true
    fn="${1:-}"
    case "$fn" in
        get_admin) echo "\"$ADMIN_ADDR\"" ;;
        get_registry_contract) echo "\"$REG_ID\"" ;;
        get_governance_contract) echo "\"$GOV_ID\"" ;;
        get_path_payment_router) echo "\"$ROUTER_ID\"" ;;
        get_contract_refs)
            printf '{"escrow_contract":"%s","production_contract":"%s"}\n' "$ESCROW_ID" "$PROD_ID"
            ;;
        *) echo "ok" ;;
    esac
    exit 0
fi
EOF
chmod +x "$MOCK_CLI"

export STELLAR_CLI="$MOCK_CLI"
export DEPLOYER="testnet-deployer"
export MANIFEST_FOR_MOCK="$TMP_DIR/deployments/deployed-addresses.testnet.json"
export ADMIN="$(jq -r '.verification.admin' "$COMMITTED_MANIFEST")"
export PATH_PAYMENT_ROUTER="$(jq -r '.wiring."escrow.path_payment_router"' "$COMMITTED_MANIFEST")"

echo "=== Test 1: committed manifest passes --verify-only ==="
"$TMP_DIR/scripts/deploy-contracts.sh" --network testnet --verify-only >/dev/null
echo "  PASS"

echo "=== Test 2: placeholder contract ID is rejected ==="
jq '.contracts.governance.id = "C…"' "$COMMITTED_MANIFEST" > "$TMP_DIR/deployments/deployed-addresses.testnet.json"
if "$TMP_DIR/scripts/deploy-contracts.sh" --network testnet --verify-only >/dev/null 2>&1; then
    echo "FAIL: --verify-only accepted placeholder contract ID" >&2
    exit 1
fi
echo "  PASS"

echo "=== Test 3: mismatched deterministic salt is rejected ==="
jq '.contracts.escrow.salt = "0000000000000000000000000000000000000000000000000000000000000000"' "$COMMITTED_MANIFEST" > "$TMP_DIR/deployments/deployed-addresses.testnet.json"
if "$TMP_DIR/scripts/deploy-contracts.sh" --network testnet --verify-only >/dev/null 2>&1; then
    echo "FAIL: --verify-only accepted mismatched salt" >&2
    exit 1
fi
echo "  PASS"

echo "=== Test 4: secret/signed_xdr in manifest is rejected ==="
jq '. + {"signed_xdr": "AAAA..."}' "$COMMITTED_MANIFEST" > "$TMP_DIR/deployments/deployed-addresses.testnet.json"
if "$TMP_DIR/scripts/deploy-contracts.sh" --network testnet --verify-only >/dev/null 2>&1; then
    echo "FAIL: --verify-only accepted manifest containing signed_xdr" >&2
    exit 1
fi
echo "  PASS"

echo "=== Test 5: missing manifest is rejected ==="
rm -f "$TMP_DIR/deployments/deployed-addresses.testnet.json"
if "$TMP_DIR/scripts/deploy-contracts.sh" --network testnet --verify-only >/dev/null 2>&1; then
    echo "FAIL: --verify-only succeeded when manifest file was absent" >&2
    exit 1
fi
echo "  PASS"

echo "All Issue #1302 manifest verification tests passed."
