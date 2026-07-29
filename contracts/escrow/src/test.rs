#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, String,
};

fn setup_test() -> (
    Env,
    EscrowContractClient<'static>,
    Address,
    Address,
    Address,
    token::Client<'static>,
    token::Client<'static>,
    Address,
    Address,
    Address,
) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let farmer = Address::generate(&env);
    let buyer = Address::generate(&env);
    let investor1 = Address::generate(&env);
    let investor2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let xlm_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let xlm_client = token::Client::new(&env, &xlm_contract.address());
    let xlm_sac_client = token::StellarAssetClient::new(&env, &xlm_contract.address());

    xlm_sac_client.mint(&buyer, &1000);
    xlm_sac_client.mint(&investor1, &2000);
    xlm_sac_client.mint(&investor2, &2000);

    let usdc_contract = env.register_stellar_asset_contract_v2(token_admin);
    let usdc_client = token::Client::new(&env, &usdc_contract.address());

    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);

    let mut supported_tokens = Vec::new(&env);
    supported_tokens.push_back(xlm_client.address.clone());
    supported_tokens.push_back(usdc_client.address.clone());

    let fee_collector = Address::generate(&env);

    client.initialize(&admin, &fee_collector, &supported_tokens);

    (
        env,
        client,
        buyer,
        farmer,
        fee_collector,
        xlm_client,
        usdc_client,
        admin,
        investor1,
        contract_id,
    )
}

fn create_test_with_tokens() -> (
    Env,
    EscrowContractClient<'static>,
    Address,
    Address,
    Address,
    token::Client<'static>,
) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let xlm_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let xlm_client = token::Client::new(&env, &xlm_contract.address());
    let xlm_admin_client = token::StellarAssetClient::new(&env, &xlm_contract.address());
    xlm_admin_client.mint(&buyer, &1000);

    // Register the second required token; only its address is needed for the whitelist.
    let usdc_address = env.register_stellar_asset_contract_v2(token_admin).address();

    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);

    let mut supported_tokens = Vec::new(&env);
    supported_tokens.push_back(xlm_client.address.clone());
    supported_tokens.push_back(usdc_address);

    let fee_collector = Address::generate(&env);
    client.initialize(&admin, &fee_collector, &supported_tokens);

    (env, client, admin, buyer, farmer, xlm_client)
}

#[test]
fn test_create_and_confirm_order() {
    let (_env, client, buyer, farmer, _collector, token, _, _, _, _) = setup_test();

    assert_eq!(token.balance(&buyer), 1000);
    assert_eq!(token.balance(&farmer), 0);

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    assert_eq!(order_id, 1);

    let order_details = client.get_order_details(&order_id);
    assert_eq!(order_details.status, OrderStatus::Pending);
    assert_eq!(order_details.delivery_timestamp, 0);

    client.mock_all_auths().confirm_receipt(&buyer, &order_id);

    let order_after = client.get_order_details(&order_id);
    assert_eq!(order_after.status, OrderStatus::Completed);
}

#[test]
fn test_mark_delivered_then_confirm() {
    let (env, client, buyer, farmer, _collector, token, _, _, _, _) = setup_test();

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    env.ledger().set_timestamp(1000);
    client.mock_all_auths().mark_delivered(&farmer, &order_id);

    let order = client.get_order_details(&order_id);
    assert_eq!(order.status, OrderStatus::Pending);
    assert!(order.delivery_timestamp > 0);

    client.mock_all_auths().confirm_receipt(&buyer, &order_id);

    let order_after = client.get_order_details(&order_id);
    assert_eq!(order_after.status, OrderStatus::Completed);
}

#[test]
fn test_mark_delivered_wrong_farmer_fails() {
    let (env, client, buyer, farmer, _, token, _, _, _, _) = setup_test();
    let fake_farmer = Address::generate(&env);

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    let result = client
        .mock_all_auths()
        .try_mark_delivered(&fake_farmer, &order_id);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::NotFarmer);
}

