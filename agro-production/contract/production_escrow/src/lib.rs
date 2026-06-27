#![no_std]
//! Production Escrow contract.
//!
//! Investors crowdfund a farmer's production campaign. Funds are held in escrow,
//! released in tranches as production progresses, and distributed proportionally
//! to investors on settlement.
//!
//! Lifecycle:
//!   Funding -> Funded -> InProduction -> Harvested -> Settled
//!   Funding -> Failed (deadline passed without target)
//!   Funded | InProduction | Harvested -> Failed (mark_campaign_failed)
//!   any -> Disputed -> resolved (Settled / Failed)
//!
//! Failure recovery:
//!   - Failure before funding target (Funding): full refund of contributions.
//!   - Failure after funding but before production start (Funded): full refund.
//!   - Failure during production (InProduction): proportional refund from remaining
//!     escrow after tranche(s) released.
//!   - Failure after harvest (Harvested): proportional refund from remaining escrow
//!     plus any accrued revenue.
//!   - Shortfall: when tranche releases exceed available escrow for refunds,
//!     investors receive their proportional share of what remains. The farmer is
//!     not obligated to return released tranches — the loss is proportional.

// COST NOTE:
// Contribution tracking now uses indexed keys Contribution(campaign_id, investor_addr) instead
// of unbounded per-campaign Maps (Contributions(campaign_id) -> Map<Address, i128>). This reduces
// worst-case ledger entry size from O(n_investors) to O(1) per operation. A campaign with 1k
// investors no longer stores all contributions in a single ledger entry; instead, each
// invest/refund/claim is a separate O(1) operation. Batch refunds are capped at 50 investors
// per call to prevent ledger thrashing.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env,
    Symbol, Vec,
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum EscrowError {
    AlreadyInitialized = 1,
    ContractNotInitialized = 2,
    MustSupportOneToken = 3,
    UnsupportedToken = 4,

    InvalidAmount = 10,
    InvalidDeadline = 11,

    CampaignNotFound = 20,
    CampaignNotFunding = 21,
    CampaignNotFunded = 22,
    CampaignNotInProduction = 23,
    CampaignNotHarvested = 24,
    CampaignNotFailed = 25,
    CampaignNotSettled = 26,
    CampaignAlreadyDisputed = 27,
    CampaignNotDisputed = 28,
    CampaignOverfunded = 29,
    CampaignDeadlinePassed = 30,
    CampaignDeadlineNotPassed = 31,
    CampaignAlreadyTerminal = 32,
    CampaignNotFailedOrSettled = 33,
    CampaignNotFundedOrBeyond = 34,

    OrderNotFound = 40,
    OrderNotPending = 41,

    NotAdmin = 50,
    NotFarmer = 51,
    NotBuyer = 52,
    NotInvestor = 53,

    NothingToClaim = 60,
    AlreadyClaimed = 61,

    TrancheAlreadyReleased = 70,
    InvalidTranche = 71,
    InvalidResolution = 72,

    NoShortfall = 80,
}

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CampaignStatus {
    Funding,
    Funded,
    InProduction,
    Harvested,
    Settled,
    Failed,
    Disputed,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OrderStatus {
    Pending,
    Confirmed,
    Refunded,
}

/// Resolution applied to a disputed campaign.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DisputeResolution {
    /// Release all escrowed funds + revenue to investors proportionally.
    FullPayoutToInvestors,
    /// Refund investors their original contributions.
    RefundInvestors,
    /// Split: farmer gets `farmer_bps` basis points of the pool, rest to investors.
    Partial(u32),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Campaign {
    pub id: u64,
    pub farmer: Address,
    pub token: Address,
    pub target_amount: i128,
    pub total_raised: i128,
    pub total_revenue: i128,
    pub tranche_released: i128,
    pub deadline: u64,
    pub created_at: u64,
    pub status: CampaignStatus,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Order {
    pub id: u64,
    pub campaign_id: u64,
    pub buyer: Address,
    pub amount: i128,
    pub fee: i128,
    pub created_at: u64,
    pub status: OrderStatus,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    SupportedTokens,
    RegistryContract,
    FeeCollector,
    FeeRateBps,
    CampaignCount,
    OrderCount,
    Campaign(u64),
    /// Per-investor contribution amount (replaces Contributions map).
    /// Old shape: Contributions(u64) stored all contributions per-campaign in a single Map<Address, i128>.
    /// New shape: Contribution(u64, Address) stores individual contribution amounts.
    /// Benefit: O(1) per-operation cost; no per-campaign ledger entry grows unbounded.
    Contribution(u64, Address),
    /// Per-campaign per-investor claim flag (true if already claimed/refunded).
    Claimed(u64, Address),
    Order(u64),
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRANCHE_START_BPS: i128 = 3_000; // 30% on production start
const TRANCHE_HARVEST_BPS: i128 = 4_000; // +40% on harvest marked (70% total)
const BPS_DENOM: i128 = 10_000;

/// Maximum cumulative tranche cap (proportion of total_raised).
/// No more than 70% of raised funds may be released as tranches,
/// guaranteeing at least 30% remains for investor refunds.
const MAX_TRANCHE_BPS: i128 = 7_000;

const TTL_THRESHOLD: u32 = 1_000;
const TTL_EXTEND: u32 = 100_000;

/// Orders expire and become refundable after 96 hours of inactivity.
pub const ORDER_EXPIRY_SECS: u64 = 96 * 3600;

// Event topic helpers.
fn t_campaign() -> Symbol {
    symbol_short!("campaign")
}
fn t_order() -> Symbol {
    symbol_short!("order")
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct ProductionEscrowContract;

#[contractimpl]
impl ProductionEscrowContract {
    /// Initialize the contract. Can only be called once.
    pub fn initialize(
        env: Env,
        admin: Address,
        supported_tokens: Vec<Address>,
        fee_collector: Address,
        fee_rate_bps: u32,
    ) -> Result<(), EscrowError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(EscrowError::AlreadyInitialized);
        }
        if supported_tokens.len() < 1 {
            return Err(EscrowError::MustSupportOneToken);
        }
        if fee_rate_bps > 10000 {
            return Err(EscrowError::InvalidAmount);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::SupportedTokens, &supported_tokens);
        env.storage()
            .instance()
            .set(&DataKey::FeeCollector, &fee_collector);
        env.storage()
            .instance()
            .set(&DataKey::FeeRateBps, &fee_rate_bps);
        Ok(())
    }

    /// Set the registry contract address. Can be called by admin to update registry configuration.
    pub fn set_registry_contract(env: Env, admin_caller: Address, registry: Address) -> Result<(), EscrowError> {
        admin_caller.require_auth();
        let admin = admin(&env)?;
        if admin_caller != admin {
            return Err(EscrowError::NotAdmin);
        }
        env.storage()
            .instance()
            .set(&DataKey::RegistryContract, &registry);
        Ok(())
    }

    /// Update fee configuration. Can be called by admin.
    /// Does not affect orders already created (fees are immutable per-order).
    pub fn set_fee_config(
        env: Env,
        admin_caller: Address,
        fee_collector: Address,
        fee_rate_bps: u32,
    ) -> Result<(), EscrowError> {
        admin_caller.require_auth();
        let admin = admin(&env)?;
        if admin_caller != admin {
            return Err(EscrowError::NotAdmin);
        }
        if fee_rate_bps > 10000 {
            return Err(EscrowError::InvalidAmount);
        }
        env.storage()
            .instance()
            .set(&DataKey::FeeCollector, &fee_collector);
        env.storage()
            .instance()
            .set(&DataKey::FeeRateBps, &fee_rate_bps);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Campaign creation
    // -----------------------------------------------------------------------

    pub fn create_campaign(
        env: Env,
        farmer: Address,
        token: Address,
        target_amount: i128,
        deadline: u64,
    ) -> Result<u64, EscrowError> {
        farmer.require_auth();

        if target_amount <= 0 {
            return Err(EscrowError::InvalidAmount);
        }
        let now = env.ledger().timestamp();
        if deadline <= now {
            return Err(EscrowError::InvalidDeadline);
        }

        let supported: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::SupportedTokens)
            .ok_or(EscrowError::ContractNotInitialized)?;
        if !supported.contains(&token) {
            return Err(EscrowError::UnsupportedToken);
        }

        let mut id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::CampaignCount)
            .unwrap_or(0);
        id += 1;
        env.storage().instance().set(&DataKey::CampaignCount, &id);

        let campaign = Campaign {
            id,
            farmer: farmer.clone(),
            token: token.clone(),
            target_amount,
            total_raised: 0,
            total_revenue: 0,
            tranche_released: 0,
            deadline,
            created_at: now,
            status: CampaignStatus::Funding,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Campaign(id), &campaign);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Campaign(id), TTL_THRESHOLD, TTL_EXTEND);

        // Register campaign with the registry if configured.
        // If registry call fails, return error and do not persist campaign (atomic semantics).
        if let Some(registry) = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::RegistryContract)
        {
            if registry_client::register_campaign(&env, &registry, id, &farmer, None).is_err() {
                return Err(EscrowError::CampaignNotFound); // Registry call failed
            }
        }

        env.events().publish(
            (t_campaign(), symbol_short!("created")),
            (id, farmer, token, target_amount, deadline),
        );
        Ok(id)
    }

    // -----------------------------------------------------------------------
    // Investment
    // -----------------------------------------------------------------------

    pub fn invest(
        env: Env,
        investor: Address,
        campaign_id: u64,
        amount: i128,
    ) -> Result<(), EscrowError> {
        investor.require_auth();

        if amount <= 0 {
            return Err(EscrowError::InvalidAmount);
        }

        let mut campaign = load_campaign(&env, campaign_id)?;
        if campaign.status != CampaignStatus::Funding {
            return Err(EscrowError::CampaignNotFunding);
        }
        if env.ledger().timestamp() > campaign.deadline {
            return Err(EscrowError::CampaignDeadlinePassed);
        }
        if campaign.total_raised + amount > campaign.target_amount {
            return Err(EscrowError::CampaignOverfunded);
        }

        // Pull funds into the contract.
        let token_client = token::Client::new(&env, &campaign.token);
        token_client.transfer(&investor, &env.current_contract_address(), &amount);

        campaign.total_raised = checked_add(campaign.total_raised, amount)?;

        // Record contribution (additive) using indexed keys instead of per-campaign Map.
        let contribution_key = DataKey::Contribution(campaign_id, investor.clone());
        let prev = env
            .storage()
            .persistent()
            .get::<_, i128>(&contribution_key)
            .unwrap_or(0);
            .get(&DataKey::Contributions(campaign_id))
            .unwrap_or(Map::new(&env));
        let prev = contribs.get(investor.clone()).unwrap_or(0);
        contribs.set(investor.clone(), checked_add(prev, amount)?);
        env.storage()
            .persistent()
            .set(&contribution_key, &(prev + amount));

        // Auto-transition to Funded when target reached.
        if campaign.total_raised == campaign.target_amount {
            campaign.status = CampaignStatus::Funded;
        }

        env.storage()
            .persistent()
            .set(&DataKey::Campaign(campaign_id), &campaign);
        env.storage().persistent().extend_ttl(
            &DataKey::Campaign(campaign_id),
            TTL_THRESHOLD,
            TTL_EXTEND,
        );

        env.events().publish(
            (t_campaign(), symbol_short!("invested")),
            (campaign_id, investor, amount, campaign.total_raised),
        );
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Production lifecycle
    // -----------------------------------------------------------------------

    /// Farmer signals production has begun. Releases the start tranche.
    pub fn start_production(
        env: Env,
        farmer: Address,
        campaign_id: u64,
    ) -> Result<(), EscrowError> {
        farmer.require_auth();
        let mut campaign = load_campaign(&env, campaign_id)?;
        if campaign.farmer != farmer {
            return Err(EscrowError::NotFarmer);
        }
        if campaign.status != CampaignStatus::Funded {
            return Err(EscrowError::CampaignNotFunded);
        }
        campaign.status = CampaignStatus::InProduction;

        let tranche = checked_mul(campaign.total_raised, TRANCHE_START_BPS)? / BPS_DENOM;
        release_tranche_internal(&env, &mut campaign, tranche)?;

        save_campaign(&env, &campaign);
        env.events().publish(
            (t_campaign(), symbol_short!("produce")),
            (campaign_id, farmer),
        );
        Ok(())
    }

    /// Farmer signals harvest done. Releases the harvest tranche.
    pub fn mark_harvest(env: Env, farmer: Address, campaign_id: u64) -> Result<(), EscrowError> {
        farmer.require_auth();
        let mut campaign = load_campaign(&env, campaign_id)?;
        if campaign.farmer != farmer {
            return Err(EscrowError::NotFarmer);
        }
        if campaign.status != CampaignStatus::InProduction {
            return Err(EscrowError::CampaignNotInProduction);
        }
        campaign.status = CampaignStatus::Harvested;

        let cumulative_target =
            checked_mul(campaign.total_raised, TRANCHE_START_BPS + TRANCHE_HARVEST_BPS)? / BPS_DENOM;
        let delta = checked_sub(cumulative_target, campaign.tranche_released)?;
        if delta > 0 {
            release_tranche_internal(&env, &mut campaign, delta)?;
        }

        save_campaign(&env, &campaign);
        env.events().publish(
            (t_campaign(), symbol_short!("harvest")),
            (campaign_id, farmer),
        );
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Orders (buyers purchase produce from campaign)
    // -----------------------------------------------------------------------

    pub fn create_order(
        env: Env,
        buyer: Address,
        campaign_id: u64,
        amount: i128,
    ) -> Result<u64, EscrowError> {
        buyer.require_auth();
        if amount <= 0 {
            return Err(EscrowError::InvalidAmount);
        }
        let campaign = load_campaign(&env, campaign_id)?;
        // Buyers can order from Harvested campaigns; permissive InProduction for pre-orders.
        if campaign.status != CampaignStatus::Harvested
            && campaign.status != CampaignStatus::InProduction
        {
            return Err(EscrowError::CampaignNotHarvested);
        }

        let token_client = token::Client::new(&env, &campaign.token);
        token_client.transfer(&buyer, &env.current_contract_address(), &amount);

        let mut id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::OrderCount)
            .unwrap_or(0);
        id += 1;
        env.storage().instance().set(&DataKey::OrderCount, &id);

        // Calculate fee based on current fee rate. Fee is escrowed with the order.
        let fee_rate_bps: u32 = env
            .storage()
            .instance()
            .get(&DataKey::FeeRateBps)
            .unwrap_or(0);
        let fee = (amount * fee_rate_bps as i128) / 10_000;

        let order = Order {
            id,
            campaign_id,
            buyer: buyer.clone(),
            amount,
            fee,
            created_at: env.ledger().timestamp(),
            status: OrderStatus::Pending,
        };
        // Create order and extend TTL immediately (Issue #456).
        env.storage().persistent().set(&DataKey::Order(id), &order);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Order(id), TTL_THRESHOLD, TTL_EXTEND);

        env.events().publish(
            (t_order(), symbol_short!("created")),
            (id, buyer, campaign_id, amount),
        );
        Ok(id)
    }

    /// Buyer confirms receipt. Payment counts toward campaign revenue and fee is collected.
    /// Buyer confirms receipt. Payment counts toward campaign revenue.
    /// Cannot confirm orders after campaign is settled (Issue #455).
    pub fn confirm_order(env: Env, buyer: Address, order_id: u64) -> Result<(), EscrowError> {
        buyer.require_auth();
        let mut order: Order = env
            .storage()
            .persistent()
            .get(&DataKey::Order(order_id))
            .ok_or(EscrowError::OrderNotFound)?;
        if order.buyer != buyer {
            return Err(EscrowError::NotBuyer);
        }
        if order.status != OrderStatus::Pending {
            return Err(EscrowError::OrderNotPending);
        }

        let mut campaign = load_campaign(&env, order.campaign_id)?;
        // Reject late confirmations after settlement (Issue #455).
        if campaign.status == CampaignStatus::Settled {
            return Err(EscrowError::CampaignNotHarvested);
        }

        campaign.total_revenue = checked_add(campaign.total_revenue, order.amount)?;
        order.status = OrderStatus::Confirmed;

        // Transfer fee to collector if fee > 0.
        if order.fee > 0 {
            if let Some(fee_collector) = env
                .storage()
                .instance()
                .get::<_, Address>(&DataKey::FeeCollector)
            {
                let token_client = token::Client::new(&env, &campaign.token);
                token_client.transfer(&env.current_contract_address(), &fee_collector, &order.fee);
            }
        }

        env.storage()
            .persistent()
            .set(&DataKey::Order(order_id), &order);
        // Extend TTL on order confirmation (Issue #456).
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Order(order_id), TTL_THRESHOLD, TTL_EXTEND);
        save_campaign(&env, &campaign);

        env.events().publish(
            (t_order(), symbol_short!("confirmed")),
            (order_id, buyer, order.campaign_id),
        );
        if order.fee > 0 {
            env.events().publish(
                (t_order(), symbol_short!("fee_col")),
                (order_id, order.fee),
            );
        }
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Settlement & refunds
    // -----------------------------------------------------------------------

    /// Transition Harvested campaign to Settled. Funds remain escrowed for
    /// investors to claim individually.
    pub fn settle(env: Env, caller: Address, campaign_id: u64) -> Result<(), EscrowError> {
        caller.require_auth();
        let mut campaign = load_campaign(&env, campaign_id)?;
        let admin = admin(&env)?;
        if caller != campaign.farmer && caller != admin {
            return Err(EscrowError::NotAdmin);
        }
        if campaign.status != CampaignStatus::Harvested {
            return Err(EscrowError::CampaignNotHarvested);
        }
        campaign.status = CampaignStatus::Settled;
        save_campaign(&env, &campaign);

        env.events().publish(
            (t_campaign(), symbol_short!("settled")),
            (campaign_id, campaign.total_revenue),
        );
        Ok(())
    }

    /// Investor claims their proportional share of the remaining escrow.
    pub fn claim_returns(
        env: Env,
        investor: Address,
        campaign_id: u64,
    ) -> Result<i128, EscrowError> {
        investor.require_auth();
        let campaign = load_campaign(&env, campaign_id)?;
        if campaign.status != CampaignStatus::Settled {
            return Err(EscrowError::CampaignNotSettled);
        }

        let contribution = env
            .storage()
            .persistent()
            .get::<_, i128>(&DataKey::Contribution(campaign_id, investor.clone()))
        let contribs = load_contribs(&env, campaign_id);
        // Extend TTL on contribution read to protect investment records (Issue #456).
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Contributions(campaign_id), TTL_THRESHOLD, TTL_EXTEND);
        let contribution = contribs
            .get(investor.clone())
            .ok_or(EscrowError::NotInvestor)?;
        if contribution <= 0 {
            return Err(EscrowError::NotInvestor);
        }

        let claim_key = DataKey::Claimed(campaign_id, investor.clone());
        if env.storage().persistent().has(&claim_key) {
            return Err(EscrowError::AlreadyClaimed);
        }

        // Remaining escrow = total_raised + revenue - tranches already released.
        // Rounding dust (due to integer division) goes to the platform fee collector (Issue #455).
        let pool = checked_add(
            campaign.total_raised,
            checked_sub(campaign.total_revenue, campaign.tranche_released)?
        )?;
        if pool <= 0 {
            return Err(EscrowError::NothingToClaim);
        }
        let payout = checked_mul(pool, contribution)? / campaign.total_raised;
        if payout <= 0 {
            return Err(EscrowError::NothingToClaim);
        }

        env.storage().persistent().set(&claim_key, &true);
        // Extend TTL on claim to protect proof of payout (Issue #456).
        env.storage()
            .persistent()
            .extend_ttl(&claim_key, TTL_THRESHOLD, TTL_EXTEND);

        let token_client = token::Client::new(&env, &campaign.token);
        token_client.transfer(&env.current_contract_address(), &investor, &payout);

        env.events().publish(
            (t_campaign(), symbol_short!("claimed")),
            (campaign_id, investor, payout),
        );
        Ok(payout)
    }

    // -----------------------------------------------------------------------
    // Failure model
    // -----------------------------------------------------------------------

    /// Anyone can trigger campaign failure once the deadline passes
    /// without the target being reached (Funding state only).
    pub fn finalize_failed(env: Env, campaign_id: u64) -> Result<(), EscrowError> {
        let mut campaign = load_campaign(&env, campaign_id)?;
        if campaign.status != CampaignStatus::Funding {
            return Err(EscrowError::CampaignNotFunding);
        }
        if env.ledger().timestamp() <= campaign.deadline {
            return Err(EscrowError::CampaignDeadlineNotPassed);
        }
        campaign.status = CampaignStatus::Failed;
        save_campaign(&env, &campaign);

        env.events()
            .publish((t_campaign(), symbol_short!("failed")), (campaign_id,));
        Ok(())
    }

    /// Farmer or admin can mark a campaign failed from any non-terminal
    /// state (Funded, InProduction, Harvested). This triggers proportional
    /// refund logic — investors get their share of the remaining escrow pool.
    ///
    /// Recovery outcomes:
    ///   - Funded: full refund (no tranches released yet).
    ///   - InProduction: proportional refund (remaining after start tranche).
    ///   - Harvested: proportional refund (remaining after all tranches + revenue).
    pub fn mark_campaign_failed(
        env: Env,
        caller: Address,
        campaign_id: u64,
    ) -> Result<(), EscrowError> {
        caller.require_auth();
        let mut campaign = load_campaign(&env, campaign_id)?;
        let admin = admin(&env)?;

        // Only farmer or admin can trigger failure after funding
        if caller != campaign.farmer && caller != admin {
            return Err(EscrowError::NotAdmin);
        }

        match campaign.status {
            CampaignStatus::Funded
            | CampaignStatus::InProduction
            | CampaignStatus::Harvested => {
                campaign.status = CampaignStatus::Failed;
                save_campaign(&env, &campaign);
                env.events().publish(
                    (t_campaign(), symbol_short!("failed")),
                    (campaign_id,),
                );
                Ok(())
            }
            _ => Err(EscrowError::CampaignNotFundedOrBeyond),
        }
    }

    /// Investor reclaims their proportional share on a failed campaign.
    ///
    /// Before production (Funding/Funded -> Failed): returns full contribution.
    /// During/after production: returns proportional share of remaining escrow.
    pub fn refund(env: Env, investor: Address, campaign_id: u64) -> Result<i128, EscrowError> {
        investor.require_auth();
        let campaign = load_campaign(&env, campaign_id)?;
        if campaign.status != CampaignStatus::Failed {
            return Err(EscrowError::CampaignNotFailed);
        }
        let contribution = env
            .storage()
            .persistent()
            .get::<_, i128>(&DataKey::Contribution(campaign_id, investor.clone()))
        let contribs = load_contribs(&env, campaign_id);
        // Extend TTL on contribution read to protect refund records (Issue #456).
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Contributions(campaign_id), TTL_THRESHOLD, TTL_EXTEND);
        let contribution = contribs
            .get(investor.clone())
            .ok_or(EscrowError::NotInvestor)?;
        if contribution <= 0 {
            return Err(EscrowError::NotInvestor);
        }

        let claim_key = DataKey::Claimed(campaign_id, investor.clone());
        if env.storage().persistent().has(&claim_key) {
            return Err(EscrowError::AlreadyClaimed);
        }
        env.storage().persistent().set(&claim_key, &true);
        // Extend TTL on refund to protect proof of payout (Issue #456).
        env.storage()
            .persistent()
            .extend_ttl(&claim_key, TTL_THRESHOLD, TTL_EXTEND);

        let token_client = token::Client::new(&env, &campaign.token);

        // Determine refund amount based on campaign state at failure time.
        // If no tranches were released, full refund is available.
        if campaign.tranche_released <= 0 {
            // Full refund: all funds are still in escrow.
            token_client.transfer(
                &env.current_contract_address(),
                &investor,
                &contribution,
            );
            env.events().publish(
                (t_campaign(), symbol_short!("refunded")),
                (campaign_id, investor, contribution),
            );
            return Ok(contribution);
        }

        // Proportional refund: remaining pool = raised + revenue - released.
        let pool = campaign.total_raised + campaign.total_revenue - campaign.tranche_released;
        if pool <= 0 {
            return Err(EscrowError::NothingToClaim);
        }

        let payout = (pool * contribution) / campaign.total_raised;
        if payout <= 0 {
            return Err(EscrowError::NothingToClaim);
        }

        token_client.transfer(
            &env.current_contract_address(),
            &investor,
            &payout,
        );

        env.events().publish(
            (t_campaign(), symbol_short!("refunded")),
            (campaign_id, investor, payout),
        );
        Ok(payout)
    }

    /// View the refundable amount for a contributor on a failed campaign.
    /// Returns 0 if not applicable (not failed, not an investor, or already claimed).
    pub fn refundable_amount(
        env: Env,
        investor: Address,
        campaign_id: u64,
    ) -> i128 {
        let campaign = match load_campaign(&env, campaign_id) {
            Ok(c) => c,
            Err(_) => return 0,
        };
        if campaign.status != CampaignStatus::Failed {
            return 0;
        }
        let contribs = load_contribs(&env, campaign_id);
        let contribution = contribs.get(investor.clone()).unwrap_or(0);
        if contribution <= 0 {
            return 0;
        }
        let claim_key = DataKey::Claimed(campaign_id, investor);
        if env.storage().persistent().has(&claim_key) {
            return 0;
        }
        if campaign.tranche_released <= 0 {
            return contribution;
        }
        let pool = campaign.total_raised + campaign.total_revenue - campaign.tranche_released;
        if pool <= 0 {
            return 0;
        }
        (pool * contribution) / campaign.total_raised
    }

    // -----------------------------------------------------------------------
    // Disputes
    // -----------------------------------------------------------------------

    pub fn open_dispute(env: Env, caller: Address, campaign_id: u64) -> Result<(), EscrowError> {
        caller.require_auth();
        let mut campaign = load_campaign(&env, campaign_id)?;
        let admin = admin(&env)?;
        if caller != campaign.farmer && caller != admin {
            // Investors may also open disputes.
            let contribution = env
                .storage()
                .persistent()
                .get::<_, i128>(&DataKey::Contribution(campaign_id, caller.clone()))
                .unwrap_or(0);
            if contribution <= 0 {
                return Err(EscrowError::NotInvestor);
            }
        }
        if campaign.status == CampaignStatus::Disputed
            || campaign.status == CampaignStatus::Settled
            || campaign.status == CampaignStatus::Failed
        {
            return Err(EscrowError::CampaignAlreadyDisputed);
        }
        campaign.status = CampaignStatus::Disputed;
        save_campaign(&env, &campaign);

        env.events().publish(
            (t_campaign(), symbol_short!("disputed")),
            (campaign_id, caller),
        );
        Ok(())
    }

    /// Admin-only resolution.
    pub fn resolve_dispute(
        env: Env,
        admin_caller: Address,
        campaign_id: u64,
        resolution: DisputeResolution,
    ) -> Result<(), EscrowError> {
        admin_caller.require_auth();
        let admin = admin(&env)?;
        if admin_caller != admin {
            return Err(EscrowError::NotAdmin);
        }

        let mut campaign = load_campaign(&env, campaign_id)?;
        if campaign.status != CampaignStatus::Disputed {
            return Err(EscrowError::CampaignNotDisputed);
        }

        match resolution {
            DisputeResolution::FullPayoutToInvestors => {
                campaign.status = CampaignStatus::Settled;
                save_campaign(&env, &campaign);
                env.events().publish(
                    (t_campaign(), symbol_short!("settled")),
                    (campaign_id, campaign.total_revenue),
                );
            }
            DisputeResolution::RefundInvestors => {
                campaign.status = CampaignStatus::Failed;
                save_campaign(&env, &campaign);
                env.events()
                    .publish((t_campaign(), symbol_short!("failed")), (campaign_id,));
            }
            DisputeResolution::Partial(farmer_bps) => {
                if farmer_bps > BPS_DENOM as u32 {
                    return Err(EscrowError::InvalidResolution);
                }
                let pool = checked_add(
                    campaign.total_raised,
                    checked_sub(campaign.total_revenue, campaign.tranche_released)?
                )?;
                if pool > 0 && farmer_bps > 0 {
                    let farmer_cut = checked_mul(pool, farmer_bps as i128)? / BPS_DENOM;
                    if farmer_cut > 0 {
                        let token_client = token::Client::new(&env, &campaign.token);
                        token_client.transfer(
                            &env.current_contract_address(),
                            &campaign.farmer,
                            &farmer_cut,
                        );
                        campaign.tranche_released = checked_add(campaign.tranche_released, farmer_cut)?;
                    }
                }
                campaign.status = CampaignStatus::Settled;
                save_campaign(&env, &campaign);
                env.events().publish(
                    (t_campaign(), symbol_short!("settled")),
                    (campaign_id, campaign.total_revenue),
                );
            }
        }
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Batch Operations (Issue #273)
    // -----------------------------------------------------------------------

    /// Batch refund multiple investors on a failed campaign.
    /// Enforces a hard cap of 50 investors per call to prevent excessive ledger reads.
    /// Silently skips investors that have no contribution or already claimed.
    /// Emits ONE `campaign:batch_ref` summary event with (campaign_id, count, total).
    pub fn batch_refund_investors(
        env: Env,
        campaign_id: u64,
        investors: Vec<Address>,
    ) -> Result<(u32, i128), EscrowError> {
        const MAX_BATCH: u32 = 50;
        if investors.len() > MAX_BATCH {
            return Err(EscrowError::InvalidAmount); // Reuse error type for oversized input
        }
        let campaign = load_campaign(&env, campaign_id)?;
        if campaign.status != CampaignStatus::Failed {
            return Err(EscrowError::CampaignNotFailed);
        }
        let token_client = token::Client::new(&env, &campaign.token);

        let pool = campaign.total_raised + campaign.total_revenue - campaign.tranche_released;
        let full_refund = campaign.tranche_released <= 0;

        let mut count: u32 = 0;
        let mut total: i128 = 0;

        for investor in investors.iter() {
            let contribution = env
                .storage()
                .persistent()
                .get::<_, i128>(&DataKey::Contribution(campaign_id, investor.clone()))
                .unwrap_or(0);
            if contribution <= 0 {
                continue;
            }
            let claim_key = DataKey::Claimed(campaign_id, investor.clone());
            if env.storage().persistent().has(&claim_key) {
                continue;
            }
            env.storage().persistent().set(&claim_key, &true);

            let payout = if full_refund {
                contribution
            } else {
                if pool <= 0 {
                    continue;
                }
                (pool * contribution) / campaign.total_raised
            };
            if payout <= 0 {
                continue;
            }

            token_client.transfer(
                &env.current_contract_address(),
                &investor,
                &payout,
            );
            count += 1;
            total = checked_add(total, contribution)?;
            total += payout;
        }

        // Emit a single summary event for the whole batch.
        env.events().publish(
            (t_campaign(), symbol_short!("batch_ref")),
            (campaign_id, count, total),
        );
        Ok((count, total))
    }

    /// Batch refund pending orders that are older than ORDER_EXPIRY_SECS (96 h).
    /// Silently skips orders that are not pending or have not expired yet.
    /// Emits ONE `order:batch_ref` summary event with (count, total).
    pub fn batch_refund_orders(
        env: Env,
        order_ids: Vec<u64>,
    ) -> Result<(u32, i128), EscrowError> {
        let now = env.ledger().timestamp();

        let mut count: u32 = 0;
        let mut total: i128 = 0;

        for order_id in order_ids.iter() {
            let mut order: Order = match env
                .storage()
                .persistent()
                .get(&DataKey::Order(order_id))
            {
                Some(o) => o,
                None => continue,
            };
            if order.status != OrderStatus::Pending {
                continue;
            }
            // Only refund orders that have passed the expiry window.
            if now < order.created_at + ORDER_EXPIRY_SECS {
                continue;
            }
            let campaign = match load_campaign(&env, order.campaign_id) {
                Ok(c) => c,
                Err(_) => continue,
            };
            // Mark as Refunded to prevent double-refund (Issue #455).
            order.status = OrderStatus::Refunded;
            env.storage()
                .persistent()
                .set(&DataKey::Order(order_id), &order);
            // Extend TTL on batch refund (Issue #456).
            env.storage()
                .persistent()
                .extend_ttl(&DataKey::Order(order_id), TTL_THRESHOLD, TTL_EXTEND);

            // Refund full amount (net + fee) to buyer since order was not delivered.
            let refund_amount = order.amount + order.fee;
            let token_client = token::Client::new(&env, &campaign.token);
            token_client.transfer(
                &env.current_contract_address(),
                &order.buyer,
                &refund_amount,
            );
            if order.fee > 0 {
                env.events().publish(
                    (t_order(), symbol_short!("fee_ref")),
                    (order_id, order.fee),
                );
            }
            count += 1;
            total += refund_amount;
            total = checked_add(total, order.amount)?;
        }

        // Emit a single summary event for the whole batch.
        env.events().publish(
            (t_order(), symbol_short!("batch_ref")),
            (count, total),
        );
        Ok((count, total))
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    pub fn get_campaign(env: Env, campaign_id: u64) -> Result<Campaign, EscrowError> {
        load_campaign(&env, campaign_id)
    }

    pub fn get_order(env: Env, order_id: u64) -> Result<Order, EscrowError> {
        env.storage()
            .persistent()
            .get(&DataKey::Order(order_id))
            .ok_or(EscrowError::OrderNotFound)
    }

    pub fn get_contribution(env: Env, campaign_id: u64, investor: Address) -> i128 {
        env.storage()
            .persistent()
            .get::<_, i128>(&DataKey::Contribution(campaign_id, investor))
            .unwrap_or(0)
    }

    pub fn get_supported_tokens(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::SupportedTokens)
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn get_admin(env: Env) -> Result<Address, EscrowError> {
        admin(&env)
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Minimal registry contract client for cross-contract calls.
mod registry_client {
    use soroban_sdk::{Address, Env, IntoVal, Symbol, Val, Vec};

    pub fn register_campaign(
        env: &Env,
        registry: &Address,
        campaign_id: u64,
        farmer: &Address,
        linked_escrow_order_id: Option<u64>,
    ) -> Result<(), ()> {
        let func = Symbol::new(env, "register_campaign");
        let mut args: Vec<Val> = Vec::new(env);
        args.push_back(env.current_contract_address().into_val(env));
        args.push_back(campaign_id.into_val(env));
        args.push_back(farmer.clone().into_val(env));
        args.push_back(linked_escrow_order_id.into_val(env));
        let _: () = env.invoke_contract(registry, &func, args);
        Ok(())
    }
// Checked arithmetic for monetary values (Issue #457).
fn checked_add(a: i128, b: i128) -> Result<i128, EscrowError> {
    a.checked_add(b)
        .ok_or(EscrowError::InvalidAmount)
}

fn checked_sub(a: i128, b: i128) -> Result<i128, EscrowError> {
    a.checked_sub(b)
        .ok_or(EscrowError::InvalidAmount)
}

fn checked_mul(a: i128, b: i128) -> Result<i128, EscrowError> {
    a.checked_mul(b)
        .ok_or(EscrowError::InvalidAmount)
}

fn admin(env: &Env) -> Result<Address, EscrowError> {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(EscrowError::ContractNotInitialized)
}

fn load_campaign(env: &Env, id: u64) -> Result<Campaign, EscrowError> {
    env.storage()
        .persistent()
        .get(&DataKey::Campaign(id))
        .ok_or(EscrowError::CampaignNotFound)
}

fn save_campaign(env: &Env, c: &Campaign) {
    env.storage().persistent().set(&DataKey::Campaign(c.id), c);
    env.storage()
        .persistent()
        .extend_ttl(&DataKey::Campaign(c.id), TTL_THRESHOLD, TTL_EXTEND);
}


fn release_tranche_internal(
    env: &Env,
    campaign: &mut Campaign,
    amount: i128,
) -> Result<(), EscrowError> {
    if amount <= 0 {
        return Err(EscrowError::InvalidTranche);
    }
    let available = checked_sub(campaign.total_raised, campaign.tranche_released)?;
    if amount > available {
        return Err(EscrowError::InvalidTranche);
    }
    // Enforce maximum cumulative tranche cap to always preserve at least
    // (100% - MAX_TRANCHE_BPS) of raised funds for investor refunds.
    let new_total = campaign.tranche_released + amount;
    let max_allowed = (campaign.total_raised * MAX_TRANCHE_BPS) / BPS_DENOM;
    if new_total > max_allowed {
        return Err(EscrowError::InvalidTranche);
    }
    let token_client = token::Client::new(env, &campaign.token);
    token_client.transfer(&env.current_contract_address(), &campaign.farmer, &amount);
    campaign.tranche_released = checked_add(campaign.tranche_released, amount)?;

    env.events().publish(
        (t_campaign(), symbol_short!("tranche")),
        (campaign.id, amount, campaign.tranche_released),
    );
    Ok(())
}

#[cfg(test)]
mod test;
