# Single React runtime, agro-production route boundaries, and product/write-route contract tests

Closes #1089, #1090, #1145.

## Summary

- **#1089:** Regenerated the lockfile with npm 10.9.2 so only one copy of `react` and `react-dom` (19.2.3) is installed. CI now blocks component tests while more than one copy is present.
- **#1090:** Added an app-level `error.tsx` and `not-found.tsx` to agro-production. Both are localized and use theme tokens. Fixed two imports in the root layout that a merge had dropped.
- **#1145:** Added server contract tests for `/products` filters, sorting and paging, and a role matrix for the product, location, demand and supply write routes. Fixed a bug in `POST /locations` validation that rejected every payload the client sends.

---

## #1089: one React runtime

**Problem:** The root `overrides` pin React to 19.2.3, but the lockfile still put a 19.2.8 copy at the root (`peer: true`) next to the 19.2.3 copies inside each workspace. `npm install` alone keeps that stale entry, because npm trusts the lockfile.

**Changes**

- **`package-lock.json`:** Ran `npm install` and then `npm dedupe` with npm 10.9.2 on Node 22. The lockfile was not edited by hand.
  - React and React DOM now have a single copy each, at `node_modules/react` and `node_modules/react-dom` (19.2.3).
  - Dedupe also removed duplicates of `react-is`, `rxjs`, `postcss`, `ws` and `eventemitter3`, and made small patch bumps (`zod` 4.4.3→4.6.7, `@types/node`, `@csstools/*`, `tldts`, `uuid` 14.0.2→14.0.3).
  - The lockfile now records the macOS and Windows native binaries for sharp, `@next/swc`, `@sentry/cli`, rollup and turbo. Before, it had only the linux-x64 ones, so `npm ci` failed for vitest on macOS.
- **`scripts/check-react-runtime.js`:** The check now also fails when the same version is installed at more than one path. Two copies of 19.2.3 are still two module instances, each with its own dispatcher. There is a new test for this case.
- **`.github/workflows/ci.yml`:** Added a "Single React runtime" step to the `client` and `agro-production-client` jobs. It runs before `npm ci` because it only reads the lockfile, so a bad lockfile fails fast.
- **`package.json`:** Replaced the outdated "lockfile still needs regeneration" note with the steps to regenerate it.
- **Vitest `resolve.dedupe`:** Left unchanged in both clients as a second line of defense.

