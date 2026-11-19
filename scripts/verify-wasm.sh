#!/usr/bin/env bash
# Verify on-chain WASM matches the repository source.
#
# Rebuilds a contract from this checkout inside a pinned Docker image, optimizes
# and hashes the artifact the same way deploy-contracts.sh does, then compares
# that SHA-256 against the on-chain WASM hash. The build actually runs.
#
# Usage:
#   ./scripts/verify-wasm.sh <contract_name> <on_chain_hash>
#   ./scripts/verify-wasm.sh --list
#
# Exit codes:
#   0  VERIFIED: <contract> matches on-chain WASM
#   1  MISMATCH: <contract> differs from on-chain WASM
#   2  error (bad arguments, missing tool, build failure)
#
# Environment:
#   DOCKER_IMAGE      Pinned builder image (default: rust:<channel>-bookworm)
#   BUILDER_TAG       Builder image tag (default: agrocylo-builder-<contract>-<epoch>)
#   STELLAR_CLI       Stellar CLI used for optimize/hash (default: stellar)
#   KEEP_DOCKERFILE   Set 1 to keep the generated Dockerfile

set -euo pipefail

usage() {
    sed -n '2,20p' "${BASH_SOURCE[0]}" >&2
}

fail() {
    printf "Error: %s\n" "$*" >&2
    exit 2
}
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS_DIR="$REPO_ROOT/contracts"

# Supported set is the checkout itself: every contracts/<name>/Cargo.toml.
# The workspace members are the source of truth, so a directory that is not a
# workspace member (e.g. archive/ leftovers placed under contracts/) is ignored.
list_contracts() {
    local dir
    grep -oe 'contracts/[a-z0-9_]*' "$REPO_ROOT/Cargo.toml" 2>/dev/null \
        | sed 's|contracts/||' || true

}

# Effective Rust channel from rust-toolchain.toml, resolved like the deploy script.
rust_channel() {
    local channel=""
    if [[ -f "$REPO_ROOT/rust-toolchain.toml" ]]; then
        channel="$(sed -n 's/^[[:space:]]*channel[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' \
            "$REPO_ROOT/rust-toolchain.toml" | head -n 1)"
    fi
    printf '%s' "${channel:-1.89.0}"
}
# Main: parse, validate, then build+compare.
CONTRACT_NAME="${1:-}"
ON_CHAIN_HASH="${2:-}"

if [[ "$CONTRACT_NAME" == "--list" || "$CONTRACT_NAME" == "-l" ]]; then
    list_contracts
    exit 0
fi

if [[ "$CONTRACT_NAME" == "--help" || "$CONTRACT_NAME" == "-h" ]]; then
    usage
    exit 0
fi

