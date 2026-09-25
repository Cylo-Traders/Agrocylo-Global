# Agrocylo — CI / Lint / Build Health Issues

Backlog from a triage of why **every merge-blocking check on `main` is red**.
Contributors cannot tell their own failures apart from pre-existing ones, so
broken code keeps merging past the gate and adding new breakage.

Evidence: CI run `33372889631` and Deploy run `33372889696` on `main`
(commit `1fbb33d`), plus `gh run view --log-failed` per job.

Current job status on `main`:

| Job | Status | Failing step |
|---|---|---|
| Contracts · Rust (Soroban) | ✅ green | — |
| Shared client dependency versions | ✅ green | — |
| Env Drift | ✅ green | — |
| Server · Node.js | ❌ | `npm ci` |
| Server · Prisma integration | ❌ | `npm ci` |
| Client · Next.js | ❌ | Unit tests (28/44 suites, 102/213 tests) |
| Agro-Production Client · Next.js | ❌ | Type check (40 errors) |
| Server E2E · Soroban | ❌ | `npm ci` → `husky` exit 127 |
| Deploy | ❌ | all 4 image builds + contract deploy |

Labels: `Stellar Wave` on every issue.

---

### 1. [CI] `server/` `npm ci` fails — OpenTelemetry peer-dependency conflict blocks two CI jobs

**Problem**
`Server · Node.js` and `Server · Prisma schema/migration integration` both fail
on their very first step, `npm ci`, with `ERESOLVE`:

```
While resolving: @opentelemetry/sdk-node@0.51.1
Found: @opentelemetry/api@1.9.1
Could not resolve dependency:
peer @opentelemetry/api@">=1.3.0 <1.9.0" from @opentelemetry/sdk-node@0.51.1
Conflicting peer dependency: @opentelemetry/api@1.8.0
```

`server/package.json` pins `@opentelemetry/api: ^1.9.1` while the
`@opentelemetry/*` SDK/exporter set is pinned at `0.51.1`, whose peer range is
`>=1.3.0 <1.9.0`. `@sentry/node@8.55.2` additionally pulls in
`@opentelemetry/instrumentation@0.57.2` and 24 sibling instrumentations,
producing an unsatisfiable graph. Nothing in `server/` can be installed from a
clean checkout — which also breaks the `server` Docker image build in Deploy
and Compose CI.

**Suggested implementation**
- Establish whether the standalone OpenTelemetry SDK is actually used.
  `@sentry/node` v8 already bundles OTel instrumentation; if tracing goes
  through Sentry, drop `@opentelemetry/sdk-node`,
  `@opentelemetry/auto-instrumentations-node`, `@opentelemetry/sdk-trace-node`,
  and the `exporter-trace-otlp-*` packages entirely.
- If OTel is kept standalone, move the whole `@opentelemetry/*` set onto one
  current minor whose peer range accepts `@opentelemetry/api@^1.9.x`, and align
  it with the version `@sentry/node` already resolves.
- Regenerate `server/package-lock.json` and commit a lockfile `npm ci` accepts
  with no `--force` / `--legacy-peer-deps`.
- Add `engines.node` matching the CI Node version.

**Acceptance criteria**
- [ ] `npm ci` in `server/` succeeds from a clean checkout and an empty npm cache, with no override flags.
- [ ] `npm ls @opentelemetry/api` reports a single resolved version and no unmet peers.
- [ ] `Server · Node.js` and `Server · Prisma integration` both get past `Install dependencies`.
- [ ] `docker compose build server` succeeds.

**Tests required**
- CI job runs `npm ci` on a runner with a cold cache (already the case) and passes.
- If OTel is removed: a test asserting the tracing/observability entry point still initialises without throwing when `SENTRY_DSN` is unset.

---

### 2. [CI] Root `"prepare": "husky"` makes `npm ci` fail with exit 127 in CI

**Problem**
`Server E2E · Soroban Integration` fails on `npm ci` with:

```
npm error code 127
npm error command sh -c husky
npm error path /home/runner/work/Agrocylo-Global/Agrocylo-Global
```

