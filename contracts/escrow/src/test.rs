#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token, Address, Env, IntoVal, String,
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
    // Issue #652 shared test-fixture fix: a fresh Env defaults to ledger
    // timestamp 0, which collides with `delivery_timestamp == 0` used
    // throughout this contract as the "not yet delivered" sentinel. Tests
    // that don't explicitly advance the clock before `mark_delivered` would
    // otherwise silently record a delivery_timestamp of 0, defeating the
    // "already delivered" guard. A live Stellar ledger never has timestamp
    // 0, so this is a test-fixture gap, not a contract bug — fixed here once
    // for every test built on this shared fixture instead of per-test.
    env.ledger().set_timestamp(1_000_000);

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

#[allow(dead_code)]
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
    // Issue #652 shared test-fixture fix: a fresh Env defaults to ledger
    // timestamp 0, which collides with `delivery_timestamp == 0` used
    // throughout this contract as the "not yet delivered" sentinel. Tests
    // that don't explicitly advance the clock before `mark_delivered` would
    // otherwise silently record a delivery_timestamp of 0, defeating the
    // "already delivered" guard. A live Stellar ledger never has timestamp
    // 0, so this is a test-fixture gap, not a contract bug — fixed here once
    // for every test built on this shared fixture instead of per-test.
    env.ledger().set_timestamp(1_000_000);

    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let xlm_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let xlm_client = token::Client::new(&env, &xlm_contract.address());
    let xlm_admin_client = token::StellarAssetClient::new(&env, &xlm_contract.address());
    xlm_admin_client.mint(&buyer, &1000);

    // Register the second required token; only its address is needed for the whitelist.
    let usdc_address = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();

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
    let (env, client, buyer, farmer, _collector, token, _, admin, _, _) = setup_test();

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    env.ledger().set_timestamp(1000);
    client
        .mock_all_auths()
        .mark_delivered(&farmer, &admin, &order_id);

    let order = client.get_order_details(&order_id);
    assert_eq!(order.status, OrderStatus::Pending);
    assert!(order.delivery_timestamp > 0);

    client.mock_all_auths().confirm_receipt(&buyer, &order_id);

    let order_after = client.get_order_details(&order_id);
    assert_eq!(order_after.status, OrderStatus::Completed);
}

#[test]
fn test_mark_delivered_wrong_farmer_fails() {
    let (env, client, buyer, farmer, _, token, _, admin, _, _) = setup_test();
    let fake_farmer = Address::generate(&env);

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    let result = client
        .mock_all_auths()
        .try_mark_delivered(&fake_farmer, &admin, &order_id);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::NotFarmer);
}

#[test]
fn test_mark_delivered_twice_succeeds() {
    let (env, client, buyer, farmer, _, token, _, admin, _, _) = setup_test();

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    client
        .mock_all_auths()
        .mark_delivered(&farmer, &admin, &order_id);
    env.ledger().set_timestamp(1000);
    let result = client
        .mock_all_auths()
        .try_mark_delivered(&farmer, &admin, &order_id);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::OrderNotPending);
}

#[test]
fn test_mark_delivered_wrong_attester_fails() {
    let (env, client, buyer, farmer, _, token, _, admin, _, _) = setup_test();
    let fake_attester = Address::generate(&env);
    client.mock_all_auths().set_attester(&admin, &admin);

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    let result = client
        .mock_all_auths()
        .try_mark_delivered(&farmer, &fake_attester, &order_id);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::NotAttester);
}

#[test]
fn test_mark_delivered_falls_back_to_admin_before_attester_configured() {
    let (_env, client, buyer, farmer, _, token, _, admin, _, _) = setup_test();

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    // No set_attester call: admin is the fallback attester.
    client
        .mock_all_auths()
        .mark_delivered(&farmer, &admin, &order_id);
    let order = client.get_order_details(&order_id);
    assert!(order.delivery_timestamp > 0);
}

