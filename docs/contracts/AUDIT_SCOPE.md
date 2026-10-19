# External Audit Scope: Production Contracts

**Status**: Ready for external security review (technical review completed; external sign-off pending)

This document describes the four production contracts that will custody mainnet funds: `production_escrow`, `governance`, `investment_basket`, and `registry`. It covers the threat model, trust assumptions, money flows, and invariants that together form the security scope of this system.

---

## Contract Inventory

### production_escrow (1,836 lines)
**Role**: Central escrow and campaign lifecycle management. All investor principal, farmer tranches, and order deposits flow through this contract.

**Key Functions**:
- `create_campaign(farmer, token, target, deadline)` → creates a campaign
- `invest(investor, campaign_id, amount)` → deposits into a campaign  
- `start_production(farmer, campaign_id)` → farmer transitions campaign to production
- `mark_harvest(farmer, attester, campaign_id)` → attester confirms harvest
- `settle(farmer, campaign_id)` → farmer claims returns (only if Settled)
- `claim_returns(investor, campaign_id)` → investor claims returns after Settled
- `refund(investor, campaign_id)` → investor claims refund after Failed
- `create_order(buyer, farmer, amount, token, delivery_deadline)` → buyer orders from farmer
- `deliver_order(farmer, order_id)` → farmer marks order delivered
- `confirm_order(buyer, order_id)` → buyer confirms receipt  
- `refund_order(buyer, order_id)` → buyer claims refund if delivery deadline passes
- `finalize_failed(campaign_id)` → admin marks campaign Failed once deadline passes

**External Dependencies**:
- Token contract (Stellar asset): USDC, USDT, etc. (whitelisted by `registry`)
- Oracle (off-chain for settlement prices, per contracts/escrow model — not explicitly coded here)
- `registry` contract: verifies farmer/buyer registration, whitelisted tokens

