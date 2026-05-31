# Building - Buyer-Seller Escrow Smart Contract

This repository is specifically for smart contracts.

### Requirements

- Soroban Rust ([Stellar Docs](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup))
- Steller CLI ([Install](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup))

### Getting Started

Refer to [main repo](https://github.com/Cylo-Traders/Agrocylo-Global/tree/main) to have general grasp of the project. For this project, please follow Srorban Rust and Stellar CLI rules correctly.

### Code Review Checklist

Before submitting a pull request, verify the following:

**Security:**
- [ ] `require_auth()` called on the correct party in every mutating function
- [ ] Initialization guard exists (`AlreadyInitialized` pattern)
- [ ] Storage writes happen before external calls (Checks-Effects-Interactions)
- [ ] All arithmetic uses `checked_*` operations
- [ ] State transitions guard on current status
- [ ] Dispute resolutions validate admin identity
- [ ] Fee calculations use safe arithmetic
- [ ] Token transfers originate from `env.current_contract_address()` on outbound

**Gas Optimization:**
- [ ] Batch operations skip invalid items with `continue` instead of failing
- [ ] Storage reads cached when reused across multiple lookups
- [ ] Instance storage used for singleton values (Admin, Config)
- [ ] Persistent storage used for per-item data (Orders, Campaigns)
- [ ] TTL extended on all persistent entries
- [ ] Event data avoids redundant/retrievable fields

**Quality:**
- [ ] Error messages are specific to the failure mode
- [ ] Edge cases tested (zero/negative amounts, duplicate operations)
- [ ] Events emitted for every state transition
- [ ] Tests cover valid and invalid state transitions

See [`GAS_OPTIMIZATION.md`](./GAS_OPTIMIZATION.md) for detailed gas analysis and [`SECURITY_AUDIT.md`](./SECURITY_AUDIT.md) for the full security audit.

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