The root `package.json` declares `"prepare": "husky"`. `agro-production/client`
is a root workspace member, so the workflow's `npm ci --legacy-peer-deps` in
that directory resolves up to the root and runs the root `prepare` lifecycle
script before `husky`'s bin is linked (or at all, on a `--omit=dev`-style
install). `server/package.json` already carries the workaround `"prepare": ""`,
which shows this has been hit before and patched locally rather than fixed.

**Suggested implementation**
- Replace the root script with a guarded form that is a no-op in CI and when
  husky is absent, e.g.
  `"prepare": "node -e \"process.env.CI||require('husky')()\" || true"`, or the
  simpler `"prepare": "husky || true"`.
- Remove the `"prepare": ""` stub from `server/package.json` so local hooks work
  consistently again.
- Confirm hooks still install on a fresh local `npm install`.

**Acceptance criteria**
- [ ] `npm ci` succeeds at the repo root and in every workspace member, in CI and locally.
- [ ] Git hooks still install on a developer's local `npm install`.
- [ ] `Server E2E` gets past its two install steps.

**Tests required**
- CI: a job step running `CI=true npm ci` at the root exits 0.
- Manual: `rm -rf node_modules && npm install` locally still writes `.husky/_`.

---

### 3. [Frontend] `client/` vitest — React resolves to `null`, failing 28 suites / 102 tests

**Problem**
`Client · Next.js → Unit tests` fails: **28 of 44 suites, 102 of 213 tests**.
The dominant errors are React internals being `null`:

```
Cannot read properties of null (reading 'useState')     ×50
Cannot read properties of null (reading 'useContext')   ×32
Cannot read properties of null (reading 'useMemo')      ×5
Cannot read properties of null (reading 'useEffect')    ×3
Cannot read properties of null (reading 'useRef')       ×1
```

This is the signature of **two React copies (or a mis-resolved React) in the
test environment** — `ReactCurrentDispatcher` is null because the renderer and
the component tree are not sharing one React instance. It appeared with the
Issue #755 migration that made `client` and `agro-production/client` npm
workspace members sharing a hoisted root `node_modules`, without teaching each
app's `vitest.config.ts` to dedupe React.

**Suggested implementation**
- In `client/vitest.config.ts` add `resolve.dedupe: ['react', 'react-dom']` and,
  if needed, explicit `resolve.alias` entries pointing `react` / `react-dom` /
  `react/jsx-runtime` at the single hoisted copy.
- Set `test.server.deps.inline` (or `deps.optimizer`) for
  `@testing-library/react` so it is bundled against the same React.
- Verify with `npm ls react` that exactly one version resolves, and add a
  guard test asserting `require.resolve('react')` is identical from the app and
  from `@testing-library/react`.
- Apply the same fix to `agro-production/client/vitest.config.ts` (same
  workspace, same risk).

**Acceptance criteria**
- [ ] `npm test` in `client/` passes all 44 suites / 213 tests.
- [ ] No `Cannot read properties of null (reading 'use*')` errors remain.
- [ ] `Client · Next.js` reaches and passes the `Build` step.

**Tests required**
- The existing 44 suites must pass unmodified — they are the regression test.
- Add one guard test asserting a single React identity across the app and testing-library.

---

### 4. [Frontend] `client/` vitest — `toBeInTheDocument` is not registered (`Invalid Chai property`)

**Problem**
Nine failures in the client suite are:

```
Error: Invalid Chai property: toBeInTheDocument
```

`@testing-library/jest-dom` is a devDependency and `client/setup.ts` exists, but
its matchers are not reaching the running suites — the vitest `setupFiles` entry
is either missing, pointing at the wrong path after the workspace move, or the
setup file is not importing `@testing-library/jest-dom/vitest`. The reported
`setup 0ms` timing in the vitest summary corroborates that the setup file never
executes.

**Suggested implementation**
- Confirm `client/vitest.config.ts` has `test.setupFiles: ['./setup.ts']`
  resolved relative to the config file.
- Ensure `setup.ts` imports `@testing-library/jest-dom/vitest` (the vitest
  entry point), not the bare `@testing-library/jest-dom`.
- Add `afterEach(cleanup)` if not already present.
- Mirror the fix in `agro-production/client`.

**Acceptance criteria**
- [ ] `toBeInTheDocument`, `toHaveTextContent`, and the other jest-dom matchers work in every suite.
- [ ] The vitest summary reports non-zero `setup` time.
- [ ] No `Invalid Chai property` errors remain.

