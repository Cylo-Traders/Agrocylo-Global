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
    NotFarmer = 10,
    OrderNotDelivered = 11,
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

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Order(u64),
    BuyerOrders(Address),
    FarmerOrders(Address),
    OrderCount,
    SupportedTokens,
    Admin,
}

const NINTY_SIX_HOURS_IN_SECONDS: u64 = 96 * 60 * 60;

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

        let timestamp = env.ledger().timestamp();

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
            (order_id, buyer.clone(), farmer.clone(), amount, token.clone()),
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
