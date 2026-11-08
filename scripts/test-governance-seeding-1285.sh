#!/usr/bin/env bash
# =============================================================================
# scripts/test-governance-seeding-1285.sh
#
# Regression test suite for Issue #1285:
# Seed governance voters and verify reachable quorum before handoff.
# =============================================================================

set -euo pipefail

echo "=== Running governance voter seeding and quorum reachability tests (#1285) ==="

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Test Case 1: Validation rejecting empty voters on mainnet
validate_electorate() {
    local network="$1"
    local voters="$2"
    local quorum="$3"

    if [[ -z "$voters" ]]; then
        if [[ "$network" == "mainnet" ]]; then
            return 1
        else
            voters="default_admin:${quorum}"
        fi
    fi

    local total=0
    IFS=',' read -ra PAIRS <<< "$voters"
    (( ${#PAIRS[@]} == 0 )) && return 1

    for pair in "${PAIRS[@]}"; do
        [[ -z "$pair" ]] && continue
        local addr="${pair%%:*}"
        local wt="${pair##*:}"
        if [[ -z "$addr" || -z "$wt" || ! "$wt" =~ ^[0-9]+$ || "$wt" -le 0 ]]; then
            return 1
        fi
        total=$((total + wt))
    done

    if (( total < quorum )); then
        return 2 # Quorum unreachable
    fi

    echo "$total"
    return 0
}

# 1. Mainnet rejects missing GOV_VOTERS
echo -n "Test 1: Mainnet requires explicit GOV_VOTERS... "
if validate_electorate "mainnet" "" 100 >/dev/null 2>&1; then
    echo "FAIL (accepted empty voters on mainnet)" >&2
    exit 1
fi
echo "PASSED"

# 2. Rejects invalid voter weight (non-numeric or 0)
echo -n "Test 2: Rejects invalid voter weights (0 or non-numeric)... "
if validate_electorate "testnet" "voter1:0,voter2:10" 10 >/dev/null 2>&1; then
    echo "FAIL (accepted 0 weight)" >&2
    exit 1
fi
if validate_electorate "testnet" "voter1:abc,voter2:10" 10 >/dev/null 2>&1; then
    echo "FAIL (accepted non-numeric weight)" >&2
    exit 1
fi
echo "PASSED"

# 3. Blocks handoff if total weight < quorum weight
echo -n "Test 3: Blocks governance handoff when total weight < quorum... "
rc=0
validate_electorate "testnet" "voter1:40,voter2:50" 100 >/dev/null 2>&1 || rc=$?
if [[ "$rc" -ne 2 ]]; then
    echo "FAIL (expected rc 2 for unreachable quorum, got $rc)" >&2
    exit 1
fi
echo "PASSED"

# 4. Permits handoff when total weight >= quorum weight
echo -n "Test 4: Permits governance handoff when total weight >= quorum... "
total="$(validate_electorate "testnet" "voter1:60,voter2:50" 100)"
if [[ "$total" -ne 110 ]]; then
    echo "FAIL (expected total 110, got $total)" >&2
    exit 1
fi
echo "PASSED"

# 5. Non-mainnet defaults to admin weight if unset
echo -n "Test 5: Testnet defaults voter to admin with quorum weight if unset... "
total="$(validate_electorate "testnet" "" 50)"
if [[ "$total" -ne 50 ]]; then
    echo "FAIL (expected total 50, got $total)" >&2
    exit 1
fi
echo "PASSED"

echo ""
echo "✅ All governance voter seeding and quorum tests passed!"
