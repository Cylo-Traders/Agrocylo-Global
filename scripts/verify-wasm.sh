#!/usr/bin/env bash
# Verify on-chain WASM matches the repository source (Issue #1282).
#
# Rebuilds a contract from an explicit git commit using the pinned Rust
# toolchain (1.89.0 / wasm32v1-none) and Cargo.lock, computes the resulting
# artifact's SHA-256 digest, and compares it against the expected on-chain
# WASM hash (or fetches the hash from Soroban RPC / manifest when requested).
#
# Usage:
#   ./scripts/verify-wasm.sh <contract_name> <on_chain_hash|--from-manifest <file>|--from-rpc <contract_id>> [--commit <sha>] [--local-build]
#
# Arguments:
#   contract_name     One of: governance, escrow, production_escrow, registry, investment_basket
#   on_chain_hash     64-character SHA-256 hex string
#
# Environment:
#   DOCKER_IMAGE      Pinned Docker image (defaults to rust:1.89.0)
#   BUILDER_TAG       Tag for temporary builder image
#   VERIFY_WASM_MODE  "docker" (default) or "local" (uses local cargo +1.89.0 / prebuilt target dir in VERIFY_ARTIFACT_DIR)
#   VERIFY_ARTIFACT_DIR Optional directory containing compiled .wasm artifacts for deterministic fixture testing
#
# Exit codes:
#   0  VERIFIED: computed WASM SHA-256 matches expected on-chain hash
#   1  MISMATCH: computed WASM SHA-256 differs from expected on-chain hash
#   2  ERROR: invalid arguments, missing tooling, missing artifact, or build failure

set -euo pipefail

CONTRACT_NAME=""
ON_CHAIN_HASH=""
MANIFEST_PATH=""
RPC_CONTRACT_ID=""
RELEASE_COMMIT=""
MODE="${VERIFY_WASM_MODE:-docker}"

usage() {
    cat >&2 << 'EOF'
Usage: verify-wasm.sh <contract_name> <on_chain_hash> [options]
       verify-wasm.sh <contract_name> --from-manifest <manifest.json> [options]
       verify-wasm.sh <contract_name> --from-rpc <contract_id> [options]

Arguments:
  contract_name     One of: governance, escrow, production_escrow, registry, investment_basket
  on_chain_hash     64-character SHA-256 hex string

Options:
  --from-manifest <file>  Read expected wasm_hash for <contract_name> from deployment manifest JSON
  --from-rpc <id>         Fetch deployed wasm_hash for <contract_id> via stellar/soroban CLI
  --commit <ref>          Verify source at explicit git commit/tag (default: HEAD)
  --local-build           Build with local pinned cargo toolchain instead of Docker
EOF
}

if [[ $# -lt 2 ]]; then
    usage
    exit 2
fi

CONTRACT_NAME="${1:-}"
shift

while [[ $# -gt 0 ]]; do
    case "$1" in
        --from-manifest)
            MANIFEST_PATH="${2:-}"
            shift 2 ;;
        --from-rpc)
            RPC_CONTRACT_ID="${2:-}"
            shift 2 ;;
        --commit)
            RELEASE_COMMIT="${2:-}"
            shift 2 ;;
        --local-build)
            MODE="local"
            shift ;;
        -h|--help)
            usage
            exit 0 ;;
        *)
            if [[ -z "$ON_CHAIN_HASH" && ! "$1" =~ ^- ]]; then
                ON_CHAIN_HASH="$1"
                shift
            else
                echo "Error: unknown argument '$1'" >&2
                usage
                exit 2
            fi ;;
    esac
done

