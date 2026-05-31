#![cfg(test)]
// Note: DisputeResolution::Split expects basis points (0-10000), where 5000 = 50%, 10000 = 100%.

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env,
};

const INITIAL_BUYER_BALANCE: i128 = 10_000;
const ORDER_EXPIRY_SECONDS: u64 = 345_601;

struct EscrowTestContext {
    env: Env,
    client: EscrowContractClient<'static>,
    admin: Address,
    buyer: Address,
    farmer: Address,
    fee_collector: Address,
    token: token::Client<'static>,
    second_token: token::Client<'static>,
}

impl EscrowTestContext {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1);

        let admin = Address::generate(&env);
        let farmer = Address::generate(&env);
        let buyer = Address::generate(&env);
        let token_admin = Address::generate(&env);

        let xlm_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token = token::Client::new(&env, &xlm_contract.address());
        let token_admin_client = token::StellarAssetClient::new(&env, &xlm_contract.address());
        token_admin_client.mint(&buyer, &INITIAL_BUYER_BALANCE);

        let usdc_contract = env.register_stellar_asset_contract_v2(token_admin);
        let second_token = token::Client::new(&env, &usdc_contract.address());

        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let mut supported_tokens = Vec::new(&env);
        supported_tokens.push_back(token.address.clone());
        supported_tokens.push_back(second_token.address.clone());

        let fee_collector = Address::generate(&env);
        client.initialize(&admin, &fee_collector, &supported_tokens);

        Self {
            env,
            client,
            admin,
            buyer,
            farmer,
            fee_collector,
            token,
            second_token,
        }
    }

    fn mint_to(&self, address: &Address, amount: i128) {
        let token_admin_client = token::StellarAssetClient::new(&self.env, &self.token.address);
        token_admin_client.mint(address, &amount);
    }

    fn create_order(&self, amount: i128) -> u64 {
        self.client.mock_all_auths().create_order(
            &self.buyer,
            &self.farmer,
            &self.token.address,
            &amount,
        )
    }

    fn open_dispute(&self, order_id: u64, opened_by: &Address) {
        let reason = String::from_str(&self.env, "Produce quality dispute");
        let evidence_hash = String::from_str(&self.env, "QmEvidenceHash");
        self.client
            .mock_all_auths()
            .open_dispute(opened_by, &order_id, &reason, &evidence_hash);
    }

    fn expire_orders(&self) {
        self.env
            .ledger()
            .set_timestamp(self.env.ledger().timestamp() + ORDER_EXPIRY_SECONDS);
    }
}

fn fee(amount: i128) -> i128 {
    amount * 3 / 100
}

fn net(amount: i128) -> i128 {
    amount - fee(amount)
}

#[test]
fn test_create_and_confirm_order() {
    let ctx = EscrowTestContext::new();

    let order_id = ctx.create_order(500);
    assert_eq!(order_id, 1);

    let order = ctx.client.get_order_details(&order_id);
    assert_eq!(order.status, OrderStatus::Pending);
    assert_eq!(order.delivery_timestamp, 0);
    assert_eq!(order.amount, net(500));
    assert_eq!(ctx.token.balance(&ctx.fee_collector), fee(500));
    assert_eq!(ctx.token.balance(&ctx.client.address), net(500));

    ctx.client
        .mock_all_auths()
        .confirm_receipt(&ctx.buyer, &order_id);

    let completed = ctx.client.get_order_details(&order_id);
    assert_eq!(completed.status, OrderStatus::Completed);
    assert_eq!(ctx.token.balance(&ctx.client.address), 0);
    assert_eq!(ctx.token.balance(&ctx.farmer), net(500));
}

