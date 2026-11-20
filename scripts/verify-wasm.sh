#!/usr/bin/env bash
# Verify that a deployed contract's on-chain WASM hash matches a clean
# rebuild from the current checkout.
#
# The build runs in a pinned Docker image so the result is independent of
# the host toolchain. SHA-256 of the resulting .wasm is compared against
# the supplied on-chain hash.
#
# Usage:
#   ./scripts/verify-wasm.sh <contract_name> <on_chain_hash>
#
# Arguments:
#   contract_name   One of: escrow, governance, investment_basket,
#                   production_escrow, registry
#                   (mirrors scripts/deploy-contracts.sh's contract table)
#   on_chain_hash   SHA-256 hex (64 lowercase/uppercase chars) obtained via
#                   `stellar contract code-get-hash` for the deployed id,
#                   or the `wasm_hash` field in the committed
#                   deployments/deployed-addresses.<network>.json manifest.
#
# Environment:
#   DOCKER_IMAGE    Pinned base image. Defaults to rust:1.89.0, matching
#                   rust-toolchain.toml.
#   DOCKER          Docker command to invoke (default: docker). The test
#                   harness in scripts/test-verify-wasm-1282.sh uses this
#                   to swap in a mock builder.
#   BUILDER_TAG     Tag for the temporary builder image. Defaults to
#                   agrocylo-verify-<contract>-<timestamp>.
#
# Exit codes:
#   0  computed hash matches on_chain_hash
#   1  mismatch (both hashes reported)
#   2  input or environment error (bad args, missing docker, build
#      failure, missing/unreadable artifact)

set -euo pipefail

CONTRACT_NAME="${1:-}"
ON_CHAIN_HASH="${2:-}"

# ---------------------------------------------------------------------------
# Contract table — must track scripts/deploy-contracts.sh exactly. Adding a
# new contract to the deploy script without updating this map is the kind
# of drift this script is supposed to catch, so the two live together in
# review.
# ---------------------------------------------------------------------------
declare -A WASM_BASENAME=(
    [escrow]="escrow.wasm"
    [governance]="governance.wasm"
    [investment_basket]="investment_basket.wasm"
    [production_escrow]="production_escrow_v2.wasm"
    [registry]="registry.wasm"
)

# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------

usage() {
    cat >&2 << EOF
Usage: verify-wasm.sh <contract_name> <on_chain_hash>

Arguments:
  contract_name   One of: ${!WASM_BASENAME[*]}
  on_chain_hash   SHA-256 hex (64 chars) from the on-chain contract.

Environment:
  DOCKER_IMAGE    Pinned base image (default: rust:1.89.0).
  DOCKER          Docker command to invoke (default: docker).
  BUILDER_TAG     Tag for temporary builder image.

Exit codes:
  0 match   1 mismatch   2 error

Example:
  ./scripts/verify-wasm.sh production_escrow \\
    c5b7d9f1a2e3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8
EOF
}

if [[ -z "$CONTRACT_NAME" || -z "$ON_CHAIN_HASH" ]]; then
    usage
    exit 2
fi

if [[ -z "${WASM_BASENAME[$CONTRACT_NAME]+_}" ]]; then
    echo "Error: unknown contract_name '$CONTRACT_NAME'" >&2
    echo "       valid contracts: ${!WASM_BASENAME[*]}" >&2
    exit 2
fi

if ! [[ "$ON_CHAIN_HASH" =~ ^[a-fA-F0-9]{64}$ ]]; then
    echo "Error: on_chain_hash must be a 64-character SHA-256 hex string" >&2
    exit 2
fi

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

DOCKER_BIN="${DOCKER:-docker}"
if ! command -v "$DOCKER_BIN" >/dev/null 2>&1; then
    echo "Error: docker command '$DOCKER_BIN' not found" >&2
    echo "       install Docker or set DOCKER=/path/to/docker" >&2
    exit 2
fi

DOCKER_IMAGE="${DOCKER_IMAGE:-rust:1.89.0}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WASM_FILE="${WASM_BASENAME[$CONTRACT_NAME]}"
BUILDER_TAG="${BUILDER_TAG:-agrocylo-verify-${CONTRACT_NAME}-$(date +%s)}"

