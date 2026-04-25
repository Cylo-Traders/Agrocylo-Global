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
//!   any -> Disputed -> resolved (Settled / Failed)

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env, Map,
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
    pub created_at: u64,
    pub status: OrderStatus,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    SupportedTokens,
    CampaignCount,
    OrderCount,
    Campaign(u64),
    /// Per-campaign investor -> contributed amount map.
    Contributions(u64),
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

const TTL_THRESHOLD: u32 = 1_000;
const TTL_EXTEND: u32 = 100_000;

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
    ) -> Result<(), EscrowError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(EscrowError::AlreadyInitialized);
        }
        if supported_tokens.len() < 1 {
            return Err(EscrowError::MustSupportOneToken);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::SupportedTokens, &supported_tokens);
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

        env.storage().persistent().set(&DataKey::Campaign(id), &campaign);
        env.storage()
            .persistent()
            .set(&DataKey::Contributions(id), &Map::<Address, i128>::new(&env));
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Campaign(id), TTL_THRESHOLD, TTL_EXTEND);

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

        campaign.total_raised += amount;

        // Record contribution (additive).
        let mut contribs: Map<Address, i128> = env
            .storage()
            .persistent()
            .get(&DataKey::Contributions(campaign_id))
            .unwrap_or(Map::new(&env));
        let prev = contribs.get(investor.clone()).unwrap_or(0);
        contribs.set(investor.clone(), prev + amount);
        env.storage()
            .persistent()
            .set(&DataKey::Contributions(campaign_id), &contribs);

        // Auto-transition to Funded when target reached.
        if campaign.total_raised == campaign.target_amount {
            campaign.status = CampaignStatus::Funded;
        }

        env.storage()
            .persistent()
            .set(&DataKey::Campaign(campaign_id), &campaign);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Campaign(campaign_id), TTL_THRESHOLD, TTL_EXTEND);

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

        let tranche = (campaign.total_raised * TRANCHE_START_BPS) / BPS_DENOM;
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

        let cumulative_target = (campaign.total_raised * (TRANCHE_START_BPS + TRANCHE_HARVEST_BPS))
            / BPS_DENOM;
        let delta = cumulative_target - campaign.tranche_released;
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

        let order = Order {
            id,
            campaign_id,
            buyer: buyer.clone(),
            amount,
            created_at: env.ledger().timestamp(),
            status: OrderStatus::Pending,
        };
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

    /// Buyer confirms receipt. Payment counts toward campaign revenue.
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
        campaign.total_revenue += order.amount;
        order.status = OrderStatus::Confirmed;

        env.storage().persistent().set(&DataKey::Order(order_id), &order);
        save_campaign(&env, &campaign);

        env.events().publish(
            (t_order(), symbol_short!("confirmed")),
            (order_id, buyer, order.campaign_id),
        );
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

        let contribs = load_contribs(&env, campaign_id);
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
        let pool = campaign.total_raised + campaign.total_revenue - campaign.tranche_released;
        if pool <= 0 {
            return Err(EscrowError::NothingToClaim);
        }
        let payout = (pool * contribution) / campaign.total_raised;
        if payout <= 0 {
            return Err(EscrowError::NothingToClaim);
        }

        env.storage().persistent().set(&claim_key, &true);

        let token_client = token::Client::new(&env, &campaign.token);
        token_client.transfer(&env.current_contract_address(), &investor, &payout);

        env.events().publish(
            (t_campaign(), symbol_short!("claimed")),
            (campaign_id, investor, payout),
        );
        Ok(payout)
    }

    /// Anyone can trigger failure finalization once the deadline passes
    /// without the target being reached.
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

        env.events().publish(
            (t_campaign(), symbol_short!("failed")),
            (campaign_id,),
        );
        Ok(())
    }

    /// Investor reclaims their contribution on a failed campaign.
    pub fn refund(
        env: Env,
        investor: Address,
        campaign_id: u64,
    ) -> Result<i128, EscrowError> {
        investor.require_auth();
        let campaign = load_campaign(&env, campaign_id)?;
        if campaign.status != CampaignStatus::Failed {
            return Err(EscrowError::CampaignNotFailed);
        }
        let contribs = load_contribs(&env, campaign_id);
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

        let token_client = token::Client::new(&env, &campaign.token);
        token_client.transfer(&env.current_contract_address(), &investor, &contribution);

        env.events().publish(
            (t_campaign(), symbol_short!("refunded")),
            (campaign_id, investor, contribution),
        );
        Ok(contribution)
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
            let contribs = load_contribs(&env, campaign_id);
            if contribs.get(caller.clone()).unwrap_or(0) <= 0 {
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
                env.events().publish(
                    (t_campaign(), symbol_short!("failed")),
                    (campaign_id,),
                );
            }
            DisputeResolution::Partial(farmer_bps) => {
                if farmer_bps > BPS_DENOM as u32 {
                    return Err(EscrowError::InvalidResolution);
                }
                let pool = campaign.total_raised + campaign.total_revenue
                    - campaign.tranche_released;
                if pool > 0 && farmer_bps > 0 {
                    let farmer_cut = (pool * farmer_bps as i128) / BPS_DENOM;
                    if farmer_cut > 0 {
                        let token_client = token::Client::new(&env, &campaign.token);
                        token_client.transfer(
                            &env.current_contract_address(),
                            &campaign.farmer,
                            &farmer_cut,
                        );
                        campaign.tranche_released += farmer_cut;
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
        load_contribs(&env, campaign_id).get(investor).unwrap_or(0)
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

fn load_contribs(env: &Env, id: u64) -> Map<Address, i128> {
    env.storage()
        .persistent()
        .get(&DataKey::Contributions(id))
        .unwrap_or_else(|| Map::new(env))
}

fn release_tranche_internal(
    env: &Env,
    campaign: &mut Campaign,
    amount: i128,
) -> Result<(), EscrowError> {
    if amount <= 0 {
        return Err(EscrowError::InvalidTranche);
    }
    let available = campaign.total_raised - campaign.tranche_released;
    if amount > available {
        return Err(EscrowError::InvalidTranche);
    }
    let token_client = token::Client::new(env, &campaign.token);
    token_client.transfer(
        &env.current_contract_address(),
        &campaign.farmer,
        &amount,
    );
    campaign.tranche_released += amount;

    env.events().publish(
        (t_campaign(), symbol_short!("tranche")),
        (campaign.id, amount, campaign.tranche_released),
    );
    Ok(())
}

#[cfg(test)]
mod test;
