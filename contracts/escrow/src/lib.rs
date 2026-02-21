#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env, Vec};

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
}

const NINTY_SIX_HOURS_IN_SECONDS: u64 = 96 * 60 * 60;

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    /// Creates a new order.
    /// Locks the buyer's funds by transferring them to the contract address.
    pub fn create_order(
        env: Env,
        buyer: Address,
        farmer: Address,
        token: Address,
        amount: i128,
    ) -> u64 {
        buyer.require_auth();

        if amount <= 0 {
            panic!("amount must be positive");
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

        order_id
    }

    /// Buyer confirms that goods have been received.
    /// Escrow releases payment to the farmer.
    pub fn confirm_receipt(env: Env, buyer: Address, order_id: u64) {
        buyer.require_auth();

        let mut order: Order = env
            .storage()
            .persistent()
            .get(&DataKey::Order(order_id))
            .expect("order does not exist");

        if order.buyer != buyer {
            panic!("not the buyer of this order");
        }
        if order.status != OrderStatus::Pending {
            panic!("order is not pending");
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
    }

    /// Anyone can call this to refund an order that is older than 96 hours without confirmation.
    pub fn refund_expired_order(env: Env, order_id: u64) {
        let mut order: Order = env
            .storage()
            .persistent()
            .get(&DataKey::Order(order_id))
            .expect("order does not exist");

        if order.status != OrderStatus::Pending {
            panic!("order is not pending");
        }

        let current_time = env.ledger().timestamp();
        if current_time <= order.timestamp + NINTY_SIX_HOURS_IN_SECONDS {
            panic!("order has not expired yet");
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
    }

    /// Refunds multiple expired orders.
    pub fn refund_expired_orders(env: Env, order_ids: Vec<u64>) {
        for order_id in order_ids.iter() {
            Self::refund_expired_order(env.clone(), order_id);
        }
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
    pub fn get_order_details(env: Env, order_id: u64) -> Order {
        env.storage()
            .persistent()
            .get(&DataKey::Order(order_id))
            .expect("order does not exist")
    }
}

mod test;
