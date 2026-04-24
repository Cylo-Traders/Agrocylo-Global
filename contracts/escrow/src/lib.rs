#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, symbol_short,
    Address, Env, String, Vec,
};

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
    NotFarmer = 10,
    OrderNotDelivered = 11,
    MissingEvidence = 12,
    DisputeAlreadyResolved = 13,
    NotAdmin = 14,
    DisputeDoesNotExist = 15,
    OrderAlreadyDisputed = 16,
    OrderNotDisputable = 17,
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
pub enum DisputeResolution {
    FullSuccess,
    PartialSettlement { farmer_bps: u32 },
    FullRefund,
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
    Dispute(u64),
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
            token,
            amount,
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

    /// Opens a dispute for an active order. Caller must be the buyer or farmer.
    /// Requires a non-empty evidence_hash (issue #125: Validate Evidence Requirement).
    pub fn open_dispute(
        env: Env,
        caller: Address,
        order_id: u64,
        reason: String,
        evidence_hash: String,
    ) -> Result<(), EscrowError> {
        caller.require_auth();

        if evidence_hash.len() == 0 {
            return Err(EscrowError::MissingEvidence);
        }

        let mut order: Order = env
            .storage()
            .persistent()
            .get(&DataKey::Order(order_id))
            .ok_or(EscrowError::OrderDoesNotExist)?;

        if order.status == OrderStatus::Disputed {
            return Err(EscrowError::OrderAlreadyDisputed);
        }

        if order.status != OrderStatus::Pending && order.status != OrderStatus::Delivered {
            return Err(EscrowError::OrderNotDisputable);
        }

        if order.buyer != caller && order.farmer != caller {
            return Err(EscrowError::NotBuyer);
        }

        order.status = OrderStatus::Disputed;
        env.storage().persistent().set(&DataKey::Order(order_id), &order);
        env.storage().persistent().extend_ttl(&DataKey::Order(order_id), 1000, 100000);

        let dispute = Dispute {
            order_id,
            opened_by: caller,
            reason,
            evidence_hash,
            timestamp: env.ledger().timestamp(),
            resolved: false,
        };

        env.storage().persistent().set(&DataKey::Dispute(order_id), &dispute);
        env.storage().persistent().extend_ttl(&DataKey::Dispute(order_id), 1000, 100000);

        env.events().publish(
            (symbol_short!("dispute"), symbol_short!("opened")),
            (order_id,),
        );

        Ok(())
    }

    /// Resolves a campaign dispute. Only the admin can call this.
    /// Prevents double resolution (issue #126: Prevent Double Resolution).
    /// Distributes funds according to the resolution outcome (issue #138).
    pub fn resolve_campaign_dispute(
        env: Env,
        admin: Address,
        order_id: u64,
        resolution: DisputeResolution,
    ) -> Result<(), EscrowError> {
        admin.require_auth();

        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(EscrowError::ContractNotInitialized)?;

        if stored_admin != admin {
            return Err(EscrowError::NotAdmin);
        }

        let order: Order = env
            .storage()
            .persistent()
            .get(&DataKey::Order(order_id))
            .ok_or(EscrowError::OrderDoesNotExist)?;

        let mut dispute: Dispute = env
            .storage()
            .persistent()
            .get(&DataKey::Dispute(order_id))
            .ok_or(EscrowError::DisputeDoesNotExist)?;

        if dispute.resolved {
            return Err(EscrowError::DisputeAlreadyResolved);
        }

        let token_client = token::Client::new(&env, &order.token);

        match resolution {
            DisputeResolution::FullSuccess => {
                token_client.transfer(
                    &env.current_contract_address(),
                    &order.farmer,
                    &order.amount,
                );
            }
            DisputeResolution::PartialSettlement { farmer_bps } => {
                let farmer_amount = order.amount * farmer_bps as i128 / 10000;
                let buyer_amount = order.amount - farmer_amount;
                if farmer_amount > 0 {
                    token_client.transfer(
                        &env.current_contract_address(),
                        &order.farmer,
                        &farmer_amount,
                    );
                }
                if buyer_amount > 0 {
                    token_client.transfer(
                        &env.current_contract_address(),
                        &order.buyer,
                        &buyer_amount,
                    );
                }
            }
            DisputeResolution::FullRefund => {
                token_client.transfer(
                    &env.current_contract_address(),
                    &order.buyer,
                    &order.amount,
                );
            }
        }

        dispute.resolved = true;
        env.storage().persistent().set(&DataKey::Dispute(order_id), &dispute);

        env.events().publish(
            (symbol_short!("dispute"), symbol_short!("resolved")),
            (order_id,),
        );

        Ok(())
    }

    pub fn get_dispute(env: Env, order_id: u64) -> Result<Dispute, EscrowError> {
        env.storage()
            .persistent()
            .get(&DataKey::Dispute(order_id))
            .ok_or(EscrowError::DisputeDoesNotExist)
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
}

mod test;
