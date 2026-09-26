# Agro Production — Client

This directory contains the campaign/crowdfunding frontend. It shares the
root npm workspace and lockfile with the marketplace client.

> Follow [the canonical frontend setup](../../docs/FRONTEND_SETUP.md) from the
> repository root for the Node.js 22.13.x/npm 10.9.x policy, `npm ci`, launcher
> commands, port overrides, and startup troubleshooting.

## Setup

```bash
# Repository root
npm ci
cp agro-production/client/.env.example agro-production/client/.env.local
npm run dev:production
# http://localhost:3001
```

## Environment Variables

This app reads `agro-production/client/.env.local`. The authoritative
per-app reference is
[`docs/deployment/environment.md`](../../docs/deployment/environment.md);
`.env.example` drift is checked in CI.

| Client var | Server var it mirrors | Required | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | `PORT` (derived) | Yes | REST base URL, e.g. `http://localhost:5001` |
| `NEXT_PUBLIC_WS_URL` | `PORT` (derived) | No | WebSocket URL; auto-derived from `window.location` if omitted |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | `RPC_URL` | Yes | Both client and server should point to the same RPC endpoint |
| `NEXT_PUBLIC_PRODUCTION_CONTRACT_ID` | `PRODUCTION_CONTRACT_ID` / `PRODUCTION_ESCROW_CONTRACT_ID` | Yes | On-chain production-escrow contract address |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | — | Yes | Stellar network passphrase (client-only) |
| `NEXT_PUBLIC_NATIVE_TOKEN_CONTRACT_ID` | — | No | XLM native token SAC address |

Available root commands

- `npm run dev:production` — start only this app on port 3001
- `npm run build --workspace=agro-production/client` — production build
- `npm run test --workspace=agro-production/client` — Vitest suite
- `npm run lint --workspace=agro-production/client` — ESLint
- `npm run test:e2e --workspace=agro-production/client` — Playwright journey, including the wallet picker
- `npm run smoke:wallets --workspace=agro-production/client` — testnet Soroban signing/submission through the kit with two wallet-family signer modules (see [docs/WALLETS.md](docs/WALLETS.md))

## Wallets

Wallet connectivity runs entirely through
[Stellar Wallets Kit](https://github.com/Creit-Tech/Stellar-Wallets-Kit) v2
behind the `WalletAdapter` boundary in `src/lib/wallets/`. The supported
browser/mobile/web/hardware matrix, the reviewed module set, WalletConnect
opt-in, the test suites, and the testnet smoke test are documented in
[`docs/WALLETS.md`](docs/WALLETS.md).

Notes for developers
- API calls are centralized in `src/lib/apiClient.ts` and wrapped by the service modules in `src/services/*`.
- Wallet context is in `src/context/WalletContext.tsx`; everything wallet-specific lives in `src/lib/wallets/`. No feature code should branch on a provider name.
