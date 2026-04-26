#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, symbol_short,
    Address, Env, Vec,
};

// ─── Errors ──────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ProductionEscrowError {
    AlreadyInitialized = 1,
    MustSupportTwoTokens = 2,
    AmountMustBePositive = 3,
    ContractNotInitialized = 4,
    UnsupportedToken = 5,
    CampaignDoesNotExist = 6,
    NotFarmer = 7,
    CampaignNotActive = 8,
    CampaignNotFailed = 9,
    DeadlineNotReached = 10,
    NotInvestor = 11,
    AlreadyRefunded = 12,
    OrderDoesNotExist = 13,
    NotBuyer = 14,
    OrderNotPending = 15,
    OrderNotExpired = 16,
    OrderNotDelivered = 17,
    // Dispute errors (Issue #124)
    DisputeAlreadyOpen = 18,
    DisputeCooldownActive = 19,
    InsufficientDisputeStake = 20,
    DisputeDoesNotExist = 21,
    DisputeNotOpen = 22,
    NotAdmin = 23,
    DisputeStakeMustBePositive = 24,
}

// ─── Types ────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CampaignStatus {
    Active,
    Funded,
    Harvested,
    Failed,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OrderStatus {
    Pending,
    Delivered,
    Completed,
    Refunded,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DisputeStatus {
    Open,
    Resolved,
    Rejected,
}

/// A crowdfunding campaign for an agricultural production run.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Campaign {
    pub farmer: Address,
    pub token: Address,
    /// Minimum amount required to mark the campaign as Funded.
    pub funding_goal: i128,
    /// Total invested so far.
    pub total_funded: i128,
    /// Ledger timestamp after which the campaign can be marked Failed
    /// if the harvest has not been confirmed (Issue #137).
    pub harvest_deadline: u64,
    pub status: CampaignStatus,
}

/// An individual investor's position in a campaign.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InvestorPosition {
    pub amount: i128,
    pub refunded: bool,
}

/// A standard escrow order between buyer and farmer.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Order {
    pub buyer: Address,
    pub farmer: Address,
    pub token: Address,
    pub amount: i128,
    pub timestamp: u64,
    pub delivery_timestamp: Option<u64>,
    pub status: OrderStatus,
}

/// A dispute record attached to an order (Issue #124).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Dispute {
    pub order_id: u64,
    pub raiser: Address,
    /// Stake locked by the raiser to open the dispute.
    pub stake: i128,
    pub opened_at: u64,
    pub status: DisputeStatus,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    // Config
    Admin,
    SupportedTokens,
    DisputeStakeAmount,
    // Campaigns
    Campaign(u64),
    CampaignCount,
    InvestorPosition(u64, Address),
    FarmerCampaigns(Address),
    // Orders
    Order(u64),
    OrderCount,
    BuyerOrders(Address),
    FarmerOrders(Address),
    // Disputes (Issue #124)
    Dispute(u64),
    DisputeCount,
    OrderDispute(u64),
    // Cooldown: tracks last dispute-open timestamp per address per order
    LastDisputeTimestamp(Address),
}

// ─── Constants ────────────────────────────────────────────────────────────────

const NINETY_SIX_HOURS: u64 = 96 * 60 * 60;

/// Minimum seconds that must pass before the same address can open another
/// dispute. Prevents spam at the protocol level (Issue #124).
const DISPUTE_COOLDOWN_SECONDS: u64 = 24 * 60 * 60;

// ─── Contract ────────────────────────────────────────────────────────────────

#[contract]
pub struct ProductionEscrowContract;

#[contractimpl]
impl ProductionEscrowContract {
    // ── Initialisation ───────────────────────────────────────────────────────

