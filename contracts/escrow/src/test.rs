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
) {
    let env = Env::default();
    env.mock_all_auths();

    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin);
    let token_client = token::Client::new(&env, &token_contract.address());

    // Mint some testing tokens to the buyer
    let token_admin_client = token::StellarAssetClient::new(&env, &token_contract.address());
    token_admin_client.mint(&buyer, &1000);

    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);

    (env, client, buyer, farmer, token_client)
}

#[test]
fn test_create_and_confirm_order() {
    let (_env, client, buyer, farmer, token) = setup_test();

    assert_eq!(token.balance(&buyer), 1000);
    assert_eq!(token.balance(&farmer), 0);

    let amount = 500;

    // Create order
    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &amount);

    assert_eq!(order_id, 1);

    // Tokens moved to escrow
    assert_eq!(token.balance(&buyer), 500);
    let escrow_address = client.address.clone();
    assert_eq!(token.balance(&escrow_address), 500);

    // Verify view functions
    let order_details = client.get_order_details(&order_id);
    assert_eq!(order_details.buyer, buyer);
    assert_eq!(order_details.farmer, farmer);
    assert_eq!(order_details.amount, amount);
    assert_eq!(order_details.status, OrderStatus::Pending);

    assert_eq!(client.get_orders_by_buyer(&buyer).len(), 1);
    assert_eq!(client.get_orders_by_buyer(&buyer).first().unwrap(), 1);
    assert_eq!(client.get_orders_by_farmer(&farmer).len(), 1);
    assert_eq!(client.get_orders_by_farmer(&farmer).first().unwrap(), 1);

    // Confirm receipt
    client.mock_all_auths().confirm_receipt(&buyer, &order_id);

    // Tokens moved to farmer
    assert_eq!(token.balance(&escrow_address), 0);
    assert_eq!(token.balance(&farmer), 500);

    // Order status now Completed
    let order_details_after = client.get_order_details(&order_id);
    assert_eq!(order_details_after.status, OrderStatus::Completed);
}

#[test]
#[should_panic(expected = "order is not pending")]
fn test_confirm_already_completed() {
    let (_env, client, buyer, farmer, token) = setup_test();
    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    client.mock_all_auths().confirm_receipt(&buyer, &order_id);
    // Panics here
    client.mock_all_auths().confirm_receipt(&buyer, &order_id);
}

#[test]
fn test_refund_expired_order() {
    let (env, client, buyer, farmer, token) = setup_test();
    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    let escrow_address = client.address.clone();
    assert_eq!(token.balance(&buyer), 500);
    assert_eq!(token.balance(&escrow_address), 500);

    // Fast forward time 96+ hours (96 * 60 * 60 + 1)
    env.ledger()
        .set_timestamp(env.ledger().timestamp() + 345601);

    client.mock_all_auths().refund_expired_order(&order_id);

    // Funds back to buyer
    assert_eq!(token.balance(&escrow_address), 0);
    assert_eq!(token.balance(&buyer), 1000);

    let order_details = client.get_order_details(&order_id);
    assert_eq!(order_details.status, OrderStatus::Refunded);
}

#[test]
#[should_panic(expected = "order has not expired yet")]
fn test_refund_unexpired_order_panics() {
    let (env, client, buyer, farmer, token) = setup_test();
    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    // Fast forward only 1 hour
    env.ledger().set_timestamp(env.ledger().timestamp() + 3600);

    // Panics here
    client.mock_all_auths().refund_expired_order(&order_id);
}