# -----------------------------------------------------------------------
# Contract-to-crate & artifact mapping (aligned with scripts/deploy-contracts.sh)
# -----------------------------------------------------------------------
declare -A CRATE_DIR=(
    [governance]="contracts/governance"
    [escrow]="contracts/escrow"
    [production_escrow]="contracts/production_escrow"
    [registry]="contracts/registry"
    [investment_basket]="contracts/investment_basket"
)
declare -A WASM_FILE=(
    [governance]="governance.wasm"
    [escrow]="escrow.wasm"
    [production_escrow]="production_escrow_v2.wasm"
    [registry]="registry.wasm"
    [investment_basket]="investment_basket.wasm"
)

if [[ -z "${CRATE_DIR[$CONTRACT_NAME]:-}" ]]; then
    echo "Error: contract_name must be one of: governance, escrow, production_escrow, registry, investment_basket" >&2
    exit 2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACT_REL_DIR="${CRATE_DIR[$CONTRACT_NAME]}"
ARTIFACT_NAME="${WASM_FILE[$CONTRACT_NAME]}"

# Resolve expected hash if --from-manifest or --from-rpc was supplied
if [[ -n "$MANIFEST_PATH" ]]; then
    [[ -f "$MANIFEST_PATH" ]] || { echo "Error: manifest file not found: $MANIFEST_PATH" >&2; exit 2; }
    if command -v jq &>/dev/null; then
        ON_CHAIN_HASH="$(jq -r ".contracts.\"$CONTRACT_NAME\".wasm_hash // empty" "$MANIFEST_PATH")"
    else
        ON_CHAIN_HASH="$(awk -v c="$CONTRACT_NAME" '
            $0 ~ "\"" c "\"" { in_c = 1 }
            in_c && $0 ~ "\"wasm_hash\"" {
                if (match($0, /[a-fA-F0-9]{64}/)) {
                    print substr($0, RSTART, RLENGTH)
                    exit
                }
            }
        ' "$MANIFEST_PATH")"
    fi
fi

if [[ -n "$RPC_CONTRACT_ID" ]]; then
    CLI="${STELLAR_CLI:-}"
    if [[ -z "$CLI" ]]; then
        if command -v stellar &>/dev/null; then CLI="stellar"
        elif command -v soroban &>/dev/null; then CLI="soroban"
        else echo "Error: neither 'stellar' nor 'soroban' CLI found on PATH" >&2; exit 2
        fi
    fi
    ON_CHAIN_HASH="$($CLI contract fetch --id "$RPC_CONTRACT_ID" 2>/dev/null | sha256sum | awk '{print $1}' || true)"
fi

if ! echo "$ON_CHAIN_HASH" | grep -qE '^[a-fA-F0-9]{64}$'; then
    echo "Error: on_chain_hash must be a 64-character hex string (SHA-256), got '${ON_CHAIN_HASH:-<empty>}'" >&2
    exit 2
fi
ON_CHAIN_HASH="$(echo "$ON_CHAIN_HASH" | tr '[:upper:]' '[:lower:]')"

# Resolve and verify git commit
if [[ -z "$RELEASE_COMMIT" ]]; then
    RELEASE_COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || true)"
else
    RELEASE_COMMIT="$(git -C "$REPO_ROOT" rev-parse --verify "$RELEASE_COMMIT^{commit}" 2>/dev/null || true)"
fi
if [[ -z "$RELEASE_COMMIT" ]]; then
    echo "Error: unable to resolve release commit in $REPO_ROOT" >&2
    exit 2
fi

# Read pinned toolchain channel from rust-toolchain.toml
TOOLCHAIN_FILE="$REPO_ROOT/rust-toolchain.toml"
[[ -f "$TOOLCHAIN_FILE" ]] || { echo "Error: missing $TOOLCHAIN_FILE" >&2; exit 2; }
RUST_CHANNEL="$(sed -n 's/^[[:space:]]*channel[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$TOOLCHAIN_FILE" | head -n1)"
[[ -n "$RUST_CHANNEL" ]] || { echo "Error: could not parse toolchain channel from $TOOLCHAIN_FILE" >&2; exit 2; }

