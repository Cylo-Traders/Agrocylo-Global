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
    token::Client<'static>,
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

    let usdc_contract = env.register_stellar_asset_contract_v2(token_admin);
    let usdc_client = token::Client::new(&env, &usdc_contract.address());

    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);

    let mut supported_tokens = Vec::new(&env);
    supported_tokens.push_back(xlm_client.address.clone());
    supported_tokens.push_back(usdc_client.address.clone());

    client.initialize(&admin, &supported_tokens);

    (env, client, buyer, farmer, xlm_client, usdc_client)
}

#[test]
fn test_create_and_confirm_order() {
    let (_env, client, buyer, farmer, token, _) = setup_test();

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    assert_eq!(order_id, 1);

    let order_details = client.get_order_details(&order_id);
    assert_eq!(order_details.status, OrderStatus::Pending);
    assert_eq!(order_details.delivery_timestamp, None);

    client.mock_all_auths().confirm_receipt(&buyer, &order_id);

    let order_after = client.get_order_details(&order_id);
    assert_eq!(order_after.status, OrderStatus::Completed);
    assert_eq!(token.balance(&farmer), 500);
}

#[test]
fn test_mark_delivered_then_confirm() {
    let (_env, client, buyer, farmer, token, _) = setup_test();

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    client.mock_all_auths().mark_delivered(&farmer, &order_id);

    let order = client.get_order_details(&order_id);
    assert_eq!(order.status, OrderStatus::Pending);
    assert!(order.delivery_timestamp.is_some());

    client.mock_all_auths().confirm_receipt(&buyer, &order_id);

    let order_after = client.get_order_details(&order_id);
    assert_eq!(order_after.status, OrderStatus::Completed);
    assert_eq!(token.balance(&farmer), 500);
}

#[test]
fn test_mark_delivered_wrong_farmer_fails() {
    let (env, client, buyer, farmer, token, _) = setup_test();
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
    let (_env, client, buyer, farmer, token, _) = setup_test();

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    client.mock_all_auths().mark_delivered(&farmer, &order_id);

    let result = client
        .mock_all_auths()
        .try_mark_delivered(&farmer, &order_id);
    assert!(result.is_ok());
}

#[test]
fn test_confirm_without_mark_delivered() {
    let (_env, client, buyer, farmer, token, _) = setup_test();

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    client.mock_all_auths().confirm_receipt(&buyer, &order_id);

    let order = client.get_order_details(&order_id);
    assert_eq!(order.status, OrderStatus::Completed);
}

#[test]
fn test_confirm_already_completed() {
    let (_env, client, buyer, farmer, token, _) = setup_test();
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
    let (env, client, buyer, farmer, token, _) = setup_test();
    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    env.ledger().set_timestamp(env.ledger().timestamp() + 345601);

    client.mock_all_auths().refund_expired_order(&order_id);

    assert_eq!(token.balance(&buyer), 1000);
    let order = client.get_order_details(&order_id);
    assert_eq!(order.status, OrderStatus::Refunded);
}

#[test]
fn test_refund_unexpired_order_fails() {
    let (env, client, buyer, farmer, token, _) = setup_test();
    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    env.ledger().set_timestamp(env.ledger().timestamp() + 3600);

    let result = client.mock_all_auths().try_refund_expired_order(&order_id);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::OrderNotExpired);
}