#[test]
fn test_mark_delivered_uses_configured_attester() {
    let (env, client, buyer, farmer, _, token, _, admin, _, _) = setup_test();
    let attester = Address::generate(&env);
    client.mock_all_auths().set_attester(&admin, &attester);

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    // Admin (the pre-attester fallback) can no longer co-sign once a
    // dedicated attester is configured.
    let result = client
        .mock_all_auths()
        .try_mark_delivered(&farmer, &admin, &order_id);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::NotAttester);

    client
        .mock_all_auths()
        .mark_delivered(&farmer, &attester, &order_id);
    let order = client.get_order_details(&order_id);
    assert!(order.delivery_timestamp > 0);
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

    client
        .mock_all_auths()
        .refund_expired_order(&buyer, &order_id);

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
fn test_cancel_order_within_window_refunds_buyer() {
    let (env, client, buyer, farmer, collector, token, _, _, _, contract_id) = setup_test();
    let amount = 500i128;
    let fee = amount * 3 / 100;
    let net_amount = amount - fee;

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &amount);

    env.ledger().set_timestamp(env.ledger().timestamp() + 60);
    client.mock_all_auths().cancel_order(&buyer, &order_id);

    let order = client.get_order_details(&order_id);
    assert_eq!(order.status, OrderStatus::Refunded);

    assert_eq!(token.balance(&buyer), 1000 - amount + net_amount);
    assert_eq!(token.balance(&collector), fee);
    assert_eq!(token.balance(&contract_id), 0);
}

#[test]
fn test_cancel_order_fails_after_window_closes() {
    let (env, client, buyer, farmer, _, token, _, _, _, _) = setup_test();
    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    env.ledger()
        .set_timestamp(env.ledger().timestamp() + CANCEL_WINDOW_SECONDS + 1);

    let result = client.mock_all_auths().try_cancel_order(&buyer, &order_id);
    assert_eq!(
        result.unwrap_err().unwrap(),
        EscrowError::CancelWindowClosed
    );
}

#[test]
fn test_cancel_order_fails_after_delivery() {
    let (_env, client, buyer, farmer, _, token, _, admin, _, _) = setup_test();
    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    client
        .mock_all_auths()
        .mark_delivered(&farmer, &admin, &order_id);

    let result = client.mock_all_auths().try_cancel_order(&buyer, &order_id);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::OrderNotDelivered);
}

#[test]
fn test_cancel_order_wrong_buyer_fails() {
    let (env, client, buyer, farmer, _, token, _, _, _, _) = setup_test();
    let stranger = Address::generate(&env);
    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    let result = client
        .mock_all_auths()
        .try_cancel_order(&stranger, &order_id);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::NotBuyer);
}

#[test]
fn test_cancel_order_emits_distinct_event() {
    let (env, client, buyer, farmer, _, token, _, _, _, contract_id) = setup_test();
    let amount = 500i128;
    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &amount);

    client.mock_all_auths().cancel_order(&buyer, &order_id);

    // The test env's event log only retains the most recent top-level
    // invocation's events, so filtering to the escrow contract after
    // `cancel_order` isolates exactly the event it emitted. Confirms it's
    // the distinct `order:cancelled` topic, not a reused `order:refunded`.
    let mut escrow_events: soroban_sdk::Vec<(
        Address,
        soroban_sdk::Vec<soroban_sdk::Val>,
        soroban_sdk::Val,
    )> = soroban_sdk::Vec::new(&env);
    for evt in env.events().all().iter() {
        if evt.0 == contract_id {
            escrow_events.push_back(evt.clone());
        }
    }
    let expected: soroban_sdk::Vec<(
        Address,
        soroban_sdk::Vec<soroban_sdk::Val>,
        soroban_sdk::Val,
    )> = soroban_sdk::vec![
        &env,
        (
            contract_id,
            (symbol_short!("order"), symbol_short!("cancelled")).into_val(&env),
            (order_id, buyer).into_val(&env),
        ),
    ];
    assert_eq!(escrow_events, expected);
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
    assert_eq!(
        result.unwrap_err().unwrap(),
        EscrowError::AmountMustBePositive
    );
}