#[test]
fn test_basic_escrow_happy_path_tracks_state_balances_and_events() {
    let ctx = EscrowTestContext::new();

    let order_id = ctx.create_order(500);
    let order = ctx.client.get_order_details(&order_id);

    assert_eq!(order.buyer, ctx.buyer);
    assert_eq!(order.farmer, ctx.farmer);
    assert_eq!(ctx.token.balance(&ctx.buyer), INITIAL_BUYER_BALANCE - 500);
    assert_eq!(ctx.token.balance(&ctx.fee_collector), fee(500));
    assert_eq!(ctx.token.balance(&ctx.client.address), net(500));

    ctx.client
        .mock_all_auths()
        .mark_delivered(&ctx.farmer, &order_id);
    let delivered = ctx.client.get_order_details(&order_id);
    assert_eq!(delivered.status, OrderStatus::Pending);
    assert!(delivered.delivery_timestamp > 0);

    ctx.client
        .mock_all_auths()
        .confirm_receipt(&ctx.buyer, &order_id);
    assert_eq!(ctx.token.balance(&ctx.farmer), net(500));
}

#[test]
fn test_mark_delivered_wrong_farmer_fails() {
    let ctx = EscrowTestContext::new();
    let fake_farmer = Address::generate(&ctx.env);
    let order_id = ctx.create_order(500);

    let result = ctx
        .client
        .mock_all_auths()
        .try_mark_delivered(&fake_farmer, &order_id);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::NotFarmer);
}

#[test]
fn test_mark_delivered_twice_fails() {
    let ctx = EscrowTestContext::new();
    let order_id = ctx.create_order(500);

    ctx.client
        .mock_all_auths()
        .mark_delivered(&ctx.farmer, &order_id);

    let result = ctx
        .client
        .mock_all_auths()
        .try_mark_delivered(&ctx.farmer, &order_id);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::OrderNotPending);
}

#[test]
fn test_confirm_without_mark_delivered() {
    let ctx = EscrowTestContext::new();
    let order_id = ctx.create_order(500);

    ctx.client
        .mock_all_auths()
        .confirm_receipt(&ctx.buyer, &order_id);

    assert_eq!(
        ctx.client.get_order_details(&order_id).status,
        OrderStatus::Completed
    );
}

#[test]
fn test_confirm_already_completed() {
    let ctx = EscrowTestContext::new();
    let order_id = ctx.create_order(500);
    ctx.client
        .mock_all_auths()
        .confirm_receipt(&ctx.buyer, &order_id);

    let result = ctx
        .client
        .mock_all_auths()
        .try_confirm_receipt(&ctx.buyer, &order_id);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::OrderNotPending);
}

#[test]
fn test_refund_expired_order() {
    let ctx = EscrowTestContext::new();
    let order_id = ctx.create_order(500);
    ctx.expire_orders();

    ctx.client.mock_all_auths().refund_expired_order(&order_id);

    let order = ctx.client.get_order_details(&order_id);
    assert_eq!(order.status, OrderStatus::Refunded);
    assert_eq!(
        ctx.token.balance(&ctx.buyer),
        INITIAL_BUYER_BALANCE - fee(500)
    );
    assert_eq!(ctx.token.balance(&ctx.client.address), 0);
    assert_eq!(ctx.token.balance(&ctx.farmer), 0);
}

#[test]
fn test_refund_unexpired_order_fails() {
    let ctx = EscrowTestContext::new();
    let order_id = ctx.create_order(500);
    ctx.env
        .ledger()
        .set_timestamp(ctx.env.ledger().timestamp() + 3_600);

    let result = ctx
        .client
        .mock_all_auths()
        .try_refund_expired_order(&order_id);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::OrderNotExpired);
}