**Tests required**
- A minimal smoke test asserting `expect(document.body).toBeInTheDocument()` passes.
- The nine currently-failing assertions pass unmodified.

---

### 5. [Frontend] `agro-production/client` — `Product` type has drifted from every consumer (23 of 40 tsc errors)

**Problem**
`Agro-Production Client · Next.js → Type check` fails with **40 errors**, and
the single largest cluster is the `Product` type missing fields that six pages
and two components read:

```
Property 'unit' does not exist on type 'Product'.            ×7
Property 'quantity' does not exist on type 'Product'.        ×4
Property 'pricePerUnit' does not exist on type 'Product'.    ×4
Property 'location' does not exist on type 'Product'.        ×2
Property 'farmerAddress' does not exist on type 'Product'.   ×2
Object literal ... 'location' does not exist in type 'ProductFilters'.
```

Affected: `src/app/marketplace/page.tsx`, `src/app/product/[id]/page.tsx`,
`src/app/farmer-dashboard/page.tsx`, `src/app/group-orders/page.tsx`,
`src/components/ProductCard.tsx`, `src/services/orderService.ts`. The type was
narrowed (or regenerated from a different source) without updating consumers,
and the job has been red long enough that nobody noticed.

**Suggested implementation**
- Reconcile the `Product` / `ProductFilters` types against what the API actually
  returns — cross-check `agro-production/server`'s product route/serializer and
  the Prisma `Product` model (`price_per_unit`, `stock_quantity`, `unit`,
  `location`, `farmer_wallet`).
- Restore the missing fields with correct optionality, and add `location` to
  `ProductFilters`.
- Prefer deriving the client type from one shared definition (e.g. a
  `packages/*` types module) rather than hand-maintaining two copies.

**Acceptance criteria**
- [ ] `npx tsc --noEmit` in `agro-production/client` reports zero `Product` / `ProductFilters` errors.
- [ ] Field names and optionality match the server's actual response shape.
- [ ] No `as any` / `@ts-expect-error` used to silence these.

**Tests required**
- A type-level test (or runtime parse test) asserting a real API response payload satisfies `Product`.
- Existing marketplace / product-detail component tests still pass.

---

### 6. [Frontend] `agro-production/client` — service, hook and module-export drift (remaining 17 tsc errors)

**Problem**
The rest of the 40 type errors are stale call sites against APIs that changed
shape:

```
Property 'event' does not exist on type 'WsMessage'.                     ×6
Property 'lastMessage' does not exist on type 'UseWebSocketReturn'.
Property 'patch' does not exist on type 'ApiClient'.
Property 'stroops' does not exist on type 'StroopAmountResult'.
Module '"@/services/productService"' has no exported member 'validateProductFilters'.
Module '"@/services/productService"' has no exported member 'isNetworkError'.
Module '"@/components/PriceChart"' has no exported member 'PriceChart'.
Type 'bigint' is not assignable to type 'string'.
Type 'Location' is not assignable to type 'string & Location'.
Property 'NODE_ENV' is missing in type 'Record<string, string|undefined>'.
Parameter 'e' implicitly has an 'any' type.
Expected 1-2 arguments, but got 0.
No overload matches this call.
MockInstance<...> is not assignable to MockInstance<unknown[], unknown>.
```

Affected: `src/hooks/useInvest.ts`, `src/components/InvestmentDashboard.tsx`,
`src/components/WeatherAdvisoryWidget.tsx`,
`src/app/campaigns/create/page.tsx`,
`src/app/campaigns/[id]/messages/page.tsx`, `src/app/portfolio/page.tsx`,
`src/__tests__/telemetry.test.ts`, `src/__tests__/useWebSocket.test.ts`.

**Suggested implementation**
- Fix each call site against the current API rather than widening the types:
  `WsMessage` uses a different discriminator than `event`; `useWebSocket`
  no longer returns `lastMessage`; `ApiClient` has no `patch`;
  `StroopAmountResult` renamed its field.
- Add the missing `productService` exports (`validateProductFilters`,
  `isNetworkError`) or update the importers if they were deliberately removed.
