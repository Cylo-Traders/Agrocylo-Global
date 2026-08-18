# Contract upgrade strategy

Issue #757. Applies to all 5 Rust/Soroban contracts: `contracts/escrow`,
`agro-production/contract/registry`, `.../production_escrow`,
`.../investment_basket`, `.../governance`.

## Why this exists

None of the contracts had any WASM-upgrade mechanism. Fixing a deployed bug
meant deploying a brand-new contract instance and somehow migrating all
existing state and users to it — expensive, risky, and in direct tension
with the escrow model's core promise of safely holding user funds across a
fix. This document defines how upgrades happen instead: governance-gated,
timelocked, and with an explicit, tested storage-migration story.

## 1. Governance-gated upgrade, not a second privileged pathway

Every contract exposes:

```rust
pub fn upgrade(env: Env, caller: Address, new_wasm_hash: BytesN<32>) -> Result<(), Error> {
    caller.require_auth();
    require_governed_caller(&env, &caller)?; // admin-only bootstrap, governance-only once set
    env.deployer().update_current_contract_wasm(new_wasm_hash);
    Ok(())
}
```

`require_governed_caller` is the same function already gating
`set_fee_config`/`set_registry_contract`/`update_supported_tokens` since
Issue #660 (hardened in #680): admin-only while no governance contract is
configured, governance-contract-only once it is. There is deliberately no
second, upgrade-specific authorization path — an upgrade proposal is just
another `target_contract::function_name(args)` flowing through governance's
existing `propose -> vote -> queue -> execute` pipeline.

The one addition on the governance contract itself is `propose_upgrade`, a
thin wrapper around the generic `propose` that:

- fixes `function_name` to `"upgrade"` and encodes `(governance_address,
  new_wasm_hash)` as `args`, so callers don't hand-encode a raw upgrade call;
- tags the resulting proposal `ProposalKind::ContractUpgrade`.

`queue`/`execute` are otherwise unmodified — the only place `kind` matters is
`execute`'s timelock lookup (§2).

**Governance's own upgrade** can't fall back to a raw admin key the way
target contracts' *bootstrap* can (that would just relocate the single-key
risk #680 closed into governance itself). But it also can't reuse the exact
`caller.require_auth()` + address-equality pattern used everywhere else for
this: Soroban disallows a contract invoking itself via `invoke_contract`
("Contract re-entry is not allowed", enforced host-side, independent of
auth) — discovered while building this out; the initial design assumed a
contract's call to its own address would be auto-authorized the same way
the reputation-report cross-contract call in `contracts/escrow` is, and that
assumption doesn't hold when the "cross-contract" call is actually a
self-call.

So `GovernanceContract` has **no public `upgrade`/`set_guardian`/`unpause`/
`migrate` entrypoint at all**. `execute` special-cases a proposal whose
`target_contract` is governance's own address and dispatches to an internal
`execute_self_action` function directly (a plain Rust call, not
`invoke_contract`) instead of attempting the (impossible) self-invocation.
Reaching that dispatch already means the full `propose -> vote -> queue ->
timelock` gate passed — there's no separate caller-identity check to bypass,
because there's no other code path that leads there at all.

## 2. A longer timelock for upgrades

`GovernanceContract::initialize` takes both `timelock_delay_secs` (ordinary
parameter changes) and `upgrade_timelock_delay_secs` (`ProposalKind::
ContractUpgrade`), and rejects configs where the upgrade delay is shorter —
a bad upgrade has categorically higher blast radius than a bad fee-rate
change, so it must never be faster to push through. `execute` selects which
delay applies based on `proposal.kind`; everything else (voting, quorum,
queuing) is identical, shared machinery.

Example values used in tests: 2-day parameter timelock, 14-day upgrade
timelock. Production values are a governance/ops decision, not a contract
constant — pick something long enough for depositors and observers to react
to a queued upgrade before it executes.

## 3. Emergency pause: a faster, narrower interim safeguard

A 14-day upgrade timelock is by design too slow for the highest-severity
live incidents (an exploit actively draining funds). Every contract has:

- `Guardian` (an `Address`, settable only via `require_governed_caller` —
  never bootstrapped by a raw admin call with no oversight);
- `pause(caller)` — instant, no timelock, callable by **either** the
  guardian or the configured governance contract (on `contracts/escrow`,
  `production_escrow`, `investment_basket`, `registry` — a normal
  cross-contract call from governance, no different from any other governed
  setter). On `GovernanceContract` itself, `pause` is guardian-only:
  governance calling its *own* `pause` would be the same disallowed
  self-invocation described in §1, and there's no need for governance to
  pause itself via its own slow proposal flow anyway;
- `unpause(caller)` — governance-only, **not** the guardian, everywhere.

The guardian/governance split is deliberate: a compromised or overcautious
guardian key can halt the contract but can never resume it unilaterally or
hold it hostage indefinitely — recovery always goes through the slower,
accountable governance path. This is why `pause` also never gates
governance's own `propose`/`vote`/`queue`/`execute`: governance must stay
operable while every *other* contract is paused, since it's the only path
back to `unpause` (and the only path to actually ship the fix via `upgrade`).