#[test]
fn test_batch_refund_expired_orders() {
    let ctx = EscrowTestContext::new();
    let first_order_id = ctx.create_order(200);
    let second_order_id = ctx.create_order(300);

    assert_eq!(ctx.token.balance(&ctx.buyer), INITIAL_BUYER_BALANCE - 500);
    assert_eq!(ctx.token.balance(&ctx.client.address), net(200) + net(300));

    ctx.expire_orders();
    let mut order_ids = Vec::new(&ctx.env);
    order_ids.push_back(first_order_id);
    order_ids.push_back(second_order_id);
    ctx.client
        .mock_all_auths()
        .refund_expired_orders(&order_ids);

    assert_eq!(
        ctx.client.get_order_details(&first_order_id).status,
        OrderStatus::Refunded
    );
    assert_eq!(
        ctx.client.get_order_details(&second_order_id).status,
        OrderStatus::Refunded
    );
    assert_eq!(
        ctx.token.balance(&ctx.buyer),
        INITIAL_BUYER_BALANCE - fee(200) - fee(300)
    );
    assert_eq!(ctx.token.balance(&ctx.client.address), 0);
}

#[test]
fn test_create_order_unsupported_token_fails() {
    let ctx = EscrowTestContext::new();
    let unsupported_token_admin = Address::generate(&ctx.env);
    let unsupported_contract = ctx
        .env
        .register_stellar_asset_contract_v2(unsupported_token_admin);
    let unsupported_client = token::Client::new(&ctx.env, &unsupported_contract.address());

    let result = ctx.client.mock_all_auths().try_create_order(
        &ctx.buyer,
        &ctx.farmer,
        &unsupported_client.address,
        &500,
    );
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::UnsupportedToken);
}

#[test]
fn test_platform_fee_acceptance_criteria() {
    let ctx = EscrowTestContext::new();

    let order_id = ctx.create_order(1_000);

    assert_eq!(ctx.token.balance(&ctx.fee_collector), 30);
    assert_eq!(ctx.client.get_order_details(&order_id).amount, 970);

    ctx.client
        .mock_all_auths()
        .confirm_receipt(&ctx.buyer, &order_id);
    assert_eq!(ctx.token.balance(&ctx.farmer), 970);
}

#[test]
fn test_concurrent_order_creation() {
    let ctx = EscrowTestContext::new();
    let buyer2 = Address::generate(&ctx.env);
    let buyer3 = Address::generate(&ctx.env);
    ctx.mint_to(&buyer2, 1_000);
    ctx.mint_to(&buyer3, 1_000);

    let order_id1 =
        ctx.client
            .mock_all_auths()
            .create_order(&ctx.buyer, &ctx.farmer, &ctx.token.address, &100);
    let order_id2 =
        ctx.client
            .mock_all_auths()
            .create_order(&buyer2, &ctx.farmer, &ctx.token.address, &200);
    let order_id3 =
        ctx.client
            .mock_all_auths()
            .create_order(&buyer3, &ctx.farmer, &ctx.token.address, &300);

    assert_eq!(order_id1, 1);
    assert_eq!(order_id2, 2);
    assert_eq!(order_id3, 3);
    assert_eq!(ctx.client.get_order_details(&order_id1).amount, net(100));
    assert_eq!(ctx.client.get_order_details(&order_id2).amount, net(200));
    assert_eq!(ctx.client.get_order_details(&order_id3).amount, net(300));
    assert_eq!(ctx.client.get_orders_by_buyer(&ctx.buyer).len(), 1);
    assert_eq!(
        ctx.client.get_orders_by_buyer(&buyer2).get(0).unwrap(),
        order_id2
    );
    assert_eq!(
        ctx.client.get_orders_by_buyer(&buyer3).get(0).unwrap(),
        order_id3
    );
    assert_eq!(
        ctx.token.balance(&ctx.fee_collector),
        fee(100) + fee(200) + fee(300)
    );
}

