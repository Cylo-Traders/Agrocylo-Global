# Mainnet Launch Runbook

**Issue #806** — Mainnet launch runbook, go/no-go checklist, and rollback plan

This document is the single ordered procedure for taking Agrocylo from testnet to
mainnet. It ties together the pieces that already exist in isolation:

- `docs/deployment/CONTRACTS.md` — contract deploy + wiring sequence
- `docs/deployment/KEY_CUSTODY.md` — multisig admin / guardian setup
- `docs/deployment/INCIDENT_RUNBOOK.md` — pause / investigate / upgrade / unpause
- `docs/CONTRACT_UPGRADES.md` — upgrade + migrate sequencing
- `docs/deployment/README.md` — backend / frontend CI/CD and Fly.io rollback
- `DISASTER_RECOVERY.md` — database backup / restore
- `contracts/production_escrow/SETTLEMENT_POLICY.md` — fund-release rules

> **Irreversibility warning.** Contract deploys and `initialize` calls are
> **permanent**. There is no "undo" for an on-chain deploy. Once mainnet contracts
> hold real value, the **only** emergency lever is `pause()` (guardian, instant) —
> see §6. Everything before "point of no return" (§4, step 5) is a dress rehearsal;
> everything after is live.

---

## 0. Roles

| Role | Responsibility | Minimum people |
|------|----------------|----------------|
| **Launch Commander (LC)** | Owns this runbook, calls go/no-go, sequences steps | 1 |
| **Contract Operator (CO)** | Runs `soroban` deploy / wire / verify commands | 1 (+ 1 shadow) |
| **Backend Operator (BO)** | Deploys `server/` + `agro-production/server/`, runs migrations | 1 |
| **Indexer Operator (IO)** | Configures + starts the chain indexer against mainnet contract IDs | 1 |
| **Frontend Operator (FO)** | Sets `NEXT_PUBLIC_*` env, deploys clients | 1 |
| **Guardian signers** | 2-of-3 multisig, on-call for `pause()` | 3 (2 online) |
| **Governance signers** | Quorum available for `unpause` / params | per quorum config |
| **Reconciliation / QA** | Runs reconciliation job, verifies each step | 1 |

All operators must be reachable in `#launch` (Slack) for the full window. Guardian
signers must confirm availability in writing before §4 begins.

---

## 1. Go / No-Go Gates

Every gate below is **mechanically checkable** and must be **GREEN with a named
sign-off** in the launch tracking issue before the LC authorizes §4. A single RED
gate is an automatic NO-GO.

| # | Gate | How to check (mechanical) | Owner | Sign-off |
|---|------|---------------------------|-------|----------|
| G1 | **Audit complete** | External audit report published; all Critical/High findings marked resolved with commit links in the audit tracking issue | LC | ☐ |
| G2 | **All CI green on release commit** | `gh run list --branch <release-tag> --json conclusion` → every workflow `success`; no `--force` merges since | LC | ☐ |
| G3 | **Contract tests + WASM reproducible** | `cargo test --workspace` passes; `./scripts/verify-wasm.sh <contract> <hash>` VERIFIED for all 4 contracts built from the release tag | CO | ☐ |
| G4 | **Testnet reconciliation clean for N days** | Reconciliation job (`scripts/reconcile.sh` or equivalent) has run daily against testnet for **≥ 7 consecutive days** with zero unexplained diffs; logs attached | Reconciliation | ☐ |
| G5 | **Monitoring + alerts live** | All alert rules from INCIDENT_RUNBOOK §1 fire in staging when synthetically tripped; `status.agrocylo.com` reachable; on-call schedule published | BO | ☐ |
| G6 | **Pause drill passed on testnet** | INCIDENT_RUNBOOK §"Running a Drill" completed within the last 30 days; guardian auth < 10 min; pause confirmed on `production_escrow`, `registry`, `investment_basket`; unpause confirmed | Guardian | ☐ |
| G7 | **Key custody verified** | `./scripts/deploy-contracts.sh --network mainnet` pre-deploy check confirms admin + guardian are multisig (rejects single-key); signer list matches KEY_CUSTODY.md | CO | ☐ |
| G8 | **Settlement policy checklist complete** | Every box in `SETTLEMENT_POLICY.md` §"Compliance Checklist" is checked, with the verifying commit/PR noted per item (see §7 below) | Reconciliation | ☐ |
| G9 | **Full dress rehearsal on testnet** | This runbook executed verbatim end-to-end on testnet within the last 14 days; rehearsal notes + tx hashes attached (see §5) | LC | ☐ |
| G10 | **Rollback drill per reversible phase** | Phases P1–P4 (§4) each rolled back and re-applied on testnet; timings recorded | LC | ☐ |
| G11 | **Soft-launch caps configured** | `production_escrow` initialized (or param-set) with campaign value cap for Ramp Stage 1 (§8); frontend enforces the same cap | CO + FO | ☐ |
| G12 | **Comms + support ready** | Launch announcement drafted; support inbox monitored; incident templates from INCIDENT_RUNBOOK pre-filled | LC | ☐ |