- `PriceChart` is a default export — change the import.
- Fix the `bigint`→`string` conversion explicitly (`.toString()`), not by casting.
- Type the implicit-`any` handler parameter; give the `process.env` mock a
  `NODE_ENV`.

**Acceptance criteria**
- [ ] `npx tsc --noEmit` in `agro-production/client` exits 0.
- [ ] `Agro-Production Client · Next.js` reaches and passes `Unit tests` and `Build`.
- [ ] No new `any` / `@ts-ignore` introduced.

**Tests required**
- `useWebSocket` and `useInvest` unit tests updated to the current return shapes and passing.
- `telemetry.test.ts` and `useWebSocket.test.ts` compile and pass.

---

### 7. [DevOps] Deploy — all four image builds fail: GHA cache export needs `setup-buildx-action`

**Problem**
Every `Build · {server,client,agro-server,agro-client}` job in `deploy.yml`
fails with:

```
ERROR: failed to build: Cache export is not supported for the docker driver.
buildx failed with: ...
```

`docker/build-push-action@v6` is configured with `cache-from: type=gha` /
`cache-to: type=gha,mode=max`, but the workflow never runs
`docker/setup-buildx-action`, so buildx falls back to the default `docker`
driver, which cannot export a cache. Because `deploy` needs `build-images`, the
whole pipeline then fails and the `Rollback` job runs on every push to `main`.

**Suggested implementation**
- Add `- uses: docker/setup-buildx-action@v3` before the login/build steps in
  the `build-images` job (and add `docker/setup-qemu-action` only if
  multi-arch is wanted).
- Re-verify `cache-from`/`cache-to` work, or drop them if the build is fast
  enough without.

**Acceptance criteria**
- [ ] All four `Build · <app>` jobs succeed and push tagged images to ghcr.io.
- [ ] No `Cache export is not supported` error.
- [ ] `Rollback` no longer runs on an ordinary push to `main`.

**Tests required**
- A Deploy run on `main` (or `workflow_dispatch` against staging) completes the `build-images` matrix green.

---

### 8. [DevOps] Deploy — `cargo install stellar-cli` fails on a missing system library

**Problem**
`Deploy contracts · testnet` fails after ~5 minutes:

```
error: failed to run custom build command for `libdbus-sys v0.2.5`
error: failed to compile `stellar-cli v22.8.2`
Process completed with exit code 101.
```

`stellar-cli` pulls in `libdbus-sys` (via its keyring/secret-store dependency),
which needs `libdbus-1-dev` and `pkg-config` present at build time. The runner
has neither. Building the CLI from source also costs 5+ minutes of every run.

**Suggested implementation**
- Preferred: stop compiling it — install the released binary
  (`stellar/stellar-cli` GitHub release tarball, or the official
  `stellar/actions/stellar-cli` action) and pin the version.
- If `cargo install` must stay: add
  `sudo apt-get update && sudo apt-get install -y libdbus-1-dev pkg-config`
  before it, and consider `--no-default-features` to drop the keyring
  dependency.
- Cache the resulting binary between runs.

**Acceptance criteria**
- [ ] `Deploy contracts · testnet` installs the CLI successfully.
- [ ] The install step takes well under a minute on a warm run.
- [ ] The CLI version is pinned and recorded in the job log.

**Tests required**
- A `workflow_dispatch` staging run reaches `scripts/deploy-contracts.sh` with a working `stellar` binary on `PATH`.

---

### 9. [DevOps] Deploy runs on every push to `main` and always ends in `Rollback`

**Problem**
`deploy.yml` triggers on every `push` to `main` with no dependency on CI being
green. Because of issues 7 and 8 it fails every time, and the `if: failure()`
`Rollback` job then runs `flyctl releases rollback` against all four production
Fly apps on **every merge**. Combined with a red `CI`, the repository has a
staging deploy that both never succeeds and routinely issues rollbacks.

**Suggested implementation**
- Gate the deploy on CI success — either `workflow_run:` (`workflows: [CI]`,
  `types: [completed]`, with an `if: github.event.workflow_run.conclusion == 'success'`
  guard) or a `needs:`-linked reusable workflow.
- Scope `Rollback` so it only fires when a `deploy`/`smoke-test` job actually
  ran and failed — not when an upstream build job failed before anything was
  released (`if: failure() && needs.deploy.result == 'failure'`).
