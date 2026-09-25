# AgroCylo Frontend Setup

This directory contains the marketplace frontend. Installation is shared with
the production frontend through the root npm workspace.

> Follow [the canonical frontend setup](../docs/FRONTEND_SETUP.md) from the
> repository root for the supported Node/npm versions, `npm ci`, launcher
> commands, port overrides, and startup troubleshooting.

## Setup

```bash
# Repository root
npm ci
cp client/.env.example client/.env.local
npm run dev:marketplace
# http://localhost:3000
```

The authoritative variable reference is
[`docs/deployment/environment.md`](../docs/deployment/environment.md).

## Wallet Setup

We use Freighter for interacting with the Stellar network.
- Download and install the [Freighter browser extension](https://www.freighter.app/).
- Set up a wallet and switch to the **Testnet**.
- Fund your Testnet account using the [Stellar Laboratory Faucet](https://laboratory.stellar.org/#account-creator?network=test).

## Environment Variables

The marketplace reads `client/.env.local`. Create it from the repository root:

```bash
cp client/.env.example client/.env.local
```

### Required Variables

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | Backend base URL for REST + Socket.io |
| `NEXT_PUBLIC_CONTRACT_ID` | Deployed Agrocylo escrow contract ID |
| `NEXT_PUBLIC_NATIVE_TOKEN_CONTRACT_ID` | XLM Stellar Asset Contract address |

### Optional Variables

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` | Stellar network passphrase |
| `NEXT_PUBLIC_TOKEN_CONTRACT_ID` | — | Fallback token contract (legacy) |
| `NEXT_PUBLIC_TOKEN_CONTRACT_ID_USDC` | — | USDC token contract (cart/checkout) |
| `NEXT_PUBLIC_TOKEN_CONTRACT_ID_STRK` | — | STRK token contract (cart/checkout) |

> `.env.example` is the canonical reference. If you add a new environment variable, add it there first with a clear comment.

### Testnet Values

```env
NEXT_PUBLIC_API_URL=http://localhost:5000
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"

# Testnet XLM SAC
NEXT_PUBLIC_NATIVE_TOKEN_CONTRACT_ID=CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
```

### Mainnet Values

```env
NEXT_PUBLIC_SOROBAN_RPC_URL=https://rpc.mainnet.stellar.org
NEXT_PUBLIC_NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"
```

## Architecture Overview

- **Framework**: Next.js App Router (React islands)
- **State & Data**: React hooks, Zustand, and React Query (for async data/RPC calls)
- **Wallet Integration**: Freighter API integration for signing and submitting transactions to Soroban.
- **Contract Calls**: Uses `@stellar/stellar-sdk` and auto-generated contract client bindings.
- **API Layer**: All backend REST calls go through a shared API helper at `src/lib/apiHelper.ts` with consistent error shapes.
- **Notifications**: WebSocket integration for real-time order/dispute updates.
- **Onboarding Flow**: Multi-step wizard with built-in geolocation and robust async state handling.

## Local Development

Run the frontend in isolation or alongside the backend. Use `testMode.ts` (if applicable) for mocking wallet behaviors during CI/CD.

## Running Tests

### Unit Tests

```bash
# Run all unit tests
npm test

# Run tests in watch mode
npm run test:ui

# Run accessibility audit tests
npm run test:a11y
```

Unit tests use [Vitest](https://vitest.dev/) with jsdom and React Testing Library. Test files are colocated with their source files (`*.test.ts(x)`).

### E2E Tests

```bash
# Run all E2E tests
npm run test:e2e

# Run E2E tests with interactive UI
npm run test:e2e:ui
```

E2E tests use [Playwright](https://playwright.dev/) and live in `e2e/`. The test suite:
- Mocks Freighter wallet at the browser level via `addInitScript`
- Uses `NEXT_PUBLIC_DEMO_MODE=true` for deterministic backend responses
- Covers wallet connect, product creation, add-to-cart, checkout, order confirmation, and negative-path scenarios
- Fixtures in `e2e/fixtures/` provide reusable wallet and API mock helpers

CI runs E2E tests on `workflow_dispatch` via `.github/workflows/e2e.yml`.

### Coverage

```bash
# Server unit tests with coverage
cd ../server && npm run test:coverage
```

## Troubleshooting
## Content Security Policy

`client/src/proxy.ts` generates a new nonce for every document request and
passes the same policy to Next.js in the request and browser response. Next.js
applies that nonce to its framework and bootstrap scripts. Development alone
adds `'unsafe-eval'` and the page's exact WebSocket origin for Fast Refresh;
production keeps those out of the policy. API, backend WebSocket, Soroban RPC,
Horizon, analytics, and Sentry connections are limited to origins derived from
their configured URLs.

Because nonces are request-specific, the root layout calls `connection()` and
all marketplace pages render dynamically. Static optimization, ISR, and shared
CDN HTML caching are therefore unavailable for this app unless the CSP strategy
changes. Framing remains denied by both `frame-ancestors 'none'` and
`X-Frame-Options: DENY`.


### Missing contract ID errors
Set `NEXT_PUBLIC_CONTRACT_ID` in `.env.local` to the deployed escrow contract address. The frontend will not render on-chain features without it.

### Unreachable backend
Ensure the backend server is running on the port matching `NEXT_PUBLIC_API_URL`. The frontend expects a running backend for REST and WebSocket connections.

### Freighter wallet not detected
Install the [Freighter browser extension](https://www.freighter.app/), switch to Testnet, and fund your account via the [Stellar Laboratory Faucet](https://laboratory.stellar.org/#account-creator?network=test).
