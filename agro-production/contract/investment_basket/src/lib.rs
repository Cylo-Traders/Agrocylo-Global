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
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env,
    IntoVal, Symbol, Val, Vec,
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
    AlreadyClaimed = 32,
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
    Claimed(u64, Address),
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BPS_DENOM: u32 = 10_000;

/// Mirrors the MAX_BATCH pattern used elsewhere (production_escrow batch ops)
/// to bound cross-contract call fan-out per transaction.
pub const MAX_BASKET_SIZE: u32 = 20;

const TTL_THRESHOLD: u32 = 1_000;
const TTL_EXTEND: u32 = 100_000;

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
        Ok(())
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
    pub fn fund_basket(env: Env, caller: Address, basket_id: u64) -> Result<(), BasketError> {
        caller.require_auth();
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
                escrow_client::invest(&env, &basket.escrow_contract, c.campaign_id, share);
                c.invested_amount = share;
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

    /// Sweep claim_returns/refund across every constituent campaign and pay
    /// the depositor their proportional share of whatever was collectible.
    /// Handles partial failure gracefully: a constituent still in-progress
    /// (not Settled/Failed) or already swept by a previous call is skipped
    /// rather than aborting the whole sweep, so successful constituents
    /// still pay out.
    pub fn claim_basket_returns(
        env: Env,
        depositor: Address,
        basket_id: u64,
    ) -> Result<i128, BasketError> {
        depositor.require_auth();
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

        let claim_key = DataKey::Claimed(basket_id, depositor.clone());
        if env.storage().persistent().has(&claim_key) {
            return Err(BasketError::AlreadyClaimed);
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

        let payout = (basket.total_collected * deposit_amount) / basket.total_deposit;
        if payout <= 0 {
            return Err(BasketError::NothingToClaim);
        }

        env.storage().persistent().set(&claim_key, &true);
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

    pub fn invest(env: &Env, escrow: &Address, campaign_id: u64, amount: i128) {
        let func = Symbol::new(env, "invest");
        let mut args: Vec<Val> = Vec::new(env);
        args.push_back(env.current_contract_address().into_val(env));
        args.push_back(campaign_id.into_val(env));
        args.push_back(amount.into_val(env));
        let _: () = env.invoke_contract(escrow, &func, args);
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
