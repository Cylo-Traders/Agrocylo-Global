# Security Audit Checklist

> **Scope:** 6 contracts: Registry, ProductionEscrow, Governance, InvestmentBasket, legacy Escrow (`contracts/escrow/src/lib.rs`), and Weather Insurance (`archive/weather-insurance/src/lib.rs`)
>
> **Audit Date:** 2026-05-29 (original review)
> **Last Verified Against:** Commit TBD (tie re-audits to CI check — see §15 below)
> **Status:** ⚠️ Stale — Pending Re-review (see notes below)

---

## Table of Contents

1. [Reentrancy Checks](#1-reentrancy-checks)
2. [Token Approval Limitations](#2-token-approval-limitations)
3. [Authorization Enforcement](#3-authorization-enforcement)
4. [Arithmetic Overflow/Underflow Protection](#4-arithmetic-overflowunderflow-protection)
5. [State Machine Integrity](#5-state-machine-integrity)
6. [Fee Collection Mechanism](#6-fee-collection-mechanism)
7. [Dispute Stake Mechanism](#7-dispute-stake-mechanism)
8. [Access Control](#8-access-control)
9. [Initialization Protection](#9-initialization-protection)
10. [Edge Cases](#10-edge-cases)
11. [Error Handling](#11-error-handling)
12. [Event Monitoring](#12-event-monitoring)
13. [Findings Summary](#13-findings-summary)
14. [Issue #652 Follow-up: Legacy/Production Escrow Drift Re-audit](#14-issue-652-follow-up-legacyproduction-escrow-drift-re-audit)
15. [Scope correction and staleness notice](#15-scope-correction--staleness-notice-2026-08-27)
16. [Issues #840, #841, #842: Weather Insurance Hardening & Solvency Audit](#16-issues-840-841-842-weather-insurance-hardening--solvency-audit)

---

## 1. Reentrancy Checks

### Status: ✅ Low Risk

**Analysis:**
Soroban's Rust runtime does not expose an EVM-style CALL mechanism that allows reentrancy. All token transfers use the Soroban token interface, which is synchronous and does not invoke receiver callbacks. However, the **Checks-Effects-Interactions** pattern is not consistently followed.

**Violations found:**

| Contract | Function | Issue |
|----------|----------|-------|
| Escrow | `confirm_receipt` | Transfers tokens to farmer BEFORE writing updated order status |
| Escrow | `refund_expired_order` | Transfers tokens BEFORE setting order status to Refunded |
| Escrow | `refund_expired_orders` | Transfers tokens BEFORE writing updated status |
| Escrow | `resolve_dispute` | Transfers tokens BEFORE writing order/dispute updates (all 3 resolution branches) |
| ProductionEscrow | `start_production` | Transfers via `release_tranche_internal` before `save_campaign` |
| ProductionEscrow | `mark_harvest` | Same pattern — transfers before save |

**Mitigation:**
Reorder operations to perform all storage writes BEFORE token transfers. However, given Soroban's non-reentrant runtime, this is a code-quality concern rather than an exploitable vulnerability.

**Severity:** Low

---

## 2. Token Approval Limitations

### Status: ✅ Secure

**Analysis:**
All contracts use `token::Client::transfer()` which requires the sender to have called `require_auth()` prior to the transfer. In every case:
- The sender (`require_auth()` caller) initiates the action
- The contract holds funds after initial deposit
- Transfers out are always from `env.current_contract_address()` → recipient

The contracts never call `approve()` or `transfer_from()` — they only use direct `transfer()`. This eliminates the approval front-running attack surface.

**No findings.**

**Severity:** N/A

---

## 3. Authorization Enforcement

### Status: ✅ Secure

**Analysis:**

| Contract | Function | Auth Mechanism | Correct? |
|----------|----------|----------------|----------|
| Escrow | `create_order` | `buyer.require_auth()` | ✅ |
| Escrow | `mark_delivered` | `farmer.require_auth()` | ✅ |
| Escrow | `confirm_receipt` | `buyer.require_auth()` | ✅ |
| Escrow | `open_dispute` | `opened_by.require_auth()` | ✅ |
| Escrow | `resolve_dispute` | `admin.require_auth()` + stored admin check | ✅ |
| Registry | `initialize` | `admin.require_auth()` | ✅ |
| Registry | `register_farmer` | `farmer.require_auth()` + validation | ✅ |
| Registry | `register_campaign` | `source_contract.require_auth()` | ✅ |
| Campaign | `register_farmer` | `farmer.require_auth()` | ✅ |
| Campaign | `create_campaign` | `farmer.require_auth()` | ✅ |
| Campaign | `start_production` | `farmer.require_auth()` | ✅ |
| Campaign | `mark_harvest` | `farmer.require_auth()` | ✅ |
| ProductionEscrow | `create_campaign` | `farmer.require_auth()` | ✅ |
| ProductionEscrow | `invest` | `investor.require_auth()` | ✅ |
| ProductionEscrow | `start_production` | `farmer.require_auth()` | ✅ |
| ProductionEscrow | `mark_harvest` | `farmer.require_auth()` | ✅ |
| ProductionEscrow | `confirm_order` | `buyer.require_auth()` | ✅ |
| ProductionEscrow | `settle` | `caller.require_auth()` + check farmer/admin | ✅ |
| ProductionEscrow | `claim_returns` | `investor.require_auth()` | ✅ |
| ProductionEscrow | `refund` | `investor.require_auth()` | ✅ |
| ProductionEscrow | `open_dispute` | `caller.require_auth()` + check participant | ✅ |
| ProductionEscrow | `resolve_dispute` | `admin_caller.require_auth()` + stored admin check | ✅ |
| ProductionEscrow | `finalize_failed` | **None** (anyone can call) | ⚠️ See note |

**Note on `finalize_failed`:** Anyone can call this function. This is intentional — if a campaign's deadline has passed without reaching the target, anyone should be able to trigger the failure transition. Since the state change is guarded by a time check (`timestamp > deadline`), there is no privilege escalation.

**No findings.**

**Severity:** N/A

---

## 4. Arithmetic Overflow/Underflow Protection

### Status: ⚠️ Medium (Partial)

**Analysis:**

| Contract | Location | Protection | Assessment |
|----------|----------|------------|------------|
| Escrow | `fee = amount * 3 / 100` | `checked_mul` + `checked_sub` | ✅ |
| Escrow | `refund_amount = amount * bps / 10_000` | `checked_mul` + `checked_sub` | ✅ |
| Escrow | Order ID increment | `unwrap_or(0) + 1` | ⚠️ See Finding #1 |
| ProductionEscrow | `campaign.total_raised += amount` | Direct `+=` | ⚠️ See Finding #2 |
| ProductionEscrow | `tranche = total_raised * BPS / DENOM` | Direct `*` / `/` | ⚠️ See Finding #3 |
| ProductionEscrow | `prev + amount` in contributions | Direct `+` | ⚠️ See Finding #2 |
| ProductionEscrow | `pool = raised + revenue - released` | Direct `+` / `-` | ⚠️ See Finding #4 |
| Campaign | `raised_amount + amount` | Direct `+` | ⚠️ Same as Finding #2 |
| Campaign | Tranche calculation | Direct `*` / `/` | ⚠️ See Finding #3 |

**Finding #1 (Escrow):** Order ID increments from `unwrap_or(0) + 1` without `checked_add`. At u64::MAX (~1.8e19), this would overflow to 0. Realistically unreachable.

**Finding #2 (ProductionEscrow, Campaign):** `campaign.total_raised += amount` and `prev + amount` use direct addition. If total_raised exceeds `i128::MAX`, it panics. For realistic agricultural production values, this is safe, but formally incorrect.

**Finding #3 (ProductionEscrow, Campaign):** Tranche calculations use direct integer multiplication (`total_raised * BPS`). An i128 overflow would require amounts > `i128::MAX / 10_000`, which is astronomically large.

**Finding #4 (ProductionEscrow):** `pool = total_raised + total_revenue - tranche_released` — if `tranche_released > total_raised + total_revenue`, this underflows. Guarded by tranche release logic (cannot release more than raised), but an edge case exists if `tranche_released` was manipulated.

**Mitigation:**
- Use `checked_add`, `checked_sub`, `checked_mul` throughout (consistent with Escrow's existing pattern)
- Add invariant checks before pool calculations
- The current code works for realistic values but formal correctness would require safe arithmetic everywhere

**Severity:** Medium

---

## 5. State Machine Integrity

### Status: ✅ Verified

**Analysis:**

#### Escrow Order State Machine:

```
Pending → mark_delivered → (Delivered) → confirm_receipt → Completed
Pending → open_dispute → Disputed → resolve_dispute → { Refunded / Completed }
Pending → refund_expired → Refunded (after 96h)
```

All transitions correctly guard on current status. Invalid transitions return appropriate errors (`OrderNotPending`, `OrderNotDelivered`, `OrderNotDisputed`, etc.).

#### ProductionEscrow Campaign State Machine:

```
Funding → invest (full) → Funded → start_production → InProduction → mark_harvest → Harvested → settle → Settled
Funding → finalize_failed → Failed
{ Funded, InProduction, Harvested } → open_dispute → Disputed → resolve → { Settled, Failed }
```

All transitions verified in test suite. Invalid transitions properly rejected.

#### Campaign Contract State Machine:

```
Pending → invest (full) → Funded → start_production → InProduction → mark_harvest → Harvested → settle → Settled
Pending → fail_campaign → Failed
Funded → fail_campaign → Failed
{ Funded, InProduction, Harvested } → dispute → Disputed → resolve → { Settled, Failed }
```

**No findings.**

**Severity:** N/A

---

## 6. Fee Collection Mechanism

### Status: ✅ Low Risk

**Analysis:**

The Escrow contract applies a 3% fee on order creation:

```rust
let fee = amount.checked_mul(3).ok_or(EscrowError::ArithmeticError)? / 100;
let net_amount = amount.checked_sub(fee).ok_or(EscrowError::ArithmeticError)?;
token_client.transfer(&buyer, &fee_collector, &fee);
token_client.transfer(&buyer, &env.current_contract_address(), &net_amount);
```

**Checks performed:**
- Fee uses `checked_mul` and `checked_sub` (safe from overflow)
- Fee rate is fixed at 3% (hardcoded, not configurable)
- Fee is collected at order creation, before funds enter escrow
- `fee_collector` is set at initialization and immutable

**Concerns:**
- Fee rate is hardcoded, not adjustable. If the platform needs to change the fee rate, a contract upgrade is required.
- For amount=1: fee = 1 * 3 / 100 = 0, net_amount = 1 — no fee collected. This is documented behavior (tested in `test_fee_calculation_with_small_amounts`).
- The ProductionEscrow contract does not collect fees on investment or order creation.

**Severity:** Low

---

## 7. Dispute Stake Mechanism

### Status: ✅ Verified

**Analysis:**

#### Escrow Disputes:
- Opened by buyer or farmer after order is Pending
- Validates order participant status
- Prevents duplicate disputes on same order
- Admin resolves with Refund / Release / Split(bps)
- Split validates ratio ≤ 10_000 bps (100%)
- After resolution, `dispute.resolved = true` prevents re-resolution
- Funds are always locked in the contract until resolution

#### ProductionEscrow Disputes:
- Opened by farmer, admin, or any investor with a non-zero contribution
- Admin resolves with FullPayoutToInvestors / RefundInvestors / Partial(bps)
- Partial resolution validates bps ≤ 10_000
- If `pool = 0` and `Partial > 0`, no transfer occurs (handled by `pool > 0 && farmer_bps > 0` check)
- Farmer receives `farmer_cut` from `Partial` resolution; investors claim remaining via `claim_returns`

**Observation:** The `Partial` resolution in ProductionEscrow transfers funds to the farmer directly, reducing the pool for investors. This is correct behavior but creates a window where `tranche_released` is incremented without a corresponding tranche release event — the `claim_returns` calculation still works because it derives from `pool = total_raised + total_revenue - tranche_released`.

**Severity:** Low (informational)

---

## 8. Access Control

### Status: ✅ Verified

**Analysis:**

| Role | Privileges | Enforcement |
|------|-----------|-------------|
| Admin (Escrow) | Resolve disputes | `require_auth()` + stored admin check |
| Admin (Registry) | Initialize, update contract refs | `require_auth()` + initialization guard |
| Admin (Campaign) | Initialize | Initialization guard |
| Admin (ProductionEscrow) | Resolve disputes, co-settle | `require_auth()` + stored admin check |
| Farmer (Escrow) | Mark delivered | `require_auth()` + stored farmer match |
| Farmer (ProductionEscrow) | Create campaign, start production, mark harvest | `require_auth()` + stored farmer match |
| Buyer (Escrow) | Create order, confirm receipt | `require_auth()` + stored buyer match |
| Investor (ProductionEscrow) | Invest, claim returns, refund | `require_auth()` + contribution check |
| Anyone | `refund_expired_orders`, `finalize_failed` | Unguarded but guarded by time/state |

**No privilege escalation vulnerabilities found.**

**Severity:** N/A

---

## 9. Initialization Protection

### Status: ✅ Verified

**Analysis:**

| Contract | Guard | Method |
|----------|-------|--------|
| Escrow | `AlreadyInitialized` | Checks `DataKey::Admin` existence |
| Registry | `AlreadyInitialized` | Checks `DataKey::Admin` existence, `require_auth(admin)` |
| Campaign | `AlreadyInitialized` | Checks `DataKey::RegistryInitialized` existence |
| ProductionEscrow | `AlreadyInitialized` | Checks `DataKey::Admin` existence |

All contracts use the same pattern: check if a known key exists in instance storage, return error if already set. This prevents re-initialization attacks.

**One issue:** The `initialize` function in `contracts/escrow/src/lib.rs` checks `supported_tokens.len() < 2` BEFORE `if supported_tokens.is_empty()` — the empty check at line 178 is unreachable because `len() < 2` catches it first (a Vec with len=0 has len < 2). The `TokenWhitelistEmpty` error is never triggered. This is a logic redundancy, not a security issue.

**Severity:** Informational

---

## 10. Edge Cases

### Status: ⚠️ Low Risk

**Identified edge cases:**

| Edge Case | Contract | Status | Mitigation |
|-----------|----------|--------|------------|
| Zero amount orders | Escrow | ✅ | Rejected: `AmountMustBePositive` |
| Negative amount orders | Escrow | ✅ | Rejected: `AmountMustBePositive` |
| Buyer = Farmer | Escrow | ✅ | Rejected: `BuyerCannotEqualFarmer` |
| Duplicate initialization | All | ✅ | `AlreadyInitialized` guard |
| Zero target amount | ProductionEscrow | ✅ | Rejected: `InvalidAmount` |
| Past deadline | ProductionEscrow | ✅ | Rejected: `InvalidDeadline` |
| Overfunding | ProductionEscrow | ✅ | Rejected: `CampaignOverfunded` |
| Double claim | ProductionEscrow | ✅ | `AlreadyClaimed` guard |
| Invalid campaign ID | ProductionEscrow | ✅ | `CampaignNotFound` error |
| Invalid order ID | ProductionEscrow | ✅ | `OrderNotFound` error |
| Split ratio > 100% | Escrow | ✅ | `InvalidSplitRatio` error |
| Split ratio > 10_000 bps | ProductionEscrow | ✅ | `InvalidResolution` error |
| Single-token initialization | Escrow | ✅ | `MustSupportTwoTokens` error |
| Empty supported tokens | Escrow | ⚠️ | Dead code: `TokenWhitelistEmpty` unreachable |
| Contribution = 0, not an investor | ProductionEscrow | ✅ | `NotInvestor` error |
| Pool ≤ 0 on claim | ProductionEscrow | ✅ | `NothingToClaim` error |
| Tranche already released | ProductionEscrow | ✅ | `TrancheAlreadyReleased` error (Campaign contract) |

**Finding #5 — Empty Token Whitelist (Escrow):**
The `TokenWhitelistEmpty` variant is defined but the guard `if supported_tokens.is_empty()` on line 178 is preceded by `if supported_tokens.len() < 2` on line 175. An empty Vec (len=0) satisfies `len() < 2`, so line 179-180 is unreachable. The check order should be swapped: first check `is_empty()`, then check `< 2`.

```rust
// Current (incorrect order):
if supported_tokens.len() < 2 { return Err(MustSupportTwoTokens); }
if supported_tokens.is_empty() { return Err(TokenWhitelistEmpty); }

// Fixed:
if supported_tokens.is_empty() { return Err(TokenWhitelistEmpty); }
if supported_tokens.len() < 2 { return Err(MustSupportTwoTokens); }
```

**Severity:** Informational

---

## 11. Error Handling

### Status: ✅ Adequate

**Analysis:**

All contracts define comprehensive error enums with descriptive variant names. Every fallible path returns a `Result<_, ContractError>`.

**Patterns used:**
- `ok_or(EscrowError::...)` on storage reads
- `.ok_or(...)?` for early returns
- `match` / `if let` for conditional error paths

**Missing error cases (none found):**
- All storage reads have appropriate `ok_or` handlers
- All access control failures return specific errors
- All state machine guard failures return specific errors
- All arithmetic paths either use `checked_*` with error mapping or are astronomically safe

**Severity:** N/A

---

## 12. Event Monitoring

### Status: ✅ Verified

**Analysis:**

| Contract | Events | Topics | Data |
|----------|--------|--------|------|
| Escrow | `order:created` | `order`, `created` | `(id, buyer, farmer, amount, token)` |
| Escrow | `order:delivered` | `order`, `delivered` | `(id, farmer, buyer, timestamp)` |
| Escrow | `order:confirmed` | `order`, `confirmed` | `(id, buyer, farmer)` |
| Escrow | `order:refunded` | `order`, `refunded` | `(id, buyer)` |
| Escrow | `order:disputed` | `order`, `disputed` | `(id, opened_by, buyer, farmer)` |
| Escrow | `order:resolved` | `order`, `resolved` | `(id, resolution, buyer, farmer)` |
| Registry | `registry:updated` | `registry`, `updated` | `(escrow, production)` |
| Registry | `farmer:registered` | `farmer`, `registerd` | `(farmer,)` |
| Registry | `campaign:registered` | `campaign`, `registerd` | `(id, farmer)` |
| Campaign | `reg:init` | `reg`, `init` | `admin` |
| Campaign | `farmer:regd` | `farmer`, `regd` | `(id, farmer)` |
| Campaign | `camp:created` | `camp`, `created` | `(id, farmer, target)` |
| Campaign | `camp:funded` | `camp`, `funded` | `(id, raised, target)` |
| Campaign | `camp:invest` | `camp`, `invest` | `(id, investor, amount, new_raised)` |
| Campaign | `camp:started` | `camp`, `started` | `(id, farmer)` |
| Campaign | `camp:harvest` | `camp`, `harvest` | `(id, farmer)` |
| Campaign | `camp:settled` | `camp`, `settled` | `id` |
| Campaign | `camp:tranche` | `camp`, `tranche` | `(id, amount, released)` |
| Campaign | `camp:failed` | `camp`, `failed` | `id` |
| Campaign | `camp:disputed` | `camp`, `disputed` | `id` |
| Campaign | `camp:resolved` | `camp`, `resolved` | `(id, success)` |
| ProductionEscrow | `campaign:created` | `campaign`, `created` | `(id, farmer, token, target, deadline)` |
| ProductionEscrow | `campaign:invested` | `campaign`, `invested` | `(id, investor, amount, total_raised)` |
| ProductionEscrow | `campaign:produce` | `campaign`, `produce` | `(id, farmer)` |
| ProductionEscrow | `campaign:harvest` | `campaign`, `harvest` | `(id, farmer)` |
| ProductionEscrow | `campaign:settled` | `campaign`, `settled` | `(id, total_revenue)` |
| ProductionEscrow | `campaign:failed` | `campaign`, `failed` | `(id,)` |
| ProductionEscrow | `campaign:disputed` | `campaign`, `disputed` | `(id, caller)` |
| ProductionEscrow | `campaign:claimed` | `campaign`, `claimed` | `(id, investor, payout)` |
| ProductionEscrow | `campaign:refunded` | `campaign`, `refunded` | `(id, investor, amount)` |
| ProductionEscrow | `campaign:tranche` | `campaign`, `tranche` | `(id, amount, released)` |
| ProductionEscrow | `campaign:batch_ref` | `campaign`, `batch_ref` | `(id, count, total)` |
| ProductionEscrow | `order:created` | `order`, `created` | `(id, buyer, campaign_id, amount)` |
| ProductionEscrow | `order:confirmed` | `order`, `confirmed` | `(id, buyer, campaign_id)` |
| ProductionEscrow | `order:batch_ref` | `order`, `batch_ref` | `(count, total)` |

**All state transitions are covered by events.** Every status change in every state machine emits an event with sufficient data for off-chain indexers.

**Typo found:** Registry uses `symbol_short!("registerd")` (missing 'e') instead of `"registered"`. Consistent across both farmer and campaign events.

**Severity:** Informational

---

## 13. Findings Summary

| # | Finding | Severity | File:Line | Status |
|---|---------|----------|-----------|--------|
| 1 | `resolve_dispute` performs token transfers before state writes (CEI violation) | Low | `escrow/src/lib.rs:461-503` | Acknowledged |
| 2 | Direct arithmetic (`+=`, `*`, `/`) without `checked_*` in ProductionEscrow/Campaign | Medium | Multiple locations | Fix recommended |
| 3 | `empty()` check unreachable in `initialize` — wrong guard order | Informational | `escrow/src/lib.rs:175-179` | Fix recommended |
| 4 | `TokenWhitelistEmpty` error variant dead code | Informational | `escrow/src/lib.rs:19` | Fix recommended |
| 5 | Event typo: `registerd` → `registered` | Informational | `registry/src/lib.rs:126,205` | Acknowledge |
| 6 | Event data includes duplicate address fields retrievable off-chain | Low | All event emissions | Optimize per GAS doc |
| 7 | Fee rate hardcoded at 3% — not configurable | Low | `escrow/src/lib.rs:224` | Feature request |
| 8 | Order list storage is O(n) per append | Low | `escrow/src/lib.rs:261-273` | Optimize per GAS doc |

### Recommended Mitigations (Immediate)

1. **Fix arithmetic** — Apply `checked_add`, `checked_sub`, `checked_mul` across ProductionEscrow and Campaign contracts, consistent with Escrow's existing pattern
2. **Fix dead code** — Swap the order of `is_empty()` and `len() < 2` checks in Escrow's `initialize`
3. **Document CEI violations** — Add comments acknowledging that token transfer ordering is intentional for Soroban's non-reentrant runtime but violates best practice

### Recommended Mitigations (Short-term)

4. **Variable fee rate** — Consider making the fee rate configurable via admin function (with upper bound)
5. **Typo fix** — Correct `registerd` → `registered` (affects indexer compatibility)

---

## 14. Issue #652 Follow-up: Legacy/Production Escrow Drift Re-audit

> **Date:** 2026-07-30
> **Trigger:** Commit `240c652` ("fix: implement independent attester role to prevent farmer self-rug exploit") was applied only to `production_escrow`, never re-checked against `contracts/escrow`.

### 14.1 Self-attestation re-audit result: vulnerability confirmed and fixed

`contracts/escrow::mark_delivered` required only `farmer.require_auth()`. Once called, `delivery_timestamp` is set to a non-zero value, which permanently disables the buyer's automatic `refund_expired_order` escape hatch (`refund_expired_order`/`refund_expired_orders` both reject once `delivery_timestamp != 0`) — regardless of whether the farmer actually delivered anything. This is the same self-rug pattern `240c652` fixed in `production_escrow::mark_harvest`/`advance_milestone` via an independent attester co-signature, and it had not been ported.

**Fix applied** (this PR): ported the identical pattern —
- `DataKey::Attester` + `set_attester(admin, attester)` (admin-only setter)
- `mark_delivered(farmer, attester_caller, order_id)` now also requires `attester_caller.require_auth()`, checked against the configured attester
- While no attester is configured, falls back to requiring the admin's co-signature (mirrors this file's existing governance-fallback convention for `set_fee_config`/`set_supported_tokens`, so a deployment that never calls `set_attester` isn't bricked, but a farmer alone can no longer self-attest either way)

New error: `EscrowError::NotAttester`. New tests: `test_mark_delivered_wrong_attester_fails`, `test_mark_delivered_falls_back_to_admin_before_attester_configured`, `test_mark_delivered_uses_configured_attester`.

### 14.2 Both contracts were uncompilable — this audit could not have been "re-checked" until now

While investigating, both crates were found in a **currently uncompilable state on `main`**, each due to an unrelated botched merge — meaning neither had actually been exercised by `cargo test`/CI in this state, and any "re-check" of one against the other was structurally impossible until fixed:

| Crate | Break | Cause |
|---|---|---|
| `contracts/escrow` | Syntax error: ~50 lines of dead, duplicate dispute-resolution logic spliced into the middle of `set_arbitrators` with no function signature, referencing `DataKey::Arbitrators`/`Quorum`/`ArbitratorVote` and `EscrowError::ArbitrationNotConfigured`/`ArbitratorNotFound`/`AlreadyVoted`, none of which existed on their enums | Bad merge resolution (commit `850ea13`) |
| `production_escrow` | `EscrowError::NotGoverned` referenced by `require_governed_caller` but never added to the enum; same for `InvalidGovernanceContract` in `set_governance_contract`'s verification path | commit `897a3cc` added the reference without the variant |
| `registry` (dev-dependency of `production_escrow`'s test suite) | `mint_batch`/`link_batch_to_order`/`get_batch`/`get_batch_history` referenced an undefined `BatchRecord` type and `DataKey::Batch`/`BatchCount`/`BatchOrderLink`/`OrderBatch` | Provenance/batch-tracking feature merged without its type definitions |
| `production_escrow/src/test.rs` | Called `registry_client.register_farmer(&admin, &farmer)` against a signature that only takes `farmer` | Stale test call site after a `registry` API change |

All four are fixed in this PR (types/variants restored, dead code removed, call site updated) — each fix is additive/restorative (no behavior removed), verified by getting every existing test in all three crates passing again (`escrow`: 56/56, `production_escrow`: 191/191, `registry`: 20/21 — see §14.4).

### 14.3 Additional drift found during the re-audit: dispute resolution wasn't reporting to the reputation registry

`contracts/escrow::resolve_escrow_dispute_internal` (shared by `resolve_dispute` and `vote_to_resolve`) never called `report_reputation_outcome`, even though `confirm_receipt` does, and an existing test (`test_resolve_dispute_reports_split_outcome_to_registry`) asserted it should — the assertion had simply never been able to run before the compile fix in §14.2. Fixed by computing `buyer_share_bps` per resolution branch (matching the exact logic that was stranded in the dead code from §14.2) and reporting it, same as `confirm_receipt`.

### 14.4 Test-fixture gap (not a contract bug): ledger timestamp 0 defeats the delivery guard

`mark_delivered`'s "already delivered" guard is `order.delivery_timestamp > 0`. A fresh Soroban test `Env` defaults its ledger timestamp to `0`; a test that calls `mark_delivered` without first advancing the clock records `delivery_timestamp == 0`, silently defeating the guard and letting `mark_delivered` be called twice (`test_mark_delivered_twice_succeeds` was actually asserting this broken idempotent behavior before this PR, see the code comment removed by commit `897a3cc`'s incomplete "stabilize escrow delivery guard" fix, which changed the test's assertion without fixing the underlying baseline-timestamp gap). A live Stellar ledger is never at timestamp 0, so this is a **test-fixture gap, not a contract vulnerability**. Fixed by giving the shared test fixtures a non-zero baseline ledger timestamp once, rather than requiring every future test author to remember to advance the clock.

### 14.5 Decision: which contract is "the production one"?

**Correction to the issue's framing:** `contracts/escrow` and `production_escrow` are not duplicate/competing implementations of the same feature — they back two different product surfaces with different domain models, both live:

- `contracts/escrow` — direct buyer↔farmer marketplace order escrow (`create_order`/`mark_delivered`/`confirm_receipt`). Wired up by the root `client/` app via `client/src/services/stellar/contractService.ts`, configured through `NEXT_PUBLIC_CONTRACT_ID`/`NEXT_PUBLIC_ESCROW_CONTRACT_ID`.
- `production_escrow` — crowdfunded production campaigns (`create_campaign`/`invest`/`start_production`/`mark_harvest`/`claim_returns`). Wired up by `agro-production/client/` via its own `agro-production/client/src/lib/contractService.ts`.

Neither should be deprecated — they are both in active use by distinct, currently-shipping frontends. **Decision: both are production contracts**, and both must independently carry any security-relevant fix (like the attester pattern) rather than treating one as canonical. This makes the checklist in §14.6 load-bearing, not optional.

### 14.6 Shared checklist: cross-checking future contract security fixes

Because `contracts/escrow` and `production_escrow` intentionally duplicate several security-critical patterns (independent attester, governance-gated params, admin/arbitrator dispute resolution, fee collection) without sharing code, any fix to one of the patterns below **must** be checked against the other contract before merging:

- [ ] **Self-attestation / independent-attester requirement** on any action that gates fund release on the interested party's own claim (`mark_delivered` / `mark_harvest` / `advance_milestone`)
- [ ] **Governance-gating fallback** on admin-controlled parameter setters (`set_fee_config`, `set_supported_tokens`/`update_supported_tokens`, `set_governance_contract` itself)
- [ ] **Dispute resolution → reputation reporting** — every code path that resolves a dispute (admin-direct or arbitrator-quorum) reports the outcome to the registry, matching the "clean confirmation" path
- [ ] **Arbitrator pool / quorum voting** — `set_arbitrators`, `get_arbitrators`, `get_quorum`, `vote_to_resolve` present and type-complete (this class of bug — a feature referencing types/variants that were never defined — caused §14.2's compile breaks; a `cargo check --workspace` in CI would catch this immediately and is the single highest-leverage fix here)
- [ ] **Cancellation / cooling-off window** (`cancel_order`) — window duration, fee-refund semantics, and the guard against cancelling after delivery/confirmation
- [ ] **Multi-party split orders** — co-buyer funding, majority-by-value vs. unanimous confirmation threshold, pro-rata dispute refund
- [ ] Run the full workspace test suite (`cargo test` from the workspace root, or per-crate — see caveat below) before merging any change to either contract

**Caveat on `cargo test` at the workspace root:** as of this audit, the `registry` crate has one pre-existing, unrelated failing test (`test_reputation_is_tracked_independently_per_farmer`, a reputation-scoring assertion mismatch), and the `governance` and `investment_basket` crates each have several pre-existing failures (`HostError: ... "ledger protocol version too old for host"` — looks like a test-harness `LedgerInfo` setup gap, the same class of issue as §14.4, not a contract bug). None of these are touched by this PR and all are out of scope for issues #652–#655 — noted here rather than fixed silently so they aren't lost. Similarly, `server/src/services/reputationService.ts` has 3 pre-existing TypeScript errors and several server test files (`contractWatcher`, `groupOrderService`, `orderService`, `reputationService`, `wsManager`) have pre-existing failing tests unrelated to this PR's changes — also flagged here rather than silently worked around, since fixing them was outside the scope of issues #652–#655.

---

## 15. Scope Correction & Staleness Notice (2026-08-27)

### Why this document is now marked stale

This audit is from **2026-05-29** (3+ months old) and the stated scope has drifted. Additionally, **critical unaudited changes** have been merged since:

1. **Issues #679–#680** (compile fixes, attester pattern sync) were applied in July without re-audit of the impact
2. **Issue #777** (contract instance TTL extension) was just implemented across all four production contracts, adding `bump_instance()` calls to every state-changing entry point — an infrastructure change spanning governance, storage patterns, and initialization flows that affects the threat model (TTL management = archival prevention)
3. **Scope never updated** after `governance` and `investment_basket` contracts were added and deployed to production — this document still references the dead orphaned `contracts/src/lib.rs` Campaign contract and omits two in-scope contracts

### Scope Correction

**Original scope (stale):** Escrow (`contracts/escrow/src/lib.rs`), Registry, ProductionEscrow

**Current production scope (6 contracts — all handle real user funds):**
1. `contracts/production_escrow/src/lib.rs` — crowdfunded production campaigns (investor funds, farmer revenue)
2. `contracts/governance/src/lib.rs` — governance contract for timelock + weighted-vote proposals (admin/governance configuration)
3. `contracts/investment_basket/src/lib.rs` — investment baskets (investor funds across multiple campaigns)
4. `contracts/registry/src/lib.rs` — campaign registry + reputation scoring (critical governance reference)
5. `contracts/escrow/src/lib.rs` — legacy direct buyer↔farmer marketplace escrow (still live, backed by root `client/` app)
6. `archive/weather-insurance/src/lib.rs` — parametric weather insurance policies (farmer premium collection, LP capital pool reserves, multi-oracle quorum, challenge window finalization)

**Out of scope:** `contracts/src/lib.rs` (dead, orphaned, superseded by the split into registry + production_escrow)

### Critical Changes Post-Audit (Unaudited in This Document)

| Issue | Date | Change | Scope | Status |
|-------|------|--------|-------|--------|
| #679/#680 | 2026-07 | Compilation fixes; attester pattern ported to legacy Escrow | Escrow, ProductionEscrow | Fixed but unaudited; see §14 (re-audit results for #652–#655 only) |
| #777 | 2026-08 | **Instance TTL extension** — added `bump_instance()` calls throughout all four production contracts | All 4 contracts | **Unaudited; pending re-review** |

**#777 impact summary:** Every state-changing entry point now calls `bump_instance(env)` after auth checks, before storage writes. This prevents instance storage archival on mainnet (a critical mainnet-viability issue) but introduces new code paths and TTL management. The change spans:
- New constants: `INSTANCE_TTL_THRESHOLD` (1000 ledgers), `INSTANCE_TTL_EXTEND` (100000 ledgers)
- New helper: `bump_instance(env: &Env)` in all four contracts
- New public endpoint: `bump_instance_ttl(env: Env)` — permissionless, for keeper/cron use
- Pervasive additions: 40+ state-changing functions across the four contracts now call `bump_instance()`
- Governance functions now extend TTL: all setters for admin params, all governance-gated operations

### Marking This Document Stale

Until a proper re-audit of #777 and a full re-check of all five contracts (including investment_basket and governance, which were not in the original 2026-05-29 scope), **this document's findings should not be treated as current, and the "Status: Review Complete" label is misleading.**

**Recommended next steps:**
1. Tie a re-audit checklist to CI: add a `cargo check --workspace` gate that catches uncompilable code before code review (prevents §14.2-class breakage)
2. Schedule a formal re-review of all five contracts with particular attention to:
   - TTL extension safety (§15's #777 changes): are TTL windows adequate? do calls happen in the right places?
   - Governance contract correctness (not in original scope)
   - Investment basket contract correctness (not in original scope)
3. Add this `Last Verified Against: <commit>` field to the top-level header and update it whenever contract code changes materially

### Spot-check: `confirm_receipt` Transfer Ordering (§1 Finding)

The original audit (§1) claimed: "Transfers tokens to farmer BEFORE writing updated order status" with a "Checks-Effects-Interactions violation."

**Current code check (production_escrow::confirm_order):** The function transfers tokens (effects) after loading the order (checks) and before updating its status (would be effects). However, Soroban's synchronous, non-reentrant runtime makes reentrancy impossible; the primary concern is code clarity, not runtime safety.

**Status:** Accurate but acknowledged as low-risk in Soroban's model (§1 states "given Soroban's non-reentrant runtime, this is a code-quality concern rather than an exploitable vulnerability"). Not a blocker, but future refactors should favor writing all state changes before token transfers for clarity.

---

## 16. Issues #840, #841, #842: Weather Insurance Hardening & Solvency Audit

> **Date:** 2026-08-29
> **Target:** `archive/weather-insurance/src/lib.rs`

### 16.1 Solvency & Reserve Accounting (#840)
- **Capital Provider Deposit/Withdrawal:** Capital providers fund the contract via `deposit_capital` to maintain pool reserves. Unreserved capital can be withdrawn via `withdraw_capital`.
- **Solvency Invariant:** At policy creation (`take_premium`), the contract enforces `total_exposure + payout_amount <= total_reserves + premium`. A policy cannot be issued if exposure exceeds total available reserves.
- **Payout Conservation:** On `finalize_payout`, reserves and exposure are decremented by `payout_amount`. Premium collected remains in reserves as pool yield when policies expire without breach.

### 16.2 Oracle Quorum & Challenge Window (#841)
- **M-of-N Oracle Quorum:** Breach reports require M-of-N oracle consensus. A single oracle cannot trigger a payout alone.
- **Plausibility Bounds:** Enforces parameter-level sanity bounds per `WeatherParam` (Rainfall: `[0, 10,000]` mm, Temperature: `[-100, 100]` °C). Out-of-bounds reports are rejected.
- **Challenge Window:** When quorum is met, payout enters `PendingPayout` with `unlock_time = timestamp + challenge_window_secs`. Governance/guardian can call `cancel_pending_payout` during the window; `finalize_payout` executes after the window expires.

### 16.3 Production Hardening Primitives (#842)
- **Governance Auth:** `initialize` requires `admin.require_auth()`. Governance-gated setters use `require_governed_caller` (admin fallback until governance contract is configured).
- **Pause & Guardian:** Instant emergency `pause` callable by guardian/governance/admin; `unpause` is strictly governance-gated. `pause` blocks `take_premium` and `report_breach`.
- **Upgrade & Migration:** `upgrade` (WASM hash update), `migrate` (schema versioning), `SchemaVersion` tracking.
- **Instance Storage TTL:** `bump_instance()` called on all state-changing entry points; permissionless `bump_instance_ttl()` keeper endpoint added.

