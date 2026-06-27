# Toolchain & SDK Reference

Single source of truth for Rust, Soroban SDK, and `stellar-cli` versions.
**Read this before changing any version.**

## Pinned versions

| Component   | Version         | Where pinned                             |
|-------------|-----------------|------------------------------------------|
| Rust        | 1.81.0          | `rust-toolchain.toml`                    |
| WASM target | `wasm32v1-none` | `rust-toolchain.toml`                    |
| soroban-sdk | 22.1.1          | root `Cargo.toml` `[workspace.dependencies]` |
| stellar-cli | 22.8.1          | install command below                    |

### Why 22.x?

SDK 25 introduced breaking changes to storage TTL helpers and auth context
requiring a re-audit before adoption. Upgrading is tracked separately.

## Compatibility matrix

| soroban-sdk | Rust min | stellar-cli | Protocol |
|-------------|----------|-------------|----------|
| 22.1.1      | 1.81.0   | 22.x        | 22       |
| 25.x        | 1.84.0+  | 25.x        | 22       |

## Installation

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32v1-none
cargo install stellar-cli --version "22.8.1" --locked
rustc --version   # → 1.81.0
stellar --version # → 22.x.x
```

## Build commands

```bash
cargo fmt --all
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo build --workspace --target wasm32v1-none --release
ls -lh target/wasm32v1-none/release/*.wasm
stellar contract bindings typescript \
  --wasm target/wasm32v1-none/release/production_escrow.wasm \
  --output-dir client/src/contracts/production_escrow
```

## Upgrade procedure

1. Open a tracking issue with new SDK version + migration notes.
2. Update `[workspace.dependencies]` and `rust-toolchain.toml`.
3. Fix all compiler errors from breaking changes.
4. Re-run full test suite and CI.
5. Independent security review of changed logic.
6. Update this doc and the compatibility matrix.
7. Record new ABI version in `agro-production/DEPLOYMENT_MANIFEST.md`.
