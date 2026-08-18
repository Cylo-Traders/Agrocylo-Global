#![no_std]
//! Investment Basket contract (Issue #659).
//!
//! Lets an investor deposit once and have the deposit split across a curated
//! set of active `production_escrow` campaigns via cross-contract `invest`
//! calls, instead of manually calling `invest` on each campaign individually.
//!
//! A basket is created by the admin from a list of (campaign_id, weight_bps)
//! constituents that must sum to 10_000 bps. Depositors buy in proportionally
//! to the basket's weights; the basket contract itself becomes the investor
//! of record on each underlying campaign, and tracks each depositor's
//! proportional claim on the basket as a whole.
//!
//! `claim_basket_returns` sweeps `claim_returns` (settled campaigns) or
//! `refund` (failed campaigns) across every constituent campaign and pays the
//! depositor their proportional share of whatever was collected. A failure
//! on one constituent (e.g. campaign still active, or already claimed) does
//! not block collection from the others — see `sweep_constituent`.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, BytesN,
    Env, Error as HostError, IntoVal, Symbol, Val, Vec,
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum BasketError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotAdmin = 3,

    InvalidAmount = 10,
    InvalidWeights = 11,
    TooManyConstituents = 12,
    EmptyConstituents = 13,

    BasketNotFound = 20,
    BasketNotOpen = 21,
    BasketAlreadyFunded = 22,
    BasketNotFunded = 23,

    NotDepositor = 30,
    NothingToClaim = 31,

    WithdrawTooEarly = 40,
    NothingToWithdraw = 41,

    InvalidGovernanceContract = 50,
    ContractPaused = 51,
    NotPaused = 52,
    AlreadyPaused = 53,
    AlreadyMigrated = 54,
}

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BasketStatus {
    /// Accepting the single deposit that funds the basket.
    Open,
    /// Deposit has been split across constituent campaigns; awaiting outcomes.
    Funded,
}

/// A single campaign in the basket, weighted in basis points of the total
/// deposit (all constituent weights must sum to exactly 10_000).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BasketConstituent {
    pub campaign_id: u64,
    pub weight_bps: u32,
    /// Amount actually routed to this campaign's `invest` call once funded.
    pub invested_amount: i128,
    /// Amount collected from this campaign via claim_returns/refund so far.
    pub collected_amount: i128,
    /// True once a successful sweep (claim or refund) has been recorded.
    pub swept: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Basket {
    pub id: u64,
    pub escrow_contract: Address,
    pub token: Address,
    pub total_deposit: i128,
    pub total_collected: i128,
    pub status: BasketStatus,
    pub constituents: Vec<BasketConstituent>,
    /// Ledger timestamp the basket was created (Issue #682). Used to gate
    /// `withdraw_basket`, the escape hatch for a basket stuck `Open` because
    /// no one has (or can) call `fund_basket` successfully.
    pub created_at: u64,
}

