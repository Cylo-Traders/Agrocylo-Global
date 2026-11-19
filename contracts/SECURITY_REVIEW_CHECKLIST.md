# Security Review Checklist

> Companion process document to [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md).
> That file is the audit *log* (what was found, when, with what resolution);
> this file is the *repeatable process* that produces new entries in it —
> written so the next contract addition or cross-contract integration
> triggers a scoped review automatically, instead of quietly falling outside
> `SECURITY_AUDIT.md`'s scope for months the way governance, investment
> basket, and the path-payment router did (see Issue #730, closed by the
> §15 audit in `SECURITY_AUDIT.md`).

## When this applies

Run this checklist — and add a dated entry to `SECURITY_AUDIT.md` recording
the result — whenever a PR does any of the following:

- Adds a new contract crate to the workspace (`Cargo.toml`'s `[workspace]
  members`).
- Adds a new cross-contract call from one in-scope contract to another
  (a new `invoke_contract`/`try_invoke_contract` call site, or a new
  generated client for another contract's interface).
- Adds or changes a privileged entry point: anything gated by an admin,
  governance, guardian, attester, or arbitrator check, or anything that moves
  funds.
- Adds or changes a `pause`/`upgrade`/`migrate` code path on any governed
  contract.

A PR that only touches test files, docs, or a contract's read-only `get_*`
views doesn't need this — use judgment, but default to running it if unsure.

## The checklist

### 1. Does it compile and test clean?

This sounds too obvious to need writing down, and yet: the §14 and §15
entries in `SECURITY_AUDIT.md` both found that the crate(s) under review were
**not compiling** at the time of the "audit" that preceded them, in one case
due to a duplicate struct definition, in another due to enum variants
referenced by a feature (pause/governance) that were never added to the
error/storage-key enums they belong to. Neither could have been caught by
reading the code, only by trying to build it. Before anything else on this
list:

- [ ] `cargo build --workspace` succeeds.
- [ ] `cargo test --workspace` (or per-crate, if the workspace build is
      broken for reasons unrelated to your change — but say so explicitly in
      the PR, don't silently skip this) — every test in every crate you
      touched, plus any crate that depends on it (e.g. a `production_escrow`
      change should also run `governance`'s tests, since its test fixture
      deploys a real `production_escrow` as an execution target).
- [ ] If you can't get a working toolchain in your environment, say so
      explicitly in the PR rather than merging on faith — see
      `SECURITY_AUDIT.md` §15.9 for what "reviewed but not compiled" looks
      like when it has to happen, and treat it as a blocking follow-up, not
      an acceptable end state.

### 2. Authorization

- [ ] Every state-changing entry point calls `require_auth()` on the correct
      party — the party whose funds/role is actually affected, not merely
      *an* address that happens to be a parameter.
- [ ] Every privileged setter (admin/governance/guardian/attester/arbitrator)
      checks caller identity against *stored* state, not a value the caller
      supplies unchecked.
- [ ] If the contract has a governance fallback pattern
      (`require_governed_caller`: admin-only while unset, governance-only
      once set), every security-relevant setter uses it — not just some of
      them. §15.5 in `SECURITY_AUDIT.md` found three setters on one contract
      that had been left on a plain admin check while every sibling setter
      had already been migrated to the governed pattern; check *all* of
      them, not just the ones a diff happens to touch.
      - `production_escrow::set_attester` and `set_milestone_configs`
        (#1297/#1298) now follow this pattern. `set_arbitrators` (which also
        sets the quorum) is **intentionally admin-only**: arbitrators only
        resolve disputes within already-defined resolution bounds and cannot
        move funds directly, so changing its gating is deliberately deferred
        to a separate governance-design change rather than bundled here.
- [ ] For a cross-contract call where the callee checks
      `caller_param.require_auth()`: confirm the caller contract is actually
      the one invoking the call (Soroban's contract-issued-auth — the direct
      invoker's identity — is what makes this succeed without a real
      signature), not an address embedded in caller-supplied data that
      nothing actually authenticates.

### 3. Trust boundaries on cross-contract calls

- [ ] A contract that receives a value from another contract's return value
      (a quote, a claimed transferred amount, a computed result) verifies it
      independently where the value backs a fund-moving decision — e.g. by
      checking its own token balance delta, not the callee's self-reported
      return value. See `SECURITY_AUDIT.md` §15.1's path-payment-router entry
      for the pattern this fixed once and should be checked for on every new
      integration.
  - [ ] If the callee is untrusted/replaceable (a configurable router,
        oracle, or similar), consider whether a bug or malicious
        implementation there could make the caller record state that isn't
        backed by real funds.
- [ ] A `try_invoke_contract` call site that swallows failures (so one bad
      constituent doesn't abort a batch operation) is checked for what
      happens to the *funds* on that path, not just that the call doesn't
      panic — money that was supposed to move but didn't must end up
      recorded as recoverable somewhere, not silently stuck.
- [ ] If a governance-style dispatcher (`execute(target_contract,
      function_name, args)`) picks a safety parameter (a timelock, a
      threshold) based on a caller-suppliable label rather than deriving it
      from what's actually being invoked, that label can be spoofed to pick
      the weaker path. §15.2 in `SECURITY_AUDIT.md` is the worked example:
      derive from the real function name being called, not from a separate
      caller-set tag.

### 4. Arithmetic

- [ ] Every arithmetic operation that determines a payout, fee, or balance
      change uses `checked_add`/`checked_sub`/`checked_mul` (or an explicit,
      commented rationale for why it's safe without — e.g. "bounded by a
      bps value ≤ 10,000"). Direct `+`/`-`/`*`/`/` on `i128` fund amounts is
      the single most repeated informational finding across every revision
      of `SECURITY_AUDIT.md` — it's realistically unreachable at Stellar's
      actual token-amount scale in every instance found so far, but "not a
      new instance of an already-accepted pattern" is a judgment call worth
      writing down each time, not assuming.
- [ ] Integer-division rounding dust is accounted for (documented where it
      goes — usually "left in the contract" or "to the fee collector" — not
      silently unspecified).
- [ ] A repeatable/cumulative claim formula (pay `fair_share − already_paid`
      on each call rather than a one-shot flag) is checked for whether
      `fair_share` can ever *decrease* between calls for a given claimant —
      if the inputs that determine it aren't frozen once claiming starts,
      it can, and that's a stranding/reversion bug.

### 5. Pause / emergency response

- [ ] Every fund-moving entry point respects `is_paused()` — including batch
      variants of an already-guarded singular function. §15.6 in
      `SECURITY_AUDIT.md` found a batch refund function that had been added
      after its singular sibling was pause-gated, and simply never got the
      same guard.
- [ ] `pause()` is reachable by the guardian *without* a timelock (that's
      the point — instant response to a live incident); `unpause()` is
      *not* reachable by the guardian alone, only through the full
      governance flow, so a compromised guardian key can halt but never
      resume operations unilaterally.

### 6. After the review

- [ ] Add a dated entry to `SECURITY_AUDIT.md` under a new numbered section
      (follow the existing `## N. Issue #NNN: <title>` convention), even if
      the result is "reviewed, no new findings" — a negative result is still
      a result worth recording, so the next reviewer doesn't have to redo
      the same ground.
  - [ ] For every finding, record a severity and one of three dispositions:
        **Fixed** (with the PR/commit that fixed it), **Accepted risk**
        (with the rationale — "by design" or "not reachable at realistic
        scale" are valid rationales, but write them down), or **Scheduled**
        (with enough context that it doesn't get silently lost — link an
        issue if one doesn't already exist).
- [ ] If the review found a genuinely new contract-level attack class (not
      just an instance of an already-documented pattern), add it to this
      checklist so the next review catches it structurally instead of
      relying on someone remembering.
