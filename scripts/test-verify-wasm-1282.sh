#!/usr/bin/env bash
# Regression test suite for Issue #1282 (scripts/verify-wasm.sh)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/verify-wasm.sh"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# 1. Create deterministic WASM fixtures for all 5 contracts (including escrow & production_escrow_v2.wasm)
declare -A ARTIFACTS=(
    [governance]="governance.wasm"
    [escrow]="escrow.wasm"
    [production_escrow]="production_escrow_v2.wasm"
    [registry]="registry.wasm"
    [investment_basket]="investment_basket.wasm"
)

for c in "${!ARTIFACTS[@]}"; do
    printf 'wasm-fixture-%s-v1' "$c" > "$TMP_DIR/${ARTIFACTS[$c]}"
done

compute_hash() {
    if command -v sha256sum &>/dev/null; then
        sha256sum "$1" | awk '{print tolower($1)}'
    else
        shasum -a 256 "$1" | awk '{print tolower($1)}'
    fi
}

PROD_HASH="$(compute_hash "$TMP_DIR/production_escrow_v2.wasm")"
ESCROW_HASH="$(compute_hash "$TMP_DIR/escrow.wasm")"
WRONG_HASH="0000000000000000000000000000000000000000000000000000000000000000"

# 2. Matching hash for production_escrow (maps to production_escrow_v2.wasm) exits 0 and prints VERIFIED
OUT_MATCH="$(VERIFY_ARTIFACT_DIR="$TMP_DIR" bash "$SCRIPT" production_escrow "$PROD_HASH")"
grep -q "^VERIFIED: production_escrow" <<<"$OUT_MATCH"

# 3. Matching hash for marketplace escrow exits 0 and two runs produce identical hash
OUT_ESCROW_1="$(VERIFY_ARTIFACT_DIR="$TMP_DIR" bash "$SCRIPT" escrow "$ESCROW_HASH")"
OUT_ESCROW_2="$(VERIFY_ARTIFACT_DIR="$TMP_DIR" bash "$SCRIPT" escrow "$ESCROW_HASH")"
grep -q "^VERIFIED: escrow" <<<"$OUT_ESCROW_1"
[[ "$OUT_ESCROW_1" == "$OUT_ESCROW_2" ]]

# 4. Mismatched hash exits 1 and prints MISMATCH
set +e
OUT_MISMATCH="$(VERIFY_ARTIFACT_DIR="$TMP_DIR" bash "$SCRIPT" production_escrow "$WRONG_HASH" 2>&1)"
RC_MISMATCH=$?
set -e
[[ "$RC_MISMATCH" -eq 1 ]]
grep -q "MISMATCH:" <<<"$OUT_MISMATCH"

# 5. Missing artifact exits 2 (nonzero)
rm -f "$TMP_DIR/registry.wasm"
set +e
OUT_MISSING="$(VERIFY_ARTIFACT_DIR="$TMP_DIR" bash "$SCRIPT" registry "$WRONG_HASH" 2>&1)"
RC_MISSING=$?
set -e
[[ "$RC_MISSING" -eq 2 ]]

# 6. Unknown contract name exits 2
set +e
VERIFY_ARTIFACT_DIR="$TMP_DIR" bash "$SCRIPT" unknown_contract "$PROD_HASH" >/dev/null 2>&1
RC_UNKNOWN=$?
set -e
[[ "$RC_UNKNOWN" -eq 2 ]]

# 7. --from-manifest reads expected hash from manifest JSON
MANIFEST_JSON="$TMP_DIR/manifest.json"
cat > "$MANIFEST_JSON" <<EOF
{
  "contracts": {
    "production_escrow": {
      "wasm_hash": "$PROD_HASH"
    }
  }
}
EOF
OUT_MANIFEST="$(VERIFY_ARTIFACT_DIR="$TMP_DIR" bash "$SCRIPT" production_escrow --from-manifest "$MANIFEST_JSON")"
grep -q "^VERIFIED: production_escrow" <<<"$OUT_MANIFEST"

echo "PASS: all verify-wasm.sh checks (#1282) succeeded"
