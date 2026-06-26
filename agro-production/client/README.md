# Agro Production — Client

Quick start and development notes for the `agro-production/client` frontend.

Prerequisites
- Node.js 18+ and npm or pnpm

Install

```bash
npm install
```

## Environment Variables

Copy the example file and fill in real values:

```bash
cp .env.example .env
```

A unified example covering both server and client vars lives at `agro-production/.env.example`.

| Client var | Server var it mirrors | Required | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | `PORT` (derived) | Yes | REST base URL, e.g. `http://localhost:5001` |
| `NEXT_PUBLIC_WS_URL` | `PORT` (derived) | No | WebSocket URL; auto-derived from `window.location` if omitted |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | `RPC_URL` | Yes | Both client and server should point to the same RPC endpoint |
| `NEXT_PUBLIC_PRODUCTION_CONTRACT_ID` | `PRODUCTION_CONTRACT_ID` / `PRODUCTION_ESCROW_CONTRACT_ID` | Yes | On-chain production-escrow contract address |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | — | Yes | Stellar network passphrase (client-only) |
| `NEXT_PUBLIC_NATIVE_TOKEN_CONTRACT_ID` | — | No | XLM native token SAC address |

Available scripts
- `npm run dev` — start Next.js dev server
- `npm run build` — build for production
- `npm run start` — start built app
- `npm run test` — run unit/integration tests (Vitest)
- `npm run storybook` — start Storybook for components

Testing
- Tests use Vitest and simple DOM mocking. Run `npm run test` to execute.

Storybook
- Start with `npm run storybook`. Stories live under `src/**/*.stories.*`.

Notes for developers
- API calls are centralized in `src/lib/apiClient.ts` and wrapped by the service modules in `src/services/*`.
- Wallet context and signer code are in `src/context/WalletContext.tsx` and `src/lib/signTransaction.ts`.
