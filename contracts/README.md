# Agrocylo Smart Contracts

Soroban/Stellar smart contracts for the Agrocylo Global platform.
Resolved: Issue #1 - Smart contract repository set-up.

## Contracts

| Contract | Path | Purpose |
|---|---|---|
| escrow | contracts/escrow | Buyer-seller escrow with dispute resolution and arbitrator pool |
| weather-insurance | contracts/weather-insurance | Parametric crop-insurance with oracle-reported thresholds |

Production contracts in agro-production/contract/ include:
- production_escrow
- investment_basket
- governance
- registry

---

## Prerequisites

### 1. Rust and WASM target

This repository uses a pinned toolchain in rust-toolchain.toml:

    channel = 1.89.0
    targets = [wasm32v1-none]

Install Rust via rustup (https://rustup.rs/):

    curl --proto =https --tlsv1.2 -sSf https://sh.rustup.rs | sh

### 2. Stellar CLI

Install: https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup

    cargo install --locked stellar-cli

### 3. Soroban SDK

Pinned in root Cargo.toml - fetched automatically by cargo.

---

## Building

Build all contracts for deployment:

    cargo build --target wasm32v1-none --release

Build a single contract:

    cargo build -p escrow --target wasm32v1-none --release

Format and lint:

    cargo fmt --all
    cargo clippy --all-targets -- -D warnings

---

## Running Unit Tests

No live network required. Uses in-process soroban-sdk testutils.

    # All tests
    cargo test

    # Single contract
    cargo test -p escrow

    # Specific test
    cargo test -p escrow -- test::test_create_order

---

## Deploying to Testnet

### 1. Create identity and fund

    stellar keys generate my-wallet --network testnet
    stellar keys fund my-wallet --network testnet

### 2. Build

    cargo build -p escrow --target wasm32v1-none --release

### 3. Deploy

    stellar contract deploy --wasm target/wasm32v1-none/release/escrow.wasm --source my-wallet --network testnet

### 4. Initialize

    stellar contract invoke --id CONTRACT_ADDRESS --source my-wallet --network testnet -- initialize --admin YOUR_G_ADDRESS --fee_collector YOUR_G_ADDRESS --fee_rate_bps 300

---

## Code Review Checklist

Security:
- [ ] require_auth() called on correct party in every mutating function
- [ ] Initialization guard exists (AlreadyInitialized pattern)
- [ ] Storage writes before external calls (CEI pattern)
- [ ] All arithmetic uses checked_* operations
- [ ] State transitions guard on current status
- [ ] Token transfers from env.current_contract_address()

Gas Optimization:
- [ ] Batch ops skip invalid items with continue
- [ ] Storage reads cached across lookups
- [ ] Instance storage for singletons (Admin, Config)
- [ ] Persistent storage for per-item data (Orders, Campaigns)
- [ ] TTL extended on all persistent entries

Quality:
- [ ] Error messages specific to failure mode
- [ ] Edge cases tested
- [ ] Events emitted for every state transition
- [ ] Tests cover valid and invalid transitions

---

## Contributor Notes

- Never put private keys, signed XDR, bearer/session tokens in fixtures, logs, or screenshots.
- Coordinate schema/config changes across agro-production/client, agro-production/server, and contracts.
- Follow Soroban SDK standards: https://developers.stellar.org/docs/build/smart-contracts/
- Run cargo fmt --all and cargo clippy before every PR.

