# Wallet Support (agro-production client)

The production client connects **any compatible Stellar wallet** through
[Stellar Wallets Kit](https://github.com/Creit-Tech/Stellar-Wallets-Kit) v2.
There are no provider-specific bridges left in the app: the handwritten
Freighter, Rabet, and Hana adapters were removed once the kit reached feature
parity, and no feature code branches on a provider name.

Pinned package: `@creit.tech/stellar-wallets-kit@2.6.0`.

## Architecture

```
UI  →  WalletContext        (connect / disconnect / reconnect, session persistence)
     →  lib/wallets/registry.ts          (adapter lookup, default id)
     →  lib/wallets/stellarKitAdapter.ts (the only place the kit is touched)
     →  StellarWalletsKit                 (init once, authModal, setWallet, getAddress, signTransaction)
     →  provider module
```

`lib/wallets/types.ts` defines the `WalletAdapter` boundary. Everything above
it — components, hooks, transaction code — is wallet-agnostic and can keep
working while providers change underneath.

| Export | Purpose |
| ------ | ------- |
| `initializeWalletKit(walletId?)` | Idempotent `StellarWalletsKit.init` with the reviewed module set; re-selects a wallet on later calls |
| `connectWithWalletModal()` | Opens the kit's own picker; returns `{ address, walletId }` |
| `WALLET_ADAPTERS` / `getWalletAdapter(id)` | One typed adapter per enabled module |
| `refreshWalletAvailability()` | Availability for the picker, with unavailable rows rendered as install links |
| `disconnectWallet()` | Kit disconnect plus local session clear |
| `isWalletError(error)` | Provider-agnostic error classification used by `lib/errorHandling.ts` |

## Supported wallet matrix

| Wallet | id | Platforms | Deep link | Enabled | Notes |
| ------ | -- | --------- | --------- | ------- | ----- |
| Freighter | `freighter` | browser, mobile | no | yes | Default selection |
| xBull Wallet | `xbull` | browser, web, mobile | yes | yes | Orion/Capricon web wallet |
| Albedo | `albedo` | web, mobile | yes | yes | In-browser extension |
| Rabet | `rabet` | browser | no | yes | |
| Hana | `hana` | browser | no | yes | |
| LOBSTR | `lobstr` | browser, mobile | yes | yes | |
| WalletConnect (LOBSTR et al.) | `wallet_connect` | mobile | yes | on demand | Only registered when `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is set |

Hardware wallets are reachable through the providers above on their own hosts
(Albedo and LOBSTR mobile apps wrap hardware keys); the kit's `HW_WALLET`
modules are **not** enabled, so Ledger, Trezor, OneKey, dCENT, and Fordefi are
intentionally absent. Enabling one is a single entry in `ENABLED_WALLET_IDS` in
`lib/wallets/stellarKitAdapter.ts` — the reviewed set is filtered out of
`defaultModules()` rather than hand-picked, so a new kit module does not reach
production unreviewed.

### Enabling WalletConnect

```bash
# .env.local in agro-production/client
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<project id from cloud.walletconnect.com>
NEXT_PUBLIC_APP_URL=https://<your app origin>
```

Without a project id the module is skipped entirely, so no WalletConnect
relay code is bundled or reachable.

## Environment

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | `Networks.TESTNET` | Network the kit signs against. Must be a `Networks` enum value; anything else falls back to testnet. |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | unset | Enables the `wallet_connect` module when present |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3001` | WalletConnect metadata origin |

## Unavailable and unsupported providers

`refreshWalletAvailability()` reports each module's availability. A provider
that reports unavailable is rendered in the picker as a link to its
`installUrl` (labelled "Open / install" for deep-link-capable wallets) instead
of a connect button, so the user always gets an actionable path. A rejected
connection shows the kit's own message and persists nothing.

## Tests

| Suite | Command | Covers |
| ----- | ------- | ------ |
| Adapter contract | `npx vitest run src/__tests__/walletAdapters.test.ts` | Every enabled module against a provider fixture: metadata, availability, address, network, signing, rejection, disconnect, silent restore |
| Context | `npx vitest run src/__tests__/wallet.test.tsx` | Kit modal, specific-provider connect, reconnect, stale session, disconnect, rejection |
| Browser | `npm run test:e2e` (`e2e/wallet-picker.spec.ts`) | Picker success, provider rejection, unavailable provider, persisted selection across reload, dropped stale session |
| Testnet | `node scripts/wallet-testnet-smoke.mjs` | One harmless contract invocation signed through the kit and submitted by two different wallet-family signer modules |

### Testnet smoke test

`scripts/wallet-testnet-smoke.mjs` signs and submits a single harmless
invocation on Stellar testnet with two different wallet families. It requires
funded testnet keys and never prints a private key or a full signed XDR — only
the transaction hash and a truncated `signedTxXdr` prefix.

```bash
# In agro-production/client:
cp .env.testnet.example .env.testnet   # git-ignored; fill in the values below
node scripts/wallet-testnet-smoke.mjs
```

| Variable | Purpose |
| -------- | ------- |
| `STELLAR_TESTNET_SECRET_1` / `STELLAR_TESTNET_PUBLIC_1` | Funded keypair for family 1. The public key is checked against the secret. |
| `STELLAR_TESTNET_SECRET_2` / `STELLAR_TESTNET_PUBLIC_2` | Funded keypair for family 2. Must be a different account. |
| `SMOKE_CONTRACT_ID` | Scratch testnet contract id. |
| `SMOKE_FUNCTION_NAME` | Harmless, idempotent, argument-free method. Default `ping`. |
| `SMOKE_FUNCTION_ARGS` | JSON array of arguments. Default `[]`. |
| `SOROBAN_TESTNET_RPC_URL` | Optional; defaults to the public testnet RPC. |

The script reads `.env.testnet` next to itself when that file exists, and
variables already exported in the shell always win, so CI can pass secrets
directly with no file at all.

Pick two genuinely different families (for example a browser-extension wallet
and a mobile/deep-link wallet) to prove the kit's abstraction holds, not two
accounts of the same provider.

The script drives the kit's static API with two local signer modules modelled on
those two families: the shipped providers (Freighter, xBull, Albedo, Rabet,
Hana, LOBSTR, WalletConnect) need an injected browser API and cannot run
headless. Real provider behaviour is covered by `e2e/wallet-picker.spec.ts`, the
`WalletAdapter` boundary by `src/__tests__/walletAdapters.test.ts`, and signing
through the kit itself is what this script exercises.

## Adding a provider

1. Add the module's `productId` to `ENABLED_WALLET_IDS` in
   `lib/wallets/stellarKitAdapter.ts` and, if needed, its entry to
   `platformMatrix`.
2. Add a fixture row in `src/__tests__/walletAdapters.test.ts`.
3. Update the matrix table above.
4. Run `npm run lint`, `npx tsc --noEmit`, and the suites in the table.

No component, hook, or transaction module should need a change.
