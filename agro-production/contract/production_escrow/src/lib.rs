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
    InvalidMilestone = 81,
    MilestoneNotConfigured = 82,
    MilestoneAlreadyAdvanced = 83,
    NotBuyerOrOracle = 84,
    AlreadyTransferred = 85,
    SameInvestor = 86,
    ArbitrationNotConfigured = 90,
    ArbitratorNotFound = 91,
    QuorumNotReached = 92,
    AlreadyVoted = 93,
    InvestorNotInCampaign = 94,
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

/// Production milestone stages. Each milestone can be configured to release a
/// percentage of the total raised funds when advanced by a buyer or oracle.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Milestone {
    Planted,
    Growing,
    Harvested,
    Shipped,
    Delivered,
}

/// Configuration for a single milestone: which stage it is and what percentage
/// (in basis points) of total_raised to release when advanced.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneConfig {
    pub milestone: Milestone,
    /// Basis points of total_raised to release (e.g. 1000 = 10%).
    pub release_bps: u32,
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
    /// Index into the milestone configs for the last advanced milestone.
    /// 0 = no milestones advanced yet (before Planted).
    pub current_milestone: u32,
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
    Attester,
    /// Governance contract authorized to change fee/token-whitelist parameters
    /// (Issue #660). While unset, those parameters fall back to admin-only
    /// control so existing deployments are not bricked; once set, it becomes
    /// the sole authorized caller for those specific setters.
    GovernanceContract,
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
    /// Per-campaign milestone release configuration (Vec<MilestoneConfig>).
    MilestoneConfigs(u64),
    /// Arbitrator pool addresses.
    Arbitrators,
    /// Minimum number of arbitrator votes required to resolve.
    Quorum,
    /// Track per-arbitrator vote per-campaign-dispute resolution.
    ArbitratorVote(u64, Address),
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

