# Client contributor guide

This guide is for contributors changing the **Next.js clients** in this
monorepo. It answers four questions fast: *which app owns this UI?*, *how do I
run only that app?*, *where do components/services/tests live?*, and *what
checks are expected before a PR?*.

For the full, canonical setup and troubleshooting, see
[Frontend development setup](FRONTEND_SETUP.md). For the repository-wide map,
see [ARCHITECTURE.md](../ARCHITECTURE.md).

## Workspace map

The repo is an npm/Turborepo monorepo. Two Next.js clients plus API and
contract workspaces:

| Workspace | Path | Role | Dev URL |
|---|---|---|---|
| Marketplace client | [`client/`](../client) | Peer-to-peer produce marketplace (buyers + farmers) | http://localhost:3000 |
| Production client | [`agro-production/client/`](../agro-production/client) | Campaign / crowdfunding flows | http://localhost:3001 |
| Marketplace API | [`server/`](../server) | Express + Prisma API for the marketplace | http://localhost:5000 |
| Production API | [`agro-production/server/`](../agro-production/server) | Campaign API & event indexer | http://localhost:5001 |
| Shared packages | [`packages/`](../packages) | Shared code (e.g. [`@agrocylo/instrumentation`](../packages/instrumentation)) | — |
| Contracts | [`contracts/`](../contracts) | Soroban (Rust) escrow & registry | — |

**Identifying the owner of a UI:** a route under `client/src/app/` belongs to
the marketplace client; a route under `agro-production/client/src/app/`
belongs to the production client. When in doubt, search both app trees for the
component or copy before editing.

## Required toolchain

Use **Node.js 22.13.x** and **npm 10.9.x** (declared in
[`.nvmrc`](../.nvmrc) and the root `package.json`). Node 18 and earlier are not
supported by the current Next.js version.

```bash
nvm use
npm run check:toolchain
```

Install once from the repository root — the clients are npm workspaces sharing
the committed root `package-lock.json`:

```bash
npm ci
```

Do **not** run `npm install` inside `client/` or `agro-production/client/`, and
do not create per-app lockfiles. Use root `npm install` only for intentional
dependency changes, then commit the root lockfile update.

## Run only the app you are changing

From the repository root:

```bash
npm run dev:marketplace     # client only  → http://localhost:3000
npm run dev:production      # agro client → http://localhost:3001
npm run dev                 # both, through Turbo
```

Each app loads its own local env file. Copy the maintained examples (never
commit the result, and never paste real secrets into a PR):

```bash
cp client/.env.example client/.env.local
cp agro-production/client/.env.example agro-production/client/.env.local
```

The authoritative per-variable reference is
[docs/deployment/environment.md](deployment/environment.md).

## Local API setup

The clients call the Express APIs, not the contracts directly. Start the API
that matches the client you are testing:

```bash
# Marketplace API (port 5000)
cd server
nvm use
cp .env.example .env      # fill DATABASE_URL + required secrets locally
npm ci
npm run prisma:generate
npx prisma migrate dev
npm run dev

# Production API (port 5001)
cd agro-production/server
npm install
npm run dev
```

Point the client at the API with `NEXT_PUBLIC_API_URL` in that app's
`.env.local` (default `http://localhost:5000`). For UI-only work you can set
`NEXT_PUBLIC_DEMO_MODE=true` to get deterministic dummy data without a backend —
never set this in production. See
[client/.env.example](../client/.env.example) for the full list.

## Issue triage guidance

Issues live in
[GitHub Issues](https://github.com/Cylo-Traders/Agrocylo-Global/issues); there
are no in-tree backlog files. Before starting:

1. Find an issue and read its acceptance criteria.
2. Comment to claim it and wait for maintainer feedback on substantial work.
3. Use labels to route attention: `area:frontend` for client work,
   `type:bug` / `type:feature` / `type:refactor`, `good-first-issue` for
   first contributions, and `Stellar Wave` for bounty-eligible work.
4. Keep the PR scoped to the issue; reference it (`Closes #123`).

## Where code and tests live (marketplace client)

| Concern | Location |
|---|---|
| Routes / pages | [`client/src/app/`](../client/src/app) |
| Components | [`client/src/components/`](../client/src/components) |
| Services (API calls) | [`client/src/services/`](../client/src/services) |
| Data hooks (React Query) | [`client/src/hooks/queries/`](../client/src/hooks/queries) |
| Shared types | [`client/src/types/`](../client/src/types) |
| Unit / component tests | alongside source as `*.test.ts` / `*.test.tsx` (e.g. [`client/src/components/ProductFormModal.test.tsx`](../client/src/components/ProductFormModal.test.tsx)) |
| E2E tests (Playwright) | [`client/e2e/`](../client/e2e) |

The production client mirrors this layout under
`agro-production/client/src/`.

## UI & accessibility expectations

- Follow existing patterns and the shared UI primitives in
  [`client/src/components/ui/`](../client/src/components/ui).
- Accessibility is a requirement, not a follow-up: see
  [client/ACCESSIBILITY.md](../client/ACCESSIBILITY.md). Ship keyboard
  reachable controls, visible focus, accessible names, and text (never
  color alone) for status.
- Keep layouts usable at 320 CSS pixels with no horizontal scrolling, and make
  primary actions reachable without covering fields or validation messages.
- Add or update tests for behavior you change; see
  [client/TESTING_GUIDE.md](../client/TESTING_GUIDE.md).

## Commands: lint, build, test

Run from the repository root, targeting one workspace:

```bash
# Marketplace client
npm run lint --workspace=client
npm run build --workspace=client
npm test --workspace=client
npm run test:e2e --workspace=client

# Production client
npm run lint --workspace=agro-production/client
npm run build --workspace=agro-production/client
npm test --workspace=agro-production/client
```

Root `npm run lint`, `npm run build`, and `npm test` run the matching task
across both clients and shared packages via Turbo. Type-check with
`npx tsc --noEmit --project client/tsconfig.json` (or the production
equivalent). CI must be green before merge; only the checks relevant to your
changed paths are required.

## Before you open a PR

- [ ] `npm run lint` and `npm test` pass for the workspace you touched.
- [ ] New behavior has tests; E2E updated when a flow changed.
- [ ] No `.env.local`, secrets, or real credentials committed.
- [ ] PR references the issue and explains the change.