/// Shadow of `Basket` as it was stored *before* Issue #682 added `created_at`
/// (schema version 1). Kept solely so `migrate` can decode legacy entries —
/// Soroban's struct decoding requires every field the target type declares to
/// be present in the stored map, so reading a pre-#682 `Basket(id)` entry
/// directly as the current `Basket` type would trap, not return `None`. This
/// is the worked example `docs/CONTRACT_UPGRADES.md` references for every
/// other contract's `migrate`. Its fields are a strict subset of `Basket`'s,
/// so it *also* decodes fine against an already-migrated entry (extra map
/// keys are ignored) — `migrate` still gates on `SchemaVersion`/the
/// migration cursor rather than relying on that, since decode success alone
/// can't tell "pre-#682" apart from "just happens to have `created_at`".
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
struct OldBasketV1 {
    pub id: u64,
    pub escrow_contract: Address,
    pub token: Address,
    pub total_deposit: i128,
    pub total_collected: i128,
    pub status: BasketStatus,
    pub constituents: Vec<BasketConstituent>,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    EscrowContractRef,
    BasketCount,
    Basket(u64),
    /// Per-depositor contribution to a given basket (baskets currently support
    /// a single depositor stream per basket_id; multiple depositors are
    /// tracked individually so partial claims remain correct).
    Deposit(u64, Address),
    /// Cumulative amount already paid out to this depositor for this basket
    /// (Issue #681). Since constituent campaigns settle at different times,
    /// `claim_basket_returns` is repeatable: each call pays the depositor's
    /// fair share of the *current* `total_collected` minus whatever they've
    /// already been paid, rather than a one-shot all-or-nothing flag.
    Claimed(u64, Address),
    /// Governance contract authorized to change governed parameters and gate
    /// `upgrade`/`set_guardian`/`unpause`/`migrate` (Issue #757). Falls back
    /// to admin-only while unset, same pattern as the escrow contracts.
    GovernanceContract,
    /// Address allowed to instantly `pause` without going through
    /// governance's full proposal flow. Settable only via
    /// `require_governed_caller`.
    Guardian,
    Paused,
    SchemaVersion,
    /// Highest basket_id `migrate` has translated so far (Issue #757).
    /// `SchemaVersion` only flips to `CURRENT_SCHEMA_VERSION` once this
    /// reaches `BasketCount`, so a batched migration can't be declared
    /// "done" while baskets remain un-translated.
    MigrationCursor,
}

/// Current on-chain storage layout version. Version 1 predates Issue #682
/// (`Basket` had no `created_at`); version 2 is current. Bump again and
/// extend `migrate` the same way for any future layout change — see
/// `docs/CONTRACT_UPGRADES.md`.
const CURRENT_SCHEMA_VERSION: u32 = 2;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BPS_DENOM: u32 = 10_000;

/// Mirrors the MAX_BATCH pattern used elsewhere (production_escrow batch ops)
/// to bound cross-contract call fan-out per transaction.
pub const MAX_BASKET_SIZE: u32 = 20;

const TTL_THRESHOLD: u32 = 1_000;
const TTL_EXTEND: u32 = 100_000;

/// A basket stuck `Open` (nobody has successfully called `fund_basket`) for
/// this long becomes withdrawable by its depositors (Issue #682).
const OPEN_BASKET_WITHDRAW_DELAY_SECONDS: u64 = 7 * 24 * 60 * 60;

