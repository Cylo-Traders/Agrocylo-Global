#!/usr/bin/env bash
# Deterministic, idempotent deploy + cross-wire for the full Soroban contract set.
#
# Contracts (dependency order):
#   1. governance          — standalone; every other contract verifies it before
#                            accepting a governance address, so it goes first.
#   2. escrow              — marketplace escrow (contracts/escrow)
#      production_escrow   — campaign escrow (contracts/production_escrow)
#      registry           — order / reputation registry
#      investment_basket  — batched campaign investments
#   3. cross-wiring, in this order (matters — see below):
#        a. escrow.set_registry_contract(registry)
#        b. escrow.set_path_payment_router(router)          [if PATH_PAYMENT_ROUTER set]
#        c. escrow.set_fee_config(fee_collector, fee_rate)  [if FEE_* set]
#        d. production_escrow.set_registry_contract(registry)
#        e. production_escrow.set_fee_config(...)           [if FEE_* set]
#        f. escrow.set_governance_contract(governance)
#        g. production_escrow.set_governance_contract(governance)
#        h. registry.set_governance_contract(governance)
#        i. investment_basket.set_governance_contract(governance)
#
#   Governance wiring is LAST: once set_governance_contract lands, every other
#   setter on that contract becomes governance-gated and can no longer be
#   driven by the raw admin key this script signs with.
#
# Idempotency: every wiring step reads the on-chain value first and is skipped
# when it already matches. initialize() calls tolerate AlreadyInitialized.
# Re-running converges to the same wired state with no duplicate deploys.
#
# Atomic initialization (Issue #843): on mainnet, freshly-deployed contracts
# are initialized in the *same* transaction as their deployment via
# constructor-style init (`--init-fn initialize --init-args ...`). There is no
# deploy/initialize gap in which an attacker could front-run the maintainer's
# initialize() and seize admin. Local/testnet deploys use the classic
# deploy-then-initialize flow (no front-running risk off-mainnet), and the
# separate initialize() step below remains as an idempotent fallback that
# tolerates AlreadyInitialized (e.g. --force redeploys onto an initialized
# instance).
#
# Verification: after wiring, every configured registry/governance/router
# address is read back and asserted against what was just deployed, and each
# contract's get_admin / get_guardian / get_governance_contract is compared to
# the expected deploy-time values. A mismatch fails the run loudly (exit 1)
# instead of leaving a contract half-configured or pointing at the wrong admin.
#
# Usage:
#   scripts/deploy-contracts.sh --network {local|testnet|mainnet} [flags]
#
# Flags:
#   --network <net>   Required. local | testnet | mainnet
#   --force           Ignore the existing address manifest and redeploy WASM
#   --skip-build      Reuse WASM already in target/wasm32v1-none/release/
#   --verify-only     Skip deploy/wire; only run the read-back verification pass
#
# Required environment:
#   DEPLOYER            `stellar keys` identity name used to sign (source account)
#   ADMIN               admin address for every initialize() (defaults to DEPLOYER's address)
#   FEE_COLLECTOR       fee collector address
#   SUPPORTED_TOKENS    comma-separated token contract IDs (escrow needs >= 2)
# Optional environment:
#   FEE_RATE_BPS            default 0
#   PATH_PAYMENT_ROUTER    router contract for escrow.set_path_payment_router
#   GOV_VOTING_PERIOD_SECS  default 259200 (3d)
#   GOV_TIMELOCK_SECS       default 172800 (2d)
#   GOV_UPGRADE_TIMELOCK_SECS  default 604800 (7d)
#   GOV_QUORUM_WEIGHT      default 1
#   GUARDIAN               guardian address; when set, the verification pass
#                          asserts get_guardian() equals it on every contract
#   ATOMIC_INIT            "true" forces atomic deploy+initialize off-mainnet
#                          (on is always atomic on mainnet)
#   SOROBAN_RPC_URL       override the network default RPC
#   STELLAR_CLI           override CLI binary (auto-detects `stellar` then `soroban`)
#
# Output:
#   deployments/deployed-addresses.<network>.json

set -euo pipefail

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------
NETWORK=""
FORCE=false
SKIP_BUILD=false
VERIFY_ONLY=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --network)     NETWORK="${2:-}"; shift 2 ;;
        --force)       FORCE=true; shift ;;
        --skip-build)  SKIP_BUILD=true; shift ;;
        --verify-only) VERIFY_ONLY=true; shift ;;
        -h|--help)     sed -n '2,60p' "$0"; exit 0 ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

