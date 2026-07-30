#![no_std]
use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, symbol_short, token,
    Address, Env, Map, String, Vec,
};

// Errors
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
    OrderNotDisputed = 12,
    DisputeAlreadyExists = 13,
    NotAdmin = 14,
    NotOrderParticipant = 15,
    InvalidSplitRatio = 16,
    ArithmeticError = 17,
    BuyerCannotEqualFarmer = 18,
    TokenWhitelistEmpty = 19,
    FeeRateTooHigh = 20,
    NotGoverned = 21,
    RouterNotConfigured = 22,
    SlippageToleranceExceeded = 23,
    InvalidSlippageTolerance = 24,
    InvalidGovernanceContract = 25,
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
    pub amount: i128,
    pub claimed: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Campaign {
    pub admin: Address,
    pub farmer: Address,
    pub token: Address,
    pub total_invested: i128,
    pub return_rate_bps: u32,
    pub created_at: u64,
    pub settled_at: Option<u64>,
    pub status: CampaignStatus,
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
    /// Configurable fee rate in basis points (Issue #660). Defaults to 300
    /// (3%) when unset, preserving the previously-hardcoded fee behavior.
    FeeRateBps,
    /// Governance contract authorized to change fee/token-whitelist
    /// parameters (Issue #660). Falls back to admin-only while unset.
    GovernanceContract,
    /// Router contract used for cross-token settlement (Issue #591).
    PathPaymentRouter,
    /// Configurable slippage tolerance in basis points for path-payment
    /// settlement (Issue #591). Defaults to 100 (1%) when unset.
    MaxSlippageBps,
    /// On-chain reputation registry (Issue #592). Optional: if unset,
    /// reputation reporting is skipped entirely.
    RegistryContract,
}

/// Cross-contract interface for a Stellar path-payment router (e.g. a Soroswap-style
/// AMM/DEX contract). Soroban contracts cannot invoke the classic
/// `PathPaymentStrictSend` ledger operation directly, so conversion is delegated to a
/// router contract implementing this interface, which performs the strict-send path
/// payment and delivers `dest_token` to `to`.
#[contractclient(name = "PathPaymentRouterClient")]
pub trait PathPaymentRouterTrait {
    /// Sends exactly `send_amount` of `send_token` from `from`, routes it through
    /// Stellar's path-payment-strict-send primitive, and delivers at least
    /// `dest_min` of `dest_token` to `to`. Returns the actual amount of `dest_token`
    /// delivered.
    fn swap_exact_in(
        env: Env,
        from: Address,
        to: Address,
        send_token: Address,
        dest_token: Address,
        send_amount: i128,
        dest_min: i128,
    ) -> i128;

    /// Returns the router's current expected `dest_token` output for converting
    /// `send_amount` of `send_token`, without moving funds. Used as the reference
    /// price against which the contract's configurable slippage tolerance is applied.
    fn get_quote(env: Env, send_token: Address, dest_token: Address, send_amount: i128) -> i128;
}

const NINETY_SIX_HOURS_IN_SECONDS: u64 = 96 * 60 * 60;

const TTL_THRESHOLD: u32 = 1000;
const TTL_EXTEND_TO: u32 = 100_000;

/// Fee rate used before `set_fee_config` has ever been called, matching the
/// previously-hardcoded 3% fee in `create_order`.
const DEFAULT_FEE_RATE_BPS: u32 = 300;

/// Slippage tolerance used before `set_max_slippage_bps` has ever been called.
const DEFAULT_MAX_SLIPPAGE_BPS: u32 = 100; // 1%

fn read_max_slippage_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::MaxSlippageBps)
        .unwrap_or(DEFAULT_MAX_SLIPPAGE_BPS)
}

/// Records bookkeeping (order id, storage, indices, event) for a newly funded order
/// whose settlement-token `net_amount` is already held in escrow.
fn record_new_order(
    env: &Env,
    buyer: Address,
    farmer: Address,
    token: Address,
    net_amount: i128,
    gross_amount: i128,
) -> u64 {
    let instance_storage = env.storage().instance();
    let order_id: u64 = instance_storage.get(&DataKey::OrderCount).unwrap_or(0u64) + 1;
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
        (order_id, buyer.clone(), farmer.clone(), gross_amount, token),
    );

    persistent_storage.set(&order_key, &order);
    persistent_storage.extend_ttl(&order_key, TTL_THRESHOLD, TTL_EXTEND_TO);

    let buyer_key = DataKey::BuyerOrders(buyer.clone());
    let mut buyer_orders: Vec<u64> = persistent_storage
        .get(&buyer_key)
        .unwrap_or_else(|| Vec::new(env));
    buyer_orders.push_back(order_id);
    persistent_storage.set(&buyer_key, &buyer_orders);

    let farmer_key = DataKey::FarmerOrders(farmer);
    let mut farmer_orders: Vec<u64> = persistent_storage
        .get(&farmer_key)
        .unwrap_or_else(|| Vec::new(env));
    farmer_orders.push_back(order_id);
    persistent_storage.set(&farmer_key, &farmer_orders);

    order_id
}