#[test]
fn test_create_order_negative_amount_fails() {
    let (_env, client, buyer, farmer, _collector, token, _, _, _, _) = setup_test();

    let result = client
        .mock_all_auths()
        .try_create_order(&buyer, &farmer, &token.address, &-1);
    assert_eq!(
        result.unwrap_err().unwrap(),
        EscrowError::AmountMustBePositive
    );
}

#[test]
fn test_create_order_buyer_auth_fails() {
    let (env, client, buyer, farmer, _, token, _, _, _, _) = setup_test();

    // Use mock_all_auths to successfully create an order while recording auths.
    client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    // Verify that the buyer's authorization was required by the contract.
    let auths = env.auths();
    assert!(!auths.is_empty(), "expected at least one auth entry");
    assert_eq!(
        auths[0].0, buyer,
        "expected buyer to be the authorized address"
    );
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
    assert!(!dispute.resolved);
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
    assert!(!dispute.resolved);
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

    assert_eq!(result.unwrap_err().unwrap(), EscrowError::OrderNotPending);
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

    client.mock_all_auths().resolve_dispute(
        &admin,
        &order_id,
        &DisputeResolution::Split(buyer_share_bps),
    );

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
    // Non-zero baseline ledger timestamp (Issue #652 fixture fix, see setup_test).
    env.ledger().set_timestamp(1_000_000);

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
    assert_eq!(
        result.unwrap_err().unwrap(),
        EscrowError::MustSupportTwoTokens
    );
}

#[test]
fn test_initialize_duplicate_fails() {
    let env = Env::default();
    env.mock_all_auths();
    // Non-zero baseline ledger timestamp (Issue #652 fixture fix, see setup_test).
    env.ledger().set_timestamp(1_000_000);

    let admin = Address::generate(&env);
    let fee_collector = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let xlm_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let usdc_address = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();

    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);

    let mut tokens = Vec::new(&env);
    tokens.push_back(xlm_contract.address());
    tokens.push_back(usdc_address);

    client.initialize(&admin, &fee_collector, &tokens);

    let result = client.try_initialize(&admin, &fee_collector, &tokens);
    assert_eq!(
        result.unwrap_err().unwrap(),
        EscrowError::AlreadyInitialized
    );
}

#[test]
fn test_initialize_requires_admin_auth() {
    // Issue #843: initialize() must require the admin's authorization, so a
    // front-runner who never signed cannot seize admin on a fresh deploy.
    // Deliberately no mock_all_auths() — the caller must prove they control
    // the admin address or the call is rejected before any state is written.
    let env = Env::default();
    // Non-zero baseline ledger timestamp (Issue #652 fixture fix, see setup_test).
    env.ledger().set_timestamp(1_000_000);

    let attacker = Address::generate(&env);
    let fee_collector = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let xlm_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let usdc_address = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();

    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);

    let mut tokens = Vec::new(&env);
    tokens.push_back(xlm_contract.address());
    tokens.push_back(usdc_address);

    // The attacker did not authorize `initialize`, so require_auth() traps.
    let result = client.try_initialize(&attacker, &fee_collector, &tokens);
    assert!(result.is_err());

    // No state was written — the contract is still uninitialized.
    let readback = client.try_get_admin();
    assert_eq!(
        readback.unwrap_err().unwrap(),
        EscrowError::ContractNotInitialized
    );
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

// ---------------------------------------------------------------------------
// Upgrade, guardian, pause (Issue #757)
// ---------------------------------------------------------------------------

#[test]
fn test_upgrade_bypassing_governance_rejected() {
    let (_env, client, _buyer, _farmer, _collector, _xlm, _usdc, _admin, _investor1, _id) =
        setup_test();

    let attacker = Address::generate(&_env);
    let dummy_wasm_hash = soroban_sdk::BytesN::from_array(&_env, &[9u8; 32]);
    let result = client
        .mock_all_auths()
        .try_upgrade(&attacker, &dummy_wasm_hash);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::NotAdmin);
}