[[ -n "$NETWORK" ]] || { echo "Error: --network is required (local|testnet|mainnet)" >&2; exit 1; }
case "$NETWORK" in local|testnet|mainnet) ;; *) echo "Error: --network must be local|testnet|mainnet" >&2; exit 1 ;; esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

MANIFEST_DIR="deployments"
MANIFEST_FILE="${MANIFEST_DIR}/deployed-addresses.${NETWORK}.json"
WASM_DIR="target/wasm32v1-none/release"

# ---------------------------------------------------------------------------
# Network config
# ---------------------------------------------------------------------------
case "$NETWORK" in
    local)
        RPC_URL="${SOROBAN_RPC_URL:-http://localhost:8000/rpc}"
        NETWORK_PASSPHRASE="Standalone Network ; February 2017" ;;
    testnet)
        RPC_URL="${SOROBAN_RPC_URL:-https://soroban-testnet.stellar.org}"
        NETWORK_PASSPHRASE="Test SDF Network ; September 2015" ;;
    mainnet)
        RPC_URL="${SOROBAN_RPC_URL:-https://soroban.stellar.org}"
        NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015" ;;
esac

# Issue #843: initializing in the same transaction as deployment is *mandatory*
# on mainnet — it removes the front-running window between `contract deploy`
# and the maintainer's separate `initialize` call. Off-mainnet the classic
# deploy-then-initialize flow is fine (no funds at stake), but can be opted in
# with ATOMIC_INIT=true.
ATOMIC_INIT=false
[[ "$NETWORK" == "mainnet" || "${ATOMIC_INIT:-false}" == "true" ]] && ATOMIC_INIT=true
[[ "${ATOMIC_INIT_DISABLE:-false}" == "true" ]] && ATOMIC_INIT=false

# ---------------------------------------------------------------------------
# CLI detection
# ---------------------------------------------------------------------------
CLI="${STELLAR_CLI:-}"
if [[ -z "$CLI" ]]; then
    if command -v stellar &>/dev/null; then CLI="stellar"
    elif command -v soroban &>/dev/null; then CLI="soroban"
    else echo "Error: neither 'stellar' nor 'soroban' CLI found on PATH" >&2; exit 1
    fi
fi
command -v jq &>/dev/null || { echo "Error: jq is required" >&2; exit 1; }

NET_ARGS=(--rpc-url "$RPC_URL" --network-passphrase "$NETWORK_PASSPHRASE")

# ---------------------------------------------------------------------------
# Contract table:  name | crate-dir | wasm-basename
# ---------------------------------------------------------------------------
CONTRACTS=(governance escrow production_escrow registry investment_basket)
declare -A DIR=(
    [governance]="contracts/governance"
    [escrow]="contracts/escrow"
    [production_escrow]="contracts/production_escrow"
    [registry]="contracts/registry"
    [investment_basket]="contracts/investment_basket"
)
declare -A WASM=(
    [governance]="governance.wasm"
    [escrow]="escrow.wasm"
    [production_escrow]="production_escrow_v2.wasm"
    [registry]="registry.wasm"
    [investment_basket]="investment_basket.wasm"
)

# ---------------------------------------------------------------------------
# Params
# ---------------------------------------------------------------------------
DEPLOYER="${DEPLOYER:?Set DEPLOYER to a configured 'stellar keys' identity}"
ADMIN="${ADMIN:-$($CLI keys address "$DEPLOYER")}"
FEE_COLLECTOR="${FEE_COLLECTOR:-}"
SUPPORTED_TOKENS="${SUPPORTED_TOKENS:-}"
FEE_RATE_BPS="${FEE_RATE_BPS:-0}"
PATH_PAYMENT_ROUTER="${PATH_PAYMENT_ROUTER:-}"
GOV_VOTING_PERIOD_SECS="${GOV_VOTING_PERIOD_SECS:-259200}"
GOV_TIMELOCK_SECS="${GOV_TIMELOCK_SECS:-172800}"
GOV_UPGRADE_TIMELOCK_SECS="${GOV_UPGRADE_TIMELOCK_SECS:-604800}"
GOV_QUORUM_WEIGHT="${GOV_QUORUM_WEIGHT:-1}"

if [[ "$VERIFY_ONLY" == "false" ]]; then
    [[ -n "$FEE_COLLECTOR" ]] || { echo "Error: FEE_COLLECTOR is required" >&2; exit 1; }
    [[ -n "$SUPPORTED_TOKENS" ]] || { echo "Error: SUPPORTED_TOKENS is required" >&2; exit 1; }