    pub fn initialize(
        env: Env,
        admin: Address,
        supported_tokens: Vec<Address>,
        dispute_stake_amount: i128,
    ) -> Result<(), ProductionEscrowError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ProductionEscrowError::AlreadyInitialized);
        }
        if supported_tokens.len() < 2 {
            return Err(ProductionEscrowError::MustSupportTwoTokens);
        }
        if dispute_stake_amount <= 0 {
            return Err(ProductionEscrowError::DisputeStakeMustBePositive);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::SupportedTokens, &supported_tokens);
        env.storage().instance().set(&DataKey::DisputeStakeAmount, &dispute_stake_amount);
        Ok(())
    }

    // ── Campaign Functions (Issue #137) ──────────────────────────────────────

    /// Create a new agricultural production campaign.
    pub fn create_campaign(
        env: Env,
        farmer: Address,
        token: Address,
        funding_goal: i128,
        harvest_deadline: u64,
    ) -> Result<u64, ProductionEscrowError> {
        farmer.require_auth();

        if funding_goal <= 0 {
            return Err(ProductionEscrowError::AmountMustBePositive);
        }

        let supported_tokens: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::SupportedTokens)
            .ok_or(ProductionEscrowError::ContractNotInitialized)?;

        if !supported_tokens.contains(&token) {
            return Err(ProductionEscrowError::UnsupportedToken);
        }

        let mut campaign_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::CampaignCount)
            .unwrap_or(0);
        campaign_id += 1;
        env.storage().instance().set(&DataKey::CampaignCount, &campaign_id);

        let campaign = Campaign {
            farmer: farmer.clone(),
            token,
            funding_goal,
            total_funded: 0,
            harvest_deadline,
            status: CampaignStatus::Active,
        };

        env.storage().persistent().set(&DataKey::Campaign(campaign_id), &campaign);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Campaign(campaign_id), 1000, 100000);

        let mut farmer_campaigns: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::FarmerCampaigns(farmer.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        farmer_campaigns.push_back(campaign_id);
        env.storage()
            .persistent()
            .set(&DataKey::FarmerCampaigns(farmer.clone()), &farmer_campaigns);

        env.events().publish(
            (symbol_short!("campaign"), symbol_short!("created")),
            (campaign_id, farmer, funding_goal, harvest_deadline),
        );

        Ok(campaign_id)
    }

    /// Invest in an active campaign.
    pub fn invest(
        env: Env,
        investor: Address,
        campaign_id: u64,
        amount: i128,
    ) -> Result<(), ProductionEscrowError> {
        investor.require_auth();

        if amount <= 0 {
            return Err(ProductionEscrowError::AmountMustBePositive);
        }

        let mut campaign: Campaign = env
            .storage()
            .persistent()
            .get(&DataKey::Campaign(campaign_id))
            .ok_or(ProductionEscrowError::CampaignDoesNotExist)?;

        if campaign.status != CampaignStatus::Active {
            return Err(ProductionEscrowError::CampaignNotActive);
        }

        let token_client = token::Client::new(&env, &campaign.token);
        token_client.transfer(&investor, &env.current_contract_address(), &amount);

        campaign.total_funded += amount;
        if campaign.total_funded >= campaign.funding_goal {
            campaign.status = CampaignStatus::Funded;
        }
        env.storage().persistent().set(&DataKey::Campaign(campaign_id), &campaign);

        let mut position: InvestorPosition = env
            .storage()
            .persistent()
            .get(&DataKey::InvestorPosition(campaign_id, investor.clone()))
            .unwrap_or(InvestorPosition { amount: 0, refunded: false });
        position.amount += amount;
        env.storage()
            .persistent()
            .set(&DataKey::InvestorPosition(campaign_id, investor.clone()), &position);

        env.events().publish(
            (symbol_short!("campaign"), symbol_short!("invested")),
            (campaign_id, investor, amount),
        );

        Ok(())
    }

    /// Farmer confirms harvest; transitions campaign to Harvested.
    pub fn confirm_harvest(
        env: Env,
        farmer: Address,
        campaign_id: u64,
    ) -> Result<(), ProductionEscrowError> {
        farmer.require_auth();

        let mut campaign: Campaign = env
            .storage()
            .persistent()
            .get(&DataKey::Campaign(campaign_id))
            .ok_or(ProductionEscrowError::CampaignDoesNotExist)?;

        if campaign.farmer != farmer {
            return Err(ProductionEscrowError::NotFarmer);
        }
        if campaign.status != CampaignStatus::Active && campaign.status != CampaignStatus::Funded {
            return Err(ProductionEscrowError::CampaignNotActive);
        }

        let token_client = token::Client::new(&env, &campaign.token);
        token_client.transfer(
            &env.current_contract_address(),
            &farmer,
            &campaign.total_funded,
        );

        campaign.status = CampaignStatus::Harvested;
        env.storage().persistent().set(&DataKey::Campaign(campaign_id), &campaign);

        env.events().publish(
            (symbol_short!("campaign"), symbol_short!("harvested")),
            (campaign_id, farmer),
        );

        Ok(())
    }

    /// Mark a campaign as Failed when the harvest deadline has passed (Issue #137).
    /// Anyone can call this once the deadline is exceeded — no centralised gating.
    pub fn mark_campaign_failed(
        env: Env,
        campaign_id: u64,
    ) -> Result<(), ProductionEscrowError> {
        let mut campaign: Campaign = env
            .storage()
            .persistent()
            .get(&DataKey::Campaign(campaign_id))
            .ok_or(ProductionEscrowError::CampaignDoesNotExist)?;

        if campaign.status != CampaignStatus::Active && campaign.status != CampaignStatus::Funded {
            return Err(ProductionEscrowError::CampaignNotActive);
        }

        let current_time = env.ledger().timestamp();
        if current_time <= campaign.harvest_deadline {
            return Err(ProductionEscrowError::DeadlineNotReached);
        }

        campaign.status = CampaignStatus::Failed;
        env.storage().persistent().set(&DataKey::Campaign(campaign_id), &campaign);

        env.events().publish(
            (symbol_short!("campaign"), symbol_short!("failed")),
            (campaign_id, current_time),
        );

        Ok(())
    }

    /// Refund a single investor's proportional share from a failed campaign (Issue #137).
    pub fn refund_investor(
        env: Env,
        campaign_id: u64,
        investor: Address,
    ) -> Result<(), ProductionEscrowError> {
        let campaign: Campaign = env
            .storage()
            .persistent()
            .get(&DataKey::Campaign(campaign_id))
            .ok_or(ProductionEscrowError::CampaignDoesNotExist)?;

        if campaign.status != CampaignStatus::Failed {
            return Err(ProductionEscrowError::CampaignNotFailed);
        }

        let mut position: InvestorPosition = env
            .storage()
            .persistent()
            .get(&DataKey::InvestorPosition(campaign_id, investor.clone()))
            .ok_or(ProductionEscrowError::NotInvestor)?;

        if position.refunded {
            return Err(ProductionEscrowError::AlreadyRefunded);
        }

        position.refunded = true;
        env.storage()
            .persistent()
            .set(&DataKey::InvestorPosition(campaign_id, investor.clone()), &position);

        let token_client = token::Client::new(&env, &campaign.token);
        token_client.transfer(
            &env.current_contract_address(),
            &investor,
            &position.amount,
        );

        env.events().publish(
            (symbol_short!("campaign"), symbol_short!("refunded")),
            (campaign_id, investor, position.amount),
        );

        Ok(())
    }

    /// Batch-refund multiple investors from a failed campaign (Issue #137).
    pub fn refund_investors(
        env: Env,
        campaign_id: u64,
        investors: Vec<Address>,
    ) -> Result<(), ProductionEscrowError> {
        for investor in investors.iter() {
            Self::refund_investor(env.clone(), campaign_id, investor)?;
        }
        Ok(())
    }

    // ── Order / Escrow Functions ─────────────────────────────────────────────

    pub fn create_order(
        env: Env,
        buyer: Address,
        farmer: Address,
        token: Address,
        amount: i128,
    ) -> Result<u64, ProductionEscrowError> {
        buyer.require_auth();

        if amount <= 0 {
            return Err(ProductionEscrowError::AmountMustBePositive);
        }

        let supported_tokens: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::SupportedTokens)
            .ok_or(ProductionEscrowError::ContractNotInitialized)?;

        if !supported_tokens.contains(&token) {
            return Err(ProductionEscrowError::UnsupportedToken);
        }

        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&buyer, &env.current_contract_address(), &amount);

        let mut order_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::OrderCount)
            .unwrap_or(0);
        order_id += 1;
        env.storage().instance().set(&DataKey::OrderCount, &order_id);

        let timestamp = env.ledger().timestamp();
        let order = Order {
            buyer: buyer.clone(),
            farmer: farmer.clone(),
            token,
            amount,
            timestamp,
            delivery_timestamp: None,
            status: OrderStatus::Pending,
        };

        env.storage().persistent().set(&DataKey::Order(order_id), &order);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Order(order_id), 1000, 100000);

        let mut buyer_orders: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::BuyerOrders(buyer.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        buyer_orders.push_back(order_id);
        env.storage()
            .persistent()
            .set(&DataKey::BuyerOrders(buyer.clone()), &buyer_orders);

        let mut farmer_orders: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::FarmerOrders(farmer.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        farmer_orders.push_back(order_id);
        env.storage()
            .persistent()
            .set(&DataKey::FarmerOrders(farmer.clone()), &farmer_orders);

        env.events().publish(
            (symbol_short!("order"), symbol_short!("created")),
            (order_id, buyer, farmer, amount),
        );

        Ok(order_id)
    }

    pub fn mark_delivered(
        env: Env,
        farmer: Address,
        order_id: u64,
    ) -> Result<(), ProductionEscrowError> {
        farmer.require_auth();

        let mut order: Order = env
            .storage()
            .persistent()
            .get(&DataKey::Order(order_id))
            .ok_or(ProductionEscrowError::OrderDoesNotExist)?;

        if order.farmer != farmer {
            return Err(ProductionEscrowError::NotFarmer);
        }
        if order.status != OrderStatus::Pending {
            return Err(ProductionEscrowError::OrderNotPending);
        }

        let delivery_timestamp = env.ledger().timestamp();
        order.status = OrderStatus::Delivered;
        order.delivery_timestamp = Some(delivery_timestamp);
        env.storage().persistent().set(&DataKey::Order(order_id), &order);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Order(order_id), 1000, 100000);

        env.events().publish(
            (symbol_short!("order"), symbol_short!("delivered")),
            (order_id, farmer, order.buyer.clone(), delivery_timestamp),
        );

        Ok(())
    }

    pub fn confirm_receipt(
        env: Env,
        buyer: Address,
        order_id: u64,
    ) -> Result<(), ProductionEscrowError> {
        buyer.require_auth();

        let mut order: Order = env
            .storage()
            .persistent()
            .get(&DataKey::Order(order_id))
            .ok_or(ProductionEscrowError::OrderDoesNotExist)?;

        if order.buyer != buyer {
            return Err(ProductionEscrowError::NotBuyer);
        }
        if order.status != OrderStatus::Pending && order.status != OrderStatus::Delivered {
            return Err(ProductionEscrowError::OrderNotPending);
        }

        order.status = OrderStatus::Completed;
        env.storage().persistent().set(&DataKey::Order(order_id), &order);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Order(order_id), 1000, 100000);

        let token_client = token::Client::new(&env, &order.token);
        token_client.transfer(
            &env.current_contract_address(),
            &order.farmer,
            &order.amount,
        );

        env.events().publish(
            (symbol_short!("order"), symbol_short!("confirmed")),
            (order_id, order.buyer, order.farmer),
        );

        Ok(())
    }

    pub fn refund_expired_order(
        env: Env,
        order_id: u64,
    ) -> Result<(), ProductionEscrowError> {
        let mut order: Order = env
            .storage()
            .persistent()
            .get(&DataKey::Order(order_id))
            .ok_or(ProductionEscrowError::OrderDoesNotExist)?;

        if order.status != OrderStatus::Pending && order.status != OrderStatus::Delivered {
            return Err(ProductionEscrowError::OrderNotPending);
        }

        let current_time = env.ledger().timestamp();
        if current_time <= order.timestamp + NINETY_SIX_HOURS {
            return Err(ProductionEscrowError::OrderNotExpired);
        }

        order.status = OrderStatus::Refunded;
        env.storage().persistent().set(&DataKey::Order(order_id), &order);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Order(order_id), 1000, 100000);

        let token_client = token::Client::new(&env, &order.token);
        token_client.transfer(&env.current_contract_address(), &order.buyer, &order.amount);

        env.events().publish(
            (symbol_short!("order"), symbol_short!("refunded")),
            (order_id, order.buyer),
        );

        Ok(())
    }

    // ── Dispute Functions (Issue #124) ───────────────────────────────────────

    /// Open a dispute for an active order.
    ///
    /// The caller must:
    ///   1. Not have opened a dispute in the last DISPUTE_COOLDOWN_SECONDS (spam guard).
    ///   2. Transfer a stake equal to `dispute_stake_amount` into the contract.
    ///
    /// The stake is returned if the dispute is resolved in the raiser's favour and
    /// forfeited if the dispute is rejected.
    pub fn open_dispute(
        env: Env,
        raiser: Address,
        order_id: u64,
    ) -> Result<u64, ProductionEscrowError> {
        raiser.require_auth();

        // Verify the order exists and is in an actionable state.
        let order: Order = env
            .storage()
            .persistent()
            .get(&DataKey::Order(order_id))
            .ok_or(ProductionEscrowError::OrderDoesNotExist)?;

        if order.status != OrderStatus::Pending && order.status != OrderStatus::Delivered {
            return Err(ProductionEscrowError::OrderNotPending);
        }

        // Only buyer or farmer may raise a dispute.
        if order.buyer != raiser && order.farmer != raiser {
            return Err(ProductionEscrowError::NotBuyer);
        }

        // Reject if a dispute is already open for this order.
        if env
            .storage()
            .persistent()
            .has(&DataKey::OrderDispute(order_id))
        {
            return Err(ProductionEscrowError::DisputeAlreadyOpen);
        }

        // Enforce cooldown (Issue #124 — prevent spam).
        let now = env.ledger().timestamp();
        let last_dispute: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::LastDisputeTimestamp(raiser.clone()))
            .unwrap_or(0);

        if now < last_dispute + DISPUTE_COOLDOWN_SECONDS {
            return Err(ProductionEscrowError::DisputeCooldownActive);
        }

        // Collect stake from the raiser (Issue #124 — small fee to open dispute).
        let stake_amount: i128 = env
            .storage()
            .instance()
            .get(&DataKey::DisputeStakeAmount)
            .ok_or(ProductionEscrowError::ContractNotInitialized)?;

        let token_client = token::Client::new(&env, &order.token);
        token_client.transfer(&raiser, &env.current_contract_address(), &stake_amount);

        // Record the dispute.
        let mut dispute_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::DisputeCount)
            .unwrap_or(0);
        dispute_id += 1;
        env.storage().instance().set(&DataKey::DisputeCount, &dispute_id);

        let dispute = Dispute {
            order_id,
            raiser: raiser.clone(),
            stake: stake_amount,
            opened_at: now,
            status: DisputeStatus::Open,
        };

        env.storage().persistent().set(&DataKey::Dispute(dispute_id), &dispute);
        env.storage()
            .persistent()
            .set(&DataKey::OrderDispute(order_id), &dispute_id);
        env.storage()
            .persistent()
            .set(&DataKey::LastDisputeTimestamp(raiser.clone()), &now);

        env.events().publish(
            (symbol_short!("dispute"), symbol_short!("opened")),
            (dispute_id, order_id, raiser, stake_amount),
        );

        Ok(dispute_id)
    }

    /// Admin resolves the dispute in favour of the raiser: stake is returned,
    /// order funds go back to the winning party.
    pub fn resolve_dispute(
        env: Env,
        admin: Address,
        dispute_id: u64,
        favour_raiser: bool,
    ) -> Result<(), ProductionEscrowError> {
        admin.require_auth();

        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ProductionEscrowError::ContractNotInitialized)?;
        if admin != stored_admin {
            return Err(ProductionEscrowError::NotAdmin);
        }

        let mut dispute: Dispute = env
            .storage()
            .persistent()
            .get(&DataKey::Dispute(dispute_id))
            .ok_or(ProductionEscrowError::DisputeDoesNotExist)?;

        if dispute.status != DisputeStatus::Open {
            return Err(ProductionEscrowError::DisputeNotOpen);
        }

        let mut order: Order = env
            .storage()
            .persistent()
            .get(&DataKey::Order(dispute.order_id))
            .ok_or(ProductionEscrowError::OrderDoesNotExist)?;

        let token_client = token::Client::new(&env, &order.token);

        if favour_raiser {
            // Return stake to raiser and refund order amount to them too.
            token_client.transfer(
                &env.current_contract_address(),
                &dispute.raiser,
                &(dispute.stake + order.amount),
            );
            dispute.status = DisputeStatus::Resolved;
            order.status = OrderStatus::Refunded;
        } else {
            // Stake is forfeited to admin; order amount goes to the other party.
            token_client.transfer(
                &env.current_contract_address(),
                &stored_admin,
                &dispute.stake,
            );
            let counterparty = if order.buyer == dispute.raiser {
                order.farmer.clone()
            } else {
                order.buyer.clone()
            };
            token_client.transfer(
                &env.current_contract_address(),
                &counterparty,
                &order.amount,
            );
            dispute.status = DisputeStatus::Rejected;
            order.status = OrderStatus::Completed;
        }

        env.storage().persistent().set(&DataKey::Dispute(dispute_id), &dispute);
        env.storage().persistent().set(&DataKey::Order(dispute.order_id), &order);

        env.events().publish(
            (symbol_short!("dispute"), symbol_short!("resolved")),
            (dispute_id, favour_raiser),
        );

        Ok(())
    }

    // ── Getters ──────────────────────────────────────────────────────────────

    pub fn get_campaign(
        env: Env,
        campaign_id: u64,
    ) -> Result<Campaign, ProductionEscrowError> {
        env.storage()
            .persistent()
            .get(&DataKey::Campaign(campaign_id))
            .ok_or(ProductionEscrowError::CampaignDoesNotExist)
    }

    pub fn get_investor_position(
        env: Env,
        campaign_id: u64,
        investor: Address,
    ) -> Result<InvestorPosition, ProductionEscrowError> {
        env.storage()
            .persistent()
            .get(&DataKey::InvestorPosition(campaign_id, investor))
            .ok_or(ProductionEscrowError::NotInvestor)
    }

    pub fn get_order_details(
        env: Env,
        order_id: u64,
    ) -> Result<Order, ProductionEscrowError> {
        env.storage()
            .persistent()
            .get(&DataKey::Order(order_id))
            .ok_or(ProductionEscrowError::OrderDoesNotExist)
    }

    pub fn get_dispute(
        env: Env,
        dispute_id: u64,
    ) -> Result<Dispute, ProductionEscrowError> {
        env.storage()
            .persistent()
            .get(&DataKey::Dispute(dispute_id))
            .ok_or(ProductionEscrowError::DisputeDoesNotExist)
    }

    pub fn get_orders_by_buyer(env: Env, buyer: Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::BuyerOrders(buyer))
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn get_orders_by_farmer(env: Env, farmer: Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::FarmerOrders(farmer))
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn get_supported_tokens(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::SupportedTokens)
            .unwrap_or_else(|| Vec::new(&env))
    }
}

mod test;
