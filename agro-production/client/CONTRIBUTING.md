# Contributing to Agrocylo Frontend

Thank you for helping improve the Agrocylo frontend. This guide covers everything you need to get started, make a change, and submit a pull request.

---

## Prerequisites

- Node.js 18 or newer
- npm (or pnpm)
- A basic understanding of Next.js (App Router), React, and TypeScript
- Freighter browser wallet extension (for testing wallet flows locally)

---

## Getting started

```bash
# 1. Fork the repository on GitHub, then clone your fork
git clone https://github.com/<your-username>/Agrocylo-Global.git
cd Agrocylo-Global/agro-production/client

# 2. Install dependencies
npm install

# 3. Copy the env example and fill in your values
cp .env.example .env.local

# 4. Start the dev server
npm run dev
```

The app runs at `http://localhost:3000` by default.

### Required environment variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | Backend API base URL (default: `http://localhost:5000`) |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | Soroban RPC endpoint |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | Stellar network passphrase |

---

## Project structure

```
src/
  app/          # Next.js App Router pages and layouts
  components/   # Shared UI components
  context/      # React context providers (wallet, theme)
  hooks/        # Custom React hooks
  lib/          # Pure utilities (API client, signing, validation)
  services/     # Data-fetching service modules
  types/        # TypeScript type definitions
```

Key files to know:
- **`src/lib/apiClient.ts`** — all HTTP calls go through here
- **`src/context/WalletContext.tsx`** — wallet connection state and signer
- **`src/lib/signTransaction.ts`** — Stellar transaction signing logic
- **`src/lib/validation.ts`** — form validation helpers

---

## Running tests

```bash
npm run test          # run all tests once
npm run test -- --watch  # watch mode
```

Tests use [Vitest](https://vitest.dev/) and live alongside source files under `src/__tests__/`. When adding a feature or fixing a bug, add a test that covers the new behaviour.

---

## Storybook (component explorer)

```bash
npm run storybook
```

Stories live in `src/**/*.stories.tsx`. Add a story for any new or significantly changed component so reviewers can inspect it in isolation.

---

## Adding a new wallet adapter

1. Create a new adapter module in `src/lib/` following the pattern of `walletFreighter.ts`.
2. The adapter must implement `connect()`, `getPublicKey()`, and `signTransaction()`.
3. Wire it into `WalletContext.tsx` alongside the existing Freighter adapter.
4. Add a unit test in `src/__tests__/` that mocks the adapter and verifies the integration.
5. Update this file's "Prerequisites" section if the new wallet requires a browser extension.

---

## Adding or updating translations

Locale strings live in `src/lib/` (look for any `i18n` or locale file). To add a new language:

1. Copy an existing locale file and rename it with the target locale code (e.g. `fr.ts`).
2. Translate each string value; do not change the keys.
3. Register the new locale in the locale config/index file.
4. Open a PR with the `translation` label.

---

## Issue and PR checklist

### Before opening an issue

- [ ] Search existing issues to avoid duplicates.
- [ ] Include the browser, OS, and wallet extension version if reporting a UI bug.
- [ ] Attach a screenshot or screen recording where possible.
- [ ] Reference the relevant file path(s) from the project structure above.

### Before submitting a pull request

- [ ] Branch off `main`: `git checkout -b fix/short-description`.
- [ ] Keep changes focused — one concern per PR.
- [ ] Run `npm run test` and confirm all tests pass.
- [ ] Run `npm run build` and confirm there are no TypeScript errors.
- [ ] Add or update a story in Storybook if a component changed visually.
- [ ] Fill in the PR description (what changed, why, how to test it).
- [ ] Link the PR to the relevant GitHub issue using a closing keyword (e.g. `Closes #123`).

### PR review expectations

- Reviewers aim to respond within 48 hours.
- Address all requested changes before asking for a re-review.
- Squash fixup commits before merge if the reviewer asks.

---

## Code style

- TypeScript strict mode is on — no `any` without a comment explaining why.
- Prefer named exports over default exports for components.
- Keep component files focused; extract logic into hooks or service modules.
- Do not commit console.log statements.

---

## Useful links

- [GitHub Issues](https://github.com/Cylo-Traders/Agrocylo-Global/issues) — open issues and backlog
- [README](./README.md) — quick-start and environment reference
- [Backend contributing guide](../../server/docs/SETUP.md) — if you also touch the API
