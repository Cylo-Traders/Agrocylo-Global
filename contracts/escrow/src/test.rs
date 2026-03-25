#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env,
};

fn setup_test() -> (
    Env,
    EscrowContractClient<'static>,
    Address, // buyer
    Address, // farmer
    Address, // fee_collector
    token::Client<'static>,
    token::Client<'static>,
) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let fee_collector = Address::generate(&env);

    let token_admin = Address::generate(&env);

    // Create XLM (Token 1)
    let xlm_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let xlm_client = token::Client::new(&env, &xlm_contract.address());
    let xlm_admin_client = token::StellarAssetClient::new(&env, &xlm_contract.address());
    xlm_admin_client.mint(&buyer, &1000);

    // Create USDC (Token 2)
    let usdc_contract = env.register_stellar_asset_contract_v2(token_admin);
    let usdc_client = token::Client::new(&env, &usdc_contract.address());

    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);

    // Initialize the contract with supported tokens
    let mut supported_tokens = Vec::new(&env);
    supported_tokens.push_back(xlm_client.address.clone());
    supported_tokens.push_back(usdc_client.address.clone());

    client.initialize(&admin, &supported_tokens, &fee_collector);

    (env, client, buyer, farmer, fee_collector, xlm_client, usdc_client)
}

#[test]
fn test_create_and_confirm_order() {
    let (_env, client, buyer, farmer, collector, token, _) = setup_test();

    assert_eq!(token.balance(&buyer), 1000);
    assert_eq!(token.balance(&farmer), 0);
    assert_eq!(token.balance(&collector), 0);

    let amount = 500;
    let expected_fee = 15; // 3% of 500
    let expected_net = 485;

    // Create order
    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &amount);

    assert_eq!(order_id, 1);

    // Tokens moved: 500 from buyer, 15 to collector, 485 to escrow
    assert_eq!(token.balance(&buyer), 500);
    assert_eq!(token.balance(&collector), expected_fee);
    let escrow_address = client.address.clone();
    assert_eq!(token.balance(&escrow_address), expected_net);

    // Verify view functions
    let order_details = client.get_order_details(&order_id);
    assert_eq!(order_details.buyer, buyer);
    assert_eq!(order_details.farmer, farmer);
    assert_eq!(order_details.amount, expected_net); // net amount stored
    assert_eq!(order_details.status, OrderStatus::Pending);

    // Confirm receipt
    client.mock_all_auths().confirm_receipt(&buyer, &order_id);

    // Tokens moved to farmer (only net amount)
    assert_eq!(token.balance(&escrow_address), 0);
    assert_eq!(token.balance(&farmer), expected_net);

    // Order status now Completed
    let order_details_after = client.get_order_details(&order_id);
    assert_eq!(order_details_after.status, OrderStatus::Completed);
}

#[test]
fn test_confirm_already_completed() {
    let (_env, client, buyer, farmer, _, token, _) = setup_test();
    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    client.mock_all_auths().confirm_receipt(&buyer, &order_id);

    // Fails with OrderNotPending
    let result = client
        .mock_all_auths()
        .try_confirm_receipt(&buyer, &order_id);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::OrderNotPending);
}

#[test]
fn test_refund_expired_order() {
    let (env, client, buyer, farmer, collector, token, _) = setup_test();
    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    let escrow_address = client.address.clone();
    assert_eq!(token.balance(&buyer), 500);
    assert_eq!(token.balance(&collector), 15);
    assert_eq!(token.balance(&escrow_address), 485);

    // Fast forward time 96+ hours
    env.ledger()
        .set_timestamp(env.ledger().timestamp() + 345601);

    client.mock_all_auths().refund_expired_order(&order_id);

    // Funds back to buyer (only 485 returned, 15 kept by platform)
    assert_eq!(token.balance(&escrow_address), 0);
    assert_eq!(token.balance(&buyer), 500 + 485);

    let order_details = client.get_order_details(&order_id);
    assert_eq!(order_details.status, OrderStatus::Refunded);
}

#[test]
fn test_refund_unexpired_order_fails() {
    let (env, client, buyer, farmer, _, token, _) = setup_test();
    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    // Fast forward only 1 hour
    env.ledger().set_timestamp(env.ledger().timestamp() + 3600);

    // Fails with OrderNotExpired
    let result = client.mock_all_auths().try_refund_expired_order(&order_id);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::OrderNotExpired);
}

#[test]
fn test_create_order_unsupported_token_fails() {
    let (env, client, buyer, farmer, _, _, _) = setup_test();
    let unsupported_token_admin = Address::generate(&env);
    let unsupported_contract = env.register_stellar_asset_contract_v2(unsupported_token_admin);
    let unsupported_client = token::Client::new(&env, &unsupported_contract.address());

    // Fails because the token was not initialized as supported
    let result = client.mock_all_auths().try_create_order(
        &buyer,
        &farmer,
        &unsupported_client.address,
        &500,
    );
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::UnsupportedToken);
}
#[test]
fn test_platform_fee_acceptance_criteria() {
    let (_env, client, buyer, farmer, collector, token, _) = setup_test();

    let amount = 1000;
    
    client.mock_all_auths().create_order(&buyer, &farmer, &token.address, &amount);

    // Acceptance criteria:
    // - fee_collector receives exactly 30 tokens
    // - order.amount stores 970
    assert_eq!(token.balance(&collector), 30);
    let order_details = client.get_order_details(&1);
    assert_eq!(order_details.amount, 970);
    
    // confirm_receipt releases exactly 970 to the farmer
    client.mock_all_auths().confirm_receipt(&buyer, &1);
    assert_eq!(token.balance(&farmer), 970);
}