**Go decision:** LC records `GO` in the launch issue with a timestamp and the list
of sign-off names. Any signer may call `NO-GO` at any point up to the point of no
return; the LC aborts and reschedules.

---

## 2. Pre-Launch (T-7 days → T-1 day)

No mainnet writes. Fully reversible.

| Step | Action | Owner | Verify |
|------|--------|-------|--------|
| 2.1 | Cut release tag `v1.0.0` from a green `main` commit | LC | `git tag` shows tag on intended SHA |
| 2.2 | Freeze `main` (only launch fixes merge; each re-runs G2) | LC | Branch protection / posted freeze notice |
| 2.3 | Provision mainnet infra: Fly.io production apps, production Postgres (root + agro), Redis | BO | `flyctl status` for all 4 apps; `psql` connects |
| 2.4 | Take a baseline backup of both production DBs (empty is fine — proves restore path) | BO | `DISASTER_RECOVERY.md` restore test passes |
| 2.5 | Create mainnet multisig admin + guardian accounts; fund deployer | CO | G7 |
| 2.6 | Prepare `.env.mainnet` for contracts; prepare `NEXT_PUBLIC_*` for clients (see §3) | CO + FO | Values reviewed by 2 people, secrets in vault |
| 2.7 | Run the full dress rehearsal on testnet (this doc, verbatim) | all | G9 — notes attached |
| 2.8 | Run rollback drills P1–P4 on testnet | all | G10 — timings attached |
| 2.9 | Complete G1–G12; LC collects sign-offs | LC | §1 all GREEN |
| 2.10 | T-1 go/no-go call | all | `GO` recorded, or reschedule |

---

## 3. Configuration Contract (env vars)

The frontend must **fail fast** if mainnet config is missing (see issue #808 and
`client/README.md`). Required for mainnet:

| Variable | Where | Notes |
|----------|-------|-------|
| `NEXT_PUBLIC_STELLAR_ENV` | client build | `mainnet` |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | client build | `Public Global Stellar Network ; September 2015` |
| `NEXT_PUBLIC_RPC_URL` / `NEXT_PUBLIC_HORIZON_URL` | client build | mainnet endpoints, no `-testnet` |
| `NEXT_PUBLIC_CONTRACT_ID` (+ per-contract IDs) | client build | from §4 step 3 |
| `RPC_URL` | agro server | `https://mainnet.sorobanrpc.com` (or chosen provider) |
| `PRODUCTION_ESCROW_CONTRACT_ID`, `REGISTRY_CONTRACT_ID`, `BASKET_CONTRACT_ID`, `GOVERNANCE_CONTRACT_ID` | agro server | from §4 step 3 |
| `SOROBAN_NETWORK_PASSPHRASE` | contract deploy | `Public Global Stellar Network ; September 2015` |
| Indexer: `INDEXER_NETWORK`, `INDEXER_RPC_URL`, contract IDs, `INDEXER_START_LEDGER` | indexer | start ledger = deploy ledger from §4 step 2 |