`require_not_paused` guards the fund-moving mutators on each contract
(order/campaign/investment/dispute/claim/refund flows). Pure views keep
working while paused so integrators can still read state. One deliberate
exception: `registry::record_order_outcome` is **not** pause-gated, because
the escrow contracts invoke it via a plain (non-`try_`) cross-contract call
as part of their own `confirm_receipt`/`resolve_dispute` core paths —
pausing that too would let a registry pause brick unrelated escrow
functionality, a bigger blast radius than intended.

### Expected sequence for a live incident

1. Guardian (or governance) calls `pause` — instant.
2. Governance proposes/votes/queues the fix as a `ContractUpgrade` proposal
   (or, if the fix doesn't need new code, a `ParameterChange` proposal).
3. After the applicable timelock, `execute` calls `upgrade`.
4. If the upgrade changes stored data shape, `migrate` runs — see §4 — while
   still paused.
5. Governance calls `unpause` once migration is verified complete.

## 4. Storage migration: why it can't be hand-waved

Soroban's storage model deserializes a persisted `#[contracttype]` struct by
looking up each of the *target* type's declared fields by name in the
stored map. If a stored entry is missing a field the new struct type
requires (because it was written by older code, before that field existed),
decoding it as the new type **traps** — it does not return `None` or a
recoverable error. You cannot deploy new code that just starts reading
existing entries with a reshaped struct and expect old entries to degrade
gracefully; every affected entry must be explicitly translated before
anything tries to decode it as the new shape.

Each contract exposes:

```rust
DataKey::SchemaVersion,
```

set to `CURRENT_SCHEMA_VERSION` at `initialize` (a fresh deployment never
needs migration — its data is current-shape from the start), and:

```rust
pub fn migrate(env: Env, caller: Address, ...) -> Result<u32, Error>
```

governance-gated identically to `upgrade`, meant to run **after** `upgrade`
and **while still paused** (step 4 above) — so no normal operation can
observe a contract that's "upgraded" but still holds un-translated data.

### Worked example: `investment_basket`

This is a real case already in this codebase, not a hypothetical: Issue
#682 added `Basket.created_at`. A basket created by code predating that fix
would be stored without it. `investment_basket::migrate` demonstrates the
required pattern:

- `OldBasketV1` — a shadow struct mirroring pre-#682 `Basket` (identical
  fields, minus `created_at`). Its fields are a strict subset of the current
  `Basket`'s, so it decodes safely against *either* an old-shape or an
  already-migrated entry (extra map keys are ignored on decode) — but decode
  success alone can't distinguish "genuinely pre-#682" from "just happens to
  have `created_at` already", so completeness is tracked explicitly instead
  of inferred from decode behavior (see below).
- `migrate` reads each basket via `OldBasketV1`, writes it back as the
  current `Basket` with `created_at` backfilled (documented default: `0`,
  the conservative/depositor-favorable choice since it makes
  `withdraw_basket`'s deadline check pass immediately rather than
  relock funds behind an invented wait).
- `DataKey::MigrationCursor` tracks the highest `basket_id` translated so
  far, so a basket population too large for one call can be migrated over
  several `migrate(caller, batch_size)` calls. `SchemaVersion` only flips to
  `CURRENT_SCHEMA_VERSION` once the cursor reaches `BasketCount` — a
  half-finished batched migration can't be mistaken for a complete one, and
  calling `migrate` again post-flip is a no-op error (`AlreadyMigrated`)
  rather than silently re-running (and potentially clobbering real data with
  the backfill default) against already-current entries.

The other 4 contracts' `migrate` is currently a no-op stub (their schema
hasn't changed since `CURRENT_SCHEMA_VERSION` was introduced) that exists
so the hook is uniformly available before it's ever needed. A future
layout-changing upgrade on any of them follows the same shape: a shadow
`OldXxxVN` type, an explicit read-old/write-new loop, and a cursor (or
equivalent completeness marker) gating the version flip.

## 5. What's intentionally out of scope here

- **Constructor/init changes on upgrade** — Soroban's `update_current_
  contract_wasm` swaps code, not storage; it never re-runs `initialize`.
  Any new required config must be set via a normal governed setter (or a
  `migrate` step) after the upgrade, not assumed to exist.
- **Real end-to-end WASM-swap testing** — this repo's test environment
  registers contracts natively (`env.register(Contract, ())`) rather than
  from a compiled `.wasm` artifact, and the local toolchain can't currently
  produce one (`wasm32v1-none` target unavailable — tracked separately).
  Tests here verify the security-critical properties that are actually this
  issue's code — governance gating (a direct `upgrade` call bypassing
  governance is rejected), the longer upgrade timelock actually applying,
  self-governance for governance's own upgrade, and the full storage
  migration logic — rather than the single-line, SDK-native `env.deployer().
  update_current_contract_wasm` call itself, which is Soroban's own
  documented primitive. Exercising a genuine WASM swap belongs in a
  testnet/integration deployment step.
