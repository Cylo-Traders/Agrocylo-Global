# AgroCylo Frontend Setup

Welcome to the AgroCylo frontend repository. This document outlines the setup, architecture, and environment configuration.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the development server:
   ```bash
   npm run dev
   ```

## Wallet Setup

We use Freighter for interacting with the Stellar network.
- Download and install the [Freighter browser extension](https://www.freighter.app/).
- Set up a wallet and switch to the **Testnet**.
- Fund your Testnet account using the [Stellar Laboratory Faucet](https://laboratory.stellar.org/#account-creator?network=test).

## Environment Variables

Copy `.env.example` to `.env.local` and fill in the required values:

```bash
cp .env.example .env.local
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

## Troubleshooting

### Missing contract ID errors
Set `NEXT_PUBLIC_CONTRACT_ID` in `.env.local` to the deployed escrow contract address. The frontend will not render on-chain features without it.

### Unreachable backend
Ensure the backend server is running on the port matching `NEXT_PUBLIC_API_URL`. The frontend expects a running backend for REST and WebSocket connections.

### Freighter wallet not detected
Install the [Freighter browser extension](https://www.freighter.app/), switch to Testnet, and fund your account via the [Stellar Laboratory Faucet](https://laboratory.stellar.org/#account-creator?network=test).