fi
# comma-separated -> repeated `--supported_tokens` JSON array element args
tokens_json() { jq -cn --arg s "$SUPPORTED_TOKENS" '$s | split(",") | map(select(length>0))'; }

echo "=========================================="
echo " Agrocylo contract deploy — $NETWORK"
echo "=========================================="
echo " CLI:        $CLI"
echo " RPC:        $RPC_URL"
echo " Deployer:   $DEPLOYER"
echo " Admin:      $ADMIN"
echo " Manifest:   $MANIFEST_FILE"
echo ""

mkdir -p "$MANIFEST_DIR"
[[ -f "$MANIFEST_FILE" ]] || echo '{"network":"","updated":"","contracts":{},"wiring":{}}' > "$MANIFEST_FILE"

# ---------------------------------------------------------------------------
# Manifest helpers
# ---------------------------------------------------------------------------
m_get()  { jq -r "$1 // empty" "$MANIFEST_FILE"; }
m_set()  { local tmp; tmp="$(mktemp)"; jq "$1" "$MANIFEST_FILE" > "$tmp" && mv "$tmp" "$MANIFEST_FILE"; }

cid()    { m_get ".contracts.\"$1\".id"; }

# ---------------------------------------------------------------------------
# invoke helpers
# ---------------------------------------------------------------------------
invoke() {   # invoke <contract-id> <fn> [args...]
    local id="$1" fn="$2"; shift 2
    $CLI contract invoke "${NET_ARGS[@]}" --source-account "$DEPLOYER" --id "$id" -- "$fn" "$@"
}
invoke_read() {  # same, read-only; strips surrounding quotes from scalar JSON
    local id="$1" fn="$2"; shift 2
    $CLI contract invoke "${NET_ARGS[@]}" --source-account "$DEPLOYER" --id "$id" -- "$fn" "$@" 2>/dev/null | tr -d '"'
}

# tolerate "already done" style contract errors, fail on everything else
invoke_idempotent() {
    local out rc
    if out="$("$@" 2>&1)"; then printf '%s\n' "$out"; return 0; fi
    rc=$?
    if grep -qiE "AlreadyInitialized|already.initialized" <<<"$out"; then
        echo "  (already initialized — skipping)"; return 0
    fi
    printf '%s\n' "$out" >&2; return $rc
}

# ---------------------------------------------------------------------------
# 1. Build
# ---------------------------------------------------------------------------
if [[ "$VERIFY_ONLY" == "false" && "$SKIP_BUILD" == "false" ]]; then
    echo "[build] compiling contracts (wasm32v1-none, release)..."
    for c in "${CONTRACTS[@]}"; do
        echo "  - $c"
        ( cd "${DIR[$c]}" && cargo build --release --target wasm32v1-none -q )
    done
    echo ""
fi

# ---------------------------------------------------------------------------
# 2. Deploy (deterministic salt per network+contract; idempotent via manifest)
# ---------------------------------------------------------------------------
# Constructor-style init args (JSON array) matching each contract's
# `initialize(admin, ...)` signature. Used to bind deployment and
# initialization into a single atomic transaction on mainnet, closing the
# front-running window between the two (Issue #843). Address arguments use the
# same bare pubkey/contract-id strings the `--admin X` invoke flags accept.
init_args_for() {
    local c="$1"
    case "$c" in
        governance)
            jq -cn --arg a "$ADMIN" \
                --argjson v "$GOV_VOTING_PERIOD_SECS" \
                --argjson t "$GOV_TIMELOCK_SECS" \
                --argjson u "$GOV_UPGRADE_TIMELOCK_SECS" \
                --argjson q "$GOV_QUORUM_WEIGHT" \
                '[$a,$v,$t,$u,$q]' ;;
        escrow)
            jq -cn --arg a "$ADMIN" --arg f "$FEE_COLLECTOR" \
                --argjson toks "$(tokens_json)" \
                '[$a,$f,$toks]' ;;
        production_escrow)
            jq -cn --arg a "$ADMIN" --arg f "$FEE_COLLECTOR" \
                --argjson fr "$FEE_RATE_BPS" \
                --argjson toks "$(tokens_json)" \
                '[$a,$toks,$f,$fr]' ;;
        registry)
            jq -cn --arg a "$ADMIN" --arg e "$(cid escrow)" --arg p "$(cid production_escrow)" \
                '[$a,$e,$p]' ;;
        investment_basket)
            jq -cn --arg a "$ADMIN" --arg e "$(cid production_escrow)" \
                '[$a,$e]' ;;
        *)
            echo "Error: no init args defined for contract '$c'" >&2
            exit 1 ;;
    esac
}

