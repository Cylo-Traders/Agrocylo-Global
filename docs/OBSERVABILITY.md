# Observability: Error Tracking, Metrics, Alerting (Issue #756)

> **Status:** code-complete and unit-tested in this PR. **Not yet demonstrated
> against a real Sentry project or a live staging environment** — see
> [Verification status](#verification-notes-updated-after-actually-running-things) at the bottom before treating
> any alert as "proven" in the sense Issue #756's acceptance criteria mean.

## What's instrumented, and where

| App | Error tracking | Metrics | Scheduled-job/alert coverage |
|---|---|---|---|
| `server/` (root API) | `@sentry/node`, init in `src/config/sentry.ts`, called from `src/index.ts` | Existing JSON `GET /metrics` (business metrics) **+ new** Prometheus-text `GET /metrics/prom` (`src/services/promMetrics.ts`): per-route `http_request_duration_seconds`/`http_requests_total`, `websocket_connections`, `queue_job_lag_seconds`, `queue_job_failures_total` | Contract watcher (`src/services/contractWatcher.ts`), BullMQ job failures (`src/queues/workers.ts` — this is what `aggregate-price-index` runs on), weather-polling cycle failures (`src/services/weatherService.ts`), elevated 5xx rate (`src/services/errorRateMonitor.ts`) |
| `agro-production/server/` | `@sentry/node`, init in `src/config/sentry.ts`, called from `src/index.ts` | Existing hand-rolled `GET /metrics` **+ new** per-route histogram and `reconciliation_drift_count` gauge (`src/services/promMetrics.ts`), appended to the same response | Production contract watcher (`src/events/watcher.ts`), **new** reconciliation-drift sweep (`src/services/reconciliationSweep.ts` — the scheduled job Issue 8's drift metric never had), elevated 5xx rate |
| `client/` (root Next.js) | `@sentry/nextjs`: `src/instrumentation.ts` (server/edge), `src/instrumentation-client.ts` (browser), `src/app/global-error.tsx` (root-layout crashes), plus a hook added to the existing `src/components/ErrorBoundary.tsx` (in-tree React errors) | — (frontend metrics out of scope for this pass; Sentry's own performance tracing covers basic frontend timing once a DSN is configured) | — |
| `agro-production/client/` | `@sentry/nextjs`: same three files as above (no pre-existing error boundary component here, so only the instrumentation files + `global-error.tsx`) | — | — |

**Nothing above requires a DSN to merge safely.** Every `Sentry.init()` call
is empty-DSN-safe (the SDK no-ops without one, logging a warning instead of
throwing), so none of this changes behavior for any environment that hasn't
configured `SENTRY_DSN` (backends) / `NEXT_PUBLIC_SENTRY_DSN` (frontends
client-side).

## Environment variables

| Var | Where | Purpose |
|---|---|---|
| `SENTRY_DSN` | all four apps (server-side) | Enables error tracking. Empty = disabled. |
| `NEXT_PUBLIC_SENTRY_DSN` | both Next.js apps (browser-side) | Same, but for the client bundle — must use the `NEXT_PUBLIC_` prefix or Next.js won't inline it. |
| `SENTRY_TRACES_SAMPLE_RATE` | both backends | Performance-trace sampling, default `0.1`. |
| `RUN_RECONCILIATION_SWEEP` | `agro-production/server` | Set to `"false"` to disable the sweep; defaults on. |
| `RECONCILIATION_SWEEP_INTERVAL_MS` | `agro-production/server` | Sweep cadence, default 5 minutes. |
| `METRICS_API_KEY` (existing) | both backends | Already gates `/metrics`; the new `/metrics/prom` route (root server) reuses the same auth. |

## Alert catalog (what fires, and why it's tagged that way)

Every operational alert (as opposed to a captured exception with a real stack
trace) goes through `captureAlert(alertType, message, extra)`
(`src/config/sentry.ts` in both backends), which tags the Sentry event
`alert_type: <value>` so alert routing rules can match on the tag instead of
parsing message text. Configure Sentry alert rules per `alert_type`, not per
individual message string.

| `alert_type` | Fires when | Severity |
|---|---|---|
| `contract_watcher_ingestion_failure` | An event fails to persist and is moved to dead-letter (both watchers), or a ledger gap exceeds the backfill batch size | High — indexing is stuck or data may be missed |
| `contract_watcher_poll_error` | A watcher's poll iteration throws (both watchers) | High — could mean the RPC endpoint is down |
| `reconciliation_drift` | The scheduled sweep finds ≥1 transaction whose DB status disagrees with its ledger/watcher-derived status | High — this is the signal Issue 8 introduced a metric for but never wired a job to produce |
| `scheduled_job_failed` | A BullMQ job (root server — includes `aggregate-price-index`) exhausts all retry attempts, or a whole weather-polling/reconciliation-sweep cycle throws before producing any result | High — exactly the "shipped in a silently-never-started state" failure mode this issue calls out |
| `elevated_5xx_rate` | ≥10 5xx responses within a rolling 60s window, both backends, at most once per 5-minute cooldown | High — active degradation, not background noise |

Uncaught exceptions and 5xx `ApiError`/`HttpError`/`StorageError` instances
are reported via `Sentry.captureException`, not `captureAlert` — those carry
their own stack trace and don't need a synthetic message.

## Incident-response expectation

This is intentionally lightweight — a real on-call rotation is a separate,
later investment once there's an actual team/schedule to build one around.
For now:

1. **Sentry is the source of truth for "something is broken."** Every alert
   in the catalog above, plus any uncaught exception, lands there. Anyone
   maintaining this project should have Sentry project access.
2. **Who looks:** whoever merged the most recent change touching the
   affected app is the first responder for an alert that appears within 24
   hours of their merge. Absent a clear "most recent change," it defaults to
   whoever owns/maintains that app area per `CONTRIBUTING.md`'s repository
   structure table.
3. **Response time (informal, not an SLA):** high-severity alerts (all five
   in the catalog above are tagged high) should get a first look within one
   business day. This project does not yet have paging/on-call tooling — if
   volume or stakes grow enough to need one, that's the trigger to invest in
   a real rotation (PagerDuty/Opsgenie or equivalent) rather than relying on
   someone noticing a Sentry email.
4. **What "looking at it" means, minimum bar:** acknowledge the alert (a
   Sentry comment or a linked issue is enough), determine if it's a real
   incident vs. a flaky/expected blip, and if real, open a tracking issue
   referencing the alert. Silence is the failure mode this whole issue exists
   to prevent — a wrong-but-visible triage beats a correct-but-invisible one.
5. **Escalation:** if the first responder can't diagnose within the response
   window, they say so explicitly (comment on the tracking issue) rather than
   letting it go quiet — the same principle as the CI flaky-check escalation
   path in `CONTRIBUTING.md`.

## How to test each alert path locally (since this PR can't demonstrate against real staging — see below)

All of these can be exercised with `SENTRY_DSN` unset — `captureAlert`
still logs via winston either way, so you can confirm the *code path* fires
even without a Sentry project. To confirm actual Sentry delivery, set a real
`SENTRY_DSN` (a free Sentry project is sufficient) and repeat.

- **Elevated 5xx rate:** hit any route that throws a 500 (or add a temporary
  debug route that does) 10+ times within 60 seconds.
- **Scheduled job failure (BullMQ):** `POST /jobs/analytics` with a payload
  that makes `processAnalytics` throw (e.g. an unknown `metricName`/report
  type won't throw today — pick a processor path you know errors, or
  temporarily force one), and let it exhaust its 5 configured attempts.
- **Weather polling cycle failure:** temporarily point `prisma.location` at
  an unreachable state (or unit-test the path directly — see
  `weatherService.ts`'s existing tests).
- **Reconciliation drift:** insert a `Transaction` row with a non-terminal
  status that disagrees with what the watcher/ledger would derive, then call
  `runReconciliationSweep()` directly (`agro-production/server`) — or run the
  new `reconciliationSweep.test.ts` suite, which exercises exactly this.
- **Contract-watcher ingestion failure:** the existing dead-letter path
  already exercises this in production when persistence fails; `pgAdmin`-level
  fault injection (making a write fail) is the most realistic local repro.

## Verification notes (updated after actually running things)

Unlike the "verification status" section below (written before this was
tested), `npm install`/`vitest`/`tsc` **were** run in this sandbox for all
four apps before finishing this PR. Results:

- **`server/` and `agro-production/server/`:** installed cleanly, all new
  tests pass (`errorRateMonitor.test.ts`, `sentry.test.ts`,
  `workers.test.ts`, `reconciliationSweep.test.ts`), `tsc --noEmit` shows no
  new errors in any file this PR touches. Both apps have pre-existing,
  unrelated failures this PR did not introduce and did not fix (out of
  scope): `agro-production/server` is missing the `jsonwebtoken` dependency
  entirely (imported by three files that were already broken) and its
  `prisma/schema.prisma` fails to validate (`Product` referenced but never
  defined) so `prisma generate` cannot run there; `server`'s Prisma client
  also isn't generated in this sandbox (no `DATABASE_URL` configured) and it
  has 2 pre-existing failing tests already flagged in
  `contracts/SECURITY_AUDIT.md`'s own caveats.
- **Two pre-existing test/source drifts were fixed in passing**, since this
  PR's own tests needed the same mocks/assertions to be correct and fixing
  them was a one-line change in a file already being edited: `server`'s
  `contractWatcher.test.ts` mocked `wsManager.broadcast`/asserted against it,
  but the actual source calls `wsManager.broadcastAuthenticated` (added
  separately, mock/assertions never updated); `agro-production/server`'s
  `watcher.test.ts` expected a log message string ("Production watcher poll
  error") the source has never produced (it logs "Soroban watcher poll
  error"). Neither is related to this issue — both are flagged here rather
  than silently fixed without a trace, matching this repo's established
  convention for that situation.
- **`client/` (root Next.js, v16.2.4):** `@sentry/nextjs@^8` only declares
  peer support up to Next 15 — bumped to `^10.70.0`, the first version whose
  peer range includes `^16.0.0-0`. Installed cleanly; `tsc --noEmit` shows no
  errors in any file this PR added/touched (`instrumentation.ts`,
  `instrumentation-client.ts`, `global-error.tsx`, `ErrorBoundary.tsx`) — one
  pre-existing, unrelated `BigInt`/target-version error elsewhere in the repo,
  not touched by this PR.
- **`agro-production/client/` (Next.js v15.3.1):** `@sentry/nextjs@^8.47.0`
  installed cleanly (no peer conflict at this Next version). `tsc --noEmit`
  shows no errors in this PR's files; one pre-existing, unrelated syntax
  error in `src/services/orderService.ts` (`'}' expected`) elsewhere in the
  repo. **Could not run `next build`** — this app's `next.config.ts` imports
  `next-intl/plugin`, but `next-intl` was never added to `package.json`
  (pre-existing, unrelated to this PR); the build fails before reaching any
  application code. Flagged here, not fixed, since adding an i18n dependency
  is out of scope for an observability PR.

## What's still not verified — acceptance criterion 2 is not met by this PR alone

Everything in this PR is code-complete, typechecked, and covered by new unit
tests that pass (see the section above) — but **none of it has been run
against an actual Sentry project or a deployed/staging environment**, and
this sandbox has no Sentry account, no metrics backend, and no staging
deployment to point at (Issue 4, the deployment pipeline, is itself still
open per this issue's own problem statement). Issue #756's acceptance
criterion 2 explicitly requires the reconciliation-drift and
scheduled-job-failure alerts to be "wired end-to-end and demonstrated (e.g.
by deliberately triggering one in staging)."

What exists here is the end-to-end *code path*, proven by unit tests that
simulate the triggering condition and assert `captureAlert`/
`Sentry.captureMessage` actually fires with the right tag and payload. The
remaining gap — an actual Sentry project receiving a real event from a real
deployment — requires a deployed environment (Issue 4) and a real
`SENTRY_DSN`, then someone deliberately triggering each condition (see "How
to test each alert path locally" above, run against that deployment instead
of locally) and confirming the alert lands in the Sentry dashboard. That's a
manual, environment-dependent step for whoever owns the actual deployment,
not something achievable from this sandbox.