/// Reports an order outcome to the configured reputation registry, if any. Best
/// effort by design: an unconfigured registry (the common case for deployments that
/// don't opt into on-chain reputation) is a no-op, not an error. `disputed_buyer_share_bps`
/// is `None` for a clean `confirm_receipt`, `Some(bps)` for a resolved dispute.
fn report_reputation_outcome(env: &Env, farmer: &Address, disputed_buyer_share_bps: Option<u32>) {
    if let Some(registry) = env
        .storage()
        .instance()
        .get::<_, Address>(&DataKey::RegistryContract)
    {
        registry_client::record_order_outcome(env, &registry, farmer, disputed_buyer_share_bps);
    }
}

/// Minimal registry contract client for the reputation cross-contract call (Issue #592).
/// Uses raw `invoke_contract` rather than a typed client so this crate does not need to
/// depend on the registry crate directly.
mod registry_client {
    use soroban_sdk::{Address, Env, IntoVal, Symbol, Val, Vec};

    pub fn record_order_outcome(
        env: &Env,
        registry: &Address,
        farmer: &Address,
        disputed_buyer_share_bps: Option<u32>,
    ) {
        let func = Symbol::new(env, "record_order_outcome");
        let mut args: Vec<Val> = Vec::new(env);
        args.push_back(env.current_contract_address().into_val(env));
        args.push_back(farmer.clone().into_val(env));
        args.push_back(disputed_buyer_share_bps.into_val(env));
        let _: Val = env.invoke_contract(registry, &func, args);
    }
}

/// Verifies a candidate governance address is a real deployed governance contract
/// (Issue #680), so `set_governance_contract` can't be pointed at an arbitrary
/// admin-controlled address. Uses raw `try_invoke_contract` against a known
/// view function (`get_admin`) rather than a typed client, returning an error
/// instead of trapping so the caller gets a clean `InvalidGovernanceContract`.
mod governance_client {
    use soroban_sdk::{Address, Env, Error as HostError, Symbol, Val, Vec};

    pub fn verify(env: &Env, governance: &Address) -> Result<(), ()> {
        let func = Symbol::new(env, "get_admin");
        let args: Vec<Val> = Vec::new(env);
        match env.try_invoke_contract::<Val, HostError>(governance, &func, args) {
            Ok(_) => Ok(()),
            Err(_) => Err(()),
        }
    }
}

fn read_order(env: &Env, order_id: u64) -> Result<Order, EscrowError> {
    env.storage()
        .persistent()
        .get(&DataKey::Order(order_id))
        .ok_or(EscrowError::OrderDoesNotExist)
}

fn write_order(env: &Env, order_id: u64, order: &Order) {
    env.storage()
        .persistent()
        .set(&DataKey::Order(order_id), order);
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
    env.storage().persistent().extend_ttl(
        &DataKey::Dispute(order_id),
        TTL_THRESHOLD,
        TTL_EXTEND_TO,
    );
}

fn resolve_escrow_dispute_internal(
    env: &Env,
    order_id: u64,
    resolution: DisputeResolution,
) -> Result<(), EscrowError> {
    let mut order = read_order(env, order_id)?;
    let mut dispute = read_dispute(env, order_id)?;
    let token_client = token::Client::new(env, &order.token);

    match resolution.clone() {
        DisputeResolution::Refund => {
            order.status = OrderStatus::Refunded;
            token_client.transfer(&env.current_contract_address(), &order.buyer, &order.amount);
        }
        DisputeResolution::Release => {
            order.status = OrderStatus::Completed;
            token_client.transfer(
                &env.current_contract_address(),
                &order.farmer,
                &order.amount,
            );
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
            let release_amount = order
                .amount
                .checked_sub(refund_amount)
                .ok_or(EscrowError::ArithmeticError)?;
            if refund_amount > 0 {
                token_client.transfer(
                    &env.current_contract_address(),
                    &order.buyer,
                    &refund_amount,
                );
            }
            if release_amount > 0 {
                token_client.transfer(
                    &env.current_contract_address(),
                    &order.farmer,
                    &release_amount,
                );
            }
            order.status = OrderStatus::Completed;
        }
    }

    dispute.resolved = true;
    write_order(env, order_id, &order);
    write_dispute(env, order_id, &dispute);

    env.events().publish(
        (symbol_short!("order"), symbol_short!("resolved")),
        (order_id, resolution, order.buyer, order.farmer),
    );

    Ok(())
}