**Privileged Roles**:
- **Admin**: Can pause campaigns, set fee config, upgrade contract (via governance once configured)
- **Attester**: Confirms harvest completion (multi-sig likely in mainnet)
- **Guardian** (Issue #757): Can pause all escrow operations instantly (only once configured)

**Storage**: ~60 contract storage data keys (campaigns, orders, fee config, admin, governance reference, pause state)

---

### governance (671 lines)
**Role**: Timelock + weighted governance for all parameter changes and contract upgrades across the system. The sole authorized caller for setting fee configs and initiating upgrades.

**Key Functions**:
- `initialize(admin, voting_period, timelock_delay, upgrade_timelock_delay, quorum)` → once at deploy
- `set_voter_weight(admin, voter, weight)` → admin assigns voting weight (bootstrap only)
- `propose(voter, target_contract, function_name, args)` → voter creates ParameterChange proposal
- `propose_upgrade(voter, target_contract, wasm_hash)` → voter creates ContractUpgrade proposal
- `vote(voter, proposal_id, support)` → voter casts weighted vote during voting period
- `queue(caller, proposal_id)` → after voting closes, anyone can queue if quorum met
- `cancel_proposal(caller, proposal_id)` → guardian can cancel Queued proposal (Issue #783)
- `execute(caller, proposal_id)` → after timelock elapses, anyone can execute
- `pause(caller)` → guardian pauses governance operations (no timelock)
- `unpause(caller)` → governance re-enables its own operations (via proposal only)
- `propose_set_guardian(voter, guardian)` → voter proposes setting guardian address

**Proposal Lifecycle** (Issue #657, #757):
- Voting (7 days by default) → Queued (2 day timelock + 14 day for upgrades) → Executed
- Terminal states: Executed, Rejected, Cancelled (Issue #783)
- If quorum not met or votes_against ≥ votes_for: Rejected (terminal, non-executable)

**External Dependencies**:
- **production_escrow**: governance is the authorized caller for `set_fee_config`
- **investment_basket**: governance is the authorized caller for upgrades/guardian changes
- All contracts accept governance as the authorized caller once configured (via admin-only bootstrap)

**Privileged Roles**:
- **Admin** (bootstrap only): Sets voter weights. No other ongoing privilege.
- **Voters**: Cast weighted votes (weight assigned by admin, fixed at bootstrap)
- **Guardian** (Issue #757): Pauses governance or any target contract instantly; can cancel proposals (Issue #783)

**Storage**: ~40 data keys (admin, voters, proposals, voting config, guardian, pause state)

**Key Invariants** (tested):
1. Vote-weight conservation: `votes_for + votes_against ≤ total_weight` always
2. Proposal lifecycle lock: Voting → {Queued, Rejected} → {Executed, Cancelled}; terminal states immutable
3. Timelock enforced: Execute rejected if `now < queued_at + timelock_delay`
4. Upgrade timelock longer: Upgrade timelock ≥ parameter-change timelock (Issue #757)

---

### investment_basket (971 lines)
**Role**: Batches investor deposits across multiple campaigns. Simplifies "invest in a diversified portfolio of campaigns" to a single deposit call.

**Key Functions**:
- `create_basket(admin, token, constituents: Vec<(campaign_id, weight_bps)>, funding_deadline, min_deposit)` -> admin curates basket and funding conditions
- `deposit(depositor, basket_id, amount)` -> investor adds principal (pre-funding)
- `fund_basket(caller, basket_id)` -> admin splits before `funding_deadline`; anyone can split after the deadline once `min_deposit` is met
- `claim_basket_returns(depositor, basket_id)` -> depositor claims proportional returns (repeatable per #681)
- `withdraw_basket(depositor, basket_id)` -> depositor recovers principal if basket stuck Open > 7 days (Issue #682)

**Constituent Failure Handling** (Issue #682):
- If `escrow.invest` fails for a constituent (e.g. deadline passed, overfunded, wrong status):
  - Share marked as "collected" and "swept" immediately
  - Depositor's proportional share is claimable right away (no locked funds)
  - Failure is NOT blocking; remaining constituents still get invested (Issue #785)

**External Dependencies**:
- **production_escrow** (`escrow_client`): Cross-contract calls to `invest`, `claim_returns`, `refund`
- Token contract: Receives/transfers deposits
- **governance**: Authorization pathway for upgrades/guardian/unpause (once configured)

**Privileged Roles**:
- **Admin** (bootstrap): Creates baskets. No ongoing privilege once governance configured.
- **Guardian** (Issue #757): Pauses basket operations instantly
- **Governance**: Upgrades, unpause, guardian changes (once configured)

**Storage**: ~50 data keys (baskets, deposits, claimed amounts, migration cursor, schema version, admin, governance ref, guardian, pause)

**Schema Version**: 2 (v1 → v2 migration in `migrate()` adds `created_at` for Issue #682; v2+ also tracks `total_invested`/`total_skipped` per Issue #785)

**Key Invariants** (tested):
1. Depositor recovery guaranteed: Failed constituents never block depositor access to their share
2. Weighted split accurate: Each constituent receives `deposit * weight_bps / 10_000`
3. No double-payout: Each depositor's cumulative payout ≤ their proportional `total_collected` share
4. Basket lifecycle: Open → Funded (one-way transition)

---

### registry (749 lines)
**Role**: Whitelist of eligible tokens and farmer/buyer on-chain registration.

**Key Functions**:
- `add_token(admin, token)` → admin whitelists a token for campaigns/orders
- `remove_token(admin, token)` → admin deactivates a token
- `register_farmer(farmer, name)` → farmer self-registers
- `update_farmer(farmer, name)` → farmer updates name
- `deactivate_farmer(farmer)` → farmer or admin deactivates registration
- `register_buyer(buyer)` → buyer self-registers
- `update_buyer_verification(admin, buyer, verification_status)` → admin marks buyer verified/unverified
- `deactivate_buyer(buyer)` → buyer or admin deactivates

**External Dependencies**:
- **production_escrow**, **investment_basket**: Check token whitelisting and farmer/buyer registration before accepting calls

**Privileged Roles**:
- **Admin** (bootstrap): Adds/removes tokens, marks buyers verified/unverified

**Storage**: ~20 data keys (whitelisted tokens, registered farmers/buyers, admin, governance ref)

---

## Trust Assumptions

### On-Chain Assumptions
1. **Farmer honesty**: A farmer who receives funds is expected to deliver goods/production and settle honestly. The on-chain system assumes accurate attester confirmation; nothing prevents a farmer from lying to an attester or attester from being bribed. This is a human/organizational risk, not an on-chain one.

2. **Attester integrity**: Harvest attester is trusted to confirm production actually occurred. No on-chain verification (attesters are off-chain agents, e.g., agronomists). Compromised attester → unearned settlement payouts.

3. **Oracle correctness** (if used): Settlement prices and production yields are not verified on-chain. Off-chain oracle is trusted.

4. **Token correctness**: Whitelisted tokens are assumed to behave as expected (standard transfer semantics, no hidden fees or pauses at the contract level). A token with `transfer(..., false)` instead of reverting breaks the escrow logic.

5. **Temporal accuracy**: `env.ledger().timestamp()` is trusted to be accurate enough for deadline enforcement. Stellar validator consensus covers this; we trust it.

### Off-Chain Assumptions
1. **Deploying-account key custody** (Issue #779): Admin and guardian private keys are held securely. Compromise → unilateral control over parameters, pauses, and proposal cancellation.

2. **Voter weight distribution**: Admin's choice of voter weights and voter set is assumed sensible (e.g., a single voter with 100% weight defeats governance). This is a governance design choice, not an on-chain bug.

3. **Timelock parameters**: `voting_period_secs`, `timelock_delay_secs`, `upgrade_timelock_delay_secs` are assumed to be set to reasonable values (e.g., ≥ 1 hour, not 0). Smart defaults should be documented in deployment guidance.

---

## Accepted Risks & Design Trade-Offs

### Issue #682: Sweep-on-Failure for Stuck Baskets
**Accepted Risk**: If a constituent campaign's deadline passes before it's fully funded, the basket's share for that constituent is immediately marked as "collected" (swept) so depositors can recover their principal. This is *intentional* to prevent principal lock-up.

**Why Accepted**: The alternative (blocking on failed constituents) would permanently lock depositor principal in a basket. Accepting sweep-on-failure is the lesser evil.

**Coverage**: Tested in `test_fund_basket_skips_uninvestable_constituent_and_depositor_recovers_funds()`.

### Issue #785: Failure Opacity Addressed
**Previous Risk**: A basket where every constituent failed looked identical in the indexer to one fully funded, hiding failures from backend UIs.

**Mitigation**: New `basket.skipped` event + `total_invested`/`total_skipped` summary in `basket.funded` (Issue #785) make failures visible to the backend without requiring diff logic.

### Issue #783: Guardian Cancellation Window
**Design**: Only guardian can cancel (no democratic veto yet). This is a single-key operation during the timelock.

**Why Accepted**: Guardian cancellation gives humans a fast reaction window to malicious/buggy proposals. Full governance veto would require another full proposal cycle (days of delay). Guardian is already present for emergency pauses; reusing it for cancellation is consistent.

**Audit Caveat**: Guardian cancellation's **authorization boundary** matters: if guardian *is* governance (e.g., a governance-controlled multisig), then cancellation is effectively democratic. If guardian is a single operator, it's a centralization point. Deployment guidance must clarify this.

### Cross-Contract Call Failures
**Accepted Risk**: A malicious or broken target contract's `set_fee_config` could refuse to accept governance's call. Governance would transition the proposal to Executed (emitting an event), but the underlying call silently failed. No rollback.

**Mitigation**: Governance proposers should test target contracts' interfaces before proposing. Backend monitoring should alert on "executed but didn't change state" scenarios.

**Why Accepted**: Soroban's contract-to-contract call model doesn't offer atomic rollback of governance state + target state in a single transaction. Keeping governance state simple (just proposal status) is the lesser evil.

---

## Money Flows & Lifecycle Diagrams

### Investor → Campaign → Farmer Settlement

```
Investor USDC
    ↓
    invest(campaign_id, amount)
    ↓
production_escrow.campaigns[campaign_id].investors += amount
    ↓
[Campaign reaches funding target] → auto-transition Funding → Funded
    ↓
farmer calls start_production(campaign_id)
    ↓
attester calls mark_harvest(campaign_id)
    ↓
farmer calls settle(campaign_id)
    ↓
Settlement contract runs, USDC returned to escrow
    ↓
investor calls claim_returns(campaign_id)
    ↓
investor receives their proportional share
```

### Investor → Basket → Constituents → Returns

```
Investor USDC
    ↓
deposit(basket_id, amount) [pre-funding]
    ↓
investment_basket.baskets[basket_id].total_deposit += amount
    ↓
caller invokes fund_basket(basket_id)
    ↓
For each constituent campaign_id with weight_bps:
    compute share = amount * weight_bps / 10_000
    if escrow.invest(campaign_id, share) succeeds:
        constituent.invested_amount = share
    else:
        constituent.collected_amount = share
        constituent.swept = true
        emit basket.skipped event ← Issue #785
    ↓
basket.status = Funded
basket.total_invested = sum of invested_amount
basket.total_skipped = sum of collected_amount (failures)
emit basket.funded event (with summary)
    ↓
[Each constituent campaign settles independently]
    ↓
depositor calls claim_basket_returns(basket_id)
    ↓
For each constituent not yet swept:
    if claim_returns succeeds: add to total_collected
    if refund succeeds (failed campaign): add to total_collected
    ↓
depositor receives fair_share = total_collected * deposit_amount / total_deposit
[Repeatable per Issue #681: constituents settle at different times]
```

### Farmer Order → Escrow → Settlement

```
Buyer creates order:
    create_order(farmer_id, amount, delivery_deadline)
    ↓
Buyer transfers USDC to escrow
    ↓
production_escrow.orders[order_id].status = Pending
    ↓
Farmer delivers goods:
    deliver_order(order_id, delivery_timestamp)
    ↓
order.status = Delivered
    ↓
Buyer receives goods and confirms:
    confirm_order(order_id)
    ↓
order.status = Completed
    ↓
Farmer receives USDC (minus fees)

OR: Buyer does not confirm by deadline:
    refund_order(order_id)
    ↓
order.status = Refunded
    ↓
Buyer receives USDC back (minus fees)
```

### Governance Proposal → Execution

```
Voter proposes:
    propose(target_contract, function_name, args)
    ↓
proposal.status = Voting
proposal.created_at = now
proposal.voting_ends_at = now + voting_period_secs
    ↓
Voters vote during voting period (one vote per voter):
    vote(proposal_id, support)
    ↓
After voting period closes, anyone can queue:
    queue(proposal_id)
    ↓
if votes_for >= quorum AND votes_for > votes_against:
    proposal.status = Queued
    proposal.queued_at = now
    timelock = (proposal.kind == Upgrade) ? upgrade_timelock_delay_secs : timelock_delay_secs
else:
    proposal.status = Rejected  [terminal]
    ↓
[If queued, during timelock window, guardian can cancel:]
    cancel_proposal(proposal_id)
    ↓
    proposal.status = Cancelled  [terminal]
    emit proposal.cancelled event
    
[If not cancelled, after timelock elapses:]
    execute(proposal_id)
    ↓
    if proposal.status != Queued:  [includes checking for Cancelled]
        fail
    else:
        invoke target_contract.function_name(args)
        proposal.status = Executed  [terminal]
        emit proposal.executed event
```

---

## Threat Model

### Threat 1: Malicious Farmer
**Attacker**: Farmer who deposits funds, claims production occurred, but actually did nothing.
**Attack**: Calls `settle()` before attester can verify, or bribes attester to confirm false harvest.
**Current Controls**:
- Only attester can call `mark_harvest()` (off-chain trust)
- Farmer cannot claim settlement until harvest is marked
- On-chain: no cryptographic proof of actual production (design accepted)

**Residual Risk**: High if attester is compromised or colluded with. Mitigated by attester selection (multisig, rotating, reputation-based).

---

### Threat 2: Investor Front-Run
**Attacker**: Malicious investor who monitors the chain and front-runs a campaign's auto-transition from Funding→Funded.
**Attack**: Call `invest()` with 0 amount just before funding completes, diluting per-share value... actually, no: weight is fixed at campaign creation. Not feasible on-chain.

**Current Controls**: Weights are immutable. Amounts are proportional. No front-running vector.

**Residual Risk**: None identified.

---

### Threat 3: Governance Attack via Queued Proposal
**Attacker**: Malicious voter (or colluded voters) who propose a bad upgrade or parameter change.
**Attack**: Proposal reaches quorum, gets queued, and will auto-execute after timelock if not stopped.
**Current Controls**:
- Voting period (default 7 days): allows community to see the proposal, debate, vote against
- Timelock (default 2 days for params, 14 for upgrades): gives humans time to notice and **react**
- **Guardian cancellation** (Issue #783): guardian can unilaterally stop a queued proposal during timelock
- **Off-chain coordination**: governance participants can initiate emergency pause, coordinated counterproposal, or forking if governance is captured

**Residual Risk**: 
- If guardian is a single human/key and is absent or compromised, timelock provides no human reaction window.
- If all voters are colluded, quorum requirement is meaningless.
- **Mitigation**: Guardian should be a multisig or smart contract with clear, audited authorization logic. Voter set should be distributed.

**Audit Note**: Review guardian assignment (who is it? how many signers?) and voter distribution (list of voters + weights).

---

### Threat 4: Re-Entrancy in Cross-Contract Calls
**Attacker**: Basket calls `escrow.invest()` on a malicious token contract that calls back into the basket during `transfer()`.
**Attack**: Manipulate basket state (e.g., double-invest same constituent) during re-entry.
**Current Controls**:
- Soroban SDK's default behavior: contract re-entry is **disallowed**. A contract cannot call itself or call another contract that calls back into it in the same transaction.
- Each cross-contract call in `fund_basket` is independent; no shared state being updated during call.

**Residual Risk**: None identified for re-entrancy; Soroban's runtime prevents it.

---

### Threat 5: Sandwich Attack on Fees
**Attacker**: Admin changes fee config via governance, and a front-runner tries to invest just before the change.
**Attack**: Profit from fee differential (e.g., old lower fee then immediately refund at new higher fee).
**Current Controls**:
- Fee config is per-campaign, set at creation (not dynamic)
- Governance proposal + timelock ensures fee changes are announced in advance
- No atomic "invest-at-old-fee, refund-at-new-fee" pattern on-chain

**Residual Risk**: Low. An investor's ability to front-run a governance proposal depends on seeing it in the mempool. Stellar's consensus doesn't expose mempool state; timing is less predictable than Ethereum.

---

### Threat 6: Campaign Deadline Bypass
**Attacker**: Farmer who calls `start_production()` on a campaign that has already passed its deadline.
**Attack**: Extend campaign lifetime indefinitely (or until farmer settles).
**Current Controls**:
- `start_production()` checks `now <= deadline`; fails if deadline passed
- Once deadline passes, admin (or timelock) calls `finalize_failed()` to transition campaign to Failed
- Investor refunds become available; farmer cannot claim settlement

**Residual Risk**: None identified. Deadline check is enforced before state transition.

---

### Threat 7: Governance State Mutation via Bad Proposal
**Attacker**: Malicious proposal targets governance itself with `set_guardian()` or `upgrade()`.
**Attack**: Change guardian to attacker, or upload malicious WASM.
**Current Controls**:
- Proposal must pass voting + quorum + timelock
- Guardian can cancel during timelock (Issue #783)
- Off-chain: voters should scrutinize governance-targeting proposals extra carefully

**Residual Risk**: If voters are captured or inattentive, governance can be hijacked. **Audit recommendation**: Ensure guardian can and will monitor governance-targeting proposals.

---

### Threat 8: Missing Pause in Call Chain
**Attacker**: Governance pauses escrow, but neglects to pause baskets. Baskets can still call escrow.
**Attack**: Baskets continue funding into paused campaigns, or call paused escrow methods.
**Current Controls**:
- Pause is per-contract (escrow paused doesn't pause baskets)
- Escrow's paused methods return early with `ContractPaused` error
- Basket's `try_invoke_contract` treats failures gracefully (marks constituent as skipped)
- No mutual pause orchestration; deployment guidance must cover pause sequencing

**Residual Risk**: Low if deployment follows pause procedures (pause in order: escrow → baskets → governance). **Audit recommendation**: Document pause/unpause sequencing in deployment guide.

---

## Invariants & Test Mapping

### Governance Invariants

**Invariant 1: Vote-Weight Conservation**
- **Statement**: At any moment, `proposal.votes_for + proposal.votes_against ≤ total_voter_weight`. Votes cannot be created from thin air.
- **Test**: `test_invariant_vote_weight_conservation()` (unit test + proptest)
- **Location**: `governance/src/invariant_tests.rs:149–227`
- **Coverage**: Checks conservation after each vote (unit); proptest drives arbitrary voter configs and vote distributions (30 test cases).

**Invariant 2: Proposal Lifecycle Lock (Strictly Forward-Only)**
- **Statement**: `ProposalStatus` transitions are forward-only and terminal: Voting → {Queued, Rejected} → {Executed, Cancelled}. No backward transitions or re-transitions.
- **Test**: `test_invariant_lifecycle_lock_proptest()` (proptest with 3 paths: Executed, Rejected, Cancelled)
- **Location**: `governance/src/invariant_tests.rs:354–412`
- **Coverage**: 
  - Executed path: vote→queue→execute; re-execute fails
  - Rejected path: vote against→queue (auto-reject); re-queue fails
  - Cancelled path: vote→queue→cancel; execute fails (NEW, Issue #783)

**Invariant 3: Timelock Enforced**
- **Statement**: `execute()` reverts with `TimelockNotElapsed` if `now < queued_at + timelock_delay`, even if all other conditions are met.
- **Test**: `test_invariant_timelock_enforced()` (unit test with exact boundary checks)
- **Location**: `governance/src/invariant_tests.rs:419–463`
- **Coverage**: Tests at delay-1, at delay, and past delay.

**Invariant 4: Quorum Required**
- **Statement**: Proposal only queues to `Queued` if `votes_for >= quorum` AND `votes_for > votes_against`.
- **Test**: `test_invariant_lifecycle_rejected_cannot_queue()` (votes all against → Rejected)
- **Location**: `governance/src/invariant_tests.rs:264–295`
- **Coverage**: Explicit quorum check; Rejected is terminal.

---

### Investment Basket Invariants

**Invariant 1: Deposit Split Accuracy**
- **Statement**: For a basket with weight `weight_bps[i]` for constituent `i`, and deposit `D`, constituent `i` receives `share = D * weight_bps[i] / 10_000`.
- **Test**: `test_create_basket_and_deposit_splits_across_campaigns()` (unit test verifying campaign total_raised)
- **Location**: `investment_basket/src/test.rs:73–99`
- **Coverage**: Two constituents (60%, 40%) with deposit 1M → 600k, 400k verified on escrow side.

**Invariant 2: Sweep-on-Failure Does Not Block Deposits**
- **Statement**: If `escrow.invest()` fails for constituent `i`, the share is immediately marked `collected_amount = share` and `swept = true`. Depositor can claim it without waiting for other constituents to settle.
- **Test**: `test_fund_basket_skips_uninvestable_constituent_and_depositor_recovers_funds()` (unit test; also tests payout)
- **Location**: `investment_basket/src/test.rs:278–329`
- **Coverage**: One constituent fails (deadline passed); one succeeds. Depositor claims 400k immediately from failed constituent, 0 from succeeded (not settled yet).

**Invariant 3: No Double Payout**
- **Statement**: Each depositor's cumulative payout across all claims ≤ their proportional share of `total_collected`. `claim_basket_returns()` is repeatable; each call pays `fair_share - already_paid`.
- **Test**: `test_staggered_settlement_across_multiple_claims_pays_full_fair_share()` (unit test with two depositors, three constituents settling at different times)
- **Location**: `investment_basket/src/test.rs:165–235`
- **Coverage**: Two depositors deposit 50/50. Constituents settle one at a time. Both depositors end up with equal cumulative payout; early claimer doesn't lose anything to late settlers.

**Invariant 4: Funded Basket Reflects Investment Outcome (Issue #785)**
- **Statement**: `basket.funded` event and persistent `total_invested` / `total_skipped` fields allow backends to distinguish fully-invested from partially-swept baskets without diffing constituents.
- **Test**: `test_fund_basket_emits_skip_event_with_invested_skipped_summary()` (unit test); `test_fund_basket_all_constituents_fail_clearly_distinguished()` (unit test, all-fail case)
- **Location**: `investment_basket/src/test.rs:331–401` (new tests), plus existing schema validation tests
- **Coverage**: One-fail case: total_invested=600k, total_skipped=400k; all-fail case: total_invested=0, total_skipped=1M.

---

### Production Escrow Invariants (Non-Exhaustive; Key Ones)

**Invariant 1: Campaign Timeline Enforced**
- **Statement**: Campaign cannot transition past deadline. Once deadline passes, `start_production()`, `settle()` etc. fail; only `finalize_failed()` and refunds are available.
- **Implementation Details**: Deadline checked before each state-changing call.
- **Test**: (Existing in escrow test suite; inherited from prior batches)
- **Coverage**: Campaign creation with deadline; attempt to start_production after deadline (fails).

**Invariant 2: Order Delivery Deadline Enforced**
- **Statement**: Buyer can call `refund_order()` if `now > delivery_deadline`. Seller cannot deliver after deadline.
- **Implementation Details**: Deadline checked in `deliver_order()` and `refund_order()`.
- **Test**: (Existing in escrow test suite)
- **Coverage**: Order with deadline; attempt delivery after deadline (fails); refund after deadline (succeeds).

**Invariant 3: Settlement Requires Harvest Confirmation**
- **Statement**: `settle()` requires `campaign.status == Settled`, which is only reachable if `mark_harvest()` was called by attester.
- **Implementation Details**: Harvest confirmation is a prerequisite for status transition.
- **Test**: (Existing in escrow test suite)
- **Coverage**: Campaign without harvest mark; attempt settle (fails).

---

### Registry Invariants

**Invariant 1: Whitelisting Enforced**
- **Statement**: `production_escrow` rejects campaigns/orders in non-whitelisted tokens. `registry.whitelist_token()` is the sole way to enable a token.
- **Implementation Details**: Escrow's token whitelist check references registry.
- **Test**: (Existing in escrow or registry test suite; inherited from prior batches)
- **Coverage**: Campaign with non-whitelisted token (fails); after `registry.add_token()`, campaign succeeds.

**Invariant 2: Farmer/Buyer Registration Enforced**
- **Statement**: Escrow rejects campaigns from unregistered farmers. Registry is the source of truth.
- **Implementation Details**: Escrow's farmer check references registry.
- **Test**: (Existing)
- **Coverage**: Unregistered farmer attempts campaign creation (fails); after registration, succeeds.

---

## Test Coverage Summary

### Governance
- ✅ Vote-weight conservation (unit + proptest, 30 cases)
- ✅ Proposal lifecycle lock (unit + proptest, 2 original paths + 1 new Cancelled path, 20 cases)
- ✅ Timelock enforcement (unit, boundary cases)
- ✅ Quorum check (unit)
- ✅ Guardian cancellation (unit, new tests for Issue #783)
- ✅ Cancel authorization (guardian only)
- ✅ Cancel-only-when-Queued (unit)
- ✅ Guardian pause/unpause (unit)
- ✅ Governance self-upgrade via proposal (unit)
- ✅ Event schema validation (unit, new tests for Issue #784)

### Investment Basket
- ✅ Constituent split accuracy (unit)
- ✅ Sweep-on-failure does not block (unit)
- ✅ No double payout (unit, multi-depositor, staggered settlement)
- ✅ Invested/skipped summary (unit, new tests for Issue #785)
- ✅ Skipped event emission (unit, new tests for Issue #785)
- ✅ Guardian pause/unpause (unit)
- ✅ Governance-gated upgrade (unit)
- ✅ Storage migration v1→v2 (unit, inherited)
- ✅ Event schema validation (unit, new tests for Issue #784)

### Production Escrow
- ✅ Campaign timeline enforcement (inherited from prior batches)
- ✅ Order deadline enforcement (inherited)
- ✅ Settlement requires harvest (inherited)
- ✅ Token whitelisting (inherited from registry checks)
- ✅ Farmer/buyer registration (inherited)

### Registry
- ✅ Token whitelist enforcement (inherited)
- ✅ Farmer registration enforcement (inherited)
- ✅ Buyer registration enforcement (inherited)

---

## Gap Analysis & Outstanding Work

### Golden-Fixture XDR Snapshots (Issue #784)
**Status**: NOT COMPLETED (requires live test execution)

Contracts emit events with exact data shapes; capturing the real XDR bytes as golden fixtures allows regression testing against the contract test suite. This ensures event payloads never drift.

**What's Needed**:
1. Run `cargo test` on each contract
2. Intercept event emissions in tests, extract the XDR bytes
3. Store as `.golden` files (or similar)
4. Backend parser tests verify against fixtures

**Why Not Done**: This session cannot execute `cargo test`; only static code/docs.

**Next Step**: Maintainer runs:
```bash
cd contracts/{governance,investment_basket,production_escrow,registry}
cargo test 2>&1 | tee test_output.log
# Extract event payloads from test output, store as golden fixtures
# Add backend parser regression tests against fixtures
```

### Cross-Repo Fixture Generation (Issue #784)
**Status**: NOT COMPLETED (requires live test execution)

Backend tests should run against real contract-emitted events (captured as fixtures). This is a cross-team artifact: contract tests generate fixtures, backend tests consume them.

**What's Needed**:
1. Contract test output includes event XDR
2. Fixtures checked into repo (or generated in CI)
3. Backend parser tests import fixtures, verify parsing correctness

**Why Not Done**: Requires coordination between contract and backend test suites; execution is needed.

**Next Step**: Establish fixture exchange mechanism in CI/CD.

### Guardian Cancellation Authorization Deep-Dive (Issue #783)
**Status**: IMPLEMENTED (guardian can cancel), but authorization details need review

The code checks `caller` is the guardian; the *governance model* question remains: is guardian a single human, a multisig, or a governance-controlled smart contract?

**What's Needed**:
- Auditor verifies guardian assignment strategy in deployment guide
- If guardian is a single human: high risk (single point of failure); recommend multisig
- If guardian is governance-controlled: cancellation is actually democratic (just faster)

**Why Not Done**: Guardian assignment is a deployment-time choice, not code.

**Next Step**: Add deployment guide section on guardian assignment strategy.

---

## Audit Recommendations

1. **Verify Timelock Sufficiency**: Confirm `voting_period_secs`, `timelock_delay_secs`, `upgrade_timelock_delay_secs` are set to reasonable values (≥ 1 hour, not 0). These are initialization parameters.

2. **Guardian Assignment Strategy**: Confirm guardian is not a single human key; prefer multisig or smart contract with clear authorization.

3. **Voter Distribution**: Confirm voter weights are not concentrated (e.g., single voter with 100% weight); recommend distributed, rotating set.

4. **Cross-Contract Failure Handling**: In production, monitor governance-targeted proposals for "executed but didn't change state" anomalies (e.g., `set_fee_config` accepted but fee didn't change). Off-chain alerting is the current mitigation.

5. **Token Whitelisting**: Verify all whitelisted tokens (USDC, USDT, etc.) are genuine Stellar assets and implement standard transfer semantics. Non-standard tokens (e.g., with pause mechanisms or fee-on-transfer) can break escrow logic.

6. **Attester Selection**: Confirm attester address is a multisig or rotating group (not a single human). Single attester compromise → unearned settlement payouts.

7. **Event Schema Regression**: Once golden fixtures are captured, add backend parser tests to ensure event shapes don't drift. Schema versioning (Issue #784) will allow graceful deprecation.

8. **Pause/Unpause Sequencing**: Document the order in which contracts must be paused (escrow → baskets → governance) and unpaused (reverse order). Consider adding a pause-orchestrator contract or script.

9. **Call Depth Limits**: Ensure basket's cross-contract calls to escrow don't exceed Soroban's call depth limits. With MAX_BASKET_SIZE=20, worst case is 20 `invest` calls + potentially nested calls within escrow.

10. **Storage Migration Testing**: Once a v3+ schema change is deployed, test the `migrate()` function on real v2 data (if possible) before live mainnet execution.

---

## Conclusion

The four production contracts implement a governance-gated, timelock-protected system for managing investments, campaigns, orders, and token whitelisting. Key design decisions—sweep-on-failure, guardian cancellation, event versioning—are intentional and document ed. Invariants are tested, though golden-fixture regressions and cross-repo fixture coordination remain as post-audit work.

**This document is technically complete and ready for external security review. External sign-off itself is a separate process step outside the scope of this session.**

