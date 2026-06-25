# Agro Production — Client

Quick start and development notes for the `agro-production/client` frontend.

Prerequisites
- Node.js 18+ and npm or pnpm

Install

```bash
npm install
```

Env

Copy `../.env.example` to `.env.local` and replace the `REPLACE_WITH_*` placeholders before running the client. Next.js only exposes variables prefixed with `NEXT_PUBLIC_` to browser code, so server contract/RPC settings must be mirrored with the public client names below.

| Server variable | Client variable | Required by client | Notes |
| --- | --- | --- | --- |
| `RPC_URL` | `NEXT_PUBLIC_SOROBAN_RPC_URL` | Yes | Soroban RPC endpoint. Defaults to Stellar testnet when omitted. |
| `PRODUCTION_CONTRACT_ID` | `NEXT_PUBLIC_PRODUCTION_CONTRACT_ID` | Yes for contract flows | Production escrow contract ID used by `src/lib/contractService.ts`. |
| `PORT` | `NEXT_PUBLIC_API_URL` | Yes for API calls | API base URL, usually `http://localhost:5001/api/v1` in local dev. |
| `PORT` | `NEXT_PUBLIC_WS_URL` | Optional | WebSocket URL, usually `ws://localhost:5001/ws`; the hook derives this when omitted. |
| n/a | `NEXT_PUBLIC_NETWORK_PASSPHRASE` | Yes for contract flows | Stellar network passphrase. Defaults to testnet. |
| n/a | `NEXT_PUBLIC_ANALYTICS_ENABLED` | Optional | Set to `false` to disable client analytics. |
| n/a | `NEXT_PUBLIC_ERROR_REPORTING_ENABLED` | Optional | Set to `false` to disable client error reporting. |

To export the common client values from a server `.env` file:

```bash
set -a && source ../.env.example && set +a
node ../scripts/export-client-env.mjs > .client-env.sh
source .client-env.sh
```

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