**Known limitation:** The lockfile still has no darwin or win32 entries for some transitive native packages: `esbuild`, `lightningcss`, `@tailwindcss/oxide` and `unrs-resolver` (npm/cli#4828).
- CI on linux-x64 is not affected.
- A fresh install without the lockfile would add them, but it crashes in npm 10's arborist (`Cannot read properties of null (reading 'edgesOut')` while loading the jsdom → canvas peer set). This needs its own follow-up.

## #1090: app-level error and not-found boundaries

**`src/app/error.tsx` (new)**

- It is a client component inside the normal shell, so the NavBar and providers stay mounted.
- It reports the error once and shows a localized safe message, with the `digest` as a reference when there is one.
- It has **Try again** (`reset()`) and **Go home** (`/home`) actions.
- It uses `role="alert"` and moves focus to the heading when it mounts.
- The error message and stack appear only in development, inside a `<details>` element.

**`src/app/not-found.tsx` (new)**

- A branded, localized 404 with a labelled "Helpful links" nav: Home, Marketplace and Campaigns.
- It is a client component only because the locale lives in `I18nContext`.

**`src/lib/errorTracking.ts`**

- Added `reportBoundaryError(error, boundary)`, which sends the error to Sentry with a `boundary` tag and to telemetry with `{ boundary, digest }`.
- Reports are deduplicated per `Error` object. A boundary error used to be reported twice: once by the boundary and once by Next's `console.error` log, which `initErrorTracking` wraps. React StrictMode also runs effects twice.
- Sentry is imported lazily. A static import pulled Sentry's server build into every module that imports this file, which broke `walletErrors.test.ts` under Vitest. Sentry is already in the client bundle through `instrumentation-client.ts`, so the bundle does not grow.

**`src/app/global-error.tsx`**

- Uses the shared reporter and theme-token classes instead of inline styles, and imports `globals.css`.
- It stays in English because the i18n provider has unmounted by then.
- It is still the boundary for crashes in the root layout itself.

**`src/locales/{en,es,fr}/common.json`:** Added `errors.boundary.*` and `errors.notFound.*`.

**`src/app/layout.tsx`:** Restored the `resolveProductionGate` and `ProductionUnavailable` imports that merge `0387289` dropped. Without them, the root layout throws on every route.

**Tests**

- `src/app/__tests__/boundaries.test.tsx` covers:
  - reporting happens once and the message is safe;
  - Retry and Home work;
  - the dev-only details;
  - es/fr locales;
  - the not-found links;
  - `reportBoundaryError` deduplication.
- `e2e/boundaries.spec.ts` checks that an unknown URL returns 404, renders the branded page inside the app shell, and that its links navigate.
- No production route throws on demand, so `error.tsx` is covered by component tests only.

## #1145: server contract tests

**`src/services/productService.test.ts`:** Added tests for the Prisma query each input produces:
- each filter (search, category, farmer/seller, location, minPrice, maxPrice, include_unavailable);
- non-numeric price bounds;
- all filters combined;
- count and findMany using the same `where`;
- the default sort;
- paging edges: page and page_size fallbacks, the 100 cap, `totalPages` rounding, empty results, and a page past the end.

**`src/routes/productRoutes.test.ts` (new)** runs the real route and service against mocked Prisma:
- which query parameter names `GET /products` actually reads (`page_size` is snake_case only, plus the accepted `include_unavailable` values);
- for `POST /products`: anonymous → 401, FARMER and ADMIN → 201, and the caller's wallet is always recorded as the farmer;
- for `PATCH` and `DELETE /products/:id`: owner → 200, non-owner of any role → 403, anonymous → 401, unknown id → 404.

**`src/routes/writeRoutesRoleMatrix.test.ts` (new)**
- **Locations:**
  - POST: anonymous → 401; every role can write its own row; a wallet named in the body is ignored.
  - PATCH and DELETE: own row → 200 or 204; someone else's row → 403.
- **`POST /demand` (BUYER) and `POST /supply` (FARMER):**
  - the full role matrix;
  - the role check uses the stored profile role, not the JWT claim;
  - no profile → 404;
  - a `buyer_wallet` or `farmer_wallet` that names another wallet → 403.

**Bug fix in `src/services/locationService.ts`:** `createLocationSchema` extended the *full* `locationShape`. That made both coordinate pairs (`lat`/`lng` and `latitude`/`longitude`) and `city`, `country` and `is_public` all required. The client sends `{ lat, lng, city, country, is_public }`, so every location save returned 400. The base is now partial and one coordinate pair is required, which is what the code comment and the transform's defaults already assumed. There are tests for both spellings and for a payload with no coordinates.

**Out of scope, marked `it.todo`:** This behavior belongs to other open issues, so these tests are marked todo instead of being written to fail:
- `sort` options other than "newest", and the client's parameter names (`q`, `price_min`/`price_max`, `categories`, `rating_min`, `in_stock`, `max_age_days`, `stock_min`): **#1132**.
- Route-level role gates (BUYER → 403 on `POST /products`, role limits on location writes): **#1133**.

## Not included

- **#1146 (idempotency for product/location writes):** Not started. The middleware is already mounted globally whenever Redis is configured, and it covers these routes. The tests that prove it, and the client sending `Idempotency-Key`, will come in a separate PR.

## Test results

Run with Node 22.23.2 and npm 10.9.2.

| Suite | Result |
|---|---|
| `node scripts/check-react-runtime.js` | ✅ single react@19.2.3 / react-dom@19.2.3 |
| `node --test scripts/__tests__/check-react-runtime.test.js` | ✅ 7/7 |
| server `productService.test.ts` | ✅ 52 passed, 3 todo |
| server `productRoutes.test.ts` | ✅ 29 passed, 5 todo |
| server `writeRoutesRoleMatrix.test.ts` | ✅ 35 passed, 1 todo |
| agro-production `boundaries.test.tsx` | ✅ 7/7 |
| agro-production full Vitest | 264 passed / 52 failed. The failing tests are the same as on `main` with this lockfile. **0 "Invalid hook call"** errors. |
| client full Vitest | 243 passed / 41 failed, all already failing on `main`. **0 "Invalid hook call"** errors. |

**Failures that already existed and are not touched here**
- `cspPolicy.test.ts` has a syntax error at line 55, which also stops `tsc --noEmit` in agro-production.
- `telemetry.test.ts` fails on the `sendBeacon` spy under jsdom.
- In `useWebSocket.test.ts`, one test times out and leaks timers into the rest of the file. Each test passes when run alone.
- `contractServiceBuilders`, `signTransaction*`, portfolio page, `WeatherAdvisoryWidget`, `basketService` and `productCheckout` fail for reasons unrelated to this PR.