#[test]
fn test_concurrent_order_confirmation() {
    let ctx = EscrowTestContext::new();
    let buyer2 = Address::generate(&ctx.env);
    let farmer2 = Address::generate(&ctx.env);
    ctx.mint_to(&buyer2, 1_000);

    let order_id1 = ctx.create_order(100);
    let order_id2 =
        ctx.client
            .mock_all_auths()
            .create_order(&buyer2, &farmer2, &ctx.token.address, &200);

    ctx.client
        .mock_all_auths()
        .confirm_receipt(&ctx.buyer, &order_id1);
    ctx.client
        .mock_all_auths()
        .confirm_receipt(&buyer2, &order_id2);

    assert_eq!(
        ctx.client.get_order_details(&order_id1).status,
        OrderStatus::Completed
    );
    assert_eq!(
        ctx.client.get_order_details(&order_id2).status,
        OrderStatus::Completed
    );
    assert_eq!(ctx.token.balance(&ctx.farmer), net(100));
    assert_eq!(ctx.token.balance(&farmer2), net(200));
    assert_eq!(ctx.token.balance(&ctx.client.address), 0);
}

#[test]
fn test_concurrent_operations_on_same_order() {
    let ctx = EscrowTestContext::new();
    let order_id = ctx.create_order(500);

    ctx.client
        .mock_all_auths()
        .confirm_receipt(&ctx.buyer, &order_id);

    let confirm_again = ctx
        .client
        .mock_all_auths()
        .try_confirm_receipt(&ctx.buyer, &order_id);
    assert_eq!(
        confirm_again.unwrap_err().unwrap(),
        EscrowError::OrderNotPending
    );

    ctx.expire_orders();
    let refund_completed = ctx
        .client
        .mock_all_auths()
        .try_refund_expired_order(&order_id);
    assert_eq!(
        refund_completed.unwrap_err().unwrap(),
        EscrowError::OrderNotPending
    );
    assert_eq!(ctx.token.balance(&ctx.farmer), net(500));
}

#[test]
fn test_concurrent_refund_operations() {
    let ctx = EscrowTestContext::new();
    let buyer2 = Address::generate(&ctx.env);
    let farmer2 = Address::generate(&ctx.env);
    ctx.mint_to(&buyer2, 1_000);

    let order_id1 = ctx.create_order(100);
    let order_id2 =
        ctx.client
            .mock_all_auths()
            .create_order(&buyer2, &farmer2, &ctx.token.address, &200);

    ctx.expire_orders();
    ctx.client.mock_all_auths().refund_expired_order(&order_id1);
    ctx.client.mock_all_auths().refund_expired_order(&order_id2);

    assert_eq!(
        ctx.client.get_order_details(&order_id1).status,
        OrderStatus::Refunded
    );
    assert_eq!(
        ctx.client.get_order_details(&order_id2).status,
        OrderStatus::Refunded
    );
    assert_eq!(
        ctx.token.balance(&ctx.buyer),
        INITIAL_BUYER_BALANCE - fee(100)
    );
    assert_eq!(ctx.token.balance(&buyer2), 1_000 - fee(200));
    assert_eq!(ctx.token.balance(&ctx.client.address), 0);
}

#[test]
fn test_batch_refund_concurrent_safety() {
    let ctx = EscrowTestContext::new();
    let order_id1 = ctx.create_order(100);
    let order_id2 = ctx.create_order(200);
    let order_id3 = ctx.create_order(300);

    ctx.expire_orders();
    let mut order_ids = Vec::new(&ctx.env);
    order_ids.push_back(order_id1);
    order_ids.push_back(order_id2);
    order_ids.push_back(order_id3);
    ctx.client
        .mock_all_auths()
        .refund_expired_orders(&order_ids);

    assert_eq!(
        ctx.client.get_order_details(&order_id1).status,
        OrderStatus::Refunded
    );
    assert_eq!(
        ctx.client.get_order_details(&order_id2).status,
        OrderStatus::Refunded
    );
    assert_eq!(
        ctx.client.get_order_details(&order_id3).status,
        OrderStatus::Refunded
    );
    assert_eq!(
        ctx.token.balance(&ctx.buyer),
        INITIAL_BUYER_BALANCE - fee(100) - fee(200) - fee(300)
    );
}