#[test]
fn test_guardian_can_pause_instantly_governance_only_can_unpause() {
    let (env, client, buyer, farmer, _collector, token, _, admin, _investor1, _id) = setup_test();

    let governance = env.register(MockGovernance, ());
    client.set_governance_contract(&admin, &governance);

    let guardian = Address::generate(&env);
    client.set_guardian(&governance, &guardian);

    // Guardian pauses instantly — no proposal, no timelock.
    client.pause(&guardian);
    assert!(client.is_paused());

    // Paused: the core fund-moving path is blocked.
    let result = client
        .mock_all_auths()
        .try_create_order(&buyer, &farmer, &token.address, &500);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::ContractPaused);

    let cancel_res = client.mock_all_auths().try_cancel_order(&buyer, &1);
    assert_eq!(
        cancel_res.unwrap_err().unwrap(),
        EscrowError::ContractPaused
    );

    let mark_res = client
        .mock_all_auths()
        .try_mark_delivered(&farmer, &admin, &1);
    assert_eq!(mark_res.unwrap_err().unwrap(), EscrowError::ContractPaused);

    let dispute_res = client.mock_all_auths().try_open_dispute(
        &buyer,
        &1,
        &String::from_str(&env, "reason"),
        &String::from_str(&env, "hash"),
    );
    assert_eq!(
        dispute_res.unwrap_err().unwrap(),
        EscrowError::ContractPaused
    );

    // The guardian cannot unpause — only governance can.
    let err = client.try_unpause(&guardian).unwrap_err().unwrap();
    assert_eq!(err, EscrowError::NotGoverned);

    client.unpause(&governance);
    assert!(!client.is_paused());

    // Normal operation resumes.
    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);
    assert_eq!(order_id, 1);
}

#[test]
fn test_path_payment_router_admin_fallback_before_governance_set() {
    let (env, client, _buyer, _farmer, _fee_collector, _xlm, _usdc, admin, _investor1, _id) =
        setup_test();

    // No governance contract configured yet: admin can still set the router.
    let router = Address::generate(&env);
    client.set_path_payment_router(&admin, &router);
}

#[test]
fn test_path_payment_router_rejects_admin_once_governance_set() {
    let (env, client, _buyer, _farmer, _fee_collector, _xlm, _usdc, admin, _investor1, _id) =
        setup_test();

    let governance = env.register(MockGovernance, ());
    client.set_governance_contract(&admin, &governance);

    // Raw admin can no longer call set_path_payment_router once governance is set.
    let router = Address::generate(&env);
    let result = client.try_set_path_payment_router(&admin, &router);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::NotGoverned);

    // The governance contract address can.
    client.set_path_payment_router(&governance, &router);
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
        env.storage()
            .instance()
            .set(&symbol_short!("quote"), &quote);
        env.storage()
            .instance()
            .set(&symbol_short!("actual"), &actual_out);
    }

    /// Issue #683: makes `swap_exact_in` return `reported` instead of the
    /// `actual_out` it really pays out, simulating a compromised or
    /// malicious router that misreports its own fill.
    pub fn set_misreport(env: Env, reported: i128) {
        env.storage()
            .instance()
            .set(&symbol_short!("report"), &reported);
    }

    pub fn get_quote(
        env: Env,
        _send_token: Address,
        _dest_token: Address,
        _send_amount: i128,
    ) -> i128 {
        env.storage()
            .instance()
            .get(&symbol_short!("quote"))
            .unwrap()
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
        let actual_out: i128 = env
            .storage()
            .instance()
            .get(&symbol_short!("actual"))
            .unwrap();
        token::Client::new(&env, &send_token).transfer(
            &from,
            &env.current_contract_address(),
            &send_amount,
        );
        token::Client::new(&env, &dest_token).transfer(
            &env.current_contract_address(),
            &to,
            &actual_out,
        );
        env.storage()
            .instance()
            .get(&symbol_short!("report"))
            .unwrap_or(actual_out)
    }
}

