# Agro-production contracts

The canonical production escrow contract is
[`production_escrow`](./production_escrow). It is the only production escrow
crate in the workspace and is the contract targeted by
`NEXT_PUBLIC_PRODUCTION_CONTRACT_ID` and `PRODUCTION_ESCROW_CONTRACT_ID`.

It manages campaign funding, investor positions, production lifecycle events,
orders, settlement, refunds, and disputes. The `registry` crate stores farmer
and campaign registration metadata.

## Commands

Run the canonical escrow unit suite from the repository root:

```bash
cargo test -p production_escrow
```

Build its deployable Wasm artifact:

```bash
cargo build -p production_escrow --target wasm32-unknown-unknown --release
```

## Contract Wiring & Deployment

After deploying both `production_escrow` and `registry` contracts, wire the registry contract to the escrow contract by invoking `set_registry_contract`:

```bash
soroban contract invoke \
  --id <PRODUCTION_ESCROW_CONTRACT_ID> \
  --source <ADMIN_SECRET_KEY> \
  --rpc-url <RPC_URL> \
  --network-passphrase "<NETWORK_PASSPHRASE>" \
  -- \
  set_registry_contract \
  --admin_caller <ADMIN_ADDRESS> \
  --registry <REGISTRY_CONTRACT_ID>
```

Set `REGISTRY_CONTRACT_ID` in `agro-production/server/.env` so the server and health checks monitor registry status.