#[test]
fn test_state_consistency_after_concurrent_operations() {
    let ctx = EscrowTestContext::new();
    let order_id1 = ctx.create_order(100);
    let order_id2 = ctx.create_order(200);

    ctx.client
        .mock_all_auths()
        .confirm_receipt(&ctx.buyer, &order_id1);
    ctx.expire_orders();
    ctx.client.mock_all_auths().refund_expired_order(&order_id2);

    assert_eq!(
        ctx.client.get_order_details(&order_id1).status,
        OrderStatus::Completed
    );
    assert_eq!(
        ctx.client.get_order_details(&order_id2).status,
        OrderStatus::Refunded
    );
    assert_eq!(ctx.token.balance(&ctx.client.address), 0);
    assert_eq!(ctx.token.balance(&ctx.farmer), net(100));
    assert_eq!(
        ctx.token.balance(&ctx.buyer),
        INITIAL_BUYER_BALANCE - 100 - fee(200)
    );
    assert_eq!(ctx.token.balance(&ctx.fee_collector), fee(100) + fee(200));
    assert_eq!(ctx.client.get_orders_by_buyer(&ctx.buyer).len(), 2);
    assert_eq!(ctx.client.get_orders_by_farmer(&ctx.farmer).len(), 2);
}

#[test]
fn test_get_orders_by_buyer() {
    let ctx = EscrowTestContext::new();
    let order_id1 = ctx.create_order(100);
    let order_id2 = ctx.create_order(200);
    let order_id3 = ctx.create_order(300);

    let buyer_orders = ctx.client.get_orders_by_buyer(&ctx.buyer);
    assert_eq!(buyer_orders.len(), 3);
    assert_eq!(buyer_orders.get(0).unwrap(), order_id1);
    assert_eq!(buyer_orders.get(1).unwrap(), order_id2);
    assert_eq!(buyer_orders.get(2).unwrap(), order_id3);
}

#[test]
fn test_get_orders_by_farmer() {
    let ctx = EscrowTestContext::new();
    let order_id1 = ctx.create_order(100);
    let order_id2 = ctx.create_order(200);

    let farmer_orders = ctx.client.get_orders_by_farmer(&ctx.farmer);
    assert_eq!(farmer_orders.len(), 2);
    assert_eq!(farmer_orders.get(0).unwrap(), order_id1);
    assert_eq!(farmer_orders.get(1).unwrap(), order_id2);
}

#[test]
fn test_get_order_count() {
    let ctx = EscrowTestContext::new();

    assert_eq!(ctx.client.get_order_count(), 0);
    ctx.create_order(500);
    assert_eq!(ctx.client.get_order_count(), 1);
    ctx.create_order(300);
    assert_eq!(ctx.client.get_order_count(), 2);
}

#[test]
fn test_open_dispute_by_buyer() {
    let ctx = EscrowTestContext::new();
    let order_id = ctx.create_order(500);
    let reason = String::from_str(&ctx.env, "Late delivery");
    let evidence_hash = String::from_str(&ctx.env, "QmBuyerEvidence");

    ctx.client
        .mock_all_auths()
        .open_dispute(&ctx.buyer, &order_id, &reason, &evidence_hash);

    let order = ctx.client.get_order_details(&order_id);
    let dispute = ctx.client.get_dispute(&order_id);
    assert_eq!(order.status, OrderStatus::Disputed);
    assert_eq!(dispute.order_id, order_id);
    assert_eq!(dispute.opened_by, ctx.buyer);
    assert_eq!(dispute.reason, reason);
    assert_eq!(dispute.evidence_hash, evidence_hash);
    assert!(!dispute.resolved);
}

