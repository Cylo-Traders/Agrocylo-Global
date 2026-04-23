#![no_std]
use soroban_sdk::{contract, contracterror, contractimpl, contracttype, token, symbol_short,
Address, Env, Map, Vec,};

// Errors
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum EscrowError {
    AlreadyInitialized     = 1,
    MustSupportTwoTokens   = 2,
    AmountMustBePositive   = 3,
    ContractNotInitialized = 4,
    UnsupportedToken       = 5,
    OrderDoesNotExist      = 6,
    NotBuyer               = 7,
    OrderNotPending        = 8,
    OrderNotExpired        = 9,
    NotFarmer              = 10,
    OrderNotDelivered      = 11,
    CampaignDoesNotExist   = 12,
    NotAdmin               = 13,
    CampaignNotActive      = 14,
    CampaignAlreadySettled = 15,
    CampaignNotSettled     = 16,
    NotAnInvestor          = 17,
    AlreadyClaimed         = 18,
    ReturnRateTooHigh      = 19,
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
pub struct Order {
    pub buyer:             Address,
    pub farmer:            Address,
    pub token:             Address,
    pub amount:            i128,
    pub timestamp:         u64,
    pub delivery_timestamp: Option<u64>,
    pub status:            OrderStatus,
}


#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CampaignStatus {
    /// Accepting investor deposits; farmer has not yet received capital.
    Active,
    /// Capital released to farmer; per-investor returns have been fixed.
    /// Investors may now call claim_returns.
    Settled,
}

/// One investor's position inside a campaign.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Investment {
    /// Tokens the investor locked into this campaign.
    pub amount:  i128,
    /// Flips to true after a successful claim_returns call.
    /// Prevents double-claiming.
    pub claimed: bool,
}

/// An agro-production funding campaign created by the platform admin.
///
/// Flow:
///   1. Admin calls create_campaign.
///   2. One or more investors call invest.
///   3. Admin calls finalize_settlement(return_rate_bps):
///      - Full principal is sent to the farmer.
///      - Return rate is locked; status becomes Settled.
///   4. Each investor calls claim_returns to receive
///      principal + floor(principal * return_rate_bps / 10000).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Campaign {
    pub admin:           Address,
    pub farmer:          Address,
    pub token:           Address,
    pub total_invested:  i128,    // running sum of all investor deposits.
    /// Agreed return in basis points (e.g. 1000 = 10%).
    /// Zero until finalize_settlement is called.
    pub return_rate_bps: u32,
    pub created_at:      u64,
    pub settled_at:      Option<u64>,
    pub status:          CampaignStatus,
}


#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Order(u64),
    BuyerOrders(Address),
    FarmerOrders(Address),
    OrderCount,
    SupportedTokens,
    Admin,
    Campaign(u64),
    CampaignInvestors(u64),   // every investor's record for a campaign.
    CampaignCount,
}


const NINTY_SIX_HOURS_IN_SECONDS: u64 = 96 * 60 * 60;
// denominator for basis-point arithmetic.
const BPS_DENOM: i128 = 10_000;
/// Hard cap on return_rate_bps: 10000 bps = 100% the principal is doubled
const MAX_RETURN_RATE_BPS: u32 = 10_000;


