#![no_std]
use soroban_sdk::{contract, contracterror, contractimpl, contracttype, token, Address, Env, Vec};

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
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OrderStatus {
    Pending,
    Completed,
    Refunded,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Order {
    pub buyer: Address,
    pub farmer: Address,
    pub token: Address,
    pub amount: i128,
    pub timestamp: u64,
    pub status: OrderStatus,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Order(u64),            // Maps order_id -> Order
    BuyerOrders(Address),  // Maps Address -> Vec<u64>
    FarmerOrders(Address), // Maps Address -> Vec<u64>
    OrderCount,            // Global counter for order IDs
    SupportedTokens,       // Maps to Vec<Address>
    Admin,                 // Maps to Address
}

const NINTY_SIX_HOURS_IN_SECONDS: u64 = 96 * 60 * 60;

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    /// Initializes the contract with an admin and a list of supported tokens.
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
        env.storage()
            .instance()
            .set(&DataKey::SupportedTokens, &supported_tokens);
        Ok(())
    }

    /// Creates a new order.
    /// Locks the buyer's funds by transferring them to the contract address.
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

        // Transfer tokens from buyer to the contract itself
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&buyer, &env.current_contract_address(), &amount);

        // Get the next order ID
        let mut order_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::OrderCount)
            .unwrap_or(0);
        order_id += 1;
        env.storage()
            .instance()
            .set(&DataKey::OrderCount, &order_id);

        let timestamp = env.ledger().timestamp();

        let order = Order {
            buyer: buyer.clone(),
            farmer: farmer.clone(),
            token,
            amount,
            timestamp,
            status: OrderStatus::Pending,
        };

        // Save order
        env.storage()
            .persistent()
            .set(&DataKey::Order(order_id), &order);

        // Update buyer's order list
        let mut buyer_orders: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::BuyerOrders(buyer.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        buyer_orders.push_back(order_id);
        env.storage()
            .persistent()
            .set(&DataKey::BuyerOrders(buyer), &buyer_orders);

        // Update farmer's order list
        let mut farmer_orders: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::FarmerOrders(farmer.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        farmer_orders.push_back(order_id);
        env.storage()
            .persistent()
            .set(&DataKey::FarmerOrders(farmer), &farmer_orders);

        // Extend data lifetime
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Order(order_id), 1000, 100000);

        Ok(order_id)
    }

    /// Buyer confirms that goods have been received.
    /// Escrow releases payment to the farmer.
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
        if order.status != OrderStatus::Pending {
            return Err(EscrowError::OrderNotPending);
        }

        // Update status to Completed
        order.status = OrderStatus::Completed;
        env.storage()
            .persistent()
            .set(&DataKey::Order(order_id), &order);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Order(order_id), 1000, 100000);

        // Release funds to the farmer
        let token_client = token::Client::new(&env, &order.token);
        token_client.transfer(
            &env.current_contract_address(),
            &order.farmer,
            &order.amount,
        );
        Ok(())
    }

    /// Anyone can call this to refund an order that is older than 96 hours without confirmation.
    pub fn refund_expired_order(env: Env, order_id: u64) -> Result<(), EscrowError> {
        let mut order: Order = env
            .storage()
            .persistent()
            .get(&DataKey::Order(order_id))
            .ok_or(EscrowError::OrderDoesNotExist)?;

        if order.status != OrderStatus::Pending {
            return Err(EscrowError::OrderNotPending);
        }

        let current_time = env.ledger().timestamp();
        if current_time <= order.timestamp + NINTY_SIX_HOURS_IN_SECONDS {
            return Err(EscrowError::OrderNotExpired);
        }

        // Mark as refunded
        order.status = OrderStatus::Refunded;
        env.storage()
            .persistent()
            .set(&DataKey::Order(order_id), &order);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Order(order_id), 1000, 100000);

        // Transfer funds back to the buyer
        let token_client = token::Client::new(&env, &order.token);
        token_client.transfer(&env.current_contract_address(), &order.buyer, &order.amount);
        Ok(())
    }

    /// Refunds multiple expired orders.
    pub fn refund_expired_orders(env: Env, order_ids: Vec<u64>) -> Result<(), EscrowError> {
        for order_id in order_ids.iter() {
            Self::refund_expired_order(env.clone(), order_id)?;
        }
        Ok(())
    }

    /// Returns all order IDs associated with a buyer.
    pub fn get_orders_by_buyer(env: Env, buyer: Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::BuyerOrders(buyer))
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Returns all order IDs for a specific farmer.
    pub fn get_orders_by_farmer(env: Env, farmer: Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::FarmerOrders(farmer))
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Returns full order details
    pub fn get_order_details(env: Env, order_id: u64) -> Result<Order, EscrowError> {
        env.storage()
            .persistent()
            .get(&DataKey::Order(order_id))
            .ok_or(EscrowError::OrderDoesNotExist)
    }

    /// Returns the currently supported tokens
    pub fn get_supported_tokens(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::SupportedTokens)
            .unwrap_or_else(|| Vec::new(&env))
    }
}

mod test;
