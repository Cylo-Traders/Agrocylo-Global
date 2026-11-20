#!/usr/bin/env bash
# Regression suite for Issue #1282: scripts/verify-wasm.sh must perform a
# real build and hash comparison, not merely print instructions.
#
# The real `verify-wasm.sh` invokes `docker build`, which is slow, requires
# Docker, and is overkill for asserting the script's control-flow around
# match / mismatch / build-failure / missing-hash cases. These tests swap
# in a mock "docker" binary via the DOCKER environment variable so the
# verification logic can be exercised deterministically on any host.
#
# The mock docker echoes a scripted fake build log (whose last hex token
# is the "computed hash") and exits with a scripted return code.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/verify-wasm.sh"

[[ -x "$SCRIPT" ]] || { echo "FAIL: $SCRIPT is not executable" >&2; exit 1; }

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

MOCK_DOCKER="$TMP_DIR/docker-mock"

# Build the mock docker binary. It consumes and ignores its args, echoes
# the content of $FAKE_BUILD_LOG (set per test), and exits with
# $FAKE_BUILD_RC (default 0). This mirrors how the real `docker build`
# streams the build log to stdout while verify-wasm.sh captures it.
cat > "$MOCK_DOCKER" << 'MOCK'
#!/usr/bin/env bash
# `%b\n` expands backslash escapes in the input, so each test can embed
# \n in FAKE_BUILD_LOG to get real newlines in the streamed build log —
# the hash extraction in verify-wasm.sh relies on word boundaries, which
# require non-word characters (newlines, spaces, punctuation) around the
# hex token.
if [[ -n "${FAKE_BUILD_LOG:-}" ]]; then
    printf '%b\n' "$FAKE_BUILD_LOG"
fi
exit "${FAKE_BUILD_RC:-0}"
MOCK
chmod +x "$MOCK_DOCKER"

PASS=0
FAIL=0
FAILED_CASES=()

note() { printf '[test] %s\n' "$*"; }

assert_exit() {
    local label="$1" expected_rc="$2" actual_rc="$3"
    if (( actual_rc == expected_rc )); then
        note "  PASS: $label (rc=$actual_rc)"
        PASS=$((PASS + 1))
    else
        note "  FAIL: $label (expected rc=$expected_rc, got rc=$actual_rc)"
        FAIL=$((FAIL + 1))
        FAILED_CASES+=("$label")
    fi
}

run_verify() {
    # Capture exit code without aborting the harness; stdout/stderr go to
    # files so individual cases can inspect them.
    local out="$TMP_DIR/stdout" err="$TMP_DIR/stderr" rc=0
    set +e
    DOCKER="$MOCK_DOCKER" "$SCRIPT" "$@" >"$out" 2>"$err"
    rc=$?
    set -e
    return $rc
}

# ---------------------------------------------------------------------------
# Case 1 — Match: computed hash equals on-chain hash (exit 0).
# ---------------------------------------------------------------------------
note "case 1: matching hash returns 0"
HASH_A="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
FAKE_BUILD_LOG="step 1/6: pulling base image\n#1 extracting sha256:feedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfa00\nstep 6/6: hashing\n$HASH_A" \
    FAKE_BUILD_RC=0 \
    run_verify escrow "$HASH_A" && rc=0 || rc=$?
assert_exit "match -> 0" 0 "$rc"

# ---------------------------------------------------------------------------
# Case 2 — Mismatch: computed hash differs from on-chain hash (exit 1).
# This is the regression-of-regressions case: the pre-fix script printed
# "VERIFIED" for every input because it never computed a hash. Any build
# that does not match must exit nonzero.
# ---------------------------------------------------------------------------
note "case 2: mismatched hash returns 1"
HASH_B="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
FAKE_BUILD_LOG="step 6/6: hashing\n$HASH_A" \
    FAKE_BUILD_RC=0 \
    run_verify escrow "$HASH_B" && rc=0 || rc=$?
assert_exit "mismatch -> 1" 1 "$rc"

# ---------------------------------------------------------------------------
# Case 3 — Build failure: docker exits nonzero (exit 2, not 0 or 1).
# ---------------------------------------------------------------------------
note "case 3: docker build failure returns 2"
FAKE_BUILD_LOG="step 3/6: compiling escrow\nerror[E0308]: mismatched types\nbuild failed" \
    FAKE_BUILD_RC=1 \
    run_verify escrow "$HASH_A" && rc=0 || rc=$?
assert_exit "build-fail -> 2" 2 "$rc"