#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    pub fn initialize(
        env: Env,
        admin: Address,
        supported_tokens: Vec<Address>,
    ) -> Result<(), EscrowError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(EscrowError::AlreadyInitialized);
        }
        if supported_tokens.len() < 2 {
            return Err(EscrowError::MustSupportTwoTokens);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::SupportedTokens, &supported_tokens);
        Ok(())
    }

    pub fn create_order(
        env: Env,
        buyer: Address,
        farmer: Address,
        token: Address,
        amount: i128,
    ) -> Result<u64, EscrowError> {
        buyer.require_auth();

        if amount <= 0 {
            return Err(EscrowError::AmountMustBePositive);
        }

        let supported_tokens: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::SupportedTokens)
            .ok_or(EscrowError::ContractNotInitialized)?;

        if !supported_tokens.contains(&token) {
            return Err(EscrowError::UnsupportedToken);
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

        let order = Order {
            buyer: buyer.clone(),
            farmer: farmer.clone(),
            token,
            amount,
            timestamp: env.ledger().timestamp(),
            delivery_timestamp: None,
            status: OrderStatus::Pending,
        };

        env.storage().persistent().set(&DataKey::Order(order_id), &order);

        let mut buyer_orders: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::BuyerOrders(buyer.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        buyer_orders.push_back(order_id);
        env.storage().persistent().set(&DataKey::BuyerOrders(buyer.clone()), &buyer_orders);

        let mut farmer_orders: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::FarmerOrders(farmer.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        farmer_orders.push_back(order_id);
        env.storage().persistent().set(&DataKey::FarmerOrders(farmer.clone()), &farmer_orders);

        env.storage().persistent().extend_ttl(&DataKey::Order(order_id), 1000, 100000);

        env.events().publish(
            (symbol_short!("order"), symbol_short!("created")),
            (order_id, buyer, farmer, amount),
        );

        Ok(order_id)
    }

    pub fn mark_delivered(env: Env, farmer: Address, order_id: u64) -> Result<(), EscrowError> {
        farmer.require_auth();

        let mut order: Order = env
            .storage()
            .persistent()
            .get(&DataKey::Order(order_id))
            .ok_or(EscrowError::OrderDoesNotExist)?;

        if order.farmer != farmer {
            return Err(EscrowError::NotFarmer);
        }
        if order.status != OrderStatus::Pending {
            return Err(EscrowError::OrderNotPending);
        }

        let delivery_timestamp = env.ledger().timestamp();
        order.status = OrderStatus::Delivered;
        order.delivery_timestamp = Some(delivery_timestamp);

        env.storage().persistent().set(&DataKey::Order(order_id), &order);
        env.storage().persistent().extend_ttl(&DataKey::Order(order_id), 1000, 100000);

        env.events().publish(
            (symbol_short!("order"), symbol_short!("delivered")),
            (order_id, farmer, order.buyer.clone(), delivery_timestamp),
        );

        Ok(())
    }

    pub fn confirm_receipt(env: Env, buyer: Address, order_id: u64) -> Result<(), EscrowError> {
        buyer.require_auth();

        let mut order: Order = env
            .storage()
            .persistent()
            .get(&DataKey::Order(order_id))
            .ok_or(EscrowError::OrderDoesNotExist)?;

        if order.buyer != buyer {
            return Err(EscrowError::NotBuyer);
        }
        if order.status != OrderStatus::Pending && order.status != OrderStatus::Delivered {
            return Err(EscrowError::OrderNotPending);
        }

        order.status = OrderStatus::Completed;
        env.storage().persistent().set(&DataKey::Order(order_id), &order);
        env.storage().persistent().extend_ttl(&DataKey::Order(order_id), 1000, 100000);

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

    pub fn refund_expired_order(env: Env, order_id: u64) -> Result<(), EscrowError> {
        let mut order: Order = env
            .storage()
            .persistent()
            .get(&DataKey::Order(order_id))
            .ok_or(EscrowError::OrderDoesNotExist)?;

        if order.status != OrderStatus::Pending && order.status != OrderStatus::Delivered {
            return Err(EscrowError::OrderNotPending);
        }

        let current_time = env.ledger().timestamp();
        if current_time <= order.timestamp + NINTY_SIX_HOURS_IN_SECONDS {
            return Err(EscrowError::OrderNotExpired);
        }

        order.status = OrderStatus::Refunded;
        env.storage().persistent().set(&DataKey::Order(order_id), &order);
        env.storage().persistent().extend_ttl(&DataKey::Order(order_id), 1000, 100000);

        let token_client = token::Client::new(&env, &order.token);
        token_client.transfer(&env.current_contract_address(), &order.buyer, &order.amount);

        env.events().publish(
            (symbol_short!("order"), symbol_short!("refunded")),
            (order_id, order.buyer),
        );

        Ok(())
    }

    pub fn refund_expired_orders(env: Env, order_ids: Vec<u64>) -> Result<(), EscrowError> {
        for order_id in order_ids.iter() {
            Self::refund_expired_order(env.clone(), order_id)?;
        }
        Ok(())
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

    pub fn get_order_details(env: Env, order_id: u64) -> Result<Order, EscrowError> {
        env.storage()
            .persistent()
            .get(&DataKey::Order(order_id))
            .ok_or(EscrowError::OrderDoesNotExist)
    }

    pub fn get_supported_tokens(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::SupportedTokens)
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Create a new investment campaign by admin only
    ///
    /// The campaign starts Active with zero invested capital.
    /// Investors call invest to deposit tokens; the admin later calls
    /// finalize_settlement to release funds to the farmer.
    pub fn create_campaign(
        env: Env,
        admin: Address,
        farmer: Address,
        token: Address,
    ) -> Result<u64, EscrowError> {
        admin.require_auth();

        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(EscrowError::ContractNotInitialized)?;
        if admin != stored_admin {
            return Err(EscrowError::NotAdmin);
        }

        let supported_tokens: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::SupportedTokens)
            .ok_or(EscrowError::ContractNotInitialized)?;
        if !supported_tokens.contains(&token) {
            return Err(EscrowError::UnsupportedToken);
        }

        let mut campaign_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::CampaignCount)
            .unwrap_or(0);
        campaign_id += 1;
        env.storage().instance().set(&DataKey::CampaignCount, &campaign_id);

        let campaign = Campaign {
            admin: admin.clone(),
            farmer: farmer.clone(),
            token,
            total_invested: 0,
            return_rate_bps: 0,
            created_at: env.ledger().timestamp(),
            settled_at: None,
            status: CampaignStatus::Active,
        };

        env.storage().persistent().set(&DataKey::Campaign(campaign_id), &campaign);
        env.storage().persistent().extend_ttl(&DataKey::Campaign(campaign_id), 1000, 100000);

        let empty_investors: Map<Address, Investment> = Map::new(&env);
        env.storage().persistent().set(&DataKey::CampaignInvestors(campaign_id), &empty_investors);
        env.storage().persistent().extend_ttl(&DataKey::CampaignInvestors(campaign_id), 1000, 100000);

        env.events().publish(
            (symbol_short!("campaign"), symbol_short!("created")),
            (campaign_id, admin, farmer),
        );

        Ok(campaign_id)
    }

    /// deposit tokens into an active campaign.
    ///
    /// Multiple calls by the same investor accumulate into a single position.
    pub fn invest(
        env: Env,
        investor: Address,
        campaign_id: u64,
        amount: i128,
    ) -> Result<(), EscrowError> {
        investor.require_auth();

        if amount <= 0 {
            return Err(EscrowError::AmountMustBePositive);
        }

        let mut campaign: Campaign = env
            .storage()
            .persistent()
            .get(&DataKey::Campaign(campaign_id))
            .ok_or(EscrowError::CampaignDoesNotExist)?;

        if campaign.status != CampaignStatus::Active {
            return Err(EscrowError::CampaignNotActive);
        }

        let token_client = token::Client::new(&env, &campaign.token);
        token_client.transfer(&investor, &env.current_contract_address(), &amount);

        let mut investors: Map<Address, Investment> = env
            .storage()
            .persistent()
            .get(&DataKey::CampaignInvestors(campaign_id))
            .unwrap_or_else(|| Map::new(&env));

        let prior = investors
            .get(investor.clone())
            .map(|i| i.amount)
            .unwrap_or(0);
        investors.set(
            investor.clone(),
            Investment {
                amount: prior + amount,
                claimed: false,
            },
        );

        env.storage().persistent().set(&DataKey::CampaignInvestors(campaign_id), &investors);
        env.storage().persistent().extend_ttl(&DataKey::CampaignInvestors(campaign_id), 1000, 100000);

        campaign.total_invested += amount;
        env.storage().persistent().set(&DataKey::Campaign(campaign_id), &campaign);
        env.storage().persistent().extend_ttl(&DataKey::Campaign(campaign_id), 1000, 100000);

        env.events().publish(
            (symbol_short!("campaign"), symbol_short!("invested")),
            (campaign_id, investor, amount),
        );

        Ok(())
    }

    // finalize_settlement
    /// Release the pooled capital to the farmer and lock in the investor
    /// return rate.
    ///
    /// Steps:
    /// 1. Validates caller is the campaign admin and campaign is still Active.
    /// 2. Transfers total_invested tokens from the contract to the farmer.
    /// 3. Records return_rate_bps on the campaign so each investor's payout
    ///    can be computed as: payout = principal + floor(principal * return_rate_bps / 10000)
    /// 4. Marks the campaign Settled; no further investments are accepted.
    ///
    /// Return funds:
    /// The farmer (or platform) must deposit the return tokens back into the
    /// contract before investors call claim_returns. The contract does
    /// not enforce the exact timing of this deposit; claim_returns will fail
    /// at the token-transfer level if the balance is insufficient.
    ///
    /// Parameters:
    /// return_rate_bps - agreed period return in basis points (100 = 1%).
    ///   Maximum is MAX_RETURN_RATE_BPS (10000 = 100%).
    pub fn finalize_settlement(
        env: Env,
        admin: Address,
        campaign_id: u64,
        return_rate_bps: u32,
    ) -> Result<(), EscrowError> {
        admin.require_auth();

        if return_rate_bps > MAX_RETURN_RATE_BPS {
            return Err(EscrowError::ReturnRateTooHigh);
        }

        let mut campaign: Campaign = env
            .storage()
            .persistent()
            .get(&DataKey::Campaign(campaign_id))
            .ok_or(EscrowError::CampaignDoesNotExist)?;

        if campaign.admin != admin {
            return Err(EscrowError::NotAdmin);
        }

        if campaign.status == CampaignStatus::Settled {
            return Err(EscrowError::CampaignAlreadySettled);
        }

        // transfer principal to farmer
        if campaign.total_invested > 0 {
            let token_client = token::Client::new(&env, &campaign.token);
            token_client.transfer(
                &env.current_contract_address(),
                &campaign.farmer,
                &campaign.total_invested,
            );
        }

        // Lock in return rate and mark settled
        let settled_at = env.ledger().timestamp();
        campaign.return_rate_bps = return_rate_bps;
        campaign.settled_at = Some(settled_at);
        campaign.status = CampaignStatus::Settled;

        env.storage().persistent().set(&DataKey::Campaign(campaign_id), &campaign);
        env.storage().persistent().extend_ttl(&DataKey::Campaign(campaign_id), 1000, 100000);

        env.events().publish(
            (symbol_short!("campaign"), symbol_short!("settled")),
            (campaign_id, campaign.farmer, campaign.total_invested, return_rate_bps, settled_at),
        );

        Ok(())
    }

    // claim_returns
    /// Claim principal + agreed return after a campaign has been settled.
    ///
    /// Steps:
    /// 1. Verifies the campaign is Settled.
    /// 2. Looks up the caller's Investment; errors if not found.
    /// 3. Double-claim guard - errors with AlreadyClaimed if
    ///    investment.claimed == true.
    /// 4. Computes payout = principal + floor(principal * return_rate_bps / 10000).
    /// 5. Marks claimed = true in storage.
    /// 6. Transfers payout tokens to the investor.
    ///
    /// Atomicity note:
    /// The claimed flag is written before the token transfer. Because
    /// Soroban transactions are atomic, a failed transfer rolls back the entire
    /// transaction - including the flag write - so the investor can retry.
    /// Once the transfer succeeds the flag is permanently set.
    ///
    /// Returns:
    /// The total payout amount transferred (useful for callers / event logs).
    pub fn claim_returns(
        env: Env,
        investor: Address,
        campaign_id: u64,
    ) -> Result<i128, EscrowError> {
        investor.require_auth();

        let campaign: Campaign = env
            .storage()
            .persistent()
            .get(&DataKey::Campaign(campaign_id))
            .ok_or(EscrowError::CampaignDoesNotExist)?;

        if campaign.status != CampaignStatus::Settled {
            return Err(EscrowError::CampaignNotSettled);
        }

        let mut investors: Map<Address, Investment> = env
            .storage()
            .persistent()
            .get(&DataKey::CampaignInvestors(campaign_id))
            .ok_or(EscrowError::CampaignDoesNotExist)?;

        let mut investment = investors
            .get(investor.clone())
            .ok_or(EscrowError::NotAnInvestor)?;

        // double claim guard
        if investment.claimed {
            return Err(EscrowError::AlreadyClaimed);
        }

        // Payout = principal + floor(principal * rate / 10000)
        let return_amount = investment.amount * (campaign.return_rate_bps as i128) / BPS_DENOM;
        let payout = investment.amount + return_amount;

        // Persist claimed flag BEFORE transfer atomic rollback safety
        investment.claimed = true;
        investors.set(investor.clone(), investment);
        env.storage().persistent().set(&DataKey::CampaignInvestors(campaign_id), &investors);
        env.storage().persistent().extend_ttl(&DataKey::CampaignInvestors(campaign_id), 1000, 100000);

        // Transfer payout
        let token_client = token::Client::new(&env, &campaign.token);
        token_client.transfer(&env.current_contract_address(), &investor, &payout);

        env.events().publish(
            (symbol_short!("campaign"), symbol_short!("claimed")),
            (campaign_id, investor, payout),
        );

        Ok(payout)
    }

    // Campaign getters
    pub fn get_campaign(env: Env, campaign_id: u64) -> Result<Campaign, EscrowError> {
        env.storage()
            .persistent()
            .get(&DataKey::Campaign(campaign_id))
            .ok_or(EscrowError::CampaignDoesNotExist)
    }

    pub fn get_investment(
        env: Env,
        campaign_id: u64,
        investor: Address,
    ) -> Result<Investment, EscrowError> {
        let investors: Map<Address, Investment> = env
            .storage()
            .persistent()
            .get(&DataKey::CampaignInvestors(campaign_id))
            .ok_or(EscrowError::CampaignDoesNotExist)?;

        investors
            .get(investor)
            .ok_or(EscrowError::NotAnInvestor)
    }
}

mod test;