**Rule:** no client or backend deploy proceeds until every value above is set and
verified non-testnet. A missing var must break the build, not silently fall back.

---

## 4. Cutover Sequence (Launch Day)

Execute strictly in order. **After each step, run the listed verification before
starting the next.** If a verification fails, STOP and go to §6.

### Phase P0 — Freeze (reversible)

| Step | Action | Owner | Verify |
|------|--------|-------|--------|
| 0.1 | Post "launch started" in `#launch`; confirm 2 guardians online | LC | Written ack from 2 guardians |
| 0.2 | Put testnet frontend into maintenance / read-only banner | FO | Banner visible |
| 0.3 | Final `main` freeze confirmation; re-check G2 on the exact release SHA | LC | CI green |

**Rollback P0:** remove banner, unfreeze. No on-chain effect.

### Phase P1 — Deploy contracts (IRREVERSIBLE once step 2 runs)

| Step | Action | Owner | Verify |
|------|--------|-------|--------|
| 1.1 | `./scripts/deploy-contracts.sh --network mainnet` (build + multisig pre-check) | CO | Exit 0; `deployments/mainnet.json` template written; G7 re-confirmed |
| 1.2 | `soroban contract install` all 4 WASMs; record hashes | CO | Each hash recorded in `deployments/mainnet.json` |
| 1.3 | `./scripts/verify-wasm.sh` for each installed hash | CO | `VERIFIED` x4 |

**Rollback P1:** if only *install* (not *deploy*) has happened, abort — installed
WASM with no instance is inert. Nothing to undo on-chain; just stop.

### Phase P2 — Deploy + initialize + wire instances (IRREVERSIBLE)

Follow `docs/deployment/CONTRACTS.md` §"Deployment Steps" exactly.

| Step | Action | Owner | Verify |
|------|--------|-------|--------|
| 2.1 | Deploy `governance` instance; record ID + deploy ledger | CO | `get_admin` returns admin |
| 2.2 | Deploy `production_escrow`, `registry`, `investment_basket`; record IDs | CO | 3 IDs recorded |
| 2.3 | `initialize` all 4 in dependency order (governance → escrow → registry → basket) | CO | `get_admin` on each; `production_escrow` supported_tokens = mainnet USDC |
| 2.4 | `set_registry_contract` on escrow | CO | `get_registry_contract` = registry ID |
| 2.5 | `set_governance_contract` on escrow, registry, basket | CO | `get_governance_contract` x3 |
| 2.6 | `set_guardian` on escrow, registry, basket = guardian multisig | CO | `get_guardian` x3 = multisig addr |
| 2.7 | `set_attester` on escrow | CO | `get_attester` = attester addr |
| 2.8 | Set Ramp Stage 1 campaign value cap (§8) via init param or governance param | CO | Read back cap = configured value |
| 2.9 | Freeze `deployments/mainnet.json`, commit to repo, tag `mainnet-deploy-v1` | CO | Commit pushed |

**Rollback P2:** **NONE.** Contracts exist forever. If wiring is wrong, the fix is
a governance param change or upgrade (INCIDENT_RUNBOOK §4), not a rollback. If a
serious defect is found here, **do not proceed to P3** — the contracts stay
un-integrated and hold no value; treat as a failed launch and reschedule after a
fix. This is the **point of no return** for the *system*, not yet for *funds*.

### Phase P3 — Backend + indexer (reversible)

**Order matters: indexer must be healthy and caught up before the frontend points
users at the contracts.**