fn read_admin(env: &Env) -> Result<Address, EscrowError> {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(EscrowError::ContractNotInitialized)
}

/// Enforces that `caller` is the authorized party for governance-gated
/// parameters (Issue #660): the governance contract if one has been set via
/// `set_governance_contract`, otherwise the raw admin as a fallback so a
/// deployment that never configures governance keeps working exactly as
/// before.
fn require_governed_caller(env: &Env, caller: &Address) -> Result<(), EscrowError> {
    if let Some(governance) = env
        .storage()
        .instance()
        .get::<_, Address>(&DataKey::GovernanceContract)
    {
        if *caller != governance {
            return Err(EscrowError::NotGoverned);
        }
        return Ok(());
    }
    let admin_addr = read_admin(env)?;
    if *caller != admin_addr {
        return Err(EscrowError::NotAdmin);
    }
    Ok(())
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
        if supported_tokens.is_empty() {
            return Err(EscrowError::TokenWhitelistEmpty);
        }
        storage.set(&DataKey::Admin, &admin);
        storage.set(&DataKey::SupportedTokens, &supported_tokens);
        env.storage()
            .instance()
            .set(&DataKey::FeeCollector, &fee_collector);
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

        if buyer == farmer {
            return Err(EscrowError::BuyerCannotEqualFarmer);
        }

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

        let fee_collector: Address = env
            .storage()
            .instance()
            .get(&DataKey::FeeCollector)
            .ok_or(EscrowError::ContractNotInitialized)?;

        // Fee rate is configurable via set_fee_config (Issue #660); defaults
        // to the historical hardcoded 3% when never configured.
        let fee_rate_bps: u32 = env
            .storage()
            .instance()
            .get(&DataKey::FeeRateBps)
            .unwrap_or(DEFAULT_FEE_RATE_BPS);
        let fee = amount
            .checked_mul(fee_rate_bps as i128)
            .ok_or(EscrowError::ArithmeticError)?
            / 10_000;
        let net_amount = amount
            .checked_sub(fee)
            .ok_or(EscrowError::ArithmeticError)?;

        token_client.transfer(&buyer, &fee_collector, &fee);
        token_client.transfer(&buyer, &env.current_contract_address(), &net_amount);

        let order_id = record_new_order(&env, buyer, farmer, token, net_amount, amount);

        Ok(order_id)
    }

    /// Cross-token settlement (Issue #591): the buyer funds the order with any
    /// `source_token` they hold. That amount is routed through Stellar's
    /// path-payment-strict-send primitive (via the configured router contract) and
    /// converted into `settlement_token`, which must be on the escrow's supported-token
    /// allow-list. `min_dest_amount` is the buyer's own strict-send floor; the order is
    /// also rejected if the router's actual output falls short of its own quoted price
    /// by more than the contract-wide configurable slippage tolerance.
    pub fn create_order_via_path_payment(
        env: Env,
        buyer: Address,
        farmer: Address,
        source_token: Address,
        source_amount: i128,
        settlement_token: Address,
        min_dest_amount: i128,
    ) -> Result<u64, EscrowError> {
        buyer.require_auth();

        if buyer == farmer {
            return Err(EscrowError::BuyerCannotEqualFarmer);
        }
        if source_amount <= 0 {
            return Err(EscrowError::AmountMustBePositive);
        }
        if min_dest_amount <= 0 {
            return Err(EscrowError::AmountMustBePositive);
        }

        let instance_storage = env.storage().instance();

        let supported_tokens: Vec<Address> = instance_storage
            .get(&DataKey::SupportedTokens)
            .ok_or(EscrowError::ContractNotInitialized)?;
        if !supported_tokens.contains(&settlement_token) {
            return Err(EscrowError::UnsupportedToken);
        }

        let router: Address = instance_storage
            .get(&DataKey::PathPaymentRouter)
            .ok_or(EscrowError::RouterNotConfigured)?;

        let router_client = PathPaymentRouterClient::new(&env, &router);

        // The contract's configurable slippage tolerance is enforced against the
        // router's quoted price at execution time, independent of the buyer-supplied
        // `min_dest_amount` floor. This guards against the buyer's floor being set too
        // loose (or manipulated) — the stricter of the two bounds always wins.
        let quoted_amount =
            router_client.get_quote(&source_token, &settlement_token, &source_amount);
        let max_slippage_bps = read_max_slippage_bps(&env);
        let max_allowed_shortfall = quoted_amount
            .checked_mul(max_slippage_bps as i128)
            .ok_or(EscrowError::ArithmeticError)?
            / 10_000;
        let tolerance_floor = quoted_amount
            .checked_sub(max_allowed_shortfall)
            .ok_or(EscrowError::ArithmeticError)?;
        let effective_min_dest = if min_dest_amount > tolerance_floor {
            min_dest_amount
        } else {
            tolerance_floor
        };

        let dest_received = router_client.swap_exact_in(
            &buyer,
            &env.current_contract_address(),
            &source_token,
            &settlement_token,
            &source_amount,
            &effective_min_dest,
        );

        if dest_received < effective_min_dest {
            return Err(EscrowError::SlippageToleranceExceeded);
        }

        let fee_collector: Address = instance_storage
            .get(&DataKey::FeeCollector)
            .ok_or(EscrowError::ContractNotInitialized)?;

        let fee_rate_bps: u32 = instance_storage
            .get(&DataKey::FeeRateBps)
            .unwrap_or(DEFAULT_FEE_RATE_BPS);
        let fee = dest_received
            .checked_mul(fee_rate_bps as i128)
            .ok_or(EscrowError::ArithmeticError)?
            / 10_000;
        let net_amount = dest_received
            .checked_sub(fee)
            .ok_or(EscrowError::ArithmeticError)?;

        token::Client::new(&env, &settlement_token).transfer(
            &env.current_contract_address(),
            &fee_collector,
            &fee,
        );

        let order_id = record_new_order(
            &env,
            buyer,
            farmer,
            settlement_token,
            net_amount,
            dest_received,
        );

        Ok(order_id)
    }

    pub fn set_path_payment_router(
        env: Env,
        admin: Address,
        router: Address,
    ) -> Result<(), EscrowError> {
        admin.require_auth();
        let stored_admin = read_admin(&env)?;
        if admin != stored_admin {
            return Err(EscrowError::NotAdmin);
        }
        env.storage()
            .instance()
            .set(&DataKey::PathPaymentRouter, &router);
        Ok(())
    }

    pub fn set_max_slippage_bps(
        env: Env,
        admin: Address,
        max_slippage_bps: u32,
    ) -> Result<(), EscrowError> {
        admin.require_auth();
        let stored_admin = read_admin(&env)?;
        if admin != stored_admin {
            return Err(EscrowError::NotAdmin);
        }
        if max_slippage_bps > 10_000 {
            return Err(EscrowError::InvalidSlippageTolerance);
        }
        env.storage()
            .instance()
            .set(&DataKey::MaxSlippageBps, &max_slippage_bps);
        Ok(())
    }

    pub fn get_max_slippage_bps(env: Env) -> u32 {
        read_max_slippage_bps(&env)
    }

    /// Configures the on-chain reputation registry (Issue #592). Once set, every
    /// `confirm_receipt` and `resolve_dispute` call reports its outcome to the
    /// registry so the farmer's `reputation_score` there stays in sync. Optional:
    /// if unset, the escrow behaves exactly as before and reputation is not tracked.
    pub fn set_registry_contract(
        env: Env,
        admin: Address,
        registry: Address,
    ) -> Result<(), EscrowError> {
        admin.require_auth();
        let stored_admin = read_admin(&env)?;
        if admin != stored_admin {
            return Err(EscrowError::NotAdmin);
        }
        env.storage()
            .instance()
            .set(&DataKey::RegistryContract, &registry);
        Ok(())
    }

    pub fn get_registry_contract(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::RegistryContract)
    }

    pub fn mark_delivered(env: Env, farmer: Address, order_id: u64) -> Result<(), EscrowError> {
        farmer.require_auth();

        let mut order = read_order(&env, order_id)?;

        if order.farmer != farmer {
            return Err(EscrowError::NotFarmer);
        }
        if order.status != OrderStatus::Pending || order.delivery_timestamp > 0 {
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

        token::Client::new(&env, &order.token).transfer(
            &env.current_contract_address(),
            &order.farmer,
            &order.amount,
        );

        report_reputation_outcome(&env, &order.farmer, None);

        env.events().publish(
            (symbol_short!("order"), symbol_short!("confirmed")),
            (order_id, order.buyer, order.farmer),
        );

        Ok(())
    }

    pub fn refund_expired_order(env: Env, caller: Address, order_id: u64) -> Result<(), EscrowError> {
        caller.require_auth();
        let mut order = read_order(&env, order_id)?;
        if order.buyer != caller {
            return Err(EscrowError::NotBuyer);
        }

        if order.status != OrderStatus::Pending {
            return Err(EscrowError::OrderNotPending);
        }

        if order.delivery_timestamp != 0 {
            return Err(EscrowError::OrderNotDelivered);
        }

        if env.ledger().timestamp() <= order.timestamp + NINETY_SIX_HOURS_IN_SECONDS {
            return Err(EscrowError::OrderNotExpired);
        }

        order.status = OrderStatus::Refunded;
        write_order(&env, order_id, &order);

        token::Client::new(&env, &order.token).transfer(
            &env.current_contract_address(),
            &order.buyer,
            &order.amount,
        );

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

            if order.delivery_timestamp != 0 {
                return Err(EscrowError::OrderNotDelivered);
            }

            if current_time <= order.timestamp + NINETY_SIX_HOURS_IN_SECONDS {
                return Err(EscrowError::OrderNotExpired);
            }

            order.status = OrderStatus::Refunded;
            storage.set(&key, &order);
            storage.extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);

            token::Client::new(&env, &order.token).transfer(
                &env.current_contract_address(),
                &order.buyer,
                &order.amount,
            );

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

        let order = read_order(&env, order_id)?;
        if order.status != OrderStatus::Disputed {
            return Err(EscrowError::OrderNotDisputed);
        }

        let dispute = read_dispute(&env, order_id)?;
        if dispute.resolved {
            return Err(EscrowError::OrderNotDisputed);
        }

        resolve_escrow_dispute_internal(&env, order_id, resolution)
    }

        let buyer_share_bps: u32;

        match resolution.clone() {
            DisputeResolution::Refund => {
                order.status = OrderStatus::Refunded;
                token_client.transfer(&env.current_contract_address(), &order.buyer, &order.amount);
                buyer_share_bps = 10_000;
            }
            DisputeResolution::Release => {
                order.status = OrderStatus::Completed;
                token_client.transfer(
                    &env.current_contract_address(),
                    &order.farmer,
                    &order.amount,
                );
                buyer_share_bps = 0;
            }
            DisputeResolution::Split(split_bps) => {
                if split_bps > 10_000 {
                    return Err(EscrowError::InvalidSplitRatio);
                }
                buyer_share_bps = split_bps;

                let refund_amount = order
                    .amount
                    .checked_mul(buyer_share_bps as i128)
                    .ok_or(EscrowError::ArithmeticError)?
                    / 10_000;
                let release_amount = order
                    .amount
                    .checked_sub(refund_amount)
                    .ok_or(EscrowError::ArithmeticError)?;

                if refund_amount > 0 {
                    token_client.transfer(
                        &env.current_contract_address(),
                        &order.buyer,
                        &refund_amount,
                    );
                }
                if release_amount > 0 {
                    token_client.transfer(
                        &env.current_contract_address(),
                        &order.farmer,
                        &release_amount,
                    );
                }

                order.status = OrderStatus::Completed;
            }
        }
        env.storage().instance().set(&DataKey::Arbitrators, &arbitrators);
        env.storage().instance().set(&DataKey::Quorum, &quorum);
        Ok(())
    }

    pub fn get_arbitrators(env: Env) -> Vec<Address> {
        env.storage().instance().get(&DataKey::Arbitrators).unwrap_or_else(|| Vec::new(&env))
    }

    pub fn get_quorum(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Quorum).unwrap_or(0)
    }

    pub fn vote_to_resolve(
        env: Env,
        arbitrator: Address,
        order_id: u64,
        resolution: DisputeResolution,
    ) -> Result<(), EscrowError> {
        arbitrator.require_auth();

        let arbitrators: Vec<Address> = env.storage().instance()
            .get(&DataKey::Arbitrators)
            .ok_or(EscrowError::ArbitrationNotConfigured)?;

        let is_valid_arbitrator = arbitrators.iter().any(|a| a == arbitrator);
        if !is_valid_arbitrator {
            return Err(EscrowError::ArbitratorNotFound);
        }

        let order = read_order(&env, order_id)?;
        if order.status != OrderStatus::Disputed {
            return Err(EscrowError::OrderNotDisputed);
        }

        let vote_key = DataKey::ArbitratorVote(order_id, arbitrator.clone());
        if env.storage().persistent().has(&vote_key) {
            return Err(EscrowError::AlreadyVoted);
        }

        env.storage().persistent().set(&vote_key, &resolution);

        let quorum: u32 = env.storage().instance().get(&DataKey::Quorum).unwrap_or(0);
        let mut yes_votes: u32 = 0;
        for a in arbitrators.iter() {
            if env.storage().persistent().has(&DataKey::ArbitratorVote(order_id, a)) {
                yes_votes += 1;
            }
        }

        if yes_votes >= quorum {
            resolve_escrow_dispute_internal(&env, order_id, resolution)?;
        }

        Ok(())
    }

    // ── Governance-gated parameter setters (Issue #660) ──────────────────────
    // This legacy contract previously hardcoded its 3% fee directly in
    // create_order with no setter at all. These setters expose the fee rate
    // and token whitelist as configurable parameters, gated the same way as
    // production_escrow: the governance contract once configured, admin-only
    // fallback until then.

    /// Set (or update) the governance contract address. Admin-only for the
    /// initial bootstrap while no governance is configured (Issue #680); once
    /// set, only the governance contract itself can re-point this, so the raw
    /// admin key can no longer unilaterally seize control back. `governance`
    /// must be a live contract implementing the expected interface — this is
    /// checked via a known view-function call before it's accepted.
    pub fn set_governance_contract(
        env: Env,
        admin_caller: Address,
        governance: Address,
    ) -> Result<(), EscrowError> {
        admin_caller.require_auth();
        require_governed_caller(&env, &admin_caller)?;
        governance_client::verify(&env, &governance)
            .map_err(|_| EscrowError::InvalidGovernanceContract)?;
        env.storage()
            .instance()
            .set(&DataKey::GovernanceContract, &governance);
        Ok(())
    }

    /// Update the fee rate (basis points) and fee collector. Governance-gated
    /// once a governance contract is configured (Issue #660).
    pub fn set_fee_config(
        env: Env,
        admin_caller: Address,
        fee_collector: Address,
        fee_rate_bps: u32,
    ) -> Result<(), EscrowError> {
        admin_caller.require_auth();
        require_governed_caller(&env, &admin_caller)?;
        if fee_rate_bps > 10_000 {
            return Err(EscrowError::FeeRateTooHigh);
        }
        env.storage()
            .instance()
            .set(&DataKey::FeeCollector, &fee_collector);
        env.storage()
            .instance()
            .set(&DataKey::FeeRateBps, &fee_rate_bps);
        Ok(())
    }

    /// Update the supported token whitelist. Governance-gated once a
    /// governance contract is configured (Issue #660).
    pub fn set_supported_tokens(
        env: Env,
        admin_caller: Address,
        supported_tokens: Vec<Address>,
    ) -> Result<(), EscrowError> {
        admin_caller.require_auth();
        require_governed_caller(&env, &admin_caller)?;
        if supported_tokens.len() < 2 {
            return Err(EscrowError::MustSupportTwoTokens);
        }
        env.storage()
            .instance()
            .set(&DataKey::SupportedTokens, &supported_tokens);
        Ok(())
    }

    pub fn get_fee_rate_bps(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::FeeRateBps)
            .unwrap_or(DEFAULT_FEE_RATE_BPS)
    }

    pub fn get_governance_contract(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::GovernanceContract)
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

    // ── Access Control Getters (Issue #275) ──────────────────────────────────

    pub fn get_admin(env: Env) -> Result<Address, EscrowError> {
        read_admin(&env)
    }

    pub fn get_fee_collector(env: Env) -> Result<Address, EscrowError> {
        env.storage()
            .instance()
            .get(&DataKey::FeeCollector)
            .ok_or(EscrowError::ContractNotInitialized)
    }

    pub fn get_order_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::OrderCount)
            .unwrap_or(0)
    }
}

mod test;
