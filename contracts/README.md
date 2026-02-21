# Building - Buyer-Seller Escrow Smart Contract

This repository is specifically for smart contracts.

### Requirements

- Soroban Rust ([Stellar Docs](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup))
- Steller CLI ([Install](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup))

### Getting Started

Refer to [main repo](https://github.com/Cylo-Traders/Agrocylo-Global/tree/main) to have general grasp of the project. For this project, please follow Srorban Rust and Stellar CLI rules correctly.

#### Building and Testing

- `cd contracts`
- `cargo build --target wasm32-unknown-unknown --release`
- `cargo test`

#### Deploying to Testnet

First, ensure you have the Stellar CLI installed and configured.

Create an identity (if you haven't already):

```bash
stellar keys generate my-wallet --network testnet
```

Deploy the contract:

```bash
stellar contract deploy \
    --wasm target/wasm32-unknown-unknown/release/escrow.wasm \
    --source my-wallet \
    --network testnet
```