| Step | Action | Owner | Verify |
|------|--------|-------|--------|
| 3.1 | Set agro server mainnet secrets (contract IDs, `RPC_URL`, passphrase) | BO | `flyctl secrets list` shows keys |
| 3.2 | Deploy `server/` + `agro-production/server/` from release tag; run `prisma migrate deploy` | BO | `/health` 200 on both; `prisma migrate status` clean |
| 3.3 | Configure indexer: mainnet contract IDs, `INDEXER_START_LEDGER` = P2 deploy ledger | IO | Config diff reviewed |
| 3.4 | Start indexer; let it sync from start ledger to chain tip | IO | Indexer lag < 5 ledgers; no error logs for 10 min |
| 3.5 | Backend reads indexed data correctly (list campaigns endpoint returns empty set, no errors) | BO | 200 + `[]` |
| 3.6 | Run reconciliation job once against mainnet (should be trivially clean — no campaigns yet) | Reconciliation | Zero diffs |

**Rollback P3:**
- Indexer misconfigured / wrong start ledger → stop indexer, wipe its DB/checkpoint,
  fix config, restart from P2 deploy ledger. No on-chain effect.
- Backend bad deploy → `flyctl releases rollback` per README.md; restore DB from
  §2.4 baseline if a migration is bad (`DISASTER_RECOVERY.md`).
- **Do not advance to P4 while the indexer is unhealthy or lagging.** A live
  frontend on a broken indexer is the exact failure mode this ordering prevents.

### Phase P4 — Frontend (reversible)