#[test]
fn test_mark_delivered_twice_succeeds() {
    let (_env, client, buyer, farmer, _, token, _, _, _, _) = setup_test();

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    client.mock_all_auths().mark_delivered(&farmer, &order_id);
    let order = client.get_order_details(&order_id);

    client.mock_all_auths().mark_delivered(&farmer, &order_id);
    let order_after = client.get_order_details(&order_id);
    assert_eq!(order_after.delivery_timestamp, order.delivery_timestamp);
    let result = client
        .mock_all_auths()
        .try_mark_delivered(&farmer, &order_id);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::OrderNotPending);
}

#[test]
fn test_confirm_without_mark_delivered() {
    let (_env, client, buyer, farmer, _, token, _, _, _, _) = setup_test();

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    client.mock_all_auths().confirm_receipt(&buyer, &order_id);

    let order = client.get_order_details(&order_id);
    assert_eq!(order.status, OrderStatus::Completed);
}

#[test]
fn test_confirm_already_completed() {
    let (_env, client, buyer, farmer, _, token, _, _, _, _) = setup_test();
    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    client.mock_all_auths().confirm_receipt(&buyer, &order_id);

    let result = client
        .mock_all_auths()
        .try_confirm_receipt(&buyer, &order_id);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::OrderNotPending);
}

#[test]
fn test_refund_expired_order() {
    let (env, client, buyer, farmer, collector, token, _, _, _, contract_id) = setup_test();
    let amount = 500i128;
    let fee = amount * 3 / 100;
    let net_amount = amount - fee;

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &amount);

    assert_eq!(token.balance(&buyer), 1000 - amount);
    assert_eq!(token.balance(&collector), fee);
    assert_eq!(token.balance(&farmer), 0);
    assert_eq!(token.balance(&contract_id), net_amount);

    env.ledger()
        .set_timestamp(env.ledger().timestamp() + 345_601);

    client.mock_all_auths().refund_expired_order(&buyer, &order_id);

    let order = client.get_order_details(&order_id);
    assert_eq!(order.status, OrderStatus::Refunded);

    assert_eq!(token.balance(&buyer), 1000 - amount + net_amount);
    assert_eq!(token.balance(&collector), fee);
    assert_eq!(token.balance(&farmer), 0);
    assert_eq!(token.balance(&contract_id), 0);
}

#[test]
fn test_refund_unexpired_order_fails() {
    let (env, client, buyer, farmer, _, token, _, _, _, _) = setup_test();
    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    env.ledger().set_timestamp(env.ledger().timestamp() + 3600);

    let result = client
        .mock_all_auths()
        .try_refund_expired_order(&buyer, &order_id);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::OrderNotExpired);
}

#[test]
fn test_create_order_unsupported_token_fails() {
    let (env, client, buyer, farmer, _, _, _, _, _, _) = setup_test();
    let unsupported_token_admin = Address::generate(&env);
    let unsupported_contract = env.register_stellar_asset_contract_v2(unsupported_token_admin);
    let unsupported_client = token::Client::new(&env, &unsupported_contract.address());

    let result = client.mock_all_auths().try_create_order(
        &buyer,
        &farmer,
        &unsupported_client.address,
        &500,
    );
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::UnsupportedToken);
}

#[test]
fn test_create_order_zero_amount_fails() {
    let (_env, client, buyer, farmer, _collector, token, _, _, _, _) = setup_test();

    let result = client
        .mock_all_auths()
        .try_create_order(&buyer, &farmer, &token.address, &0);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::AmountMustBePositive);
}

#[test]
fn test_create_order_negative_amount_fails() {
    let (_env, client, buyer, farmer, _collector, token, _, _, _, _) = setup_test();

    let result = client
        .mock_all_auths()
        .try_create_order(&buyer, &farmer, &token.address, &-1);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::AmountMustBePositive);
}