DOCKER_IMAGE="${DOCKER_IMAGE:-rust:${RUST_CHANNEL}}"
BUILDER_TAG="${BUILDER_TAG:-agrocylo-wasm-verifier-${CONTRACT_NAME}-${RELEASE_COMMIT:0:12}}"

echo "Verifying WASM: $CONTRACT_NAME"
echo "  Commit:          $RELEASE_COMMIT"
echo "  Toolchain:       $RUST_CHANNEL (wasm32v1-none)"
echo "  Crate dir:       $CONTRACT_REL_DIR"
echo "  Artifact:        $ARTIFACT_NAME"
echo "  Expected hash:   $ON_CHAIN_HASH"
echo "  Mode:            $MODE"

compute_sha256() {
    local file="$1"
    if command -v sha256sum &>/dev/null; then
        sha256sum "$file" | awk '{print tolower($1)}'
    elif command -v shasum &>/dev/null; then
        shasum -a 256 "$file" | awk '{print tolower($1)}'
    else
        echo "Error: neither sha256sum nor shasum found on PATH" >&2
        return 2
    fi
}

COMPUTED_HASH=""

if [[ -n "${VERIFY_ARTIFACT_DIR:-}" ]]; then
    ARTIFACT_PATH="${VERIFY_ARTIFACT_DIR%/}/$ARTIFACT_NAME"
    if [[ ! -f "$ARTIFACT_PATH" ]]; then
        echo "Error: expected artifact not found at $ARTIFACT_PATH" >&2
        exit 2
    fi
    COMPUTED_HASH="$(compute_sha256 "$ARTIFACT_PATH")" || exit 2
elif [[ "$MODE" == "local" ]]; then
    command -v cargo &>/dev/null || { echo "Error: cargo not found on PATH" >&2; exit 2; }
    WORKTREE_DIR="$(mktemp -d)"
    trap 'git -C "$REPO_ROOT" worktree remove --force "$WORKTREE_DIR" >/dev/null 2>&1 || rm -rf "$WORKTREE_DIR"' EXIT
    git -C "$REPO_ROOT" worktree add --detach "$WORKTREE_DIR" "$RELEASE_COMMIT" >/dev/null 2>&1 || {
        echo "Error: failed to checkout clean worktree for commit $RELEASE_COMMIT" >&2
        exit 2
    }
    LOCK_FLAG=""
    [[ -f "$WORKTREE_DIR/$CONTRACT_REL_DIR/Cargo.lock" || -f "$WORKTREE_DIR/Cargo.lock" ]] && LOCK_FLAG="--locked"
    (
        cd "$WORKTREE_DIR/$CONTRACT_REL_DIR"
        CARGO_INCREMENTAL=0 SOURCE_DATE_EPOCH=1 \
            cargo +"$RUST_CHANNEL" build --release --target wasm32v1-none $LOCK_FLAG
    ) || {
        echo "Error: cargo build failed for $CONTRACT_NAME" >&2
        exit 2
    }
    BUILT_WASM=""
    for candidate in \
        "$WORKTREE_DIR/target/wasm32v1-none/release/$ARTIFACT_NAME" \
        "$WORKTREE_DIR/$CONTRACT_REL_DIR/target/wasm32v1-none/release/$ARTIFACT_NAME"; do
        if [[ -f "$candidate" ]]; then
            BUILT_WASM="$candidate"
            break
        fi
    done
    if [[ -z "$BUILT_WASM" ]]; then
        echo "Error: built artifact $ARTIFACT_NAME not found after cargo build" >&2
        exit 2
    fi
    COMPUTED_HASH="$(compute_sha256 "$BUILT_WASM")" || exit 2
