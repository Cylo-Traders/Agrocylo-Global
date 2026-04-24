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

fn setup_test_with_admin() -> (
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

    let usdc_contract = env.register_stellar_asset_contract_v2(token_admin);
    let usdc_client = token::Client::new(&env, &usdc_contract.address());

    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);

    let mut supported_tokens = Vec::new(&env);
    supported_tokens.push_back(xlm_client.address.clone());
    supported_tokens.push_back(usdc_client.address.clone());

    client.initialize(&admin, &supported_tokens);

    (env, client, admin, buyer, farmer, xlm_client)
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
    assert_eq!(order.status, OrderStatus::Delivered);
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
fn test_mark_delivered_twice_fails() {
    let (_env, client, buyer, farmer, token, _) = setup_test();

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    client.mock_all_auths().mark_delivered(&farmer, &order_id);

    let result = client
        .mock_all_auths()
        .try_mark_delivered(&farmer, &order_id);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::OrderNotPending);
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

// --- Dispute System Tests (Issues #125, #126, #138) ---

#[test]
fn test_open_dispute_without_evidence_fails() {
    let (env, client, _admin, buyer, farmer, token) = setup_test_with_admin();

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    let result = client.mock_all_auths().try_open_dispute(
        &buyer,
        &order_id,
        &String::from_str(&env, "Goods not received"),
        &String::from_str(&env, ""),
    );

    assert_eq!(result.unwrap_err().unwrap(), EscrowError::MissingEvidence);
}

#[test]
fn test_open_dispute_success() {
    let (env, client, _admin, buyer, farmer, token) = setup_test_with_admin();

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    client.mock_all_auths().open_dispute(
        &buyer,
        &order_id,
        &String::from_str(&env, "Goods not received"),
        &String::from_str(&env, "ipfs://Qm123abc"),
    );

    let order = client.get_order_details(&order_id);
    assert_eq!(order.status, OrderStatus::Disputed);

    let dispute = client.get_dispute(&order_id);
    assert_eq!(dispute.order_id, order_id);
    assert!(!dispute.resolved);
}

#[test]
fn test_open_dispute_on_delivered_order() {
    let (env, client, _admin, buyer, farmer, token) = setup_test_with_admin();

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    client.mock_all_auths().mark_delivered(&farmer, &order_id);

    client.mock_all_auths().open_dispute(
        &buyer,
        &order_id,
        &String::from_str(&env, "Wrong goods delivered"),
        &String::from_str(&env, "ipfs://Qm456def"),
    );

    let order = client.get_order_details(&order_id);
    assert_eq!(order.status, OrderStatus::Disputed);
}

#[test]
fn test_open_dispute_twice_fails() {
    let (env, client, _admin, buyer, farmer, token) = setup_test_with_admin();

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    client.mock_all_auths().open_dispute(
        &buyer,
        &order_id,
        &String::from_str(&env, "Issue"),
        &String::from_str(&env, "ipfs://QmEvidence"),
    );

    let result = client.mock_all_auths().try_open_dispute(
        &farmer,
        &order_id,
        &String::from_str(&env, "Counter dispute"),
        &String::from_str(&env, "ipfs://QmCounter"),
    );

    assert_eq!(result.unwrap_err().unwrap(), EscrowError::OrderAlreadyDisputed);
}

#[test]
fn test_open_dispute_on_completed_order_fails() {
    let (env, client, _admin, buyer, farmer, token) = setup_test_with_admin();

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    client.mock_all_auths().confirm_receipt(&buyer, &order_id);

    let result = client.mock_all_auths().try_open_dispute(
        &buyer,
        &order_id,
        &String::from_str(&env, "Changed mind"),
        &String::from_str(&env, "ipfs://QmEvidence"),
    );

    assert_eq!(result.unwrap_err().unwrap(), EscrowError::OrderNotDisputable);
}