#[test]
fn test_create_order_buyer_auth_fails() {
    let (env, client, buyer, farmer, _, token, _, _, _, _) = setup_test();

    // Use mock_all_auths to successfully create an order while recording auths.
    client.mock_all_auths().create_order(&buyer, &farmer, &token.address, &500);

    // Verify that the buyer's authorization was required by the contract.
    let auths = env.auths();
    assert!(!auths.is_empty(), "expected at least one auth entry");
    assert_eq!(auths[0].0, buyer, "expected buyer to be the authorized address");
}

#[test]
fn test_platform_fee_acceptance_criteria() {
    let (_env, client, buyer, farmer, collector, token, _, _, _, _) = setup_test();

    let amount = 1000;

    client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &amount);

    assert_eq!(token.balance(&collector), 30);
    let order_details = client.get_order_details(&1);
    assert_eq!(order_details.amount, 970);

    client.mock_all_auths().confirm_receipt(&buyer, &1);
    assert_eq!(token.balance(&farmer), 970);
}

#[test]
fn test_open_dispute_by_buyer() {
    let (_env, client, buyer, farmer, _, token, _, _, _, _) = setup_test();

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    let reason = String::from_str(&_env, "Product damaged");
    let evidence_hash = String::from_str(&_env, "QmHash123");

    client
        .mock_all_auths()
        .open_dispute(&buyer, &order_id, &reason, &evidence_hash);

    let order = client.get_order_details(&order_id);
    assert_eq!(order.status, OrderStatus::Disputed);

    let dispute = client.get_dispute(&order_id);
    assert_eq!(dispute.opened_by, buyer);
    assert_eq!(dispute.resolved, false);
}

#[test]
fn test_open_dispute_by_farmer() {
    let (_env, client, buyer, farmer, _, token, _, _, _, _) = setup_test();

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    let reason = String::from_str(&_env, "Buyer not responding");
    let evidence_hash = String::from_str(&_env, "QmHash456");

    client
        .mock_all_auths()
        .open_dispute(&farmer, &order_id, &reason, &evidence_hash);

    let order = client.get_order_details(&order_id);
    assert_eq!(order.status, OrderStatus::Disputed);

    let dispute = client.get_dispute(&order_id);
    assert_eq!(dispute.opened_by, farmer);
    assert_eq!(dispute.resolved, false);
}

#[test]
fn test_open_dispute_not_pending_fails() {
    let (_env, client, buyer, farmer, _, token, _, _, _, _) = setup_test();

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    client.mock_all_auths().confirm_receipt(&buyer, &order_id);

    let reason = String::from_str(&_env, "Issue with order");
    let evidence_hash = String::from_str(&_env, "QmHash789");

    let result =
        client
            .mock_all_auths()
            .try_open_dispute(&buyer, &order_id, &reason, &evidence_hash);

    assert_eq!(result.unwrap_err().unwrap(), EscrowError::OrderNotPending);
}