if [[ $# -ne 2 ]]; then
    usage
    exit 2
fi

if [[ ! "$CONTRACT_NAME" =~ ^[a-z][a-z0-9_]*$ ]]; then
    fail "contract_name must match ^[a-z][a-z0-9_]*\$"
fi

if ! list_contracts | grep -qxF "$CONTRACT_NAME"; then
    fail "unsupported contract '$CONTRACT_NAME' (try --list)"
fi

# Accept an optional 0x prefix and upper case; require 64 hex chars.
ON_CHAIN_HASH="${ON_CHAIN_HASH#0x}"
ON_CHAIN_HASH="$(printf '%s' "$ON_CHAIN_HASH" | tr 'A-Z' 'a-z')"
if [[ ! "$ON_CHAIN_HASH" =~ ^[a-f0-9]{64}$ ]]; then
    fail "on_chain_hash must be a 64-character hex string (SHA-256)"
fi

RUST_VERSION="$(rust_channel)"
DOCKER_IMAGE="${DOCKER_IMAGE:-rust:${RUST_VERSION}-bookworm}"
BUILDER_TAG="${BUILDER_TAG:-agrocylo-builder-${CONTRACT_NAME}-$(date +%s)}"
STELLAR_CLI="${STELLAR_CLI:-stellar}"
WASM_NAME="${CONTRACT_NAME}.wasm"

if [[ "$CONTRACT_NAME" == "production_escrow" ]]; then
    WASM_NAME="production_escrow_v2.wasm"
fi

echo "Verifying WASM: $CONTRACT_NAME"
echo "  On-chain hash:   $ON_CHAIN_HASH"
echo "  Docker image:    $DOCKER_IMAGE"
echo "  Contract dir:    contracts/$CONTRACT_NAME"

if ! command -v docker >/dev/null 2>&1; then
    fail "docker is not available; cannot run the pinned build"
fi

WORK_DIR="$(mktemp -d)"
DOCKERFILE="$WORK_DIR/Dockerfile"
BUILDER_IMAGE="agrocylo-builder-temp:${BUILDER_TAG}"

cleanup() {
    local status=$?
    if [[ "${KEEP_BUILDER:-0}" != "1" ]]; then
        docker image rm -f "$BUILDER_IMAGE" >/dev/null 2>&1 || true
    fi
    if [[ "${KEEP_DOCKERFILE:-0}" != "1" ]]; then
        rm -rf "$WORK_DIR"
    fi
    return $status
}
trap cleanup EXIT

# Build context: the repository root. The artifact is copied out below, so
# the context itself is never left behind as a dangling layer.
cat > "$DOCKERFILE" << DOCKERFILE_END
ARG BASE_IMAGE
FROM ${DOCKER_IMAGE}

ARG RUST_VERSION

RUN rustup toolchain install "${RUST_VERSION}" \
    && rustup target add --toolchain "${RUST_VERSION}" wasm32v1-none \
    && rustup component add --toolchain "${RUST_VERSION}" rustfmt clippy || true

WORKDIR /repo
COPY . /repo

# Build the contract crate for the pinned target. The artifact is read from the
# workspace target dir, which is where cargo places it for path members.
ARG CONTRACT_NAME
ARG RUST_VERSION
ARG WASM_NAME

RUN cd /repo/contracts/${CONTRACT_NAME} \
    && cargo +${RUST_VERSION} build --release --target wasm32v1-none

RUN set -eux; \
    ART=/repo/target/wasm32v1-none/release/${WASM_NAME}; \
    test -f "\$ART"; \
    cp "\$ART" /repo/artifact.wasm; \
    sha256sum /repo/artifact.wasm | awk '{print \$1}'

CMD ["sha256sum", "/repo/artifact.wasm"]
DOCKERFILE_END

echo ""
echo "Building in Docker (pinned to $DOCKER_IMAGE, Rust $RUST_VERSION)..."
echo ""

# Build failures are errors, not hash mismatches.
if ! DOCKER_BUILDKIT=0 docker build \
    --build-arg BASE_IMAGE="$DOCKER_IMAGE" \
    --build-arg RUST_VERSION="$RUST_VERSION" \
    --build-arg CONTRACT_NAME="$CONTRACT_NAME" \
    --build-arg WASM_NAME="$WASM_NAME" \
    -t "$BUILDER_IMAGE" \
    -f "$DOCKERFILE" \
    "$REPO_ROOT"; then
    fail "docker build failed for $CONTRACT_NAME"
fi

RAW_HASH="$(docker run --rm "$BUILDER_IMAGE" sha256sum /repo/artifact.wasm | awk '{print $1}')"
if [[ ! "$RAW_HASH" =~ ^[a-f0-9]{64}$ ]]; then
    fail "could not compute SHA-256 of the built artifact (got: '$RAW_HASH')"
fi

# Optimize + hash with the same tool the deploy script uses, when available.
COMPUTED_HASH=""
if [[ "${SKIP_OPTIMIZE:-0}" == "1" ]]; then
    COMPUTED_HASH="$RAW_HASH"
    echo "  SKIP_OPTIMIZE=1: comparing raw cargo output"
elif command -v "$STELLAR_CLI" >/dev/null 2>&1; then
    OPT_OUT="$WORK_DIR/optimized.wasm"
    docker cp "$(docker create "$BUILDER_IMAGE")":/repo/artifact.wasm "$OPT_OUT" >/dev/null 2>&1
    if "$STELLAR_CLI" contract optimize --wasm "$OPT_OUT" >/dev/null 2>&1; then
        COMPUTED_HASH="$(sha256sum "$OPT_OUT" | awk '{print $1}')"
        echo "  Optimized artifact SHA-256: $COMPUTED_HASH"
    else
        COMPUTED_HASH="$RAW_HASH"
        echo "  optimize failed; comparing the raw artifact"
    fi
else
    COMPUTED_HASH="$RAW_HASH"
    echo "  Stellar CLI '$STELLAR_CLI' not found; comparing the raw artifact."
    echo "  Install it and re-run for an exact deploy-hash comparison."
fi

echo ""
if [[ "$COMPUTED_HASH" == "$ON_CHAIN_HASH" ]]; then
    echo "VERIFIED: $CONTRACT_NAME matches on-chain WASM"
    exit 0
fi

echo "MISMATCH: $CONTRACT_NAME differs from on-chain WASM"
echo "  computed: $COMPUTED_HASH"
echo "  on-chain: $ON_CHAIN_HASH"
exit 1