| Step | Action | Owner | Verify |
|------|--------|-------|--------|
| 4.1 | Set client build env per §3 (`NEXT_PUBLIC_STELLAR_ENV=mainnet`, passphrase, contract IDs, RPC) | FO | Build fails if any missing (issue #808) |
| 4.2 | Deploy both clients from release tag | FO | `/` 200; app loads |
| 4.3 | Wallet network check active: connect a mainnet wallet → no mismatch banner; connect a testnet wallet → mismatch banner blocks checkout (issue #807) | FO + QA | Both behaviors confirmed |
| 4.4 | Smoke: create one capped test campaign end-to-end with a small real value; invest a small real amount from a second account | QA | Campaign visible in UI **and** indexer **and** reconciliation clean |
| 4.5 | Remove testnet maintenance banner; keep a "soft launch — capped campaigns" notice | FO | Notice visible |

**Rollback P4:** `flyctl releases rollback` on both clients → users back to
maintenance page. On-chain state from the 4.4 smoke campaign remains (small, known
value; refund via normal flow or leave to settle).

### Phase P5 — Post-launch watch (first 72h)

| Step | Action | Owner | Cadence |
|------|--------|-------|---------|
| 5.1 | Reconciliation job runs against mainnet | Reconciliation | Hourly for 72h, then daily |
| 5.2 | On-call watches INCIDENT_RUNBOOK §1 alerts | BO | Continuous |
| 5.3 | Manual review of every new campaign vs the value cap | Reconciliation | Per campaign |
| 5.4 | Daily launch standup: diffs, incidents, ramp decision | LC | Daily |

---

## 5. Dress Rehearsal (Gate G9)

Run **this entire document, verbatim**, against testnet within 14 days of launch:

1. Use a fresh set of testnet multisig admin/guardian accounts.
2. Execute §4 P0–P5 exactly as written, including all verifications.
3. Deliberately inject **one** failure per rehearsal (rotate): bad indexer start
   ledger (P3), missing `NEXT_PUBLIC_CONTRACT_ID` (P4), wrong network wallet (P4.3),
   bad migration (P3.2). Confirm the verification catches it and the documented
   rollback works.
4. Attach to the launch issue: every tx hash, every command output, wall-clock
   timing per phase, and a list of any step where the doc was ambiguous (fix the
   doc before launch).

A rehearsal is **PASS** only if no step required improvisation.

---

## 6. Emergency Response During Launch

If any verification fails or an alert fires **after P2**:

1. LC declares an incident in `#launch` and `#incidents`.
2. If funds are at risk → **guardian `pause()` immediately** on `production_escrow`,
   `registry`, `investment_basket` (INCIDENT_RUNBOOK §2). Pause is instant, no
   timelock.
3. If pre-funds (P2–P3, no value on-chain) → stop the cutover, roll back P3/P4 per
   their rollback notes, leave contracts un-integrated, reschedule.
4. Root-cause per INCIDENT_RUNBOOK §3; fixes go through governance (§4 of that doc),
   not ad-hoc redeploys.
5. `unpause` only via governance once verified (INCIDENT_RUNBOOK §5).

**There is no rollback for a deployed contract. Pause is the only lever once value
is on-chain.**

---

## 7. Settlement Policy Compliance Checklist (Gate G8)

Before launch, confirm each item from
`contracts/production_escrow/SETTLEMENT_POLICY.md` §"Compliance
Checklist", with the verifying PR/commit or test noted:

| Item | Verified by | Ref |
|------|-------------|-----|
| All campaigns go through the full settlement pipeline | contract test `settle_requires_full_pipeline` | ☐ |
| Fund release only after documented authorization | `settle` requires multisig/governance auth | ☐ |
| Production status attested by independent verifier or dispute window | attester wiring (§4 step 2.7) + dispute-window test | ☐ |
| All orders finalized before settlement | Issue #455 test | ☐ |
| Investor claims verified against proportional payout calc | payout unit tests | ☐ |
| Disputes resolved by multisig or governance authority | `resolve_dispute` auth test | ☐ |
| All persistent storage entries have TTL extensions | TTL_POLICY tests | ☐ |
| Monetary arithmetic uses checked functions | Issue #457 overflow tests | ☐ |

LC attaches the filled table to the launch issue as the G8 artifact.

---

## 8. Soft Launch & Ramp

Launch **capped**. Each stage requires an explicit LC + Reconciliation sign-off in
the launch issue, backed by the metric below.

| Stage | Max campaign target | Max concurrent campaigns | Advance criteria (all required) |
|-------|--------------------|--------------------------|---------------------------------|
| **S1 — Canary** | 500 USDC | 3 | 72h with zero reconciliation diffs; ≥ 1 full lifecycle (fund → produce → harvest → settle → claim) completed; no SEV1/SEV2 |
| **S2 — Soft** | 5,000 USDC | 10 | 7 days at S1 clean; ≥ 3 settlements reconciled; pause drill re-run on mainnet governance |
| **S3 — Open (capped)** | 50,000 USDC | 50 | 14 days at S2 clean; dispute path exercised at least once (drill or real) |
| **S4 — Uncapped** | governance-set | governance-set | 30 days at S3 clean; board sign-off; audit follow-up items closed |

Enforcement is **two-layer**: the contract cap (param, §4 step 2.8) is the hard
limit; the frontend cap is the same value and is the first thing bumped when a
stage advances. Never raise the frontend cap above the contract cap.

Rollback a stage: lower the contract param via governance (2-day timelock) and the
frontend cap immediately; existing campaigns above the new cap are allowed to
complete.

---

## 9. Sign-off Record (fill at launch)

```
Release tag:            ____________________
Deploy ledger (P2):     ____________________
Contract IDs:           governance ________  escrow ________  registry ________  basket ________
WASM hashes verified:   ☐ governance  ☐ escrow  ☐ registry  ☐ basket

Go/No-Go gates:  G1☐ G2☐ G3☐ G4☐ G5☐ G6☐ G7☐ G8☐ G9☐ G10☐ G11☐ G12☐

GO authorized by (LC):  ____________________  @ ______ UTC
Guardians online:       ____________________ , ____________________
Ramp stage at launch:   S1 (canary, 500 USDC cap)

P0 done ______  P1 done ______  P2 done ______ (POINT OF NO RETURN)
P3 done ______  P4 done ______  Soft launch live ______
```