#[test]
fn test_open_dispute_not_participant_fails() {
    let (env, client, buyer, farmer, _, token, _, _, _, _) = setup_test();
    let non_participant = Address::generate(&env);

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    let reason = String::from_str(&env, "Not involved");
    let evidence_hash = String::from_str(&env, "QmHashXYZ");

    let result = client.mock_all_auths().try_open_dispute(
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
    let (_env, client, buyer, farmer, _, token, _, _, _, _) = setup_test();

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    let reason = String::from_str(&_env, "First dispute");
    let evidence_hash = String::from_str(&_env, "QmHash111");

    client
        .mock_all_auths()
        .open_dispute(&buyer, &order_id, &reason, &evidence_hash);

    let reason2 = String::from_str(&_env, "Second dispute");
    let evidence_hash2 = String::from_str(&_env, "QmHash222");

    let result =
        client
            .mock_all_auths()
            .try_open_dispute(&buyer, &order_id, &reason2, &evidence_hash2);

    assert_eq!(
        result.unwrap_err().unwrap(),
        EscrowError::OrderNotPending
    );
}

#[test]
fn test_resolve_dispute_refund() {
    let (_env, client, buyer, farmer, collector, token, _, admin, _, contract_id) = setup_test();
    let amount = 500i128;
    let fee = amount * 3 / 100;
    let net_amount = amount - fee;

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &amount);

    assert_eq!(token.balance(&buyer), 1000 - amount);
    assert_eq!(token.balance(&collector), fee);
    assert_eq!(token.balance(&contract_id), net_amount);
    assert_eq!(token.balance(&farmer), 0);

    let reason = String::from_str(&_env, "Product not received");
    let evidence_hash = String::from_str(&_env, "QmHashRefund");

    client
        .mock_all_auths()
        .open_dispute(&buyer, &order_id, &reason, &evidence_hash);

    client
        .mock_all_auths()
        .resolve_dispute(&admin, &order_id, &DisputeResolution::Refund);

    let order = client.get_order_details(&order_id);
    assert_eq!(order.status, OrderStatus::Refunded);
    assert_eq!(order.amount, net_amount);

    assert_eq!(token.balance(&buyer), 1000 - amount + net_amount);
    assert_eq!(token.balance(&collector), fee);
    assert_eq!(token.balance(&contract_id), 0);
    assert_eq!(token.balance(&farmer), 0);
}

#[test]
fn test_resolve_dispute_release() {
    let (_env, client, buyer, farmer, collector, token, _, admin, _, contract_id) = setup_test();
    let amount = 500i128;
    let fee = amount * 3 / 100;
    let net_amount = amount - fee;

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &amount);

    assert_eq!(token.balance(&buyer), 1000 - amount);
    assert_eq!(token.balance(&collector), fee);
    assert_eq!(token.balance(&contract_id), net_amount);
    assert_eq!(token.balance(&farmer), 0);

    let reason = String::from_str(&_env, "Farmer delivered goods");
    let evidence_hash = String::from_str(&_env, "QmHashRelease");

    client
        .mock_all_auths()
        .open_dispute(&farmer, &order_id, &reason, &evidence_hash);

    client
        .mock_all_auths()
        .resolve_dispute(&admin, &order_id, &DisputeResolution::Release);

    let order = client.get_order_details(&order_id);
    assert_eq!(order.status, OrderStatus::Completed);
    assert_eq!(order.amount, net_amount);

    assert_eq!(token.balance(&buyer), 1000 - amount);
    assert_eq!(token.balance(&collector), fee);
    assert_eq!(token.balance(&contract_id), 0);
    assert_eq!(token.balance(&farmer), net_amount);
}

#[test]
fn test_resolve_dispute_split_50_50() {
    let (_env, client, buyer, farmer, collector, token, _, admin, _, contract_id) = setup_test();
    let amount = 1000i128;
    let fee = amount * 3 / 100;
    let net_amount = amount - fee;
    let buyer_share_bps: u32 = 5000;
    let refund_amount = net_amount * buyer_share_bps as i128 / 10_000;
    let release_amount = net_amount - refund_amount;

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &amount);

    assert_eq!(token.balance(&buyer), 1000 - amount);
    assert_eq!(token.balance(&collector), fee);
    assert_eq!(token.balance(&contract_id), net_amount);
    assert_eq!(token.balance(&farmer), 0);

    let reason = String::from_str(&_env, "Partial fulfillment");
    let evidence_hash = String::from_str(&_env, "QmHashSplit50");

    client
        .mock_all_auths()
        .open_dispute(&buyer, &order_id, &reason, &evidence_hash);

    client
        .mock_all_auths()
        .resolve_dispute(&admin, &order_id, &DisputeResolution::Split(buyer_share_bps));

    let order = client.get_order_details(&order_id);
    assert_eq!(order.status, OrderStatus::Completed);
    assert_eq!(order.amount, net_amount);

    assert_eq!(token.balance(&buyer), 1000 - amount + refund_amount);
    assert_eq!(token.balance(&collector), fee);
    assert_eq!(token.balance(&contract_id), 0);
    assert_eq!(token.balance(&farmer), release_amount);
}