# ---------------------------------------------------------------------------
# Case 4 — Build succeeds but emits no extractable hash (exit 2).
# Guards against the pre-fix placeholder path where the script "passed"
# without ever computing a hash.
# ---------------------------------------------------------------------------
note "case 4: build succeeded but no hash in log returns 2"
FAKE_BUILD_LOG="step 6/6: hashing\n<TO BE FILLED IN BY MAINTAINER>" \
    FAKE_BUILD_RC=0 \
    run_verify escrow "$HASH_A" && rc=0 || rc=$?
assert_exit "no-hash -> 2" 2 "$rc"

# ---------------------------------------------------------------------------
# Case 5 — Docker binary missing (exit 2).
# ---------------------------------------------------------------------------
note "case 5: missing docker binary returns 2"
set +e
DOCKER="$TMP_DIR/does-not-exist" "$SCRIPT" escrow "$HASH_A" >"$TMP_DIR/stdout" 2>"$TMP_DIR/stderr"
rc=$?
set -e
assert_exit "missing-docker -> 2" 2 "$rc"

# ---------------------------------------------------------------------------
# Case 6 — Unknown contract name (exit 2).
# ---------------------------------------------------------------------------
note "case 6: unknown contract name returns 2"
run_verify no_such_contract "$HASH_A" && rc=0 || rc=$?
assert_exit "unknown-contract -> 2" 2 "$rc"

# ---------------------------------------------------------------------------
# Case 7 — Malformed on-chain hash (exit 2).
# ---------------------------------------------------------------------------
note "case 7: malformed on-chain hash returns 2"
run_verify escrow "not-a-sha256-hash" && rc=0 || rc=$?
assert_exit "bad-hash-format -> 2" 2 "$rc"

# ---------------------------------------------------------------------------
# Case 8 — The active marketplace escrow must be an accepted contract name.
# (The previous script omitted it entirely.)
# ---------------------------------------------------------------------------
note "case 8: 'escrow' is an accepted contract name"
FAKE_BUILD_LOG="step 6/6: hashing\n$HASH_A" \
    FAKE_BUILD_RC=0 \
    run_verify escrow "$HASH_A" && rc=0 || rc=$?
assert_exit "escrow-recognised -> 0" 0 "$rc"

# ---------------------------------------------------------------------------
# Case 9 — All five deploy-contracts.sh contracts are recognised.
# ---------------------------------------------------------------------------
note "case 9: all five contracts from scripts/deploy-contracts.sh are recognised"
for c in escrow governance investment_basket production_escrow registry; do
    FAKE_BUILD_LOG="step 6/6: hashing\n$HASH_A" \
        FAKE_BUILD_RC=0 \
        run_verify "$c" "$HASH_A" && rc=0 || rc=$?
    assert_exit "recognised: $c" 0 "$rc"
done

# ---------------------------------------------------------------------------
# Case 10 — Determinism: two clean runs that see the same build output
# produce the same verdict. (A reproducible build is enforced by the real
# Dockerfile; what this harness proves is that the script does not inject
# per-run nondeterminism into the comparison.)
# ---------------------------------------------------------------------------
note "case 10: two clean runs with the same hash both verify"
FAKE_BUILD_LOG="step 6/6: hashing\n$HASH_A" \
    FAKE_BUILD_RC=0 \
    run_verify escrow "$HASH_A" && rc1=0 || rc1=$?
FAKE_BUILD_LOG="step 6/6: hashing\n$HASH_A" \
    FAKE_BUILD_RC=0 \
    run_verify escrow "$HASH_A" && rc2=0 || rc2=$?
assert_exit "determinism run 1 -> 0" 0 "$rc1"
assert_exit "determinism run 2 -> 0" 0 "$rc2"

# ---------------------------------------------------------------------------
# Case 11 — Hash comparison is case-insensitive (RPC emits lowercase today,
# older tooling emits uppercase).
# ---------------------------------------------------------------------------
note "case 11: uppercase on-chain hash still matches lowercase computed hash"
HASH_UPPER="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
FAKE_BUILD_LOG="step 6/6: hashing\n$HASH_A" \
    FAKE_BUILD_RC=0 \
    run_verify escrow "$HASH_UPPER" && rc=0 || rc=$?
assert_exit "case-insensitive -> 0" 0 "$rc"

echo ""
echo "=========================================="
echo " verify-wasm.sh regression (Issue #1282)"
echo "   passed: $PASS"
echo "   failed: $FAIL"
echo "=========================================="

if (( FAIL > 0 )); then
    echo "Failed cases:" >&2
    for c in "${FAILED_CASES[@]}"; do
        echo "  - $c" >&2
    done
    exit 1
fi