fn setup_path_payment_test(
    quote: i128,
    actual_out: i128,
) -> (
    Env,
    EscrowContractClient<'static>,
    Address,                // buyer
    Address,                // farmer
    Address,                // fee_collector
    token::Client<'static>, // source (non-whitelisted) token
    token::Client<'static>, // settlement token (whitelisted)
    Address,                // admin
) {
    let env = Env::default();
    env.mock_all_auths();
    // Non-zero baseline ledger timestamp (Issue #652 fixture fix, see setup_test).
    env.ledger().set_timestamp(1_000_000);

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

    let xlm_address = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();

    let router_id = env.register(MockRouter, ());
    let router_client_setup = MockRouterClient::new(&env, &router_id);
    router_client_setup.configure(&quote, &actual_out);
    // Fund the router with the settlement-token liquidity it pays out on swap.
    token::StellarAssetClient::new(&env, &settlement_contract.address())
        .mint(&router_id, &actual_out);

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
    // Non-zero baseline ledger timestamp (Issue #652 fixture fix, see setup_test).
    env.ledger().set_timestamp(1_000_000);

    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let fee_collector = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let source_address = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let settlement_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let xlm_address = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();

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
    assert_eq!(
        result.unwrap_err().unwrap(),
        EscrowError::RouterNotConfigured
    );
}

#[test]
fn test_create_order_via_path_payment_rejects_router_misreporting_dest_received() {
    // The router claims (via its swap return value) that it delivered 990,
    // well within tolerance of a 1000 quote, but only actually transfers 100
    // of the settlement token to the escrow — simulating a compromised or
    // malicious router (Issue #683).
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000_000);

    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let fee_collector = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let source_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let source_client = token::Client::new(&env, &source_contract.address());
    token::StellarAssetClient::new(&env, &source_contract.address()).mint(&buyer, &10_000);

    let settlement_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let xlm_address = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();

    let router_id = env.register(MockRouter, ());
    let router_client_setup = MockRouterClient::new(&env, &router_id);
    router_client_setup.configure(&1_000, &100);
    router_client_setup.set_misreport(&990);
    token::StellarAssetClient::new(&env, &settlement_contract.address()).mint(&router_id, &100);

    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);

    let mut supported_tokens = Vec::new(&env);
    supported_tokens.push_back(settlement_contract.address());
    supported_tokens.push_back(xlm_address);
    client.initialize(&admin, &fee_collector, &supported_tokens);
    client.set_path_payment_router(&admin, &router_id);

    let result = client.try_create_order_via_path_payment(
        &buyer,
        &farmer,
        &source_client.address,
        &1_000,
        &settlement_contract.address(),
        &1, // buyer's own floor is not the binding constraint here
    );

    // Rejected because the escrow's measured settlement-token balance only
    // increased by 100, not the 990 the router falsely reported.
    assert_eq!(
        result.unwrap_err().unwrap(),
        EscrowError::SlippageToleranceExceeded
    );
    // The whole invocation reverts on error, so no funds actually moved.
    assert_eq!(source_client.balance(&buyer), 10_000);
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
        env.storage()
            .instance()
            .set(&symbol_short!("calls"), &calls);
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

// ── Multi-party split orders (Issue #654) ──────────────────────────────────

fn setup_split_test(
    co_buyer_count: u32,
) -> (
    Env,
    EscrowContractClient<'static>,
    Address,
    Vec<Address>,
    token::Client<'static>,
    Address,
    Address,
) {
    let (env, client, _buyer, farmer, _collector, token, _, admin, _, contract_id) = setup_test();

    let sac = token::StellarAssetClient::new(&env, &token.address);
    let mut co_buyers = Vec::new(&env);
    for _ in 0..co_buyer_count {
        let co_buyer = Address::generate(&env);
        sac.mint(&co_buyer, &1_000);
        co_buyers.push_back(co_buyer);
    }

    (env, client, farmer, co_buyers, token, contract_id, admin)
}

#[test]
fn test_create_split_order_validates_shares() {
    let (env, client, farmer, co_buyers, token, _, _admin) = setup_split_test(3);
    let initiator = co_buyers.get(0).unwrap();

    let mut shares = Vec::new(&env);
    shares.push_back(300i128);
    shares.push_back(400i128);
    // Missing third share: length mismatch.
    let result = client.mock_all_auths().try_create_split_order(
        &initiator,
        &farmer,
        &token.address,
        &co_buyers,
        &shares,
    );
    assert_eq!(
        result.unwrap_err().unwrap(),
        EscrowError::SplitSharesMustSumToTotal
    );
}