echo "Verifying WASM: $CONTRACT_NAME"
echo "  WASM artifact:  $WASM_FILE"
echo "  On-chain hash:  $ON_CHAIN_HASH"
echo "  Base image:     $DOCKER_IMAGE"
echo "  Docker:         $DOCKER_BIN"
echo ""

# ---------------------------------------------------------------------------
# Dockerfile
#
# Pinned stable Rust 1.89.0 with the wasm32v1-none target. Build runs with
# `--release` using the workspace's release profile (opt-level=z, lto=true,
# codegen-units=1, strip=debuginfo, panic=abort, debug=0 — see
# Cargo.toml [profile.release]), which is the configuration deployed to
# the network. --no-cache on `docker build` guarantees that an earlier
# (stale) copy of the source tree in the image layer cache cannot mask a
# real mismatch.
# ---------------------------------------------------------------------------

BUILD_DOCKERFILE="$(mktemp)"
BUILD_LOG="$(mktemp)"
trap 'rm -f "$BUILD_DOCKERFILE" "$BUILD_LOG"' EXIT

cat > "$BUILD_DOCKERFILE" << 'DOCKERFILE_END'
# syntax=docker/dockerfile:1
ARG BASE_IMAGE
FROM ${BASE_IMAGE}

ARG WASM_FILE

RUN rustup toolchain install 1.89.0 \
    && rustup target add --toolchain 1.89.0 wasm32v1-none \
    && rustup component add --toolchain 1.89.0 rustfmt clippy

WORKDIR /repo
COPY . /repo

RUN cargo +1.89.0 build --release --target wasm32v1-none --workspace

# Final stdout line is the per-contract SHA-256, parsed by verify-wasm.sh.
RUN set -eu; \
    WASM_PATH="/repo/target/wasm32v1-none/release/${WASM_FILE}"; \
    test -r "$WASM_PATH" || { echo "verify-wasm: artifact not found: $WASM_PATH" >&2; exit 2; }; \
    sha256sum "$WASM_PATH" | awk '{print $1}'
DOCKERFILE_END

echo "Building (docker build --no-cache)..."
set +e
"$DOCKER_BIN" build \
    --no-cache \
    --progress=plain \
    --build-arg "BASE_IMAGE=$DOCKER_IMAGE" \
    --build-arg "WASM_FILE=$WASM_FILE" \
    -t "$BUILDER_TAG" \
    -f "$BUILD_DOCKERFILE" \
    "$REPO_ROOT" \
    >"$BUILD_LOG" 2>&1
BUILD_RC=$?
set -e

if (( BUILD_RC != 0 )); then
    echo "Error: docker build failed (exit $BUILD_RC)" >&2
    echo "---- last 60 lines of build log ----" >&2
    tail -60 "$BUILD_LOG" >&2
    exit 2
fi

# The `sha256sum ... | awk` RUN step prints a bare 64-char hex on its own
# line. Pick the last such token to ignore any earlier incidental hex in
# tool output (e.g. image digests, cargo deps).
COMPUTED_HASH="$(grep -oE '\b[a-f0-9]{64}\b' "$BUILD_LOG" | tail -1 || true)"

if [[ -z "$COMPUTED_HASH" ]]; then
    echo "Error: could not extract WASM SHA-256 from build output" >&2
    echo "---- last 60 lines of build log ----" >&2
    tail -60 "$BUILD_LOG" >&2
    exit 2
fi

echo ""
echo "  Computed hash:  $COMPUTED_HASH"
echo "  On-chain hash:  $ON_CHAIN_HASH"
echo ""

# Hash comparison is case-insensitive; the on-chain hash normalises to
# lowercase in Stellar's RPC today but older tooling emits uppercase.
if [[ "${COMPUTED_HASH,,}" == "${ON_CHAIN_HASH,,}" ]]; then
    echo "VERIFIED: $CONTRACT_NAME matches on-chain WASM"
    exit 0
fi

echo "MISMATCH: $CONTRACT_NAME differs from on-chain WASM" >&2
exit 1