fn t_basket() -> Symbol {
    symbol_short!("basket")
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct InvestmentBasketContract;

#[contractimpl]
impl InvestmentBasketContract {
    /// Initialize the basket contract. Can only be called once.
    pub fn initialize(
        env: Env,
        admin: Address,
        escrow_contract: Address,
    ) -> Result<(), BasketError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(BasketError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::EscrowContractRef, &escrow_contract);
        // A freshly-initialized contract's baskets always have the current
        // shape from the start, so there's nothing to migrate — the version
        // starts at CURRENT, not 0/1. See `migrate` for the pre-#682 case.
        env.storage()
            .instance()
            .set(&DataKey::SchemaVersion, &CURRENT_SCHEMA_VERSION);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Governance, upgrade, guardian, pause (Issue #757)
    // -----------------------------------------------------------------------

    /// Set (or update) the governance contract address. Admin-only for the
    /// initial bootstrap while no governance is configured; once set, only
    /// the governance contract itself can re-point this (same hardened
    /// pattern as `contracts/escrow`/`production_escrow` post-#680).
    /// `governance` must be a live contract implementing the expected
    /// interface, checked via a known view-function call before it's
    /// accepted.
    pub fn set_governance_contract(
        env: Env,
        caller: Address,
        governance: Address,
    ) -> Result<(), BasketError> {
        caller.require_auth();
        require_governed_caller(&env, &caller)?;
        governance_client::verify(&env, &governance)
            .map_err(|_| BasketError::InvalidGovernanceContract)?;
        env.storage()
            .instance()
            .set(&DataKey::GovernanceContract, &governance);
        Ok(())
    }

    pub fn get_governance_contract(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::GovernanceContract)
    }

    /// Upgrades this contract's WASM. Governance-gated: admin-only while no
    /// governance is configured, governance-only once it is. Callers should
    /// use governance's `propose_upgrade`, which applies the longer upgrade
    /// timelock. See `docs/CONTRACT_UPGRADES.md` for the required
    /// pause -> upgrade -> migrate -> unpause sequencing.
    pub fn upgrade(env: Env, caller: Address, new_wasm_hash: BytesN<32>) -> Result<(), BasketError> {
        caller.require_auth();
        require_governed_caller(&env, &caller)?;
        env.deployer().update_current_contract_wasm(new_wasm_hash.clone());
        env.events()
            .publish((t_basket(), symbol_short!("upgraded")), (new_wasm_hash,));
        Ok(())
    }

    /// Sets the guardian allowed to `pause` instantly. Governance-gated
    /// identically to `set_governance_contract`.
    pub fn set_guardian(env: Env, caller: Address, guardian: Address) -> Result<(), BasketError> {
        caller.require_auth();
        require_governed_caller(&env, &caller)?;
        env.storage().instance().set(&DataKey::Guardian, &guardian);
        Ok(())
    }

    /// Instant pause — no timelock — callable by the guardian or the
    /// configured governance contract.
    pub fn pause(env: Env, caller: Address) -> Result<(), BasketError> {
        caller.require_auth();
        let is_guardian = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::Guardian)
            .map(|g| g == caller)
            .unwrap_or(false);
        let is_governance = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::GovernanceContract)
            .map(|g| g == caller)
            .unwrap_or(false);
        if !is_guardian && !is_governance {
            return Err(BasketError::NotAdmin);
        }
        if env.storage().instance().get(&DataKey::Paused).unwrap_or(false) {
            return Err(BasketError::AlreadyPaused);
        }
        env.storage().instance().set(&DataKey::Paused, &true);
        env.events()
            .publish((t_basket(), symbol_short!("paused")), (caller,));
        Ok(())
    }

    /// Unpause. Deliberately governance-only (never the guardian) — a
    /// compromised guardian key can halt operations but never resume them
    /// unilaterally.
    pub fn unpause(env: Env, caller: Address) -> Result<(), BasketError> {
        caller.require_auth();
        require_governed_caller(&env, &caller)?;
        if !env.storage().instance().get(&DataKey::Paused).unwrap_or(false) {
            return Err(BasketError::NotPaused);
        }
        env.storage().instance().set(&DataKey::Paused, &false);
        env.events()
            .publish((t_basket(), symbol_short!("unpausd")), (caller,));
        Ok(())
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage().instance().get(&DataKey::Paused).unwrap_or(false)
    }

    /// Storage migration (Issue #757), worked example: translates baskets
    /// stored under the pre-#682 shape (`OldBasketV1`, no `created_at`) into
    /// the current `Basket` shape, backfilling `created_at` with 0 (unknown
    /// creation time for baskets that predate the field — callers that rely
    /// on `created_at` for `withdraw_basket`'s deadline should treat 0 as
    /// "eligible immediately", which is the conservative/depositor-favorable
    /// default). Processes up to `batch_size` basket_ids starting right
    /// after `MigrationCursor`, so a basket population too large for one
    /// call can be migrated over several; `SchemaVersion` only flips to
    /// `CURRENT_SCHEMA_VERSION` once the cursor reaches `BasketCount`, so
    /// normal operations can't observe a "migrated" contract with
    /// un-translated baskets still in it. Expected to run while
    /// `is_paused()` — see `docs/CONTRACT_UPGRADES.md`.
    pub fn migrate(env: Env, caller: Address, batch_size: u32) -> Result<u32, BasketError> {
        caller.require_auth();
        require_governed_caller(&env, &caller)?;

        let stored: u32 = env
            .storage()
            .instance()
            .get(&DataKey::SchemaVersion)
            .unwrap_or(0);
        if stored >= CURRENT_SCHEMA_VERSION {
            return Err(BasketError::AlreadyMigrated);
        }
        if batch_size == 0 || batch_size > MAX_BASKET_SIZE {
            return Err(BasketError::TooManyConstituents);
        }

        let basket_count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::BasketCount)
            .unwrap_or(0);
        let cursor: u64 = env
            .storage()
            .instance()
            .get(&DataKey::MigrationCursor)
            .unwrap_or(0);

        let mut migrated: u32 = 0;
        let mut id = cursor + 1;
        while id <= basket_count && migrated < batch_size {
            let key = DataKey::Basket(id);
            if let Some(old) = env.storage().persistent().get::<_, OldBasketV1>(&key) {
                let translated = Basket {
                    id: old.id,
                    escrow_contract: old.escrow_contract,
                    token: old.token,
                    total_deposit: old.total_deposit,
                    total_collected: old.total_collected,
                    status: old.status,
                    constituents: old.constituents,
                    created_at: 0,
                };
                env.storage().persistent().set(&key, &translated);
            }
            migrated += 1;
            id += 1;
        }

        let new_cursor = cursor + migrated as u64;
        env.storage()
            .instance()
            .set(&DataKey::MigrationCursor, &new_cursor);
        if new_cursor >= basket_count {
            env.storage()
                .instance()
                .set(&DataKey::SchemaVersion, &CURRENT_SCHEMA_VERSION);
        }
        Ok(migrated)
    }

    pub fn get_schema_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::SchemaVersion)
            .unwrap_or(0)
    }

    pub fn get_guardian(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Guardian)
    }

    /// Admin curates a new basket from a set of campaigns and their weights
    /// (basis points, must sum to 10_000). Caps at MAX_BASKET_SIZE
    /// constituents, mirroring the MAX_BATCH pattern in production_escrow.
    pub fn create_basket(
        env: Env,
        admin_caller: Address,
        token: Address,
        constituents: Vec<(u64, u32)>,
    ) -> Result<u64, BasketError> {
        admin_caller.require_auth();
        let admin = read_admin(&env)?;
        if admin_caller != admin {
            return Err(BasketError::NotAdmin);
        }

        if constituents.is_empty() {
            return Err(BasketError::EmptyConstituents);
        }
        if constituents.len() > MAX_BASKET_SIZE {
            return Err(BasketError::TooManyConstituents);
        }

        let mut weight_sum: u32 = 0;
        let mut entries: Vec<BasketConstituent> = Vec::new(&env);
        for i in 0..constituents.len() {
            let (campaign_id, weight_bps) = constituents.get(i).unwrap();
            if weight_bps == 0 {
                return Err(BasketError::InvalidWeights);
            }
            weight_sum = weight_sum
                .checked_add(weight_bps)
                .ok_or(BasketError::InvalidWeights)?;
            entries.push_back(BasketConstituent {
                campaign_id,
                weight_bps,
                invested_amount: 0,
                collected_amount: 0,
                swept: false,
            });
        }
        if weight_sum != BPS_DENOM {
            return Err(BasketError::InvalidWeights);
        }

        let mut id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::BasketCount)
            .unwrap_or(0);
        id += 1;
        env.storage().instance().set(&DataKey::BasketCount, &id);

        let escrow_contract: Address = env
            .storage()
            .instance()
            .get(&DataKey::EscrowContractRef)
            .ok_or(BasketError::NotInitialized)?;

        let basket = Basket {
            id,
            escrow_contract,
            token,
            total_deposit: 0,
            total_collected: 0,
            status: BasketStatus::Open,
            constituents: entries,
            created_at: env.ledger().timestamp(),
        };
        env.storage().persistent().set(&DataKey::Basket(id), &basket);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Basket(id), TTL_THRESHOLD, TTL_EXTEND);

        env.events()
            .publish((t_basket(), symbol_short!("created")), (id, constituents.len()));
        Ok(id)
    }

    /// Investor deposits into an Open basket. The deposit is immediately split
    /// across constituent campaigns proportional to their weight via
    /// cross-contract `invest` calls, and the basket transitions to Funded.
    ///
    /// Only a single deposit call is supported per basket (one deposit ->
    /// one funding event), consistent with "one deposit" in the acceptance
    /// criteria; multiple depositors can still each call `deposit` on
    /// distinct baskets, or repeat deposits accumulate before the basket is
    /// funded by the first depositor to trigger the split — depositors that
    /// deposited into the same still-Open basket are all tracked so the
    /// eventual payout stays proportional to individual contribution.
    pub fn deposit(
        env: Env,
        depositor: Address,
        basket_id: u64,
        amount: i128,
    ) -> Result<(), BasketError> {
        depositor.require_auth();
        require_not_paused(&env)?;
        if amount <= 0 {
            return Err(BasketError::InvalidAmount);
        }

        let mut basket = load_basket(&env, basket_id)?;
        if basket.status != BasketStatus::Open {
            return Err(BasketError::BasketNotOpen);
        }

        let token_client = token::Client::new(&env, &basket.token);
        token_client.transfer(&depositor, &env.current_contract_address(), &amount);

        let deposit_key = DataKey::Deposit(basket_id, depositor.clone());
        let prev: i128 = env.storage().persistent().get(&deposit_key).unwrap_or(0);
        let new_deposit = prev
            .checked_add(amount)
            .ok_or(BasketError::InvalidAmount)?;
        env.storage().persistent().set(&deposit_key, &new_deposit);
        env.storage()
            .persistent()
            .extend_ttl(&deposit_key, TTL_THRESHOLD, TTL_EXTEND);

        basket.total_deposit = basket
            .total_deposit
            .checked_add(amount)
            .ok_or(BasketError::InvalidAmount)?;
        save_basket(&env, &basket);

        env.events().publish(
            (t_basket(), symbol_short!("deposit")),
            (basket_id, depositor, amount),
        );
        Ok(())
    }

    /// Admin (or anyone, once the basket has a deposit) triggers the actual
    /// split of the pooled deposit across constituent campaigns. Separated
    /// from `deposit` so multiple depositors can contribute before the
    /// basket is funded in a single batch of cross-contract `invest` calls.
    ///
    /// Uses `try_invoke_contract` per constituent (Issue #682): a constituent
    /// that's no longer investable (deadline passed, overfunded, wrong
    /// status, ...) is skipped rather than aborting the whole call. Its share
    /// never leaves the basket's own balance, so it's recorded as already
    /// "collected" and immediately claimable via `claim_basket_returns` —
    /// depositors get that portion of their principal back dollar-for-dollar
    /// instead of it being stuck behind a permanently-Open basket.
    pub fn fund_basket(env: Env, caller: Address, basket_id: u64) -> Result<(), BasketError> {
        caller.require_auth();
        require_not_paused(&env)?;
        let mut basket = load_basket(&env, basket_id)?;
        if basket.status != BasketStatus::Open {
            return Err(BasketError::BasketNotOpen);
        }
        if basket.total_deposit <= 0 {
            return Err(BasketError::InvalidAmount);
        }

        let mut allocated: i128 = 0;
        let count = basket.constituents.len();
        for i in 0..count {
            let mut c = basket.constituents.get(i).unwrap();
            let share = if i == count - 1 {
                // Last constituent absorbs rounding dust so the full deposit is invested.
                basket
                    .total_deposit
                    .checked_sub(allocated)
                    .ok_or(BasketError::InvalidAmount)?
            } else {
                (basket.total_deposit * c.weight_bps as i128) / BPS_DENOM as i128
            };
            if share > 0 {
                if escrow_client::try_invest(&env, &basket.escrow_contract, c.campaign_id, share) {
                    c.invested_amount = share;
                } else {
                    c.collected_amount = share;
                    c.swept = true;
                    basket.total_collected = basket
                        .total_collected
                        .checked_add(share)
                        .unwrap_or(basket.total_collected);
                }
                allocated = allocated
                    .checked_add(share)
                    .ok_or(BasketError::InvalidAmount)?;
            }
            basket.constituents.set(i, c);
        }

        basket.status = BasketStatus::Funded;
        save_basket(&env, &basket);

        env.events().publish(
            (t_basket(), symbol_short!("funded")),
            (basket_id, basket.total_deposit),
        );
        Ok(())
    }

    /// Escape hatch for a basket stuck `Open` because `fund_basket` was never
    /// (successfully) called — e.g. every constituent became uninvestable
    /// before anyone triggered funding (Issue #682). Once
    /// `OPEN_BASKET_WITHDRAW_DELAY_SECONDS` has elapsed since creation, any
    /// depositor can withdraw their own principal directly; no admin action
    /// required. Not available once the basket has transitioned to `Funded`
    /// — `claim_basket_returns` covers recovery from that point on,
    /// including the never-invested share of any constituent skipped above.
    pub fn withdraw_basket(
        env: Env,
        depositor: Address,
        basket_id: u64,
    ) -> Result<i128, BasketError> {
        depositor.require_auth();
        require_not_paused(&env)?;
        let mut basket = load_basket(&env, basket_id)?;
        if basket.status != BasketStatus::Open {
            return Err(BasketError::BasketNotOpen);
        }
        if env.ledger().timestamp() < basket.created_at + OPEN_BASKET_WITHDRAW_DELAY_SECONDS {
            return Err(BasketError::WithdrawTooEarly);
        }

        let deposit_key = DataKey::Deposit(basket_id, depositor.clone());
        let deposit_amount: i128 = env.storage().persistent().get(&deposit_key).unwrap_or(0);
        if deposit_amount <= 0 {
            return Err(BasketError::NothingToWithdraw);
        }

        env.storage().persistent().set(&deposit_key, &0i128);
        env.storage()
            .persistent()
            .extend_ttl(&deposit_key, TTL_THRESHOLD, TTL_EXTEND);

        basket.total_deposit = basket
            .total_deposit
            .checked_sub(deposit_amount)
            .ok_or(BasketError::NothingToWithdraw)?;
        save_basket(&env, &basket);

        let token_client = token::Client::new(&env, &basket.token);
        token_client.transfer(&env.current_contract_address(), &depositor, &deposit_amount);

        env.events().publish(
            (t_basket(), symbol_short!("withdrawn")),
            (basket_id, depositor, deposit_amount),
        );
        Ok(deposit_amount)
    }

    /// Sweep claim_returns/refund across every constituent campaign and pay
    /// the depositor their proportional share of whatever was collectible.
    /// Handles partial failure gracefully: a constituent still in-progress
    /// (not Settled/Failed) or already swept by a previous call is skipped
    /// rather than aborting the whole sweep, so successful constituents
    /// still pay out.
    ///
    /// Repeatable by design (Issue #681): constituent campaigns settle at
    /// different times, so a depositor's fair share of `total_collected`
    /// grows across multiple calls. Each call pays out
    /// `fair_share(total_collected) - already_paid`, so claiming early never
    /// forfeits a later constituent's payout — the depositor (or anyone
    /// prompting the sweep) can just call this again once more constituents
    /// settle.
    pub fn claim_basket_returns(
        env: Env,
        depositor: Address,
        basket_id: u64,
    ) -> Result<i128, BasketError> {
        depositor.require_auth();
        require_not_paused(&env)?;
        let mut basket = load_basket(&env, basket_id)?;
        if basket.status != BasketStatus::Funded {
            return Err(BasketError::BasketNotFunded);
        }

        let deposit_key = DataKey::Deposit(basket_id, depositor.clone());
        let deposit_amount: i128 = env
            .storage()
            .persistent()
            .get(&deposit_key)
            .ok_or(BasketError::NotDepositor)?;
        if deposit_amount <= 0 {
            return Err(BasketError::NotDepositor);
        }

        // Sweep every unswept constituent; failures on individual campaigns
        // (still active, or nothing to collect) are swallowed so the loop
        // continues and successful constituents still get collected.
        let count = basket.constituents.len();
        for i in 0..count {
            let mut c = basket.constituents.get(i).unwrap();
            if c.swept {
                continue;
            }
            if let Some(collected) = sweep_constituent(&env, &basket.escrow_contract, &c) {
                c.collected_amount = collected;
                c.swept = true;
                basket.total_collected = basket
                    .total_collected
                    .checked_add(collected)
                    .unwrap_or(basket.total_collected);
                basket.constituents.set(i, c);
            }
            // else: constituent not yet resolved (still Funding/InProduction/etc.)
            // or this basket already claimed/refunded from it in a prior call —
            // leave `swept` false so a future call can retry.
        }
        save_basket(&env, &basket);

        if basket.total_deposit <= 0 || basket.total_collected <= 0 {
            return Err(BasketError::NothingToClaim);
        }

        let claim_key = DataKey::Claimed(basket_id, depositor.clone());
        let already_paid: i128 = env.storage().persistent().get(&claim_key).unwrap_or(0);

        let fair_share = (basket.total_collected * deposit_amount) / basket.total_deposit;
        let payout = fair_share
            .checked_sub(already_paid)
            .ok_or(BasketError::NothingToClaim)?;
        if payout <= 0 {
            return Err(BasketError::NothingToClaim);
        }
        let new_paid = already_paid
            .checked_add(payout)
            .ok_or(BasketError::NothingToClaim)?;

        env.storage().persistent().set(&claim_key, &new_paid);
        env.storage()
            .persistent()
            .extend_ttl(&claim_key, TTL_THRESHOLD, TTL_EXTEND);

        let token_client = token::Client::new(&env, &basket.token);
        token_client.transfer(&env.current_contract_address(), &depositor, &payout);

        env.events().publish(
            (t_basket(), symbol_short!("claimed")),
            (basket_id, depositor, payout),
        );
        Ok(payout)
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    pub fn get_basket(env: Env, basket_id: u64) -> Result<Basket, BasketError> {
        load_basket(&env, basket_id)
    }

    pub fn get_deposit(env: Env, basket_id: u64, depositor: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Deposit(basket_id, depositor))
            .unwrap_or(0)
    }

    pub fn get_admin(env: Env) -> Result<Address, BasketError> {
        read_admin(&env)
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn read_admin(env: &Env) -> Result<Address, BasketError> {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(BasketError::NotInitialized)
}

/// Enforces that `caller` is the authorized party for governance-gated
/// actions: the governance contract if one has been set via
/// `set_governance_contract`, otherwise the raw admin as a fallback so a
/// deployment that never configures governance keeps working as before.
fn require_governed_caller(env: &Env, caller: &Address) -> Result<(), BasketError> {
    if let Some(governance) = env
        .storage()
        .instance()
        .get::<_, Address>(&DataKey::GovernanceContract)
    {
        if *caller != governance {
            return Err(BasketError::NotAdmin);
        }
        return Ok(());
    }
    let admin_addr = read_admin(env)?;
    if *caller != admin_addr {
        return Err(BasketError::NotAdmin);
    }
    Ok(())
}

fn require_not_paused(env: &Env) -> Result<(), BasketError> {
    if env.storage().instance().get(&DataKey::Paused).unwrap_or(false) {
        return Err(BasketError::ContractPaused);
    }
    Ok(())
}

/// Verifies a candidate governance address is a real deployed governance
/// contract (mirrors the check added to `contracts/escrow`/`production_escrow`
/// in #680), so `set_governance_contract` can't be pointed at an arbitrary
/// admin-controlled address.
mod governance_client {
    use super::{Env, HostError, Address, Symbol, Val, Vec};

    pub fn verify(env: &Env, governance: &Address) -> Result<(), ()> {
        let func = Symbol::new(env, "get_admin");
        let args: Vec<Val> = Vec::new(env);
        match env.try_invoke_contract::<Val, HostError>(governance, &func, args) {
            Ok(_) => Ok(()),
            Err(_) => Err(()),
        }
    }
}

fn load_basket(env: &Env, id: u64) -> Result<Basket, BasketError> {
    env.storage()
        .persistent()
        .get(&DataKey::Basket(id))
        .ok_or(BasketError::BasketNotFound)
}

fn save_basket(env: &Env, b: &Basket) {
    env.storage().persistent().set(&DataKey::Basket(b.id), b);
    env.storage()
        .persistent()
        .extend_ttl(&DataKey::Basket(b.id), TTL_THRESHOLD, TTL_EXTEND);
}

/// Attempt to collect from a single constituent campaign: try claim_returns
/// first (Settled campaigns), then refund (Failed campaigns). Returns None
/// if the campaign is still active or nothing was collectible, so the caller
/// can skip it without failing the whole batch.
fn sweep_constituent(
    env: &Env,
    escrow_contract: &Address,
    constituent: &BasketConstituent,
) -> Option<i128> {
    if let Some(amount) =
        escrow_client::try_claim_returns(env, escrow_contract, constituent.campaign_id)
    {
        if amount > 0 {
            return Some(amount);
        }
    }
    if let Some(amount) = escrow_client::try_refund(env, escrow_contract, constituent.campaign_id)
    {
        if amount > 0 {
            return Some(amount);
        }
    }
    None
}

/// Minimal production_escrow client for cross-contract calls. Uses
/// try_invoke_contract so a constituent that reverts (e.g. campaign not
/// Settled/Failed yet) does not abort the whole basket operation.
mod escrow_client {
    use super::*;

    /// Returns `true` if the constituent accepted the investment, `false` if
    /// the call failed for any reason (deadline passed, overfunded, wrong
    /// status, ...) — callers skip a `false` constituent rather than
    /// aborting the whole `fund_basket` call (Issue #682).
    pub fn try_invest(env: &Env, escrow: &Address, campaign_id: u64, amount: i128) -> bool {
        let func = Symbol::new(env, "invest");
        let mut args: Vec<Val> = Vec::new(env);
        args.push_back(env.current_contract_address().into_val(env));
        args.push_back(campaign_id.into_val(env));
        args.push_back(amount.into_val(env));
        env.try_invoke_contract::<(), soroban_sdk::Error>(escrow, &func, args)
            .ok()
            .and_then(|r| r.ok())
            .is_some()
    }

    pub fn try_claim_returns(env: &Env, escrow: &Address, campaign_id: u64) -> Option<i128> {
        let func = Symbol::new(env, "claim_returns");
        let mut args: Vec<Val> = Vec::new(env);
        args.push_back(env.current_contract_address().into_val(env));
        args.push_back(campaign_id.into_val(env));
        env.try_invoke_contract::<i128, soroban_sdk::Error>(escrow, &func, args)
            .ok()
            .and_then(|r| r.ok())
    }

    pub fn try_refund(env: &Env, escrow: &Address, campaign_id: u64) -> Option<i128> {
        let func = Symbol::new(env, "refund");
        let mut args: Vec<Val> = Vec::new(env);
        args.push_back(env.current_contract_address().into_val(env));
        args.push_back(campaign_id.into_val(env));
        env.try_invoke_contract::<i128, soroban_sdk::Error>(escrow, &func, args)
            .ok()
            .and_then(|r| r.ok())
    }
}

#[cfg(test)]
mod test;
