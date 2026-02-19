# Building - Buyer-Seller Escrow Smart Contract
This repository is specifically for smart contracts.

### Requirements
* Soroban Rust ([Stellar Docs](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup))
* Steller CLI ([Install](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup))

### Getting Started
Refer to [main repo](https://github.com/Cylo-Traders/Agrocylo-Global/tree/main) to have general grasp of the project. For this project, please follow Srorban Rust and Stellar CLI rules correctly.

#### Building and Testing
* `cd contracts`
* `cargo build --target wasm32-unknown-unknown --release`
* `cargo test`