#[test]
fn test_open_dispute_by_farmer() {
    let ctx = EscrowTestContext::new();
    let order_id = ctx.create_order(500);
    let reason = String::from_str(&ctx.env, "Buyer is unresponsive");
    let evidence_hash = String::from_str(&ctx.env, "QmFarmerEvidence");

    ctx.client
        .mock_all_auths()
        .open_dispute(&ctx.farmer, &order_id, &reason, &evidence_hash);

    let dispute = ctx.client.get_dispute(&order_id);
    assert_eq!(
        ctx.client.get_order_details(&order_id).status,
        OrderStatus::Disputed
    );
    assert_eq!(dispute.opened_by, ctx.farmer);
    assert_eq!(dispute.resolved, false);
}

#[test]
fn test_open_dispute_not_pending_fails() {
    let ctx = EscrowTestContext::new();
    let order_id = ctx.create_order(500);
    ctx.client
        .mock_all_auths()
        .confirm_receipt(&ctx.buyer, &order_id);

    let reason = String::from_str(&ctx.env, "Too late");
    let evidence_hash = String::from_str(&ctx.env, "QmHash");
    let result = ctx.client.mock_all_auths().try_open_dispute(
        &ctx.buyer,
        &order_id,
        &reason,
        &evidence_hash,
    );
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::OrderNotPending);
}

#[test]
fn test_open_dispute_not_participant_fails() {
    let ctx = EscrowTestContext::new();
    let non_participant = Address::generate(&ctx.env);
    let order_id = ctx.create_order(500);

    let reason = String::from_str(&ctx.env, "Not involved");
    let evidence_hash = String::from_str(&ctx.env, "QmHashXYZ");
    let result = ctx.client.mock_all_auths().try_open_dispute(
        &non_participant,
        &order_id,
        &reason,
        &evidence_hash,
    );

    assert_eq!(
        result.unwrap_err().unwrap(),
        EscrowError::NotOrderParticipant
    );
}

#[test]
fn test_open_dispute_duplicate_fails() {
    let ctx = EscrowTestContext::new();
    let order_id = ctx.create_order(500);
    ctx.open_dispute(order_id, &ctx.buyer);

    let reason = String::from_str(&ctx.env, "Second dispute");
    let evidence_hash = String::from_str(&ctx.env, "QmHash2");
    let result = ctx.client.mock_all_auths().try_open_dispute(
        &ctx.farmer,
        &order_id,
        &reason,
        &evidence_hash,
    );

    assert_eq!(result.unwrap_err().unwrap(), EscrowError::OrderNotPending);
}

#[test]
fn test_resolve_dispute_refund() {
    let ctx = EscrowTestContext::new();
    let order_id = ctx.create_order(500);
    ctx.open_dispute(order_id, &ctx.buyer);

    ctx.client
        .mock_all_auths()
        .resolve_dispute(&ctx.admin, &order_id, &DisputeResolution::Refund);

    assert_eq!(
        ctx.client.get_order_details(&order_id).status,
        OrderStatus::Refunded
    );
    assert!(ctx.client.get_dispute(&order_id).resolved);
    assert_eq!(
        ctx.token.balance(&ctx.buyer),
        INITIAL_BUYER_BALANCE - fee(500)
    );
    assert_eq!(ctx.token.balance(&ctx.client.address), 0);
}

#[test]
fn test_resolve_dispute_release() {
    let ctx = EscrowTestContext::new();
    let order_id = ctx.create_order(500);
    ctx.open_dispute(order_id, &ctx.farmer);

    ctx.client
        .mock_all_auths()
        .resolve_dispute(&ctx.admin, &order_id, &DisputeResolution::Release);

    assert_eq!(
        ctx.client.get_order_details(&order_id).status,
        OrderStatus::Completed
    );
    assert!(ctx.client.get_dispute(&order_id).resolved);
    assert_eq!(ctx.token.balance(&ctx.farmer), net(500));
    assert_eq!(ctx.token.balance(&ctx.client.address), 0);
}