#[test]
fn test_split_order_partial_funding_stays_in_funding_state() {
    let (env, client, farmer, co_buyers, token, contract_id, _admin) = setup_split_test(3);
    let mut shares = Vec::new(&env);
    shares.push_back(300i128);
    shares.push_back(300i128);
    shares.push_back(400i128);

    let order_id = client.mock_all_auths().create_split_order(
        &co_buyers.get(0).unwrap(),
        &farmer,
        &token.address,
        &co_buyers,
        &shares,
    );

    // Only the first co-buyer funds their share.
    client
        .mock_all_auths()
        .fund_split_order(&co_buyers.get(0).unwrap(), &order_id);

    let order = client.get_split_order(&order_id);
    assert_eq!(order.status, SplitOrderStatus::Funding);
    assert_eq!(order.funded_count, 1);
    // Farmer has not been paid — funds are held, not disbursed.
    assert_eq!(token.balance(&farmer), 0);
    assert_eq!(token.balance(&contract_id), 300);
}

#[test]
fn test_split_order_becomes_active_once_fully_funded() {
    let (env, client, farmer, co_buyers, token, _, _admin) = setup_split_test(2);
    let mut shares = Vec::new(&env);
    shares.push_back(500i128);
    shares.push_back(500i128);

    let order_id = client.mock_all_auths().create_split_order(
        &co_buyers.get(0).unwrap(),
        &farmer,
        &token.address,
        &co_buyers,
        &shares,
    );
    client
        .mock_all_auths()
        .fund_split_order(&co_buyers.get(0).unwrap(), &order_id);
    let mid = client.get_split_order(&order_id);
    assert_eq!(mid.status, SplitOrderStatus::Funding);

    client
        .mock_all_auths()
        .fund_split_order(&co_buyers.get(1).unwrap(), &order_id);
    let order = client.get_split_order(&order_id);
    assert_eq!(order.status, SplitOrderStatus::Active);
    // 3% platform fee taken once on full funding: 1000 - 30 = 970.
    assert_eq!(order.net_amount, 970);
}

#[test]
fn test_split_order_fund_twice_fails() {
    let (env, client, farmer, co_buyers, token, _, _admin) = setup_split_test(2);
    let mut shares = Vec::new(&env);
    shares.push_back(500i128);
    shares.push_back(500i128);

    let order_id = client.mock_all_auths().create_split_order(
        &co_buyers.get(0).unwrap(),
        &farmer,
        &token.address,
        &co_buyers,
        &shares,
    );
    client
        .mock_all_auths()
        .fund_split_order(&co_buyers.get(0).unwrap(), &order_id);
    let result = client
        .mock_all_auths()
        .try_fund_split_order(&co_buyers.get(0).unwrap(), &order_id);
    assert_eq!(
        result.unwrap_err().unwrap(),
        EscrowError::AlreadyContributed
    );
}

#[test]
fn test_split_order_majority_by_value_releases_despite_non_confirming_contributor() {
    // Shares: 600 / 200 / 200. The 600-share co-buyer alone is a strict
    // majority by value, so the order completes even though the other two
    // co-buyers never confirm.
    let (env, client, farmer, co_buyers, token, contract_id, _admin) = setup_split_test(3);
    let mut shares = Vec::new(&env);
    shares.push_back(600i128);
    shares.push_back(200i128);
    shares.push_back(200i128);

    let order_id = client.mock_all_auths().create_split_order(
        &co_buyers.get(0).unwrap(),
        &farmer,
        &token.address,
        &co_buyers,
        &shares,
    );
    for co_buyer in co_buyers.iter() {
        client
            .mock_all_auths()
            .fund_split_order(&co_buyer, &order_id);
    }
    client
        .mock_all_auths()
        .mark_split_delivered(&farmer, &order_id);

    // Only the majority-share (non-confirming-others) co-buyer confirms.
    client
        .mock_all_auths()
        .confirm_split_receipt(&co_buyers.get(0).unwrap(), &order_id);

    let order = client.get_split_order(&order_id);
    assert_eq!(order.status, SplitOrderStatus::Completed);
    assert_eq!(token.balance(&farmer), 970);
    assert_eq!(token.balance(&contract_id), 0);
}