#[test]
fn test_resolve_dispute_full_success() {
    let (env, client, admin, buyer, farmer, token) = setup_test_with_admin();

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    client.mock_all_auths().open_dispute(
        &buyer,
        &order_id,
        &String::from_str(&env, "Goods not received"),
        &String::from_str(&env, "ipfs://QmEvidence"),
    );

    client.mock_all_auths().resolve_campaign_dispute(
        &admin,
        &order_id,
        &DisputeResolution::FullSuccess,
    );

    assert_eq!(token.balance(&farmer), 500);
    assert_eq!(token.balance(&buyer), 500);

    let dispute = client.get_dispute(&order_id);
    assert!(dispute.resolved);
}

#[test]
fn test_resolve_dispute_full_refund() {
    let (env, client, admin, buyer, farmer, token) = setup_test_with_admin();

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    client.mock_all_auths().open_dispute(
        &buyer,
        &order_id,
        &String::from_str(&env, "Never delivered"),
        &String::from_str(&env, "ipfs://QmEvidence"),
    );

    client.mock_all_auths().resolve_campaign_dispute(
        &admin,
        &order_id,
        &DisputeResolution::FullRefund,
    );

    assert_eq!(token.balance(&buyer), 1000);
    assert_eq!(token.balance(&farmer), 0);

    let dispute = client.get_dispute(&order_id);
    assert!(dispute.resolved);
}

#[test]
fn test_resolve_dispute_partial_settlement() {
    let (env, client, admin, buyer, farmer, token) = setup_test_with_admin();

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    client.mock_all_auths().open_dispute(
        &buyer,
        &order_id,
        &String::from_str(&env, "Partial delivery"),
        &String::from_str(&env, "ipfs://QmEvidence"),
    );

    // 6000 bps = 60% to farmer, 40% to buyer
    client.mock_all_auths().resolve_campaign_dispute(
        &admin,
        &order_id,
        &DisputeResolution::PartialSettlement { farmer_bps: 6000 },
    );

    assert_eq!(token.balance(&farmer), 300); // 60% of 500
    assert_eq!(token.balance(&buyer), 700);  // 500 remaining + 200 refunded
}

#[test]
fn test_resolve_dispute_already_resolved_fails() {
    let (env, client, admin, buyer, farmer, token) = setup_test_with_admin();

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    client.mock_all_auths().open_dispute(
        &buyer,
        &order_id,
        &String::from_str(&env, "Issue"),
        &String::from_str(&env, "ipfs://QmEvidence"),
    );

    client.mock_all_auths().resolve_campaign_dispute(
        &admin,
        &order_id,
        &DisputeResolution::FullRefund,
    );

    // Attempt to resolve again
    let result = client.mock_all_auths().try_resolve_campaign_dispute(
        &admin,
        &order_id,
        &DisputeResolution::FullSuccess,
    );

    assert_eq!(result.unwrap_err().unwrap(), EscrowError::DisputeAlreadyResolved);
}

#[test]
fn test_resolve_dispute_not_admin_fails() {
    let (env, client, _admin, buyer, farmer, token) = setup_test_with_admin();
    let fake_admin = Address::generate(&env);

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    client.mock_all_auths().open_dispute(
        &buyer,
        &order_id,
        &String::from_str(&env, "Issue"),
        &String::from_str(&env, "ipfs://QmEvidence"),
    );

    let result = client.mock_all_auths().try_resolve_campaign_dispute(
        &fake_admin,
        &order_id,
        &DisputeResolution::FullRefund,
    );

    assert_eq!(result.unwrap_err().unwrap(), EscrowError::NotAdmin);
}

#[test]
fn test_resolve_nonexistent_dispute_fails() {
    let (_env, client, admin, buyer, farmer, token) = setup_test_with_admin();

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    // No dispute opened - try to resolve directly
    let result = client.mock_all_auths().try_resolve_campaign_dispute(
        &admin,
        &order_id,
        &DisputeResolution::FullRefund,
    );

    assert_eq!(result.unwrap_err().unwrap(), EscrowError::DisputeDoesNotExist);
}