#[test]
fn test_create_order_unsupported_token_fails() {
    let (env, client, buyer, farmer, _, _) = setup_test();
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

// Dispute Tests

#[test]
fn test_open_dispute_by_buyer() {
    let (_env, client, buyer, farmer, token, _) = setup_test();

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
    let (_env, client, buyer, farmer, token, _) = setup_test();

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
    let (_env, client, buyer, farmer, token, _) = setup_test();

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    client.mock_all_auths().confirm_receipt(&buyer, &order_id);

    let reason = String::from_str(&_env, "Issue with order");
    let evidence_hash = String::from_str(&_env, "QmHash789");

    let result = client
        .mock_all_auths()
        .try_open_dispute(&buyer, &order_id, &reason, &evidence_hash);

    assert_eq!(result.unwrap_err().unwrap(), EscrowError::OrderNotPending);
}

#[test]
fn test_open_dispute_not_participant_fails() {
    let (env, client, buyer, farmer, token, _) = setup_test();
    let non_participant = Address::generate(&env);

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    let reason = String::from_str(&env, "Not involved");
    let evidence_hash = String::from_str(&env, "QmHashXYZ");

    let result = client
        .mock_all_auths()
        .try_open_dispute(&non_participant, &order_id, &reason, &evidence_hash);

    assert_eq!(result.unwrap_err().unwrap(), EscrowError::NotOrderParticipant);
}

#[test]
fn test_open_dispute_duplicate_fails() {
    let (_env, client, buyer, farmer, token, _) = setup_test();

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

    let result = client
        .mock_all_auths()
        .try_open_dispute(&buyer, &order_id, &reason2, &evidence_hash2);

    assert_eq!(result.unwrap_err().unwrap(), EscrowError::OrderNotPending);
}

#[test]
fn test_resolve_dispute_refund() {
    let (env, _client, _buyer, _farmer, _token, _) = setup_test();

    let admin = Address::generate(&env);
    let buyer2 = Address::generate(&env);
    let farmer2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let xlm_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let xlm_client = token::Client::new(&env, &xlm_contract.address());
    let xlm_admin_client = token::StellarAssetClient::new(&env, &xlm_contract.address());
    xlm_admin_client.mint(&buyer2, &1000);

    let usdc_contract = env.register_stellar_asset_contract_v2(token_admin);
    let usdc_client = token::Client::new(&env, &usdc_contract.address());

    let contract_id = env.register(EscrowContract, ());
    let client2 = EscrowContractClient::new(&env, &contract_id);

    let mut supported_tokens = Vec::new(&env);
    supported_tokens.push_back(xlm_client.address.clone());
    supported_tokens.push_back(usdc_client.address.clone());

    client2.initialize(&admin, &supported_tokens);

    let order_id = client2
        .mock_all_auths()
        .create_order(&buyer2, &farmer2, &xlm_client.address, &500);

    let reason = String::from_str(&env, "Product not received");
    let evidence_hash = String::from_str(&env, "QmHashRefund");

    client2
        .mock_all_auths()
        .open_dispute(&buyer2, &order_id, &reason, &evidence_hash);

    client2
        .mock_all_auths()
        .resolve_dispute(&admin, &order_id, &DisputeResolution::Refund);

    let order = client2.get_order_details(&order_id);
    assert_eq!(order.status, OrderStatus::Refunded);
    assert_eq!(xlm_client.balance(&buyer2), 1000);
}

#[test]
fn test_resolve_dispute_release() {
    let (env, _client, _buyer, _farmer, _token, _) = setup_test();

    let admin = Address::generate(&env);
    let buyer2 = Address::generate(&env);
    let farmer2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let xlm_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let xlm_client = token::Client::new(&env, &xlm_contract.address());
    let xlm_admin_client = token::StellarAssetClient::new(&env, &xlm_contract.address());
    xlm_admin_client.mint(&buyer2, &1000);

    let usdc_contract = env.register_stellar_asset_contract_v2(token_admin);
    let usdc_client = token::Client::new(&env, &usdc_contract.address());

    let contract_id = env.register(EscrowContract, ());
    let client2 = EscrowContractClient::new(&env, &contract_id);

    let mut supported_tokens = Vec::new(&env);
    supported_tokens.push_back(xlm_client.address.clone());
    supported_tokens.push_back(usdc_client.address.clone());

    client2.initialize(&admin, &supported_tokens);

    let order_id = client2
        .mock_all_auths()
        .create_order(&buyer2, &farmer2, &xlm_client.address, &500);

    let reason = String::from_str(&env, "Farmer delivered goods");
    let evidence_hash = String::from_str(&env, "QmHashRelease");

    client2
        .mock_all_auths()
        .open_dispute(&farmer2, &order_id, &reason, &evidence_hash);

    client2
        .mock_all_auths()
        .resolve_dispute(&admin, &order_id, &DisputeResolution::Release);

    let order = client2.get_order_details(&order_id);
    assert_eq!(order.status, OrderStatus::Completed);
    assert_eq!(xlm_client.balance(&farmer2), 500);
}

#[test]
fn test_resolve_dispute_split_50_50() {
    let (env, _client, _buyer, _farmer, _token, _) = setup_test();

    let admin = Address::generate(&env);
    let buyer2 = Address::generate(&env);
    let farmer2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let xlm_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let xlm_client = token::Client::new(&env, &xlm_contract.address());
    let xlm_admin_client = token::StellarAssetClient::new(&env, &xlm_contract.address());
    xlm_admin_client.mint(&buyer2, &1000);

    let usdc_contract = env.register_stellar_asset_contract_v2(token_admin);
    let usdc_client = token::Client::new(&env, &usdc_contract.address());

    let contract_id = env.register(EscrowContract, ());
    let client2 = EscrowContractClient::new(&env, &contract_id);

    let mut supported_tokens = Vec::new(&env);
    supported_tokens.push_back(xlm_client.address.clone());
    supported_tokens.push_back(usdc_client.address.clone());

    client2.initialize(&admin, &supported_tokens);

    let order_id = client2
        .mock_all_auths()
        .create_order(&buyer2, &farmer2, &xlm_client.address, &1000);

    let reason = String::from_str(&env, "Partial fulfillment");
    let evidence_hash = String::from_str(&env, "QmHashSplit50");

    client2
        .mock_all_auths()
        .open_dispute(&buyer2, &order_id, &reason, &evidence_hash);

    client2
        .mock_all_auths()
        .resolve_dispute(&admin, &order_id, &DisputeResolution::Split(5000));

    let order = client2.get_order_details(&order_id);
    assert_eq!(order.status, OrderStatus::Completed);
    assert_eq!(xlm_client.balance(&buyer2), 500);
    assert_eq!(xlm_client.balance(&farmer2), 500);
}

#[test]
fn test_resolve_dispute_split_custom_ratio() {
    let (env, _client, _buyer, _farmer, _token, _) = setup_test();

    let admin = Address::generate(&env);
    let buyer2 = Address::generate(&env);
    let farmer2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let xlm_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let xlm_client = token::Client::new(&env, &xlm_contract.address());
    let xlm_admin_client = token::StellarAssetClient::new(&env, &xlm_contract.address());
    xlm_admin_client.mint(&buyer2, &1000);

    let usdc_contract = env.register_stellar_asset_contract_v2(token_admin);
    let usdc_client = token::Client::new(&env, &usdc_contract.address());

    let contract_id = env.register(EscrowContract, ());
    let client2 = EscrowContractClient::new(&env, &contract_id);

    let mut supported_tokens = Vec::new(&env);
    supported_tokens.push_back(xlm_client.address.clone());
    supported_tokens.push_back(usdc_client.address.clone());

    client2.initialize(&admin, &supported_tokens);

    let order_id = client2
        .mock_all_auths()
        .create_order(&buyer2, &farmer2, &xlm_client.address, &1000);

    let reason = String::from_str(&env, "Partial claim");
    let evidence_hash = String::from_str(&env, "QmHashSplitCustom");

    client2
        .mock_all_auths()
        .open_dispute(&buyer2, &order_id, &reason, &evidence_hash);

    client2
        .mock_all_auths()
        .resolve_dispute(&admin, &order_id, &DisputeResolution::Split(3000));

    let order = client2.get_order_details(&order_id);
    assert_eq!(order.status, OrderStatus::Completed);
    assert_eq!(xlm_client.balance(&buyer2), 300);
    assert_eq!(xlm_client.balance(&farmer2), 700);
}

#[test]
fn test_resolve_dispute_not_admin_fails() {
    let (env, _client, _buyer, _farmer, _token, _) = setup_test();

    let admin = Address::generate(&env);
    let not_admin = Address::generate(&env);
    let buyer2 = Address::generate(&env);
    let farmer2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let xlm_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let xlm_client = token::Client::new(&env, &xlm_contract.address());
    let xlm_admin_client = token::StellarAssetClient::new(&env, &xlm_contract.address());
    xlm_admin_client.mint(&buyer2, &1000);

    let usdc_contract = env.register_stellar_asset_contract_v2(token_admin);
    let usdc_client = token::Client::new(&env, &usdc_contract.address());

    let contract_id = env.register(EscrowContract, ());
    let client2 = EscrowContractClient::new(&env, &contract_id);

    let mut supported_tokens = Vec::new(&env);
    supported_tokens.push_back(xlm_client.address.clone());
    supported_tokens.push_back(usdc_client.address.clone());

    client2.initialize(&admin, &supported_tokens);

    let order_id = client2
        .mock_all_auths()
        .create_order(&buyer2, &farmer2, &xlm_client.address, &500);

    let reason = String::from_str(&env, "Dispute");
    let evidence_hash = String::from_str(&env, "QmHashNotAdmin");

    client2
        .mock_all_auths()
        .open_dispute(&buyer2, &order_id, &reason, &evidence_hash);

    let result = client2
        .mock_all_auths()
        .try_resolve_dispute(&not_admin, &order_id, &DisputeResolution::Refund);

    assert_eq!(result.unwrap_err().unwrap(), EscrowError::NotAdmin);
}

#[test]
fn test_resolve_dispute_not_disputed_fails() {
    let (env, _client, _buyer, _farmer, _token, _) = setup_test();

    let admin = Address::generate(&env);
    let buyer2 = Address::generate(&env);
    let farmer2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let xlm_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let xlm_client = token::Client::new(&env, &xlm_contract.address());
    let xlm_admin_client = token::StellarAssetClient::new(&env, &xlm_contract.address());
    xlm_admin_client.mint(&buyer2, &1000);

    let usdc_contract = env.register_stellar_asset_contract_v2(token_admin);
    let usdc_client = token::Client::new(&env, &usdc_contract.address());

    let contract_id = env.register(EscrowContract, ());
    let client2 = EscrowContractClient::new(&env, &contract_id);

    let mut supported_tokens = Vec::new(&env);
    supported_tokens.push_back(xlm_client.address.clone());
    supported_tokens.push_back(usdc_client.address.clone());

    client2.initialize(&admin, &supported_tokens);

    let order_id = client2
        .mock_all_auths()
        .create_order(&buyer2, &farmer2, &xlm_client.address, &500);

    let result = client2
        .mock_all_auths()
        .try_resolve_dispute(&admin, &order_id, &DisputeResolution::Refund);

    assert_eq!(result.unwrap_err().unwrap(), EscrowError::OrderNotDisputed);
}

#[test]
fn test_resolve_dispute_invalid_split_ratio_fails() {
    let (env, _client, _buyer, _farmer, _token, _) = setup_test();

    let admin = Address::generate(&env);
    let buyer2 = Address::generate(&env);
    let farmer2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let xlm_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let xlm_client = token::Client::new(&env, &xlm_contract.address());
    let xlm_admin_client = token::StellarAssetClient::new(&env, &xlm_contract.address());
    xlm_admin_client.mint(&buyer2, &1000);

    let usdc_contract = env.register_stellar_asset_contract_v2(token_admin);
    let usdc_client = token::Client::new(&env, &usdc_contract.address());

    let contract_id = env.register(EscrowContract, ());
    let client2 = EscrowContractClient::new(&env, &contract_id);

    let mut supported_tokens = Vec::new(&env);
    supported_tokens.push_back(xlm_client.address.clone());
    supported_tokens.push_back(usdc_client.address.clone());

    client2.initialize(&admin, &supported_tokens);

    let order_id = client2
        .mock_all_auths()
        .create_order(&buyer2, &farmer2, &xlm_client.address, &500);

    let reason = String::from_str(&env, "Dispute");
    let evidence_hash = String::from_str(&env, "QmHashInvalidRatio");

    client2
        .mock_all_auths()
        .open_dispute(&buyer2, &order_id, &reason, &evidence_hash);

    let result = client2
        .mock_all_auths()
        .try_resolve_dispute(&admin, &order_id, &DisputeResolution::Split(15000));

    assert_eq!(result.unwrap_err().unwrap(), EscrowError::InvalidSplitRatio);
}