#[test]
fn test_resolve_dispute_not_admin_fails() {
    let (env, client, buyer, farmer, _, token, _, _, _, _) = setup_test();

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    let reason = String::from_str(&env, "Dispute");
    let evidence_hash = String::from_str(&env, "QmHashNotAdmin");

    client
        .mock_all_auths()
        .open_dispute(&buyer, &order_id, &reason, &evidence_hash);

    let not_admin = Address::generate(&env);
    let result = client.mock_all_auths().try_resolve_dispute(
        &not_admin,
        &order_id,
        &DisputeResolution::Refund,
    );

    assert_eq!(result.unwrap_err().unwrap(), EscrowError::NotAdmin);
}

#[test]
fn test_resolve_dispute_not_disputed_fails() {
    let (_env, client, buyer, farmer, _, token, _, admin, _, _) = setup_test();

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    let result =
        client
            .mock_all_auths()
            .try_resolve_dispute(&admin, &order_id, &DisputeResolution::Refund);

    assert_eq!(result.unwrap_err().unwrap(), EscrowError::OrderNotDisputed);
}

#[test]
fn test_resolve_dispute_invalid_split_ratio_fails() {
    let (_env, client, buyer, farmer, _, token, _, admin, _, _) = setup_test();

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    let reason = String::from_str(&_env, "Dispute");
    let evidence_hash = String::from_str(&_env, "QmHashInvalidRatio");

    client
        .mock_all_auths()
        .open_dispute(&buyer, &order_id, &reason, &evidence_hash);

    let result = client.mock_all_auths().try_resolve_dispute(
        &admin,
        &order_id,
        &DisputeResolution::Split(15000),
    );

    assert_eq!(result.unwrap_err().unwrap(), EscrowError::InvalidSplitRatio);
}

#[test]
fn test_get_orders_by_buyer() {
    let (_env, client, buyer, farmer, _, token, _, _, _, _) = setup_test();

    let _order_id1 = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    let _order_id2 = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &300);

    let orders = client.get_orders_by_buyer(&buyer);
    assert_eq!(orders.len(), 2);
}

#[test]
fn test_get_orders_by_farmer() {
    let (_env, client, buyer, farmer, _, token, _, _, _, _) = setup_test();

    let _order_id1 = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    let orders = client.get_orders_by_farmer(&farmer);
    assert_eq!(orders.len(), 1);
}

#[test]
fn test_initialize_with_only_one_token_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let fee_collector = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let xlm_contract = env.register_stellar_asset_contract_v2(token_admin);
    let xlm_address = xlm_contract.address();

    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);

    let mut one_token = Vec::new(&env);
    one_token.push_back(xlm_address);

    let result = client.try_initialize(&admin, &fee_collector, &one_token);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::MustSupportTwoTokens);
}

#[test]
fn test_initialize_duplicate_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let fee_collector = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let xlm_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let usdc_address = env.register_stellar_asset_contract_v2(token_admin).address();

    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);

    let mut tokens = Vec::new(&env);
    tokens.push_back(xlm_contract.address());
    tokens.push_back(usdc_address);

    client.initialize(&admin, &fee_collector, &tokens);

    let result = client.try_initialize(&admin, &fee_collector, &tokens);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::AlreadyInitialized);
}

// ---------------------------------------------------------------------------
// Governance gating (Issue #660)
// ---------------------------------------------------------------------------

#[test]
fn test_fee_config_admin_fallback_before_governance_set() {
    let (_env, client, _buyer, _farmer, fee_collector, _xlm, _usdc, admin, _investor1, _id) =
        setup_test();

    // No governance contract configured yet: admin can still update fee config.
    client.set_fee_config(&admin, &fee_collector, &500);
    assert_eq!(client.get_fee_rate_bps(), 500);
}

/// Stand-in for a real governance contract: exposes the `get_admin` view function
/// `set_governance_contract` uses to verify a candidate address is a live deployed
/// governance contract before accepting it (Issue #680).
#[contract]
struct MockGovernance;