/// The ordered sequence of milestones. Index 1 = Planted, 2 = Growing, etc.
/// A campaign starts at milestone 0 (no milestones advanced).
/// Validates that the given milestone index matches the expected milestone type.
fn validate_milestone_order(idx: u32, milestone: &Milestone) -> bool {
    match (idx, milestone) {
        (0, Milestone::Planted) => true,
        (1, Milestone::Growing) => true,
        (2, Milestone::Harvested) => true,
        (3, Milestone::Shipped) => true,
        (4, Milestone::Delivered) => true,
        _ => false,
    }
}

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

    /// Set the registry contract address. Authorized caller is the governance
    /// contract once configured via `set_governance_contract` (Issue #660);
    /// falls back to admin-only while governance is unset.
    pub fn set_registry_contract(env: Env, admin_caller: Address, registry: Address) -> Result<(), EscrowError> {
        admin_caller.require_auth();
        require_governed_caller(&env, &admin_caller)?;
        env.storage()
            .instance()
            .set(&DataKey::RegistryContract, &registry);
        Ok(())
    }

    /// Update fee configuration. Authorized caller is the governance contract
    /// once configured via `set_governance_contract` (Issue #660); falls back
    /// to admin-only while governance is unset.
    /// Does not affect orders already created (fees are immutable per-order).
    pub fn set_fee_config(
        env: Env,
        admin_caller: Address,
        fee_collector: Address,
        fee_rate_bps: u32,
    ) -> Result<(), EscrowError> {
        admin_caller.require_auth();
        require_governed_caller(&env, &admin_caller)?;
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

    /// Set (or update) the governance contract address. Only the original
    /// admin can do this — a one-time (or migration-time) bootstrapping step
    /// that hands control of fee/token-whitelist parameters to governance.
    /// Once set, `set_fee_config`/`set_registry_contract`/`update_supported_tokens`
    /// can only be called by this address, not by the raw admin key.
    pub fn set_governance_contract(
        env: Env,
        admin_caller: Address,
        governance: Address,
    ) -> Result<(), EscrowError> {
        admin_caller.require_auth();
        let admin = admin(&env)?;
        if admin_caller != admin {
            return Err(EscrowError::NotAdmin);
        }
        env.storage()
            .instance()
            .set(&DataKey::GovernanceContract, &governance);
        Ok(())
    }

    /// Update the supported token whitelist. Same governance gating as
    /// `set_fee_config`/`set_registry_contract` (Issue #660) — this is the
    /// "token whitelist" parameter the issue calls out as a centralization
    /// risk when controlled by a single admin key.
    pub fn update_supported_tokens(
        env: Env,
        admin_caller: Address,
        supported_tokens: Vec<Address>,
    ) -> Result<(), EscrowError> {
        admin_caller.require_auth();
        require_governed_caller(&env, &admin_caller)?;
        if supported_tokens.len() < 1 {
            return Err(EscrowError::MustSupportOneToken);
        }
        env.storage()
            .instance()
            .set(&DataKey::SupportedTokens, &supported_tokens);
        Ok(())
    }

    pub fn get_governance_contract(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::GovernanceContract)
    }

    /// Set the independent attester role. Can be called by admin.
    /// The attester is required to sign off on mark_harvest to prevent farmer self-attest exploits.
    pub fn set_attester(env: Env, admin_caller: Address, attester: Address) -> Result<(), EscrowError> {
        admin_caller.require_auth();
        let admin = admin(&env)?;
        if admin_caller != admin {
            return Err(EscrowError::NotAdmin);
        }
        env.storage()
            .instance()
            .set(&DataKey::Attester, &attester);
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
            current_milestone: 0,
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
        env.storage()
            .persistent()
            .set(&contribution_key, &checked_add(prev, amount)?);

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
    /// Requires independent attester co-signature to prevent farmer self-attest exploits.
    pub fn mark_harvest(env: Env, farmer: Address, attester_caller: Address, campaign_id: u64) -> Result<(), EscrowError> {
        farmer.require_auth();
        attester_caller.require_auth();
        let attester_addr = attester(&env)?;
        if attester_caller != attester_addr {
            return Err(EscrowError::NotAdmin);
        }
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
    // Milestone-based partial release
    // -----------------------------------------------------------------------

    /// Admin sets the milestone release configuration for a campaign.
    /// Each config entry maps a milestone stage to a percentage (basis points)
    /// of total_raised to release when that milestone is advanced.
    /// Configs must be provided in sequential order (Planted -> Growing -> ...).
    pub fn set_milestone_configs(
        env: Env,
        admin_caller: Address,
        campaign_id: u64,
        configs: Vec<MilestoneConfig>,
    ) -> Result<(), EscrowError> {
        admin_caller.require_auth();
        let admin_addr = admin(&env)?;
        if admin_caller != admin_addr {
            return Err(EscrowError::NotAdmin);
        }
        let campaign = load_campaign(&env, campaign_id)?;
        // Only allow config before any milestones have been advanced.
        if campaign.current_milestone > 0 {
            return Err(EscrowError::MilestoneAlreadyAdvanced);
        }
        // Validate sequential order of milestones.
        for i in 0..configs.len() {
            let cfg = configs.get(i).unwrap();
            if cfg.release_bps == 0 || cfg.release_bps > 10000 {
                return Err(EscrowError::InvalidAmount);
            }
            if !validate_milestone_order(i, &cfg.milestone) {
                return Err(EscrowError::InvalidMilestone);
            }
        }
        env.storage()
            .persistent()
            .set(&DataKey::MilestoneConfigs(campaign_id), &configs);
        Ok(())
    }

    /// Advance to the next production milestone and release the configured
    /// percentage of funds to the farmer. Restricted to buyers and oracles
    /// (not the farmer) to prevent self-serving milestone claims.
    ///
    /// The caller must be a buyer (has a confirmed order on this campaign)
    /// or an oracle (admin address acting as oracle).
    pub fn advance_milestone(
        env: Env,
        caller: Address,
        campaign_id: u64,
    ) -> Result<(), EscrowError> {
        caller.require_auth();
        let mut campaign = load_campaign(&env, campaign_id)?;

        // Only allow milestone advances during active production.
        if campaign.status != CampaignStatus::Funded
            && campaign.status != CampaignStatus::InProduction
            && campaign.status != CampaignStatus::Harvested
        {
            return Err(EscrowError::CampaignNotFundedOrBeyond);
        }

        // Verify caller is buyer or oracle (admin).
        let admin_addr = admin(&env)?;
        let is_oracle = caller == admin_addr;
        if !is_oracle {
            // Check if caller is a buyer (has any confirmed order on this campaign).
            let is_buyer = has_confirmed_order(&env, campaign_id, &caller);
            if !is_buyer {
                return Err(EscrowError::NotBuyerOrOracle);
            }
        }

        // Load milestone configs.
        let configs: Vec<MilestoneConfig> = env
            .storage()
            .persistent()
            .get(&DataKey::MilestoneConfigs(campaign_id))
            .ok_or(EscrowError::MilestoneNotConfigured)?;

        let next_idx = campaign.current_milestone;
        if next_idx >= configs.len() {
            return Err(EscrowError::InvalidMilestone);
        }

        let cfg = configs.get(next_idx).unwrap();
        let tranche_amount = checked_mul(campaign.total_raised, cfg.release_bps as i128)? / BPS_DENOM;
        if tranche_amount > 0 {
            release_tranche_internal(&env, &mut campaign, tranche_amount)?;
        }

        campaign.current_milestone = next_idx + 1;
        save_campaign(&env, &campaign);

        env.events().publish(
            (t_campaign(), symbol_short!("milestone")),
            (campaign_id, caller, next_idx + 1, tranche_amount),
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

        let contribution_key = DataKey::Contribution(campaign_id, investor.clone());
        let contribution = env
            .storage()
            .persistent()
            .get::<_, i128>(&contribution_key)
            .ok_or(EscrowError::NotInvestor)?;
        if contribution <= 0 {
            return Err(EscrowError::NotInvestor);
        }
        // Extend TTL on contribution read to protect investment records (Issue #456).
        env.storage()
            .persistent()
            .extend_ttl(&contribution_key, TTL_THRESHOLD, TTL_EXTEND);

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

    /// Farmer or admin can mark a campaign failed from any non-terminal state.
    /// Farmer can unilaterally fail from Funded (no tranches released yet).
    /// Farmer cannot unilaterally fail from InProduction or Harvested (requires admin co-sign).
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

        // Determine who can call based on campaign state
        let can_fail = match campaign.status {
            CampaignStatus::Funded => {
                // Farmer can unilaterally fail before production starts
                caller == campaign.farmer || caller == admin
            }
            CampaignStatus::InProduction | CampaignStatus::Harvested => {
                // Farmer cannot unilaterally fail after production starts; requires admin
                caller == admin
            }
            _ => false,
        };

        if !can_fail {
            return Err(EscrowError::NotAdmin);
        }

        campaign.status = CampaignStatus::Failed;
        save_campaign(&env, &campaign);
        env.events().publish(
            (t_campaign(), symbol_short!("failed")),
            (campaign_id,),
        );
        Ok(())
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
        let contribution_key = DataKey::Contribution(campaign_id, investor.clone());
        let contribution = env
            .storage()
            .persistent()
            .get::<_, i128>(&contribution_key)
            .ok_or(EscrowError::NotInvestor)?;
        if contribution <= 0 {
            return Err(EscrowError::NotInvestor);
        }
        // Extend TTL on contribution read to protect refund records (Issue #456).
        env.storage()
            .persistent()
            .extend_ttl(&contribution_key, TTL_THRESHOLD, TTL_EXTEND);

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
        let contribution = env
            .storage()
            .persistent()
            .get::<_, i128>(&DataKey::Contribution(campaign_id, investor.clone()))
            .unwrap_or(0);
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
        let pool = match checked_add(
            campaign.total_raised,
            checked_sub(campaign.total_revenue, campaign.tranche_released).unwrap_or(0)
        ) {
            Ok(p) => p,
            Err(_) => return 0,
        };
        if pool <= 0 {
            return 0;
        }
        checked_mul(pool, contribution).unwrap_or(0) / campaign.total_raised
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

    /// Admin-only resolution. Falls back to admin if no arbitrator pool is configured.
    /// If arbitrator pool exists, admin can still resolve directly.
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

        let campaign = load_campaign(&env, campaign_id)?;
        if campaign.status != CampaignStatus::Disputed {
            return Err(EscrowError::CampaignNotDisputed);
        }

        resolve_dispute_internal(&env, campaign_id, resolution)
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

        let pool = checked_add(
            campaign.total_raised,
            checked_sub(campaign.total_revenue, campaign.tranche_released)?
        )?;
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
                match checked_mul(pool, contribution) {
                    Ok(prod) => prod / campaign.total_raised,
                    Err(_) => continue,
                }
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
            total = checked_add(total, payout)?;
        }

        // Emit a single summary event for the whole batch.
        env.events().publish(
            (t_campaign(), symbol_short!("batch_ref")),
            (campaign_id, count, total),
        );
        Ok((count, total))
    }

    /// Batch refund pending orders that are older than ORDER_EXPIRY_SECS (96 h).
    /// Enforces a hard cap of 50 orders per call to prevent excessive ledger reads.
    /// Silently skips orders that are not pending or have not expired yet.
    /// Emits ONE `order:batch_ref` summary event with (count, total).
    pub fn batch_refund_orders(
        env: Env,
        order_ids: Vec<u64>,
    ) -> Result<(u32, i128), EscrowError> {
        const MAX_BATCH: u32 = 50;
        if order_ids.len() > MAX_BATCH {
            return Err(EscrowError::InvalidAmount);
        }
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
            let refund_amount = checked_add(order.amount, order.fee)?;
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
            total = checked_add(total, refund_amount)?;
        }

        // Emit a single summary event for the whole batch.
        env.events().publish(
            (t_order(), symbol_short!("batch_ref")),
            (count, total),
        );
        Ok((count, total))
    }

    // -----------------------------------------------------------------------
    // Secondary Market — Transferable Investment
    // -----------------------------------------------------------------------

    pub fn transfer_investment(
        env: Env,
        from: Address,
        to: Address,
        campaign_id: u64,
    ) -> Result<(), EscrowError> {
        from.require_auth();
        if from == to {
            return Err(EscrowError::SameInvestor);
        }

        let campaign = load_campaign(&env, campaign_id)?;
        if campaign.status == CampaignStatus::Settled || campaign.status == CampaignStatus::Failed {
            return Err(EscrowError::CampaignAlreadyTerminal);
        }

        let contribution_key = DataKey::Contribution(campaign_id, from.clone());
        let contribution = env.storage().persistent()
            .get::<_, i128>(&contribution_key)
            .ok_or(EscrowError::NotInvestor)?;
        if contribution <= 0 {
            return Err(EscrowError::NotInvestor);
        }

        let claim_key_from = DataKey::Claimed(campaign_id, from.clone());
        if env.storage().persistent().has(&claim_key_from) {
            return Err(EscrowError::AlreadyTransferred);
        }

        let to_contribution_key = DataKey::Contribution(campaign_id, to.clone());
        let to_prev = env.storage().persistent()
            .get::<_, i128>(&to_contribution_key)
            .unwrap_or(0);

        env.storage().persistent().set(&contribution_key, &0i128);
        env.storage().persistent().set(&claim_key_from, &true);
        env.storage().persistent().set(&to_contribution_key, &checked_add(to_prev, contribution)?);

        env.events().publish(
            (symbol_short!("invest"), symbol_short!("transfer")),
            (campaign_id, from, to, contribution),
        );

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Arbitrator Pool
    // -----------------------------------------------------------------------

    pub fn set_arbitrators(
        env: Env,
        admin_caller: Address,
        arbitrators: Vec<Address>,
        quorum: u32,
    ) -> Result<(), EscrowError> {
        admin_caller.require_auth();
        let admin = admin(&env)?;
        if admin_caller != admin {
            return Err(EscrowError::NotAdmin);
        }
        if quorum == 0 || quorum > arbitrators.len() as u32 {
            return Err(EscrowError::InvalidAmount);
        }
        env.storage().instance().set(&DataKey::Arbitrators, &arbitrators);
        env.storage().instance().set(&DataKey::Quorum, &quorum);
        Ok(())
    }

    pub fn get_arbitrators(env: Env) -> Vec<Address> {
        env.storage().instance().get(&DataKey::Arbitrators).unwrap_or_else(|| Vec::new(&env))
    }

    pub fn get_quorum(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Quorum).unwrap_or(0)
    }

    pub fn vote_to_resolve(
        env: Env,
        arbitrator: Address,
        campaign_id: u64,
        resolution: DisputeResolution,
    ) -> Result<(), EscrowError> {
        arbitrator.require_auth();

        let arbitrators: Vec<Address> = env.storage().instance()
            .get(&DataKey::Arbitrators)
            .ok_or(EscrowError::ArbitrationNotConfigured)?;

        let is_valid_arbitrator = arbitrators.iter().any(|a| a == arbitrator);
        if !is_valid_arbitrator {
            return Err(EscrowError::ArbitratorNotFound);
        }

        let campaign = load_campaign(&env, campaign_id)?;
        if campaign.status != CampaignStatus::Disputed {
            return Err(EscrowError::CampaignNotDisputed);
        }

        let vote_key = DataKey::ArbitratorVote(campaign_id, arbitrator.clone());
        if env.storage().persistent().has(&vote_key) {
            return Err(EscrowError::AlreadyVoted);
        }

        env.storage().persistent().set(&vote_key, &resolution);

        let quorum: u32 = env.storage().instance().get(&DataKey::Quorum).unwrap_or(0);
        let mut yes_votes: u32 = 0;
        for a in arbitrators.iter() {
            if env.storage().persistent().has(&DataKey::ArbitratorVote(campaign_id, a)) {
                yes_votes += 1;
            }
        }

        if yes_votes >= quorum {
            resolve_dispute_internal(&env, campaign_id, resolution)?;
        }

        Ok(())
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

    pub fn get_milestone_configs(env: Env, campaign_id: u64) -> Vec<MilestoneConfig> {
        env.storage()
            .persistent()
            .get(&DataKey::MilestoneConfigs(campaign_id))
            .unwrap_or_else(|| Vec::new(&env))
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

fn attester(env: &Env) -> Result<Address, EscrowError> {
    env.storage()
        .instance()
        .get(&DataKey::Attester)
        .ok_or(EscrowError::ContractNotInitialized)
}

/// Enforces that `caller` is the authorized party for governance-gated
/// parameters (Issue #660): the governance contract if one has been set via
/// `set_governance_contract`, otherwise the raw admin as a fallback so a
/// deployment that never configures governance keeps working exactly as
/// before.
fn require_governed_caller(env: &Env, caller: &Address) -> Result<(), EscrowError> {
    if let Some(governance) = env
        .storage()
        .instance()
        .get::<_, Address>(&DataKey::GovernanceContract)
    {
        if *caller != governance {
            return Err(EscrowError::NotGoverned);
        }
        return Ok(());
    }
    let admin_addr = admin(env)?;
    if *caller != admin_addr {
        return Err(EscrowError::NotAdmin);
    }
    Ok(())
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

/// Check if a buyer has at least one confirmed order on a campaign.
/// Used by advance_milestone to verify caller authorization.
fn resolve_dispute_internal(
    env: &Env,
    campaign_id: u64,
    resolution: DisputeResolution,
) -> Result<(), EscrowError> {
    let mut campaign = load_campaign(env, campaign_id)?;

    match resolution {
        DisputeResolution::FullPayoutToInvestors => {
            campaign.status = CampaignStatus::Settled;
            save_campaign(env, &campaign);
            env.events().publish(
                (t_campaign(), symbol_short!("settled")),
                (campaign_id, campaign.total_revenue),
            );
        }
        DisputeResolution::RefundInvestors => {
            campaign.status = CampaignStatus::Failed;
            save_campaign(env, &campaign);
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
                    let token_client = token::Client::new(env, &campaign.token);
                    token_client.transfer(
                        &env.current_contract_address(),
                        &campaign.farmer,
                        &farmer_cut,
                    );
                    campaign.tranche_released = checked_add(campaign.tranche_released, farmer_cut)?;
                }
            }
            campaign.status = CampaignStatus::Settled;
            save_campaign(env, &campaign);
            env.events().publish(
                (t_campaign(), symbol_short!("settled")),
                (campaign_id, campaign.total_revenue),
            );
        }
    }
    Ok(())
}

fn has_confirmed_order(env: &Env, campaign_id: u64, buyer: &Address) -> bool {
    // Scan orders by checking up to order_count for confirmed orders by this buyer.
    let order_count: u64 = env
        .storage()
        .instance()
        .get(&DataKey::OrderCount)
        .unwrap_or(0);
    for i in 1..=order_count {
        if let Some(order) = env
            .storage()
            .persistent()
            .get::<_, Order>(&DataKey::Order(i))
        {
            if order.campaign_id == campaign_id && order.buyer == *buyer && order.status == OrderStatus::Confirmed {
                return true;
            }
        }
    }
    false
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