#[test]
fn test_resolve_dispute_split_50_50() {
    let ctx = EscrowTestContext::new();
    let order_id = ctx.create_order(1_000);
    ctx.open_dispute(order_id, &ctx.buyer);

    let buyer_before = ctx.token.balance(&ctx.buyer);
    let farmer_before = ctx.token.balance(&ctx.farmer);
    ctx.client.mock_all_auths().resolve_dispute(
        &ctx.admin,
        &order_id,
        &DisputeResolution::Split(5_000),
    );

    assert_eq!(
        ctx.client.get_order_details(&order_id).status,
        OrderStatus::Completed
    );
    assert!(ctx.client.get_dispute(&order_id).resolved);
    assert_eq!(ctx.token.balance(&ctx.buyer), buyer_before + net(1_000) / 2);
    assert_eq!(
        ctx.token.balance(&ctx.farmer),
        farmer_before + net(1_000) - (net(1_000) / 2)
    );
    assert_eq!(ctx.token.balance(&ctx.client.address), 0);
}

#[test]
fn test_resolve_dispute_not_admin_fails() {
    let ctx = EscrowTestContext::new();
    let not_admin = Address::generate(&ctx.env);
    let order_id = ctx.create_order(500);
    ctx.open_dispute(order_id, &ctx.buyer);

    let result = ctx.client.mock_all_auths().try_resolve_dispute(
        &not_admin,
        &order_id,
        &DisputeResolution::Refund,
    );
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::NotAdmin);
}

#[test]
fn test_resolve_dispute_not_disputed_fails() {
    let ctx = EscrowTestContext::new();
    let order_id = ctx.create_order(500);

    let result = ctx.client.mock_all_auths().try_resolve_dispute(
        &ctx.admin,
        &order_id,
        &DisputeResolution::Refund,
    );
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::OrderNotDisputed);
}

#[test]
fn test_resolve_dispute_invalid_split_ratio_fails() {
    let ctx = EscrowTestContext::new();
    let order_id = ctx.create_order(500);
    ctx.open_dispute(order_id, &ctx.buyer);

    let result = ctx.client.mock_all_auths().try_resolve_dispute(
        &ctx.admin,
        &order_id,
        &DisputeResolution::Split(10_001),
    );
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::InvalidSplitRatio);
}

#[test]
fn test_initialize_with_only_one_token_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let fee_collector = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let xlm_contract = env.register_stellar_asset_contract_v2(token_admin);

    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);

    let mut one_token = Vec::new(&env);
    one_token.push_back(xlm_contract.address());

    let result = client.try_initialize(&admin, &fee_collector, &one_token);
    assert_eq!(
        result.unwrap_err().unwrap(),
        EscrowError::MustSupportTwoTokens
    );
}

#[test]
fn test_initialize_duplicate_fails() {
    let ctx = EscrowTestContext::new();
    let mut tokens = Vec::new(&ctx.env);
    tokens.push_back(ctx.token.address.clone());
    tokens.push_back(ctx.second_token.address.clone());

    let result = ctx
        .client
        .try_initialize(&ctx.admin, &ctx.fee_collector, &tokens);
    assert_eq!(
        result.unwrap_err().unwrap(),
        EscrowError::AlreadyInitialized
    );
}

#[test]
fn test_get_admin() {
    let ctx = EscrowTestContext::new();
    assert_eq!(ctx.client.get_admin(), ctx.admin);
}

#[test]
fn test_get_fee_collector() {
    let ctx = EscrowTestContext::new();
    assert_eq!(ctx.client.get_fee_collector(), ctx.fee_collector);
}

#[test]
fn test_fee_calculation_with_small_amounts() {
    let ctx = EscrowTestContext::new();
    let initial_balance = ctx.token.balance(&ctx.buyer);

    ctx.create_order(1);

    let order = ctx.client.get_order_details(&1);
    assert_eq!(ctx.token.balance(&ctx.fee_collector), 0);
    assert_eq!(order.amount, 1);
    assert_eq!(ctx.token.balance(&ctx.buyer), initial_balance - 1);
}

