#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env,
    String, Vec, Map,
};

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
    NotFarmer = 10,
    OrderNotDelivered = 11,
    OrderNotDisputed = 12,
    DisputeAlreadyExists = 13,
    NotAdmin = 14,
    NotOrderParticipant = 15,
    InvalidSplitRatio = 16,
    ArithmeticError = 17,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OrderStatus {
    Pending,
    Disputed,
    Completed,
    Refunded,
}

#[contracttype]
#[derive(Clone, Eq, PartialEq)]
pub enum DisputeResolution {
    Refund,
    Release,
    Split(u32),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Order {
    pub buyer: Address,
    pub farmer: Address,
    pub token: Address,
    pub amount: i128,
    pub timestamp: u64,
    pub delivery_timestamp: u64,
    pub status: OrderStatus,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CampaignStatus {
    Active,
    Settled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Investment {
    pub amount:  i128,
    pub claimed: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Campaign {
    pub admin:           Address,
    pub farmer:          Address,
    pub token:           Address,
    pub total_invested:  i128,
    pub return_rate_bps: u32,
    pub created_at:      u64,
    pub settled_at:      Option<u64>,
    pub status:          CampaignStatus,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Dispute {
    pub order_id: u64,
    pub opened_by: Address,
    pub reason: String,
    pub evidence_hash: String,
    pub timestamp: u64,
    pub resolved: bool,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Order(u64),
    Dispute(u64),
    BuyerOrders(Address),
    FarmerOrders(Address),
    OrderCount,
    SupportedTokens,
    Admin,
    FeeCollector,
}

const NINETY_SIX_HOURS_IN_SECONDS: u64 = 96 * 60 * 60;

const TTL_THRESHOLD: u32 = 1000;
const TTL_EXTEND_TO: u32 = 100_000;

fn read_order(env: &Env, order_id: u64) -> Result<Order, EscrowError> {
    env.storage()
        .persistent()
        .get(&DataKey::Order(order_id))
        .ok_or(EscrowError::OrderDoesNotExist)
}

fn write_order(env: &Env, order_id: u64, order: &Order) {
    env.storage().persistent().set(&DataKey::Order(order_id), order);
    env.storage()
        .persistent()
        .extend_ttl(&DataKey::Order(order_id), TTL_THRESHOLD, TTL_EXTEND_TO);
}

fn read_dispute(env: &Env, order_id: u64) -> Result<Dispute, EscrowError> {
    env.storage()
        .persistent()
        .get(&DataKey::Dispute(order_id))
        .ok_or(EscrowError::OrderNotDisputed)
}

fn write_dispute(env: &Env, order_id: u64, dispute: &Dispute) {
    env.storage()
        .persistent()
        .set(&DataKey::Dispute(order_id), dispute);
    env.storage()
        .persistent()
        .extend_ttl(&DataKey::Dispute(order_id), TTL_THRESHOLD, TTL_EXTEND_TO);
}

fn read_admin(env: &Env) -> Result<Address, EscrowError> {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(EscrowError::ContractNotInitialized)
}

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
        let storage = env.storage().instance();
        if storage.has(&DataKey::Admin) {
            return Err(EscrowError::AlreadyInitialized);
        }
        if supported_tokens.len() < 2 {
            return Err(EscrowError::MustSupportTwoTokens);
        }
        storage.set(&DataKey::Admin, &admin);
        storage.set(&DataKey::SupportedTokens, &supported_tokens);
        env.storage().instance().set(&DataKey::FeeCollector, &fee_collector);
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

        let instance_storage = env.storage().instance();

        let supported_tokens: Vec<Address> = instance_storage
            .get(&DataKey::SupportedTokens)
            .ok_or(EscrowError::ContractNotInitialized)?;

        if !supported_tokens.contains(&token) {
            return Err(EscrowError::UnsupportedToken);
        }

        let token_client = token::Client::new(&env, &token);
        
        let fee_collector: Address = env.storage().instance().get(&DataKey::FeeCollector).ok_or(EscrowError::ContractNotInitialized)?;
        let fee = amount * 3 / 100;
        let net_amount = amount - fee;

        token_client.transfer(&buyer, &fee_collector, &fee);
        token_client.transfer(&buyer, &env.current_contract_address(), &net_amount);

        let order_id: u64 = instance_storage
            .get(&DataKey::OrderCount)
            .unwrap_or(0u64)
            + 1;
        instance_storage.set(&DataKey::OrderCount, &order_id);

        let timestamp = env.ledger().timestamp();

        let persistent_storage = env.storage().persistent();
        let order_key = DataKey::Order(order_id);
        let order = Order {
            buyer: buyer.clone(),
            farmer: farmer.clone(),
            token: token.clone(),
            amount: net_amount,
            timestamp,
            delivery_timestamp: 0,
            status: OrderStatus::Pending,
        };

        env.events().publish(
            (symbol_short!("order"), symbol_short!("created")),
            (order_id, buyer.clone(), farmer.clone(), amount, token.clone()),
        );

        persistent_storage.set(&order_key, &order);
        persistent_storage.extend_ttl(&order_key, TTL_THRESHOLD, TTL_EXTEND_TO);

        let buyer_key = DataKey::BuyerOrders(buyer.clone());
        let mut buyer_orders: Vec<u64> = persistent_storage
            .get(&buyer_key)
            .unwrap_or_else(|| Vec::new(&env));
        buyer_orders.push_back(order_id);
        persistent_storage.set(&buyer_key, &buyer_orders);

        let farmer_key = DataKey::FarmerOrders(farmer.clone());
        let mut farmer_orders: Vec<u64> = persistent_storage
            .get(&farmer_key)
            .unwrap_or_else(|| Vec::new(&env));
        farmer_orders.push_back(order_id);
        persistent_storage.set(&farmer_key, &farmer_orders);

        Ok(order_id)
    }

    pub fn mark_delivered(env: Env, farmer: Address, order_id: u64) -> Result<(), EscrowError> {
        farmer.require_auth();

        let mut order = read_order(&env, order_id)?;

        if order.farmer != farmer {
            return Err(EscrowError::NotFarmer);
        }
        if order.status != OrderStatus::Pending {
            return Err(EscrowError::OrderNotPending);
        }

        let delivery_timestamp = env.ledger().timestamp();
        order.delivery_timestamp = delivery_timestamp;

        write_order(&env, order_id, &order);

        env.events().publish(
            (symbol_short!("order"), symbol_short!("delivered")),
            (order_id, farmer, order.buyer, delivery_timestamp),
        );

        Ok(())
    }

    pub fn confirm_receipt(env: Env, buyer: Address, order_id: u64) -> Result<(), EscrowError> {
        buyer.require_auth();

        let mut order = read_order(&env, order_id)?;

        if order.buyer != buyer {
            return Err(EscrowError::NotBuyer);
        }
        if order.status != OrderStatus::Pending {
            return Err(EscrowError::OrderNotPending);
        }

        order.status = OrderStatus::Completed;
        write_order(&env, order_id, &order);

        token::Client::new(&env, &order.token)
            .transfer(&env.current_contract_address(), &order.farmer, &order.amount);

        env.events().publish(
            (symbol_short!("order"), symbol_short!("confirmed")),
            (order_id, order.buyer, order.farmer),
        );

        Ok(())
    }

    pub fn refund_expired_order(env: Env, order_id: u64) -> Result<(), EscrowError> {
        let mut order = read_order(&env, order_id)?;

        if order.status != OrderStatus::Pending {
            return Err(EscrowError::OrderNotPending);
        }

        if env.ledger().timestamp() <= order.timestamp + NINETY_SIX_HOURS_IN_SECONDS {
            return Err(EscrowError::OrderNotExpired);
        }

        order.status = OrderStatus::Refunded;
        write_order(&env, order_id, &order);

        token::Client::new(&env, &order.token)
            .transfer(&env.current_contract_address(), &order.buyer, &order.amount);

        env.events().publish(
            (symbol_short!("order"), symbol_short!("refunded")),
            (order_id, order.buyer),
        );

        Ok(())
    }

    pub fn refund_expired_orders(env: Env, order_ids: Vec<u64>) -> Result<(), EscrowError> {
        let storage = env.storage().persistent();
        let current_time = env.ledger().timestamp();

        for order_id in order_ids.iter() {
            let key = DataKey::Order(order_id);
            let mut order: Order = storage.get(&key).ok_or(EscrowError::OrderDoesNotExist)?;

            if order.status != OrderStatus::Pending {
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

    pub fn open_dispute(
        env: Env,
        opened_by: Address,
        order_id: u64,
        reason: String,
        evidence_hash: String,
    ) -> Result<(), EscrowError> {
        opened_by.require_auth();

        let mut order = read_order(&env, order_id)?;
        if order.status != OrderStatus::Pending {
            return Err(EscrowError::OrderNotPending);
        }
        if opened_by != order.buyer && opened_by != order.farmer {
            return Err(EscrowError::NotOrderParticipant);
        }
        if env.storage().persistent().has(&DataKey::Dispute(order_id)) {
            return Err(EscrowError::DisputeAlreadyExists);
        }

        order.status = OrderStatus::Disputed;
        write_order(&env, order_id, &order);

        let dispute = Dispute {
            order_id,
            opened_by: opened_by.clone(),
            reason,
            evidence_hash,
            timestamp: env.ledger().timestamp(),
            resolved: false,
        };
        write_dispute(&env, order_id, &dispute);

        env.events().publish(
            (symbol_short!("order"), symbol_short!("disputed")),
            (order_id, opened_by, order.buyer, order.farmer),
        );

        Ok(())
    }

    pub fn resolve_dispute(
        env: Env,
        admin: Address,
        order_id: u64,
        resolution: DisputeResolution,
    ) -> Result<(), EscrowError> {
        admin.require_auth();

        let stored_admin = read_admin(&env)?;
        if admin != stored_admin {
            return Err(EscrowError::NotAdmin);
        }

        let mut order = read_order(&env, order_id)?;
        if order.status != OrderStatus::Disputed {
            return Err(EscrowError::OrderNotDisputed);
        }

        let mut dispute = read_dispute(&env, order_id)?;
        if dispute.resolved {
            return Err(EscrowError::OrderNotDisputed);
        }

        let token_client = token::Client::new(&env, &order.token);

        match resolution.clone() {
            DisputeResolution::Refund => {
                order.status = OrderStatus::Refunded;
                token_client.transfer(&env.current_contract_address(), &order.buyer, &order.amount);
            }
            DisputeResolution::Release => {
                order.status = OrderStatus::Completed;
                token_client.transfer(&env.current_contract_address(), &order.farmer, &order.amount);
            }
            DisputeResolution::Split(buyer_share_bps) => {
                if buyer_share_bps > 10_000 {
                    return Err(EscrowError::InvalidSplitRatio);
                }

                let refund_amount = order
                    .amount
                    .checked_mul(buyer_share_bps as i128)
                    .ok_or(EscrowError::ArithmeticError)?
                    / 10_000;
                let release_amount = order.amount - refund_amount;

                if refund_amount > 0 {
                    token_client.transfer(&env.current_contract_address(), &order.buyer, &refund_amount);
                }
                if release_amount > 0 {
                    token_client.transfer(&env.current_contract_address(), &order.farmer, &release_amount);
                }

                order.status = OrderStatus::Completed;
            }
        }

        dispute.resolved = true;
        write_order(&env, order_id, &order);
        write_dispute(&env, order_id, &dispute);

        env.events().publish(
            (symbol_short!("order"), symbol_short!("resolved")),
            (order_id, resolution, order.buyer, order.farmer),
        );

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
        read_order(&env, order_id)
    }

    pub fn get_dispute(env: Env, order_id: u64) -> Result<Dispute, EscrowError> {
        read_dispute(&env, order_id)
    }

    pub fn get_supported_tokens(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::SupportedTokens)
            .unwrap_or_else(|| Vec::new(&env))
    }
}

mod test;