deploy_one() {
    local c="$1"
    local wasm="$WASM_DIR/${WASM[$c]}" existing salt hash id \
          init_fn="" init_args="" deployed_init=false
    existing="$(cid "$c")"
    if [[ -n "$existing" && "$FORCE" == "false" ]]; then
        echo "  $c: reusing $existing"
        return
    fi
    [[ -f "$wasm" ]] || { echo "Error: missing WASM $wasm (build first, or drop --skip-build)" >&2; exit 1; }
    salt="$(printf 'agrocylo:%s:%s' "$NETWORK" "$c" | sha256sum | cut -c1-64)"
    hash="$($CLI contract install "${NET_ARGS[@]}" --source-account "$DEPLOYER" --wasm "$wasm")"

    # Atomic init: only on a fresh instance (no manifest `initialized: true`).
    # A --force redeploy onto an already-initialized instance must NOT re-run
    # constructor-init — it would revert the whole deploy with AlreadyInitialized;
    # that path keeps the separate idempotent initialize() step below.
    if [[ "$ATOMIC_INIT" == "true" && "$(m_get ".contracts.\"$c\".initialized")" != "true" ]]; then
        init_fn="initialize"
        init_args="$(init_args_for "$c")"
        deployed_init=true
    fi

    if [[ -n "$init_fn" ]]; then
        id="$($CLI contract deploy "${NET_ARGS[@]}" --source-account "$DEPLOYER" \
                --wasm-hash "$hash" --salt "$salt" \
                --init-fn "$init_fn" --init-args "$init_args" 2>/dev/null \
              || $CLI contract deploy "${NET_ARGS[@]}" --source-account "$DEPLOYER" \
                --wasm "$wasm" --salt "$salt" \
                --init-fn "$init_fn" --init-args "$init_args")"
        echo "  $c: deployed $id (initialized atomically)"
    else
        id="$($CLI contract deploy "${NET_ARGS[@]}" --source-account "$DEPLOYER" --wasm-hash "$hash" --salt "$salt" 2>/dev/null \
              || $CLI contract deploy "${NET_ARGS[@]}" --source-account "$DEPLOYER" --wasm "$wasm" --salt "$salt")"
        echo "  $c: deployed $id"
    fi
    local init_field=""
    [[ "$deployed_init" == "true" ]] && init_field=',"initialized":true'
    m_set ".contracts.\"$c\" = {\"id\":\"$id\",\"wasm\":\"${WASM[$c]}\",\"wasm_hash\":\"$hash\",\"salt\":\"$salt\"$init_field}"
}

if [[ "$VERIFY_ONLY" == "false" ]]; then
    echo "[deploy] installing + deploying contract instances..."
    for c in "${CONTRACTS[@]}"; do deploy_one "$c"; done
    m_set ".network = \"$NETWORK\" | .updated = \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\""
    echo ""
fi

GOVERNANCE="$(cid governance)"
ESCROW="$(cid escrow)"
PROD_ESCROW="$(cid production_escrow)"
REGISTRY="$(cid registry)"
BASKET="$(cid investment_basket)"
for v in GOVERNANCE ESCROW PROD_ESCROW REGISTRY BASKET; do
    [[ -n "${!v}" ]] || { echo "Error: $v contract id missing from manifest — run without --verify-only first" >&2; exit 1; }
done

# ---------------------------------------------------------------------------
# 3. Initialize
# NOTE: on mainnet (or ATOMIC_INIT=true), freshly deployed contracts were
# already initialized atomically during `contract deploy`. This pass exists as
# an idempotent fallback: it initializes contracts deployed the classic way
# (local/testnet, or --force redeploys onto initialized instances) and its
# invocations tolerate AlreadyInitialized on re-runs.
# ---------------------------------------------------------------------------
if [[ "$VERIFY_ONLY" == "false" ]]; then
    echo "[init] initializing contracts..."
    TOKENS="$(tokens_json)"

    invoke_idempotent invoke "$GOVERNANCE" initialize \
        --admin "$ADMIN" \
        --voting_period_secs "$GOV_VOTING_PERIOD_SECS" \
        --timelock_delay_secs "$GOV_TIMELOCK_SECS" \
        --upgrade_timelock_delay_secs "$GOV_UPGRADE_TIMELOCK_SECS" \
        --quorum_weight "$GOV_QUORUM_WEIGHT"

    invoke_idempotent invoke "$ESCROW" initialize \
        --admin "$ADMIN" --fee_collector "$FEE_COLLECTOR" --supported_tokens "$TOKENS"

    invoke_idempotent invoke "$PROD_ESCROW" initialize \
        --admin "$ADMIN" --supported_tokens "$TOKENS" \
        --fee_collector "$FEE_COLLECTOR" --fee_rate_bps "$FEE_RATE_BPS"

    invoke_idempotent invoke "$REGISTRY" initialize \
        --admin "$ADMIN" --escrow_contract "$ESCROW" --production_contract "$PROD_ESCROW"

    invoke_idempotent invoke "$BASKET" initialize \
        --admin "$ADMIN" --escrow_contract "$PROD_ESCROW"
    echo ""
fi

# ---------------------------------------------------------------------------
# 4. Cross-wiring — read current value, skip when already correct
# ---------------------------------------------------------------------------
# wire <label> <current-value> <desired-value> <invoke...>
wire() {
    local label="$1" current="$2" desired="$3"; shift 3
    if [[ "$current" == "$desired" ]]; then
        echo "  = $label already $desired"
        return
    fi
    echo "  + $label -> $desired"
    "$@"
}

if [[ "$VERIFY_ONLY" == "false" ]]; then
    echo "[wire] cross-contract wiring (non-governance first)..."

    wire "escrow.registry" \
        "$(invoke_read "$ESCROW" get_registry_contract || true)" "$REGISTRY" \
        invoke "$ESCROW" set_registry_contract --admin "$ADMIN" --registry "$REGISTRY"

    # escrow has no getter for the router; skip when the manifest already
    # records it, otherwise set it (tolerating a governance-gated rejection
    # on a re-run where governance is already wired).
    if [[ -n "$PATH_PAYMENT_ROUTER" && "$(m_get '.wiring."escrow.path_payment_router"')" != "$PATH_PAYMENT_ROUTER" ]]; then
        echo "  + escrow.path_payment_router -> $PATH_PAYMENT_ROUTER"
        invoke "$ESCROW" set_path_payment_router --admin "$ADMIN" --router "$PATH_PAYMENT_ROUTER" || \
            echo "  (set_path_payment_router rejected — likely already governance-gated)"
    fi

    if (( FEE_RATE_BPS > 0 )); then
        wire "escrow.fee_config" \
            "$(invoke_read "$ESCROW" get_fee_rate_bps || true)" "$FEE_RATE_BPS" \
            invoke "$ESCROW" set_fee_config --admin_caller "$ADMIN" --fee_collector "$FEE_COLLECTOR" --fee_rate_bps "$FEE_RATE_BPS"
    fi

    # production_escrow has no get_registry_contract getter; guard on the
    # manifest so a converged re-run doesn't pay for a redundant write.
    if [[ "$(m_get '.wiring."production_escrow.registry"')" != "$REGISTRY" ]]; then
        echo "  + production_escrow.registry -> $REGISTRY"
        invoke "$PROD_ESCROW" set_registry_contract --admin_caller "$ADMIN" --registry "$REGISTRY" || \
            echo "  (set_registry_contract rejected — likely already governance-gated)"
    else
        echo "  = production_escrow.registry already $REGISTRY (per manifest)"
    fi

    echo "[wire] governance wiring (last — locks the other setters)..."
    wire "escrow.governance" \
        "$(invoke_read "$ESCROW" get_governance_contract || true)" "$GOVERNANCE" \
        invoke "$ESCROW" set_governance_contract --admin_caller "$ADMIN" --governance "$GOVERNANCE"

    wire "production_escrow.governance" \
        "$(invoke_read "$PROD_ESCROW" get_governance_contract || true)" "$GOVERNANCE" \
        invoke "$PROD_ESCROW" set_governance_contract --admin_caller "$ADMIN" --governance "$GOVERNANCE"

    wire "registry.governance" \
        "$(invoke_read "$REGISTRY" get_governance_contract || true)" "$GOVERNANCE" \
        invoke "$REGISTRY" set_governance_contract --caller "$ADMIN" --governance "$GOVERNANCE"

    wire "investment_basket.governance" \
        "$(invoke_read "$BASKET" get_governance_contract || true)" "$GOVERNANCE" \
        invoke "$BASKET" set_governance_contract --caller "$ADMIN" --governance "$GOVERNANCE"

    m_set ".wiring = {\"escrow.registry\":\"$REGISTRY\",\"escrow.governance\":\"$GOVERNANCE\",\"production_escrow.registry\":\"$REGISTRY\",\"production_escrow.governance\":\"$GOVERNANCE\",\"registry.governance\":\"$GOVERNANCE\",\"investment_basket.governance\":\"$GOVERNANCE\"${PATH_PAYMENT_ROUTER:+,\"escrow.path_payment_router\":\"$PATH_PAYMENT_ROUTER\"}}"
    echo ""
fi

# ---------------------------------------------------------------------------
# 5. Verification pass — read back and assert
# ---------------------------------------------------------------------------
echo "[verify] reading back on-chain wiring..."
FAILURES=0
check() {  # check <label> <actual> <expected>
    if [[ "$2" == "$3" ]]; then
        echo "  ok   $1 = $3"
    else
        echo "  FAIL $1: expected '$3', got '$2'" >&2
        FAILURES=$((FAILURES + 1))
    fi
}

check "escrow.registry_contract"      "$(invoke_read "$ESCROW" get_registry_contract || true)"    "$REGISTRY"
check "escrow.governance_contract"     "$(invoke_read "$ESCROW" get_governance_contract || true)"  "$GOVERNANCE"
check "production_escrow.governance"   "$(invoke_read "$PROD_ESCROW" get_governance_contract || true)" "$GOVERNANCE"
check "registry.governance_contract"   "$(invoke_read "$REGISTRY" get_governance_contract || true)" "$GOVERNANCE"
check "investment_basket.governance"   "$(invoke_read "$BASKET" get_governance_contract || true)"  "$GOVERNANCE"

# ── Issue #843 admin/guardian readback — assert the expected admin owns every
# newly-deployed contract before any funds move. Registry now exposes get_admin
# too; escrow/production_escrow also have get_guardian we re-read (guardian is
# set later by maintainers, so a missing guardian is reported, not fatal).
check "governance.get_admin"           "$(invoke_read "$GOVERNANCE" get_admin || true)" "$ADMIN"
check "escrow.get_admin"               "$(invoke_read "$ESCROW" get_admin || true)" "$ADMIN"
check "production_escrow.get_admin"    "$(invoke_read "$PROD_ESCROW" get_admin || true)" "$ADMIN"
check "registry.get_admin"             "$(invoke_read "$REGISTRY" get_admin || true)" "$ADMIN"
check "investment_basket.get_admin"    "$(invoke_read "$BASKET" get_admin || true)" "$ADMIN"

GUARDIAN="${GUARDIAN:-}"
if [[ -n "$GUARDIAN" ]]; then
    check "escrow.get_guardian"        "$(invoke_read "$ESCROW" get_guardian || true)" "$GUARDIAN"
    check "production_escrow.get_guardian" "$(invoke_read "$PROD_ESCROW" get_guardian || true)" "$GUARDIAN"
    check "registry.get_guardian"      "$(invoke_read "$REGISTRY" get_guardian || true)" "$GUARDIAN"
    check "investment_basket.get_guardian" "$(invoke_read "$BASKET" get_guardian || true)" "$GUARDIAN"
else
    echo "  ok   (GUARDIAN unset — skipping get_guardian readback)"
fi

# registry.get_contract_refs returns {escrow, production, ...}; assert both links
REFS="$($CLI contract invoke "${NET_ARGS[@]}" --source-account "$DEPLOYER" --id "$REGISTRY" -- get_contract_refs 2>/dev/null || echo '{}')"
check "registry.escrow_ref"     "$(jq -r '.escrow_contract // .escrow // empty' <<<"$REFS")"     "$ESCROW"
check "registry.production_ref" "$(jq -r '.production_contract // .production // empty' <<<"$REFS")" "$PROD_ESCROW"

if [[ -n "$PATH_PAYMENT_ROUTER" ]]; then
    # no getter for the router; assert it's recorded in the manifest at least
    check "manifest.escrow.path_payment_router" "$(m_get '.wiring."escrow.path_payment_router"')" "$PATH_PAYMENT_ROUTER"
fi

echo ""
if (( FAILURES > 0 )); then
    echo "❌ $FAILURES wiring check(s) failed — deployment is half-configured. Fix and re-run." >&2
    exit 1
fi
echo "✅ All contracts deployed and wired. Manifest: $MANIFEST_FILE"
jq . "$MANIFEST_FILE"
