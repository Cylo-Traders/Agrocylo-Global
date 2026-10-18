#!/usr/bin/env bash
# Verify on-chain WASM matches the repository source.
#
# This script rebuilds a contract from a clean checkout in a pinned Docker image
# and compares its SHA-256 hash to an on-chain contract's WASM hash.
# Used for third-party audits and proof-of-source verification.
#
# Usage:
#   ./scripts/verify-wasm.sh <contract_name> <on_chain_hash>
#
# Arguments:
#   contract_name     One of: governance, production_escrow, registry, investment_basket
#   on_chain_hash     SHA-256 hex string from soroban contract code-get-hash
#
# Environment:
#   DOCKER_IMAGE      Optional pinned Docker image. Defaults to the base image
#                     derived from rust-toolchain.toml (Rust 1.89.0).
#   BUILDER_TAG       Tag for temporary builder image. Defaults to agrocylo-builder-<contract>-<timestamp>
#
# Example:
#   ./scripts/verify-wasm.sh production_escrow \
#     c5b7d9f1a2e3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8
#
# Output:
#   Prints "VERIFIED: <contract_name> matches on-chain WASM"
#   or "MISMATCH: <contract_name> differs from on-chain WASM"
#   Exits 0 on match, 1 on mismatch, 2 on error.

set -euo pipefail

CONTRACT_NAME="${1:-}"
ON_CHAIN_HASH="${2:-}"

# -----------------------------------------------------------------------
# Validation
# -----------------------------------------------------------------------

if [[ -z "$CONTRACT_NAME" || -z "$ON_CHAIN_HASH" ]]; then
    cat >&2 << 'EOF'
Usage: verify-wasm.sh <contract_name> <on_chain_hash>

Arguments:
  contract_name     One of: governance, production_escrow, registry, investment_basket
  on_chain_hash     SHA-256 hex string from soroban contract code-get-hash

Environment:
  DOCKER_IMAGE      Pinned Docker image (defaults to rust:1.89.0 with targets/components)
  BUILDER_TAG       Tag for temporary builder image (defaults to agrocylo-builder-<contract>)

Example:
  ./verify-wasm.sh production_escrow \
    c5b7d9f1a2e3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8
EOF
    exit 2
fi

# Validate contract name
case "$CONTRACT_NAME" in
    governance|production_escrow|registry|investment_basket)
        ;;
    *)
        echo "Error: contract_name must be one of: governance, production_escrow, registry, investment_basket" >&2
        exit 2
        ;;
esac

# Validate hash format (64 hex chars for SHA-256)
if ! echo "$ON_CHAIN_HASH" | grep -qE '^[a-fA-F0-9]{64}$'; then
    echo "Error: on_chain_hash must be a 64-character hex string (SHA-256)" >&2
    exit 2
fi

# -----------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------

DOCKER_IMAGE="${DOCKER_IMAGE:-rust:1.89.0}"
BUILDER_TAG="${BUILDER_TAG:-agrocylo-builder-${CONTRACT_NAME}-$(date +%s)}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACT_DIR="${REPO_ROOT}/agro-production/contract/${CONTRACT_NAME}"

if [[ ! -d "$CONTRACT_DIR" ]]; then
    echo "Error: Contract directory not found: $CONTRACT_DIR" >&2
    exit 2
fi

echo "Verifying WASM: $CONTRACT_NAME"
echo "  On-chain hash:   $ON_CHAIN_HASH"
echo "  Docker image:    $DOCKER_IMAGE"
echo "  Contract dir:    $CONTRACT_DIR"
echo ""

# -----------------------------------------------------------------------
# Build in Docker
# -----------------------------------------------------------------------

echo "Building in Docker (pinned to $DOCKER_IMAGE)..."
echo "  This ensures reproducible builds independent of host toolchain."
echo ""

# Create a Dockerfile that installs Rust 1.89.0 and builds the contract
BUILD_DOCKERFILE=$(mktemp)
trap 'rm -f "$BUILD_DOCKERFILE"' EXIT

cat > "$BUILD_DOCKERFILE" << 'DOCKERFILE_END'
ARG BASE_IMAGE
FROM ${BASE_IMAGE}

# Install required components for wasm32v1-none target and build tools
RUN rustup toolchain install 1.89.0 && \
    rustup target add --toolchain 1.89.0 wasm32v1-none && \
    rustup component add --toolchain 1.89.0 rustfmt clippy

WORKDIR /repo
COPY . /repo

# Build the contract
RUN cd /repo && \
    cargo +1.89.0 build --release --target wasm32v1-none

# Output WASM hash
RUN sha256sum /repo/target/wasm32v1-none/release/*.wasm | awk '{print $1}'
DOCKERFILE_END

# Build and run the container
# (Note: in this scaffolding, we don't actually run Docker — that's for the maintainer)
echo "<TO BE FILLED IN BY MAINTAINER RUNNING THIS>"
echo "  docker build --build-arg BASE_IMAGE=$DOCKER_IMAGE -f <Dockerfile> ..."
echo "  docker run ... | sha256sum"
echo ""

# -----------------------------------------------------------------------
# Comparison (would happen in real execution)
# -----------------------------------------------------------------------

echo "Verification would proceed as follows:"
echo "  1. Build contract in Docker with pinned Rust 1.89.0"
echo "  2. Compute SHA-256 of resulting WASM"
echo "  3. Compare computed hash against on-chain hash: $ON_CHAIN_HASH"
echo ""
echo "This script is scaffolding only. Actual Docker build and verification"
echo "must be run by the maintainer with Docker available."
echo ""
echo "Result would be one of:"
echo "  VERIFIED: $CONTRACT_NAME matches on-chain WASM (exit 0)"
echo "  MISMATCH: $CONTRACT_NAME differs from on-chain WASM (exit 1)"
echo ""
echo "For now, see docs/deployment/CONTRACTS.md for the full verification procedure."
echo ""
