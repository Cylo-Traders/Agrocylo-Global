# Agro Production Contracts

This workspace contains the Soroban contracts for the agro-production flow.

## Registry Contract

The `registry` crate stores:

- farmer registrations
- campaign registrations
- campaign indexing by farmer
- authorized contract references for escrow and production flows

Run tests with:

```bash
cargo test
```
# Agro Production Contract

This Soroban smart contract manages agricultural campaign funding and investments.

## Features
- Create campaigns with target amounts and deadlines.
- Invest in campaigns using supported tokens.
- Track investor positions and calculate proportional shares.
- Event emission for tracking on-chain activity.

## Commands
- `cargo test`: Run unit tests.
- `cargo build --target wasm32-unknown-unknown --release`: Build the contract.