#[contractimpl]
impl MockGovernance {
    pub fn get_admin(env: Env) -> Address {
        env.current_contract_address()
    }
}

#[test]
fn test_fee_config_rejects_admin_once_governance_set() {
    let (env, client, _buyer, _farmer, fee_collector, _xlm, _usdc, admin, _investor1, _id) =
        setup_test();

    let governance = env.register(MockGovernance, ());
    client.set_governance_contract(&admin, &governance);

    // Raw admin can no longer call set_fee_config once governance is set.
    let result = client.try_set_fee_config(&admin, &fee_collector, &500);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::NotGoverned);

    // The governance contract address can.
    client.set_fee_config(&governance, &fee_collector, &500);
    assert_eq!(client.get_fee_rate_bps(), 500);
}

#[test]
fn test_set_governance_contract_rejects_non_contract_address() {
    let (env, client, _buyer, _farmer, _fee_collector, _xlm, _usdc, admin, _investor1, _id) =
        setup_test();

    // A plain generated address has no deployed code, so it fails the
    // `get_admin` view-function check and is rejected outright.
    let fake_governance = Address::generate(&env);
    let result = client.try_set_governance_contract(&admin, &fake_governance);
    assert_eq!(
        result.unwrap_err().unwrap(),
        EscrowError::InvalidGovernanceContract
    );
}

#[test]
fn test_admin_cannot_repoint_governance_once_set() {
    let (env, client, _buyer, _farmer, _fee_collector, _xlm, _usdc, admin, _investor1, _id) =
        setup_test();

    let governance = env.register(MockGovernance, ());
    client.set_governance_contract(&admin, &governance);

    // Admin tries to re-point governance to a second, self-controlled instance.
    let attacker_governance = env.register(MockGovernance, ());
    let result = client.try_set_governance_contract(&admin, &attacker_governance);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::NotGoverned);

    // The governance address on file is unchanged.
    assert_eq!(client.get_governance_contract(), Some(governance));
}

#[test]
fn test_create_order_uses_configured_fee_rate() {
    let (_env, client, buyer, farmer, fee_collector, xlm, _usdc, admin, _investor1, _id) =
        setup_test();

    client.set_fee_config(&admin, &fee_collector, &1_000); // 10%
    let order_id = client.create_order(&buyer, &farmer, &xlm.address, &1_000);
    let order = client.get_order_details(&order_id);
    // 10% fee -> net amount is 900.
    assert_eq!(order.amount, 900);
}

// ---------------------------------------------------------------------------
// Cross-token settlement via path payments (Issue #591)
// ---------------------------------------------------------------------------

/// Stand-in for a Stellar path-payment router/AMM. Holds pre-funded liquidity of the
/// destination token and reports a configured quote and actual fill amount, so tests
/// can simulate both a clean conversion and one that slips beyond tolerance.
#[contract]
struct MockRouter;

#[contractimpl]
impl MockRouter {
    pub fn configure(env: Env, quote: i128, actual_out: i128) {
        env.storage().instance().set(&symbol_short!("quote"), &quote);
        env.storage()
            .instance()
            .set(&symbol_short!("actual"), &actual_out);
    }

    pub fn get_quote(env: Env, _send_token: Address, _dest_token: Address, _send_amount: i128) -> i128 {
        env.storage().instance().get(&symbol_short!("quote")).unwrap()
    }

    pub fn swap_exact_in(
        env: Env,
        from: Address,
        to: Address,
        send_token: Address,
        dest_token: Address,
        send_amount: i128,
        _dest_min: i128,
    ) -> i128 {
        let actual_out: i128 = env.storage().instance().get(&symbol_short!("actual")).unwrap();
        token::Client::new(&env, &send_token).transfer(&from, &env.current_contract_address(), &send_amount);
        token::Client::new(&env, &dest_token).transfer(&env.current_contract_address(), &to, &actual_out);
        actual_out
    }
}