#[test]
fn test_split_order_even_split_requires_unanimous_confirmation() {
    // Shares: 500 / 500. Neither co-buyer alone is a strict majority, so
    // both must confirm before the farmer is paid.
    let (env, client, farmer, co_buyers, token, _, _admin) = setup_split_test(2);
    let mut shares = Vec::new(&env);
    shares.push_back(500i128);
    shares.push_back(500i128);

    let order_id = client.mock_all_auths().create_split_order(
        &co_buyers.get(0).unwrap(),
        &farmer,
        &token.address,
        &co_buyers,
        &shares,
    );
    for co_buyer in co_buyers.iter() {
        client
            .mock_all_auths()
            .fund_split_order(&co_buyer, &order_id);
    }
    client
        .mock_all_auths()
        .mark_split_delivered(&farmer, &order_id);

    client
        .mock_all_auths()
        .confirm_split_receipt(&co_buyers.get(0).unwrap(), &order_id);
    let mid = client.get_split_order(&order_id);
    assert_eq!(mid.status, SplitOrderStatus::Active);
    assert_eq!(token.balance(&farmer), 0);

    client
        .mock_all_auths()
        .confirm_split_receipt(&co_buyers.get(1).unwrap(), &order_id);
    let order = client.get_split_order(&order_id);
    assert_eq!(order.status, SplitOrderStatus::Completed);
    assert_eq!(token.balance(&farmer), 970);
}

#[test]
fn test_split_order_dispute_refund_is_pro_rata_across_all_contributors() {
    let (env, client, farmer, co_buyers, token, contract_id, admin) = setup_split_test(3);
    let mut shares = Vec::new(&env);
    shares.push_back(500i128);
    shares.push_back(300i128);
    shares.push_back(200i128);

    let order_id = client.mock_all_auths().create_split_order(
        &co_buyers.get(0).unwrap(),
        &farmer,
        &token.address,
        &co_buyers,
        &shares,
    );
    for co_buyer in co_buyers.iter() {
        client
            .mock_all_auths()
            .fund_split_order(&co_buyer, &order_id);
    }

    let reason = String::from_str(&env, "produce never arrived");
    let evidence_hash = String::from_str(&env, "hash");
    client.mock_all_auths().open_split_dispute(
        &co_buyers.get(2).unwrap(),
        &order_id,
        &reason,
        &evidence_hash,
    );

    client
        .mock_all_auths()
        .resolve_split_dispute(&admin, &order_id, &DisputeResolution::Refund);

    let order = client.get_split_order(&order_id);
    assert_eq!(order.status, SplitOrderStatus::Refunded);
    // net_amount = 1000 - 3% fee = 970, pro-rata over shares 500/300/200.
    assert_eq!(token.balance(&co_buyers.get(0).unwrap()), 1_000 - 500 + 485);
    assert_eq!(token.balance(&co_buyers.get(1).unwrap()), 1_000 - 300 + 291);
    assert_eq!(token.balance(&co_buyers.get(2).unwrap()), 1_000 - 200 + 194);
    assert_eq!(token.balance(&contract_id), 0);
    assert_eq!(token.balance(&farmer), 0);
}

#[test]
fn test_fund_split_order_non_co_buyer_fails() {
    let (env, client, farmer, co_buyers, token, _, _admin) = setup_split_test(2);
    let mut shares = Vec::new(&env);
    shares.push_back(500i128);
    shares.push_back(500i128);
    let order_id = client.mock_all_auths().create_split_order(
        &co_buyers.get(0).unwrap(),
        &farmer,
        &token.address,
        &co_buyers,
        &shares,
    );

    let stranger = Address::generate(&env);
    let result = client
        .mock_all_auths()
        .try_fund_split_order(&stranger, &order_id);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::NotCoBuyer);
}
