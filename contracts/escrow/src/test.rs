#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env,
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
