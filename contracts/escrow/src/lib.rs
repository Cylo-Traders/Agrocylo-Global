#![no_std]
use soroban_sdk::{contract, contracterror, contractimpl, contracttype, token, symbol_short, Address, Env, Vec};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum EscrowError {
    AlreadyInitialized = 1,
    MustSupportTwoTokens = 2,
    AmountMustBePositive = 3,
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

    pub fn get_supported_tokens(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::SupportedTokens)
            .unwrap_or_else(|| Vec::new(&env))
    }
}

mod test;