- Consider making staging deploys `workflow_dispatch`-only until the pipeline
  is reliably green.

**Acceptance criteria**
- [ ] Deploy does not start unless CI for that commit is green.
- [ ] `Rollback` cannot run when nothing was deployed.
- [ ] A failing image build no longer touches production Fly apps.

**Tests required**
- Push a commit that fails CI: Deploy must be skipped entirely.
- Force a build-stage failure: `Rollback` must not execute.

---

### 10. [CI] Lint is non-blocking on both clients, hiding ~86 pre-existing errors

**Problem**
Both Next.js jobs run `npm run lint` with `continue-on-error: true`, per the
comments in `ci.yml`: ~20 pre-existing errors in `client/` (surfaced when
`next lint` was replaced with `eslint .` in Issue #755, because the old script
crashed before linting a single file) and ~66 in `agro-production/client`
(surfaced by the flat-config migration). The `Lint` check therefore reports
green while failing, so lint quality is unenforced and the backlog keeps
growing.

**Suggested implementation**
- Triage the two error sets; auto-fix what `eslint --fix` can handle.
- For genuinely intentional patterns, add scoped `eslint-disable-next-line`
  comments with a reason, or narrow the rule in the flat config — not a blanket
  disable.
- Once each app is clean, remove `continue-on-error: true` so `Lint` blocks.
- Land it per-app so the two efforts can be reviewed independently.

**Acceptance criteria**
- [ ] `npm run lint` exits 0 in `client/` and in `agro-production/client`.
- [ ] `continue-on-error` is removed from both `Lint` steps.
- [ ] No blanket rule disables were added to make it pass.

**Tests required**
- CI: a PR introducing a deliberate lint error fails the `Lint` step.

---

### 11. [CI] A PR touching one app runs — and fails on — every other app's jobs

**Problem**
`ci.yml` declares one workflow with six jobs and a single workflow-level
`paths:` filter. Any matching change (e.g. a `client/**`-only PR) starts the
whole workflow, so contributors see `Server · Node.js`, `Server · Prisma
integration`, and `Agro-Production Client` fail for reasons entirely unrelated
to their change. This is the direct cause of the "checks are always red"
complaint: there is no signal that a contributor's own work is sound.

**Suggested implementation**
- Add per-job change detection with `dorny/paths-filter` in a small `changes`
  job, and gate each downstream job on `if: needs.changes.outputs.<app> == 'true'`.
- Alternatively split `ci.yml` into `ci-client.yml`, `ci-server.yml`,
  `ci-contracts.yml`, `ci-agro-client.yml`, each with its own `paths:`.
- Keep the merge queue honest by listing the jobs as required checks that pass
  trivially (skipped) when not relevant.
- Document in `CONTRIBUTING.md` which checks a given change is expected to run.

**Acceptance criteria**
- [ ] A `client/**`-only PR runs the client job (plus shared checks) and does not run server or contract jobs.
- [ ] A `contracts/**`-only PR runs only the contracts job.
- [ ] Required-check configuration still blocks merges when a relevant job fails.

**Tests required**
- Open a scratch PR touching only `client/` and confirm the run's job list.
- Open a scratch PR touching only `contracts/` and confirm the same.

---

## Summary

| # | Area | Blocks | Severity |
|---|---|---|---|
| 1 | `server/` npm ci — OTel peer conflict | Server ×2, Compose, Deploy | Blocker |
| 2 | Root `prepare: husky` breaks `npm ci` | Server E2E | Blocker |
| 3 | `client/` vitest React resolves to null | Client unit tests | Blocker |
| 4 | `client/` jest-dom matchers not registered | Client unit tests | High |
| 5 | `agro-production/client` `Product` type drift | Agro client typecheck | Blocker |
| 6 | `agro-production/client` service/hook drift | Agro client typecheck | Blocker |
| 7 | Deploy image builds — buildx cache driver | Deploy | High |
| 8 | Deploy — `stellar-cli` build deps | Deploy | High |
| 9 | Deploy ungated + spurious rollbacks | Deploy | High |
| 10 | Lint non-blocking, ~86 hidden errors | quality gate | Medium |
| 11 | No per-job path filtering | contributor signal | High |