#[test]
fn test_fee_calculation_with_large_amounts() {
    let ctx = EscrowTestContext::new();
    ctx.mint_to(&ctx.buyer, i128::MAX / 2);

    let large_amount = 1_000_000_000;
    ctx.create_order(large_amount);

    let order = ctx.client.get_order_details(&1);
    assert_eq!(ctx.token.balance(&ctx.fee_collector), fee(large_amount));
    assert_eq!(order.amount, net(large_amount));
}

#[test]
fn test_fee_rounding_consistency() {
    let ctx = EscrowTestContext::new();
    let test_amounts = [33_i128, 67, 99, 100, 101, 333, 999];

    for (idx, amount) in test_amounts.iter().enumerate() {
        let order_id = (idx + 1) as u64;
        ctx.create_order(*amount);

        let order = ctx.client.get_order_details(&order_id);
        assert_eq!(order.amount, net(*amount));
    }
}

#[test]
fn test_split_ratio_zero_percent() {
    let ctx = EscrowTestContext::new();
    let order_id = ctx.create_order(1_000);
    ctx.open_dispute(order_id, &ctx.buyer);

    let farmer_before = ctx.token.balance(&ctx.farmer);
    ctx.client.mock_all_auths().resolve_dispute(
        &ctx.admin,
        &order_id,
        &DisputeResolution::Split(0),
    );

    assert_eq!(ctx.token.balance(&ctx.farmer), farmer_before + net(1_000));
}

#[test]
fn test_split_ratio_fifty_percent() {
    let ctx = EscrowTestContext::new();
    let order_id = ctx.create_order(1_000);
    ctx.open_dispute(order_id, &ctx.buyer);

    let buyer_before = ctx.token.balance(&ctx.buyer);
    let farmer_before = ctx.token.balance(&ctx.farmer);
    ctx.client.mock_all_auths().resolve_dispute(
        &ctx.admin,
        &order_id,
        &DisputeResolution::Split(5_000),
    );

    assert_eq!(ctx.token.balance(&ctx.buyer), buyer_before + 485);
    assert_eq!(ctx.token.balance(&ctx.farmer), farmer_before + 485);
}

#[test]
fn test_split_ratio_hundred_percent() {
    let ctx = EscrowTestContext::new();
    let order_id = ctx.create_order(1_000);
    ctx.open_dispute(order_id, &ctx.buyer);

    let buyer_before = ctx.token.balance(&ctx.buyer);
    ctx.client.mock_all_auths().resolve_dispute(
        &ctx.admin,
        &order_id,
        &DisputeResolution::Split(10_000),
    );

    assert_eq!(ctx.token.balance(&ctx.buyer), buyer_before + net(1_000));
}

#[test]
fn test_split_ratio_over_hundred_percent_fails() {
    let ctx = EscrowTestContext::new();
    let order_id = ctx.create_order(1_000);
    ctx.open_dispute(order_id, &ctx.buyer);

    let result = ctx.client.mock_all_auths().try_resolve_dispute(
        &ctx.admin,
        &order_id,
        &DisputeResolution::Split(10_001),
    );
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::InvalidSplitRatio);
}

#[test]
fn test_zero_amount_order_fails() {
    let ctx = EscrowTestContext::new();

    let result = ctx.client.mock_all_auths().try_create_order(
        &ctx.buyer,
        &ctx.farmer,
        &ctx.token.address,
        &0,
    );
    assert_eq!(
        result.unwrap_err().unwrap(),
        EscrowError::AmountMustBePositive
    );
}

#[test]
fn test_negative_amount_order_fails() {
    let ctx = EscrowTestContext::new();

    let result = ctx.client.mock_all_auths().try_create_order(
        &ctx.buyer,
        &ctx.farmer,
        &ctx.token.address,
        &-100,
    );
    assert_eq!(
        result.unwrap_err().unwrap(),
        EscrowError::AmountMustBePositive
    );
}