fn setup_path_payment_test(
    quote: i128,
    actual_out: i128,
) -> (
    Env,
    EscrowContractClient<'static>,
    Address, // buyer
    Address, // farmer
    Address, // fee_collector
    token::Client<'static>, // source (non-whitelisted) token
    token::Client<'static>, // settlement token (whitelisted)
    Address, // admin
) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let fee_collector = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let source_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let source_client = token::Client::new(&env, &source_contract.address());
    token::StellarAssetClient::new(&env, &source_contract.address()).mint(&buyer, &10_000);

    let settlement_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let settlement_client = token::Client::new(&env, &settlement_contract.address());

    let xlm_address = env.register_stellar_asset_contract_v2(token_admin).address();

    let router_id = env.register(MockRouter, ());
    let router_client_setup = MockRouterClient::new(&env, &router_id);
    router_client_setup.configure(&quote, &actual_out);
    // Fund the router with the settlement-token liquidity it pays out on swap.
    token::StellarAssetClient::new(&env, &settlement_contract.address()).mint(&router_id, &actual_out);

    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);

    let mut supported_tokens = Vec::new(&env);
    supported_tokens.push_back(settlement_client.address.clone());
    supported_tokens.push_back(xlm_address);
    client.initialize(&admin, &fee_collector, &supported_tokens);
    client.set_path_payment_router(&admin, &router_id);

    (
        env,
        client,
        buyer,
        farmer,
        fee_collector,
        source_client,
        settlement_client,
        admin,
    )
}

#[test]
fn test_create_order_via_path_payment_success() {
    // Router quotes 1000 and actually delivers 990 (1% slippage), within the
    // default 1% (100 bps) tolerance.
    let (_env, client, buyer, farmer, fee_collector, source_token, settlement_token, _admin) =
        setup_path_payment_test(1_000, 990);

    let order_id = client.create_order_via_path_payment(
        &buyer,
        &farmer,
        &source_token.address,
        &1_000,
        &settlement_token.address,
        &900, // buyer's own loose floor; contract's tolerance floor (990) governs
    );

    let order = client.get_order_details(&order_id);
    assert_eq!(order.status, OrderStatus::Pending);
    assert_eq!(order.token, settlement_token.address);
    // Default 3% platform fee on the 990 actually received.
    assert_eq!(order.amount, 990 - (990 * 3 / 100));
    assert_eq!(settlement_token.balance(&fee_collector), 990 * 3 / 100);
    assert_eq!(source_token.balance(&buyer), 10_000 - 1_000);
}

#[test]
fn test_create_order_via_path_payment_slippage_rejected() {
    // Router quotes 1000 but only delivers 900 (10% slippage), exceeding the
    // default 1% (100 bps) tolerance, so the order must be rejected and no funds
    // should move.
    let (_env, client, buyer, farmer, _fee_collector, source_token, settlement_token, _admin) =
        setup_path_payment_test(1_000, 900);

    let result = client.try_create_order_via_path_payment(
        &buyer,
        &farmer,
        &source_token.address,
        &1_000,
        &settlement_token.address,
        &1, // buyer floor is not the binding constraint here
    );

    assert_eq!(
        result.unwrap_err().unwrap(),
        EscrowError::SlippageToleranceExceeded
    );
    assert_eq!(source_token.balance(&buyer), 10_000);
}

#[test]
fn test_create_order_via_path_payment_unsupported_settlement_token_fails() {
    let (_env, client, buyer, farmer, _fee_collector, source_token, _settlement_token, admin) =
        setup_path_payment_test(1_000, 990);

    let token_admin = Address::generate(&_env);
    let other_client = _env.register_stellar_asset_contract_v2(token_admin);

    let result = client.try_create_order_via_path_payment(
        &buyer,
        &farmer,
        &source_token.address,
        &1_000,
        &other_client.address(),
        &900,
    );
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::UnsupportedToken);
    let _ = admin; // admin unused beyond setup in this test
}