elif [[ "$MODE" == "docker" ]]; then
    command -v docker &>/dev/null || { echo "Error: docker is required for docker verification mode (or pass --local-build)" >&2; exit 2; }
    BUILD_CONTEXT="$(mktemp -d)"
    BUILD_DOCKERFILE="$(mktemp)"
    trap 'rm -rf "$BUILD_CONTEXT" "$BUILD_DOCKERFILE"; docker rmi -f "$BUILDER_TAG" >/dev/null 2>&1 || true' EXIT

    git -C "$REPO_ROOT" archive --format=tar "$RELEASE_COMMIT" | tar -x -C "$BUILD_CONTEXT" || {
        echo "Error: failed to export clean archive for commit $RELEASE_COMMIT" >&2
        exit 2
    }

    cat > "$BUILD_DOCKERFILE" << 'DOCKERFILE_END'
ARG BASE_IMAGE
ARG RUST_CHANNEL
ARG CONTRACT_REL_DIR
ARG ARTIFACT_NAME
FROM ${BASE_IMAGE}

ARG RUST_CHANNEL
ARG CONTRACT_REL_DIR
ARG ARTIFACT_NAME

ENV CARGO_INCREMENTAL=0 \
    SOURCE_DATE_EPOCH=1

RUN rustup toolchain install "${RUST_CHANNEL}" && \
    rustup target add --toolchain "${RUST_CHANNEL}" wasm32v1-none

WORKDIR /repo
COPY . /repo

RUN cd "/repo/${CONTRACT_REL_DIR}" && \
    if [ -f Cargo.lock ] || [ -f /repo/Cargo.lock ]; then LOCK_FLAG="--locked"; else LOCK_FLAG=""; fi && \
    cargo +"${RUST_CHANNEL}" build --release --target wasm32v1-none ${LOCK_FLAG} && \
    WASM_PATH="" && \
    for p in "/repo/target/wasm32v1-none/release/${ARTIFACT_NAME}" "/repo/${CONTRACT_REL_DIR}/target/wasm32v1-none/release/${ARTIFACT_NAME}"; do \
      if [ -f "$p" ]; then WASM_PATH="$p"; break; fi; \
    done && \
    [ -n "$WASM_PATH" ] && \
    sha256sum "$WASM_PATH" | awk '{print tolower($1)}' > /wasm.sha256
DOCKERFILE_END

    docker build \
        --build-arg BASE_IMAGE="$DOCKER_IMAGE" \
        --build-arg RUST_CHANNEL="$RUST_CHANNEL" \
        --build-arg CONTRACT_REL_DIR="$CONTRACT_REL_DIR" \
        --build-arg ARTIFACT_NAME="$ARTIFACT_NAME" \
        -t "$BUILDER_TAG" \
        -f "$BUILD_DOCKERFILE" \
        "$BUILD_CONTEXT" >/dev/null || {
        echo "Error: Docker build failed for $CONTRACT_NAME" >&2
        exit 2
    }

    COMPUTED_HASH="$(docker run --rm --entrypoint cat "$BUILDER_TAG" /wasm.sha256 | tr -d '[:space:]')" || {
        echo "Error: failed to read computed hash from container $BUILDER_TAG" >&2
        exit 2
    }
else
    echo "Error: unsupported VERIFY_WASM_MODE '$MODE'" >&2
    exit 2
fi

if ! echo "$COMPUTED_HASH" | grep -qE '^[a-f0-9]{64}$'; then
    echo "Error: invalid computed hash '$COMPUTED_HASH'" >&2
    exit 2
fi

echo "  Computed hash:   $COMPUTED_HASH"

if [[ "$COMPUTED_HASH" == "$ON_CHAIN_HASH" ]]; then
    echo "VERIFIED: $CONTRACT_NAME ($ARTIFACT_NAME @ $RELEASE_COMMIT) matches on-chain WASM ($COMPUTED_HASH)"
    exit 0
else
    echo "MISMATCH: $CONTRACT_NAME ($ARTIFACT_NAME @ $RELEASE_COMMIT) computed $COMPUTED_HASH != expected $ON_CHAIN_HASH" >&2
    exit 1
fi
