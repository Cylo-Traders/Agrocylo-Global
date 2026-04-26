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
    UnsupportedToken = 5,
    OrderDoesNotExist = 6,
    NotBuyer = 7,
    OrderNotPending = 8,
    OrderNotExpired = 9,
    NotAdmin = 10,
    OrderAlreadyDisputed = 11,
    NotFarmer = 12,
    OrderNotDelivered = 13,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OrderStatus {
    Pending,
    Delivered,
    Completed,
    Refunded,
    Disputed,
}

// OPTIMIZATION: Removed Debug derive from Order — not needed in production,
// reduces Wasm binary size.
#[contracttype]
#[derive(Clone, Eq, PartialEq)]
pub struct Order {
    pub buyer: Address,
    pub farmer: Address,
    pub token: Address,
    pub amount: i128,
    pub timestamp: u64,
    // OPTIMIZATION: Packed delivery_timestamp into a u64 using 0 as "None"
    // sentinel — removes Option<u64> overhead (extra byte + alignment padding).
    // 0 is safe because no real ledger timestamp will ever be 0.
    pub delivery_timestamp: u64,
    pub status: OrderStatus,
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
    FeeCollector,
}

const NINETY_SIX_HOURS_IN_SECONDS: u64 = 96 * 60 * 60;

// TTL constants — centralized to avoid magic numbers scattered across functions
const TTL_THRESHOLD: u32 = 1000;
const TTL_EXTEND_TO: u32 = 100_000;

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    pub fn initialize(
        env: Env,
        admin: Address,
        fee_collector: Address,
        supported_tokens: Vec<Address>,
    ) -> Result<(), EscrowError> {
        // OPTIMIZATION: Cache instance storage handle — single reference,
        // avoids repeated method dispatch.
        let storage = env.storage().instance();
        if storage.has(&DataKey::Admin) {
            return Err(EscrowError::AlreadyInitialized);
        }
        if supported_tokens.len() < 2 {
            return Err(EscrowError::MustSupportTwoTokens);
        }
        storage.set(&DataKey::Admin, &admin);
        storage.set(&DataKey::SupportedTokens, &supported_tokens);
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::FeeCollector, &fee_collector);
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

        // OPTIMIZATION: Cache instance storage once — previously called twice
        // (once for SupportedTokens, once for OrderCount), now a single handle.
        let instance_storage = env.storage().instance();

        let supported_tokens: Vec<Address> = instance_storage
            .get(&DataKey::SupportedTokens)
            .ok_or(EscrowError::ContractNotInitialized)?;

        if !supported_tokens.contains(&token) {
            return Err(EscrowError::UnsupportedToken);
        }

        // Transfer tokens before mutating state (checks-effects-interactions)
        token::Client::new(&env, &token).transfer(
            &buyer,
            &env.current_contract_address(),
            &amount,
        );
        let token_client = token::Client::new(&env, &token);
        
        let fee_collector: Address = env.storage().instance().get(&DataKey::FeeCollector).ok_or(EscrowError::ContractNotInitialized)?;
        let fee = amount * 3 / 100;
        let net_amount = amount - fee;

        token_client.transfer(&buyer, &fee_collector, &fee);
        token_client.transfer(&buyer, &env.current_contract_address(), &net_amount);

        // OPTIMIZATION: Single instance read for OrderCount using cached handle
        let order_id: u64 = instance_storage
            .get(&DataKey::OrderCount)
            .unwrap_or(0u64)
            + 1;
        instance_storage.set(&DataKey::OrderCount, &order_id);

        let timestamp = env.ledger().timestamp();

        // OPTIMIZATION: Build order last so buyer/farmer addresses move into
        // the struct without cloning. Clones below are only for storage keys,
        // which require owned values — unavoidable in Soroban's storage API.
        let persistent_storage = env.storage().persistent();
        let order_key = DataKey::Order(order_id);
        let order = Order {
            buyer: buyer.clone(),
            farmer: farmer.clone(),
            token: token.clone(),
            amount: net_amount,
            timestamp,
            delivery_timestamp: None,
            status: OrderStatus::Pending,
        };

        env.storage().persistent().set(&DataKey::Order(order_id), &order);

        // Update buyer order list
        let buyer_key = DataKey::BuyerOrders(buyer.clone());
        let mut buyer_orders: Vec<u64> = persistent_storage
            .get(&buyer_key)
            .unwrap_or_else(|| Vec::new(&env));
        buyer_orders.push_back(order_id);
        persistent_storage.set(&buyer_key, &buyer_orders);

        // Update farmer order list
        let farmer_key = DataKey::FarmerOrders(farmer.clone());
        let mut farmer_orders: Vec<u64> = persistent_storage
            .get(&farmer_key)
            .unwrap_or_else(|| Vec::new(&env));
        farmer_orders.push_back(order_id);
        persistent_storage.set(&farmer_key, &farmer_orders);

        // OPTIMIZATION: buyer and farmer move into struct here (no extra clone)
        let order = Order {
            buyer,
            farmer,
            token,
            amount,
            timestamp,
            delivery_timestamp: 0, // 0 = not yet delivered (replaces Option<u64>)
            status: OrderStatus::Pending,
        };

        // Publish event before storage write to expose fields before move
        env.events().publish(
            (symbol_short!("order"), symbol_short!("created")),
            (order_id, order.buyer.clone(), order.farmer.clone(), amount),
            (order_id, buyer.clone(), farmer.clone(), amount, token.clone()),
        );

        persistent_storage.set(&order_key, &order);
        persistent_storage.extend_ttl(&order_key, TTL_THRESHOLD, TTL_EXTEND_TO);

        Ok(order_id)
    }

    pub fn mark_delivered(env: Env, farmer: Address, order_id: u64) -> Result<(), EscrowError> {
        farmer.require_auth();

        let storage = env.storage().persistent();
        let key = DataKey::Order(order_id);
        let mut order: Order = storage.get(&key).ok_or(EscrowError::OrderDoesNotExist)?;

        if order.farmer != farmer {
            return Err(EscrowError::NotFarmer);
        }
        if order.status != OrderStatus::Pending {
            return Err(EscrowError::OrderNotPending);
        }

        let delivery_timestamp = env.ledger().timestamp();
        order.status = OrderStatus::Delivered;
        // OPTIMIZATION: u64 sentinel (0 = none) instead of Option<u64>
        order.delivery_timestamp = delivery_timestamp;

        storage.set(&key, &order);
        storage.extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);

        env.events().publish(
            (symbol_short!("order"), symbol_short!("delivered")),
            (order_id, farmer, order.buyer, delivery_timestamp),
        );

        Ok(())
    }

    pub fn confirm_receipt(env: Env, buyer: Address, order_id: u64) -> Result<(), EscrowError> {
        buyer.require_auth();

        let storage = env.storage().persistent();
        let key = DataKey::Order(order_id);
        let mut order: Order = storage.get(&key).ok_or(EscrowError::OrderDoesNotExist)?;

        if order.buyer != buyer {
            return Err(EscrowError::NotBuyer);
        }
        if order.status != OrderStatus::Pending && order.status != OrderStatus::Delivered {
            return Err(EscrowError::OrderNotPending);
        }

        order.status = OrderStatus::Completed;
        storage.set(&key, &order);
        storage.extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);

        token::Client::new(&env, &order.token)
            .transfer(&env.current_contract_address(), &order.farmer, &order.amount);

        env.events().publish(
            (symbol_short!("order"), symbol_short!("confirmed")),
            (order_id, order.buyer, order.farmer),
        );

        Ok(())
    }

    pub fn refund_expired_order(env: Env, order_id: u64) -> Result<(), EscrowError> {
        let storage = env.storage().persistent();
        let key = DataKey::Order(order_id);
        let mut order: Order = storage.get(&key).ok_or(EscrowError::OrderDoesNotExist)?;

        if order.status == OrderStatus::Disputed {
            return Err(EscrowError::OrderDisputed);
        }
        if order.status != OrderStatus::Pending && order.status != OrderStatus::Delivered {
            return Err(EscrowError::OrderNotPending);
        }

        if env.ledger().timestamp() <= order.timestamp + NINETY_SIX_HOURS_IN_SECONDS {
            return Err(EscrowError::OrderNotExpired);
        }

        order.status = OrderStatus::Refunded;
        storage.set(&key, &order);
        storage.extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);

        token::Client::new(&env, &order.token)
            .transfer(&env.current_contract_address(), &order.buyer, &order.amount);

        env.events().publish(
            (symbol_short!("order"), symbol_short!("refunded")),
            (order_id, order.buyer),
        );

        Ok(())
    }

    // OPTIMIZATION: env.clone() in loops is costly in Soroban. Inlined the
    // refund logic here to avoid repeated Env clones. This reduces overhead
    // for each iteration of the batch refund.
    pub fn refund_expired_orders(env: Env, order_ids: Vec<u64>) -> Result<(), EscrowError> {
        let storage = env.storage().persistent();
        let current_time = env.ledger().timestamp();

        for order_id in order_ids.iter() {
            let key = DataKey::Order(order_id);
            let mut order: Order = storage.get(&key).ok_or(EscrowError::OrderDoesNotExist)?;

            if order.status != OrderStatus::Pending && order.status != OrderStatus::Delivered {
                return Err(EscrowError::OrderNotPending);
            }

            if current_time <= order.timestamp + NINETY_SIX_HOURS_IN_SECONDS {
                return Err(EscrowError::OrderNotExpired);
            }

            order.status = OrderStatus::Refunded;
            storage.set(&key, &order);
            storage.extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);

            token::Client::new(&env, &order.token)
                .transfer(&env.current_contract_address(), &order.buyer, &order.amount);

            env.events().publish(
                (symbol_short!("order"), symbol_short!("refunded")),
                (order_id, order.buyer),
            );
        }

        Ok(())
    }

    /// Dispute an order. Can be called by buyer or farmer.
    pub fn dispute_order(env: Env, caller: Address, order_id: u64) -> Result<(), EscrowError> {
        caller.require_auth();

        let mut order: Order = env
            .storage()
            .persistent()
            .get(&DataKey::Order(order_id))
            .ok_or(EscrowError::OrderDoesNotExist)?;

        if order.status != OrderStatus::Pending {
            return Err(EscrowError::OrderNotPending);
        }

        if caller != order.buyer && caller != order.farmer {
            return Err(EscrowError::NotBuyer); // Using NotBuyer as a placeholder for "Not Involved"
        }

        // Update status to Disputed
        order.status = OrderStatus::Disputed;
        env.storage()
            .persistent()
            .set(&DataKey::Order(order_id), &order);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Order(order_id), 1000, 100000);

        // --- NEW: Emit Event for Backend Notification ---
        // Topics: (order, disputed), Data: (order_id, caller)
        env.events().publish(
            (symbol_short!("order"), symbol_short!("dispute")),
            (order_id, caller),
        );

        Ok(())
    }

    /// Resolves a dispute. Can only be called by the admin.
    pub fn resolve_dispute(
        env: Env,
        admin: Address,
        order_id: u64,
        resolve_to_buyer: bool,
    ) -> Result<(), EscrowError> {
        admin.require_auth();

        // Check if caller is admin
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(EscrowError::ContractNotInitialized)?;

        if admin != stored_admin {
            return Err(EscrowError::NotAdmin);
        }

        let mut order: Order = env
            .storage()
            .persistent()
            .get(&DataKey::Order(order_id))
            .ok_or(EscrowError::OrderDoesNotExist)?;

        if order.status != OrderStatus::Disputed {
            return Err(EscrowError::OrderNotPending); // Should probably use a more specific error
        }

        let token_client = token::Client::new(&env, &order.token);

        if resolve_to_buyer {
            // Refund to buyer
            order.status = OrderStatus::Refunded;
            token_client.transfer(&env.current_contract_address(), &order.buyer, &order.amount);
        } else {
            // Complete for farmer
            order.status = OrderStatus::Completed;
            token_client.transfer(&env.current_contract_address(), &order.farmer, &order.amount);
        }

        env.storage()
            .persistent()
            .set(&DataKey::Order(order_id), &order);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Order(order_id), 1000, 100000);

        // --- NEW: Emit Event for Backend Notification ---
        // Topics: (order, resolved), Data: (order_id, resolve_to_buyer)
        env.events().publish(
            (symbol_short!("order"), symbol_short!("resolved")),
            (order_id, resolve_to_buyer),
        );

        Ok(())
    }

    /// Returns all order IDs associated with a buyer.
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

    pub fn split_funds(
        env: Env,
        admin: Address,
        order_id: u64,
        buyer_share: i128,
        farmer_share: i128,
    ) -> Result<(), EscrowError> {
        admin.require_auth();

        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(EscrowError::ContractNotInitialized)?;
        if admin != stored_admin {
            return Err(EscrowError::NotAdmin);
        }

        let mut order: Order = env
            .storage()
            .persistent()
            .get(&DataKey::Order(order_id))
            .ok_or(EscrowError::OrderDoesNotExist)?;

        if order.status != OrderStatus::Pending && order.status != OrderStatus::Delivered && order.status != OrderStatus::Disputed {
            return Err(EscrowError::OrderNotPending);
        }

        if buyer_share + farmer_share != order.amount {
            return Err(EscrowError::InvalidSplit);
        }

        order.status = OrderStatus::Completed;
        env.storage().persistent().set(&DataKey::Order(order_id), &order);
        env.storage().persistent().extend_ttl(&DataKey::Order(order_id), 1000, 100000);

        let token_client = token::Client::new(&env, &order.token);
        if buyer_share > 0 {
            token_client.transfer(&env.current_contract_address(), &order.buyer, &buyer_share);
        }
        if farmer_share > 0 {
            token_client.transfer(&env.current_contract_address(), &order.farmer, &farmer_share);
        }

        env.events().publish(
            (symbol_short!("order"), symbol_short!("split")),
            (order_id, buyer_share, farmer_share),
        );

        Ok(())
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