#[test]
fn test_create_order_via_path_payment_no_router_configured_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let fee_collector = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let source_address = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let settlement_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let xlm_address = env.register_stellar_asset_contract_v2(token_admin).address();

    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);

    let mut supported_tokens = Vec::new(&env);
    supported_tokens.push_back(settlement_contract.address());
    supported_tokens.push_back(xlm_address);
    client.initialize(&admin, &fee_collector, &supported_tokens);

    let result = client.try_create_order_via_path_payment(
        &buyer,
        &farmer,
        &source_address,
        &1_000,
        &settlement_contract.address(),
        &900,
    );
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::RouterNotConfigured);
}

// ---------------------------------------------------------------------------
// On-chain reputation reporting (Issue #592)
// ---------------------------------------------------------------------------

/// Records every `record_order_outcome` call it receives, standing in for the real
/// reputation registry so tests can assert the escrow triggers it correctly without
/// depending on the registry crate.
#[contract]
struct MockRegistry;

#[contractimpl]
impl MockRegistry {
    pub fn record_order_outcome(
        env: Env,
        source_contract: Address,
        farmer: Address,
        disputed_buyer_share_bps: Option<u32>,
    ) {
        source_contract.require_auth();
        let mut calls: Vec<(Address, Address, Option<u32>)> = env
            .storage()
            .instance()
            .get(&symbol_short!("calls"))
            .unwrap_or_else(|| Vec::new(&env));
        calls.push_back((source_contract, farmer, disputed_buyer_share_bps));
        env.storage().instance().set(&symbol_short!("calls"), &calls);
    }

    pub fn calls(env: Env) -> Vec<(Address, Address, Option<u32>)> {
        env.storage()
            .instance()
            .get(&symbol_short!("calls"))
            .unwrap_or_else(|| Vec::new(&env))
    }
}

#[test]
fn test_confirm_receipt_reports_completed_outcome_to_registry() {
    let (env, client, buyer, farmer, _collector, token, _, admin, _, contract_id) = setup_test();

    let registry_id = env.register(MockRegistry, ());
    let registry_client = MockRegistryClient::new(&env, &registry_id);
    client
        .mock_all_auths()
        .set_registry_contract(&admin, &registry_id);

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);
    client.mock_all_auths().confirm_receipt(&buyer, &order_id);

    let calls = registry_client.calls();
    assert_eq!(calls.len(), 1);
    let (reported_source, reported_farmer, reported_outcome) = calls.get(0).unwrap();
    assert_eq!(reported_source, contract_id);
    assert_eq!(reported_farmer, farmer);
    assert_eq!(reported_outcome, None);
}

#[test]
fn test_resolve_dispute_reports_split_outcome_to_registry() {
    let (env, client, buyer, farmer, _collector, token, _, admin, _, _) = setup_test();

    let registry_id = env.register(MockRegistry, ());
    let registry_client = MockRegistryClient::new(&env, &registry_id);
    client
        .mock_all_auths()
        .set_registry_contract(&admin, &registry_id);

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);
    let reason = String::from_str(&env, "bad batch");
    let evidence_hash = String::from_str(&env, "hash");
    client
        .mock_all_auths()
        .open_dispute(&buyer, &order_id, &reason, &evidence_hash);
    client
        .mock_all_auths()
        .resolve_dispute(&admin, &order_id, &DisputeResolution::Split(3_000));

    let calls = registry_client.calls();
    assert_eq!(calls.len(), 1);
    let (_, reported_farmer, reported_outcome) = calls.get(0).unwrap();
    assert_eq!(reported_farmer, farmer);
    assert_eq!(reported_outcome, Some(3_000));
}

#[test]
fn test_confirm_receipt_without_registry_configured_still_succeeds() {
    let (_env, client, buyer, farmer, _collector, token, _, _, _, _) = setup_test();

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);
    client.mock_all_auths().confirm_receipt(&buyer, &order_id);

    let order = client.get_order_details(&order_id);
    assert_eq!(order.status, OrderStatus::Completed);
}
