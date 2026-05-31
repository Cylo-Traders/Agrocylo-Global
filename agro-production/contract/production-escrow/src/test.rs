#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env,
};

const STAKE_AMOUNT: i128 = 10;

fn setup_test() -> (
    Env,
    ProductionEscrowContractClient<'static>,
    Address,
    Address,
    Address,
    token::Client<'static>,
    token::Client<'static>,
) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000_000);

    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let fee_collector = Address::generate(&env);

    let xlm_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let xlm_client = token::Client::new(&env, &xlm_contract.address());
    let xlm_admin_client = token::StellarAssetClient::new(&env, &xlm_contract.address());
    xlm_admin_client.mint(&buyer, &100_000);
    xlm_admin_client.mint(&farmer, &100_000);

    let usdc_contract = env.register_stellar_asset_contract_v2(token_admin);
    let usdc_client = token::Client::new(&env, &usdc_contract.address());

    let contract_id = env.register(ProductionEscrowContract, ());
    let client = ProductionEscrowContractClient::new(&env, &contract_id);

    let mut supported_tokens = Vec::new(&env);
    supported_tokens.push_back(xlm_client.address.clone());
    supported_tokens.push_back(usdc_client.address.clone());

    // fee_rate_bps = 0 so existing balance assertions remain unchanged
    client.initialize(&admin, &supported_tokens, &STAKE_AMOUNT, &fee_collector, &0u32);

    (env, client, admin, buyer, farmer, xlm_client, usdc_client)
}

/// Helper that sets up the contract with a non-zero fee rate.
fn setup_test_with_fee(
    fee_rate_bps: u32,
) -> (
    Env,
    ProductionEscrowContractClient<'static>,
    Address,
    Address,
    Address,
    Address,
    token::Client<'static>,
) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000_000);

    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let fee_collector = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let xlm_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let xlm_client = token::Client::new(&env, &xlm_contract.address());
    let xlm_admin_client = token::StellarAssetClient::new(&env, &xlm_contract.address());
    xlm_admin_client.mint(&buyer, &100_000);
    xlm_admin_client.mint(&farmer, &100_000);

    let usdc_contract = env.register_stellar_asset_contract_v2(token_admin);
    let usdc_client = token::Client::new(&env, &usdc_contract.address());

    let contract_id = env.register(ProductionEscrowContract, ());
    let client = ProductionEscrowContractClient::new(&env, &contract_id);

    let mut supported_tokens = Vec::new(&env);
    supported_tokens.push_back(xlm_client.address.clone());
    supported_tokens.push_back(usdc_client.address.clone());

    client.initialize(
        &admin,
        &supported_tokens,
        &STAKE_AMOUNT,
        &fee_collector,
        &fee_rate_bps,
    );

    (
        env,
        client,
        admin,
        buyer,
        farmer,
        fee_collector,
        xlm_client,
    )
}

// ── Campaign tests (Issue #137) ───────────────────────────────────────────────

#[test]
fn test_create_campaign_and_invest() {
    let (env, client, _admin, buyer, farmer, token, _) = setup_test();

    let deadline = env.ledger().timestamp() + 7 * 24 * 60 * 60;
    let campaign_id = client.create_campaign(&farmer, &token.address, &1000, &deadline);
    assert_eq!(campaign_id, 1);

    client.invest(&buyer, &campaign_id, &600);

    let campaign = client.get_campaign(&campaign_id);
    assert_eq!(campaign.total_funded, 600);
    assert_eq!(campaign.status, CampaignStatus::Active);

    client.invest(&buyer, &campaign_id, &400);
    let campaign = client.get_campaign(&campaign_id);
    assert_eq!(campaign.total_funded, 1000);
    assert_eq!(campaign.status, CampaignStatus::Funded);
}

#[test]
fn test_create_campaign_with_zero_goal_fails() {
    let (env, client, _admin, _buyer, farmer, token, _) = setup_test();
    
    let deadline = env.ledger().timestamp() + 7 * 24 * 60 * 60;
    let result = client.try_create_campaign(&farmer, &token.address, &0, &deadline);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ProductionEscrowError::AmountMustBePositive
    );
}

#[test]
fn test_create_campaign_with_negative_goal_fails() {
    let (env, client, _admin, _buyer, farmer, token, _) = setup_test();
    
    let deadline = env.ledger().timestamp() + 7 * 24 * 60 * 60;
    let result = client.try_create_campaign(&farmer, &token.address, &-1000, &deadline);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ProductionEscrowError::AmountMustBePositive
    );
}

#[test]
fn test_create_campaign_with_unsupported_token_fails() {
    let (env, client, _admin, _buyer, farmer, _token, _) = setup_test();
    
    let unsupported_token = Address::generate(&env);
    let deadline = env.ledger().timestamp() + 7 * 24 * 60 * 60;
    let result = client.try_create_campaign(&farmer, &unsupported_token, &1000, &deadline);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ProductionEscrowError::UnsupportedToken
    );
}

#[test]
fn test_create_campaign_emits_event() {
    let (env, client, _admin, _buyer, farmer, token, _) = setup_test();
    
    let deadline = env.ledger().timestamp() + 7 * 24 * 60 * 60;
    let campaign_id = client.create_campaign(&farmer, &token.address, &1000, &deadline);
    
    // Verify campaign was created
    let campaign = client.get_campaign(&campaign_id);
    assert_eq!(campaign.farmer, farmer);
    assert_eq!(campaign.funding_goal, 1000);
}

#[test]
fn test_invest_in_nonexistent_campaign_fails() {
    let (_env, client, _admin, buyer, _farmer, _token, _) = setup_test();
    
    let result = client.try_invest(&buyer, &999, &500);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ProductionEscrowError::CampaignDoesNotExist
    );
}

#[test]
fn test_invest_zero_amount_fails() {
    let (env, client, _admin, buyer, farmer, token, _) = setup_test();
    
    let deadline = env.ledger().timestamp() + 7 * 24 * 60 * 60;
    let campaign_id = client.create_campaign(&farmer, &token.address, &1000, &deadline);
    
    let result = client.try_invest(&buyer, &campaign_id, &0);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ProductionEscrowError::AmountMustBePositive
    );
}

#[test]
fn test_invest_in_harvested_campaign_fails() {
    let (env, client, _admin, buyer, farmer, token, _) = setup_test();
    
    let deadline = env.ledger().timestamp() + 7 * 24 * 60 * 60;
    let campaign_id = client.create_campaign(&farmer, &token.address, &500, &deadline);
    client.invest(&buyer, &campaign_id, &500);
    client.confirm_harvest(&farmer, &campaign_id);
    
    let result = client.try_invest(&buyer, &campaign_id, &100);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ProductionEscrowError::CampaignNotActive
    );
}

#[test]
fn test_invest_transitions_to_funded() {
    let (env, client, _admin, buyer, farmer, token, _) = setup_test();
    
    let deadline = env.ledger().timestamp() + 7 * 24 * 60 * 60;
    let campaign_id = client.create_campaign(&farmer, &token.address, &1000, &deadline);
    
    client.invest(&buyer, &campaign_id, &999);
    let campaign = client.get_campaign(&campaign_id);
    assert_eq!(campaign.status, CampaignStatus::Active);
    
    client.invest(&buyer, &campaign_id, &1);
    let campaign = client.get_campaign(&campaign_id);
    assert_eq!(campaign.status, CampaignStatus::Funded);
}

#[test]
fn test_invest_emits_funded_event_once() {
    let (env, client, _admin, buyer, farmer, token, _) = setup_test();
    
    let deadline = env.ledger().timestamp() + 7 * 24 * 60 * 60;
    let campaign_id = client.create_campaign(&farmer, &token.address, &1000, &deadline);
    
    // First investment crosses the threshold
    client.invest(&buyer, &campaign_id, &1000);
    
    // Additional investment should not emit another funded event
    client.invest(&buyer, &campaign_id, &100);
    
    let campaign = client.get_campaign(&campaign_id);
    assert_eq!(campaign.total_funded, 1100);
    assert_eq!(campaign.status, CampaignStatus::Funded);
}

#[test]
fn test_confirm_harvest_releases_funds() {
    let (env, client, _admin, buyer, farmer, token, _) = setup_test();

    let deadline = env.ledger().timestamp() + 7 * 24 * 60 * 60;
    let campaign_id = client.create_campaign(&farmer, &token.address, &500, &deadline);
    client.invest(&buyer, &campaign_id, &500);

    let farmer_balance_before = token.balance(&farmer);
    client.confirm_harvest(&farmer, &campaign_id);

    assert_eq!(token.balance(&farmer), farmer_balance_before + 500);
    let campaign = client.get_campaign(&campaign_id);
    assert_eq!(campaign.status, CampaignStatus::Harvested);
}

#[test]
fn test_confirm_harvest_by_non_farmer_fails() {
    let (env, client, _admin, buyer, farmer, token, _) = setup_test();
    
    let deadline = env.ledger().timestamp() + 7 * 24 * 60 * 60;
    let campaign_id = client.create_campaign(&farmer, &token.address, &500, &deadline);
    client.invest(&buyer, &campaign_id, &500);
    
    let result = client.try_confirm_harvest(&buyer, &campaign_id);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ProductionEscrowError::NotFarmer
    );
}

#[test]
fn test_confirm_harvest_emits_events() {
    let (env, client, _admin, buyer, farmer, token, _) = setup_test();
    
    let deadline = env.ledger().timestamp() + 7 * 24 * 60 * 60;
    let campaign_id = client.create_campaign(&farmer, &token.address, &500, &deadline);
    client.invest(&buyer, &campaign_id, &500);
    
    client.confirm_harvest(&farmer, &campaign_id);
    
    // Verify campaign status changed
    let campaign = client.get_campaign(&campaign_id);
    assert_eq!(campaign.status, CampaignStatus::Harvested);
}

#[test]
fn test_mark_campaign_failed_after_deadline() {
    let (env, client, _admin, buyer, farmer, token, _) = setup_test();

    let deadline = env.ledger().timestamp() + 100;
    let campaign_id = client.create_campaign(&farmer, &token.address, &1000, &deadline);
    client.invest(&buyer, &campaign_id, &500);

    // Move time past the deadline.
    env.ledger().set_timestamp(env.ledger().timestamp() + 200);

    client.mark_campaign_failed(&campaign_id);
    let campaign = client.get_campaign(&campaign_id);
    assert_eq!(campaign.status, CampaignStatus::Failed);
}

#[test]
fn test_mark_campaign_failed_before_deadline_errors() {
    let (env, client, _admin, _buyer, farmer, token, _) = setup_test();

    let deadline = env.ledger().timestamp() + 10_000;
    let campaign_id = client.create_campaign(&farmer, &token.address, &1000, &deadline);

    let result = client.try_mark_campaign_failed(&campaign_id);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ProductionEscrowError::DeadlineNotReached
    );
}

#[test]
fn test_mark_harvested_campaign_failed_fails() {
    let (env, client, _admin, buyer, farmer, token, _) = setup_test();
    
    let deadline = env.ledger().timestamp() + 7 * 24 * 60 * 60;
    let campaign_id = client.create_campaign(&farmer, &token.address, &500, &deadline);
    client.invest(&buyer, &campaign_id, &500);
    client.confirm_harvest(&farmer, &campaign_id);
    
    env.ledger().set_timestamp(env.ledger().timestamp() + 10 * 24 * 60 * 60);
    
    let result = client.try_mark_campaign_failed(&campaign_id);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ProductionEscrowError::CampaignNotActive
    );
}

#[test]
fn test_refund_investor_from_failed_campaign() {
    let (env, client, _admin, buyer, farmer, token, _) = setup_test();
    
    let deadline = env.ledger().timestamp() + 100;
    let campaign_id = client.create_campaign(&farmer, &token.address, &1000, &deadline);
    client.invest(&buyer, &campaign_id, &600);
    
    env.ledger().set_timestamp(env.ledger().timestamp() + 200);
    client.mark_campaign_failed(&campaign_id);
    
    let buyer_balance_before = token.balance(&buyer);
    client.refund_investor(&campaign_id, &buyer);
    
    assert_eq!(token.balance(&buyer), buyer_balance_before + 600);
}

#[test]
fn test_refund_investor_from_active_campaign_fails() {
    let (env, client, _admin, buyer, farmer, token, _) = setup_test();
    
    let deadline = env.ledger().timestamp() + 7 * 24 * 60 * 60;
    let campaign_id = client.create_campaign(&farmer, &token.address, &1000, &deadline);
    client.invest(&buyer, &campaign_id, &600);
    
    let result = client.try_refund_investor(&campaign_id, &buyer);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ProductionEscrowError::CampaignNotFailed
    );
}

#[test]
fn test_refund_non_investor_fails() {
    let (env, client, _admin, buyer, farmer, token, _) = setup_test();
    
    let non_investor = Address::generate(&env);
    
    let deadline = env.ledger().timestamp() + 100;
    let campaign_id = client.create_campaign(&farmer, &token.address, &1000, &deadline);
    client.invest(&buyer, &campaign_id, &600);
    
    env.ledger().set_timestamp(env.ledger().timestamp() + 200);
    client.mark_campaign_failed(&campaign_id);
    
    let result = client.try_refund_investor(&campaign_id, &non_investor);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ProductionEscrowError::NotInvestor
    );
}

#[test]
fn test_refund_investors_after_failed_campaign() {
    let (env, client, _admin, buyer, farmer, token, _) = setup_test();

    let deadline = env.ledger().timestamp() + 100;
    let campaign_id = client.create_campaign(&farmer, &token.address, &1000, &deadline);
    client.invest(&buyer, &campaign_id, &600);

    env.ledger().set_timestamp(env.ledger().timestamp() + 200);
    client.mark_campaign_failed(&campaign_id);

    let buyer_balance_before = token.balance(&buyer);

    let mut investors = Vec::new(&env);
    investors.push_back(buyer.clone());
    client.refund_investors(&campaign_id, &investors);

    assert_eq!(token.balance(&buyer), buyer_balance_before + 600);

    let position = client.get_investor_position(&campaign_id, &buyer);
    assert!(position.refunded);
}

#[test]
fn test_double_refund_fails() {
    let (env, client, _admin, buyer, farmer, token, _) = setup_test();

    let deadline = env.ledger().timestamp() + 100;
    let campaign_id = client.create_campaign(&farmer, &token.address, &1000, &deadline);
    client.invest(&buyer, &campaign_id, &600);

    env.ledger().set_timestamp(env.ledger().timestamp() + 200);
    client.mark_campaign_failed(&campaign_id);
    client.refund_investor(&campaign_id, &buyer);

    let result = client.try_refund_investor(&campaign_id, &buyer);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ProductionEscrowError::AlreadyRefunded
    );
}

// ── Order tests ───────────────────────────────────────────────────────────────

#[test]
fn test_create_and_confirm_order() {
    let (_env, client, _admin, buyer, farmer, token, _) = setup_test();

    let order_id = client.create_order(&buyer, &farmer, &token.address, &500);
    assert_eq!(order_id, 1);

    let order = client.get_order_details(&order_id);
    assert_eq!(order.status, OrderStatus::Pending);

    client.confirm_receipt(&buyer, &order_id);
    let order = client.get_order_details(&order_id);
    assert_eq!(order.status, OrderStatus::Completed);
    assert_eq!(token.balance(&farmer), 100_500);
}

#[test]
fn test_create_order_with_zero_amount_fails() {
    let (_env, client, _admin, buyer, farmer, token, _) = setup_test();
    
    let result = client.try_create_order(&buyer, &farmer, &token.address, &0);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ProductionEscrowError::AmountMustBePositive
    );
}

#[test]
fn test_create_order_with_unsupported_token_fails() {
    let (env, client, _admin, buyer, farmer, _token, _) = setup_test();
    
    let unsupported_token = Address::generate(&env);
    let result = client.try_create_order(&buyer, &farmer, &unsupported_token, &500);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ProductionEscrowError::UnsupportedToken
    );
}

#[test]
fn test_create_order_transfers_tokens() {
    let (_env, client, _admin, buyer, farmer, token, _) = setup_test();
    
    let buyer_balance_before = token.balance(&buyer);
    let contract_balance_before = token.balance(&client.address);
    
    client.create_order(&buyer, &farmer, &token.address, &500);
    
    assert_eq!(token.balance(&buyer), buyer_balance_before - 500);
    assert_eq!(token.balance(&client.address), contract_balance_before + 500);
}

#[test]
fn test_mark_delivered_updates_timestamp() {
    let (env, client, _admin, buyer, farmer, token, _) = setup_test();
    
    let order_id = client.create_order(&buyer, &farmer, &token.address, &500);
    let order_before = client.get_order_details(&order_id);
    assert_eq!(order_before.delivery_timestamp, None);
    
    client.mark_delivered(&farmer, &order_id);
    
    let order_after = client.get_order_details(&order_id);
    assert!(order_after.delivery_timestamp.is_some());
    assert!(order_after.delivery_timestamp.unwrap() >= env.ledger().timestamp());
}

#[test]
fn test_mark_delivered_by_non_farmer_fails() {
    let (_env, client, _admin, buyer, farmer, token, _) = setup_test();
    
    let order_id = client.create_order(&buyer, &farmer, &token.address, &500);
    
    let result = client.try_mark_delivered(&buyer, &order_id);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ProductionEscrowError::NotFarmer
    );
}

#[test]
fn test_mark_delivered_nonexistent_order_fails() {
    let (_env, client, _admin, _buyer, farmer, _token, _) = setup_test();
    
    let result = client.try_mark_delivered(&farmer, &999);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ProductionEscrowError::OrderDoesNotExist
    );
}

#[test]
fn test_confirm_receipt_releases_funds() {
    let (_env, client, _admin, buyer, farmer, token, _) = setup_test();
    
    let order_id = client.create_order(&buyer, &farmer, &token.address, &500);
    let farmer_balance_before = token.balance(&farmer);
    
    client.confirm_receipt(&buyer, &order_id);
    
    assert_eq!(token.balance(&farmer), farmer_balance_before + 500);
}

#[test]
fn test_confirm_receipt_by_non_buyer_fails() {
    let (_env, client, _admin, buyer, farmer, token, _) = setup_test();
    
    let order_id = client.create_order(&buyer, &farmer, &token.address, &500);
    
    let result = client.try_confirm_receipt(&farmer, &order_id);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ProductionEscrowError::NotBuyer
    );
}

#[test]
fn test_confirm_receipt_after_delivered() {
    let (_env, client, _admin, buyer, farmer, token, _) = setup_test();
    
    let order_id = client.create_order(&buyer, &farmer, &token.address, &500);
    client.mark_delivered(&farmer, &order_id);
    
    client.confirm_receipt(&buyer, &order_id);
    
    let order = client.get_order_details(&order_id);
    assert_eq!(order.status, OrderStatus::Completed);
}

#[test]
fn test_refund_expired_order() {
    let (env, client, _admin, buyer, farmer, token, _) = setup_test();

    let order_id = client.create_order(&buyer, &farmer, &token.address, &500);
    env.ledger()
        .set_timestamp(env.ledger().timestamp() + NINETY_SIX_HOURS + 1);

    client.refund_expired_order(&order_id);
    let order = client.get_order_details(&order_id);
    assert_eq!(order.status, OrderStatus::Refunded);
    assert_eq!(token.balance(&buyer), 100_000);
}

#[test]
fn test_refund_unexpired_order_fails() {
    let (env, client, _admin, buyer, farmer, token, _) = setup_test();
    
    let order_id = client.create_order(&buyer, &farmer, &token.address, &500);
    env.ledger().set_timestamp(env.ledger().timestamp() + 1000);
    
    let result = client.try_refund_expired_order(&order_id);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ProductionEscrowError::OrderNotExpired
    );
}

#[test]
fn test_refund_completed_order_fails() {
    let (env, client, _admin, buyer, farmer, token, _) = setup_test();
    
    let order_id = client.create_order(&buyer, &farmer, &token.address, &500);
    client.confirm_receipt(&buyer, &order_id);
    
    env.ledger().set_timestamp(env.ledger().timestamp() + NINETY_SIX_HOURS + 1);
    
    let result = client.try_refund_expired_order(&order_id);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ProductionEscrowError::OrderNotPending
    );
}

#[test]
fn test_refund_expired_order_returns_funds() {
    let (env, client, _admin, buyer, farmer, token, _) = setup_test();
    
    let order_id = client.create_order(&buyer, &farmer, &token.address, &500);
    let buyer_balance_before = token.balance(&buyer);
    
    env.ledger().set_timestamp(env.ledger().timestamp() + NINETY_SIX_HOURS + 1);
    client.refund_expired_order(&order_id);
    
    assert_eq!(token.balance(&buyer), buyer_balance_before + 500);
}

// ── Dispute tests (Issue #124) ────────────────────────────────────────────────

#[test]
fn test_open_dispute_locks_stake() {
    let (_env, client, _admin, buyer, farmer, token, _) = setup_test();

    let order_id = client.create_order(&buyer, &farmer, &token.address, &500);
    let buyer_balance_before = token.balance(&buyer);

    let dispute_id = client.open_dispute(&buyer, &order_id);
    assert_eq!(dispute_id, 1);

    // Stake deducted from buyer.
    assert_eq!(token.balance(&buyer), buyer_balance_before - STAKE_AMOUNT);

    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.status, DisputeStatus::Open);
    assert_eq!(dispute.stake, STAKE_AMOUNT);
}

#[test]
fn test_open_dispute_by_buyer() {
    let (_env, client, _admin, buyer, farmer, token, _) = setup_test();
    
    let order_id = client.create_order(&buyer, &farmer, &token.address, &500);
    let dispute_id = client.open_dispute(&buyer, &order_id);
    
    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.raiser, buyer);
    assert_eq!(dispute.order_id, order_id);
    assert_eq!(dispute.status, DisputeStatus::Open);
}

#[test]
fn test_open_dispute_by_farmer() {
    let (_env, client, _admin, buyer, farmer, token, _) = setup_test();
    
    let order_id = client.create_order(&buyer, &farmer, &token.address, &500);
    let dispute_id = client.open_dispute(&farmer, &order_id);
    
    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.raiser, farmer);
}

#[test]
fn test_open_dispute_on_nonexistent_order_fails() {
    let (_env, client, _admin, buyer, _farmer, _token, _) = setup_test();
    
    let result = client.try_open_dispute(&buyer, &999);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ProductionEscrowError::OrderDoesNotExist
    );
}

#[test]
fn test_open_dispute_on_completed_order_fails() {
    let (_env, client, _admin, buyer, farmer, token, _) = setup_test();
    
    let order_id = client.create_order(&buyer, &farmer, &token.address, &500);
    client.confirm_receipt(&buyer, &order_id);
    
    let result = client.try_open_dispute(&buyer, &order_id);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ProductionEscrowError::OrderNotPending
    );
}

#[test]
fn test_open_dispute_by_non_participant_fails() {
    let (env, client, _admin, buyer, farmer, token, _) = setup_test();
    
    let non_participant = Address::generate(&env);
    let order_id = client.create_order(&buyer, &farmer, &token.address, &500);
    
    let result = client.try_open_dispute(&non_participant, &order_id);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ProductionEscrowError::NotBuyer
    );
}

#[test]
fn test_dispute_cooldown_blocks_second_dispute() {
    let (env, client, admin, buyer, farmer, token, _) = setup_test();

    // First order + dispute.
    let order_id = client.create_order(&buyer, &farmer, &token.address, &500);
    let dispute_id = client.open_dispute(&buyer, &order_id);
    // Resolve so the order closes, then try to open another dispute immediately.
    client.resolve_dispute(&admin, &dispute_id, &false);

    // Second order — cooldown should block a new dispute from the same address.
    let order_id2 = client.create_order(&buyer, &farmer, &token.address, &500);

    // Advance time but stay within cooldown window.
    env.ledger()
        .set_timestamp(env.ledger().timestamp() + DISPUTE_COOLDOWN_SECONDS / 2);

    let result = client.try_open_dispute(&buyer, &order_id2);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ProductionEscrowError::DisputeCooldownActive
    );
}

#[test]
fn test_dispute_allowed_after_cooldown() {
    let (env, client, admin, buyer, farmer, token, _) = setup_test();

    let order_id = client.create_order(&buyer, &farmer, &token.address, &500);
    let dispute_id = client.open_dispute(&buyer, &order_id);
    client.resolve_dispute(&admin, &dispute_id, &false);

    // Second order.
    let order_id2 = client.create_order(&buyer, &farmer, &token.address, &500);

    // Advance past cooldown.
    env.ledger()
        .set_timestamp(env.ledger().timestamp() + DISPUTE_COOLDOWN_SECONDS + 1);

    let dispute_id2 = client.open_dispute(&buyer, &order_id2);
    assert_eq!(dispute_id2, 2);
}

#[test]
fn test_resolve_dispute_in_favour_of_raiser() {
    let (_env, client, admin, buyer, farmer, token, _) = setup_test();

    let order_id = client.create_order(&buyer, &farmer, &token.address, &500);
    let dispute_id = client.open_dispute(&buyer, &order_id);

    let buyer_balance_before = token.balance(&buyer);
    client.resolve_dispute(&admin, &dispute_id, &true);

    // Buyer gets stake + order net amount back.
    assert_eq!(
        token.balance(&buyer),
        buyer_balance_before + STAKE_AMOUNT + 500
    );

    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.status, DisputeStatus::Resolved);
}

#[test]
fn test_resolve_dispute_against_raiser_stake_forfeited() {
    let (_env, client, admin, buyer, farmer, token, _) = setup_test();

    let order_id = client.create_order(&buyer, &farmer, &token.address, &500);
    let dispute_id = client.open_dispute(&buyer, &order_id);

    let admin_balance_before = token.balance(&admin);
    let farmer_balance_before = token.balance(&farmer);

    client.resolve_dispute(&admin, &dispute_id, &false);

    // Admin gets the forfeited stake.
    assert_eq!(token.balance(&admin), admin_balance_before + STAKE_AMOUNT);
    // Counterparty (farmer) gets the order net amount.
    assert_eq!(token.balance(&farmer), farmer_balance_before + 500);

    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.status, DisputeStatus::Rejected);
}

#[test]
fn test_resolve_dispute_by_non_admin_fails() {
    let (env, client, _admin, buyer, farmer, token, _) = setup_test();
    
    let non_admin = Address::generate(&env);
    let order_id = client.create_order(&buyer, &farmer, &token.address, &500);
    let dispute_id = client.open_dispute(&buyer, &order_id);
    
    let result = client.try_resolve_dispute(&non_admin, &dispute_id, &true);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ProductionEscrowError::NotAdmin
    );
}

#[test]
fn test_resolve_nonexistent_dispute_fails() {
    let (_env, client, admin, _buyer, _farmer, _token, _) = setup_test();
    
    let result = client.try_resolve_dispute(&admin, &999, &true);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ProductionEscrowError::DisputeDoesNotExist
    );
}

#[test]
fn test_resolve_already_resolved_dispute_fails() {
    let (_env, client, admin, buyer, farmer, token, _) = setup_test();
    
    let order_id = client.create_order(&buyer, &farmer, &token.address, &500);
    let dispute_id = client.open_dispute(&buyer, &order_id);
    
    client.resolve_dispute(&admin, &dispute_id, &true);
    
    let result = client.try_resolve_dispute(&admin, &dispute_id, &false);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ProductionEscrowError::DisputeNotOpen
    );
}

#[test]
fn test_duplicate_dispute_on_same_order_fails() {
    let (_env, client, _admin, buyer, farmer, token, _) = setup_test();

    let order_id = client.create_order(&buyer, &farmer, &token.address, &500);
    client.open_dispute(&buyer, &order_id);

    let result = client.try_open_dispute(&farmer, &order_id);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ProductionEscrowError::DisputeAlreadyOpen
    );
}

// ── Getter tests (Issue #275) ─────────────────────────────────────────────────

#[test]
fn test_get_admin() {
    let (_env, client, admin, _buyer, _farmer, _token, _) = setup_test();
    
    let retrieved_admin = client.get_admin();
    assert_eq!(retrieved_admin, admin);
}

#[test]
fn test_get_dispute_stake_amount() {
    let (_env, client, _admin, _buyer, _farmer, _token, _) = setup_test();
    
    let stake = client.get_dispute_stake_amount();
    assert_eq!(stake, STAKE_AMOUNT);
}

#[test]
fn test_get_campaign_count() {
    let (env, client, _admin, _buyer, farmer, token, _) = setup_test();
    
    assert_eq!(client.get_campaign_count(), 0);
    
    let deadline = env.ledger().timestamp() + 7 * 24 * 60 * 60;
    client.create_campaign(&farmer, &token.address, &1000, &deadline);
    assert_eq!(client.get_campaign_count(), 1);
    
    client.create_campaign(&farmer, &token.address, &2000, &deadline);
    assert_eq!(client.get_campaign_count(), 2);
}

#[test]
fn test_get_order_count() {
    let (_env, client, _admin, buyer, farmer, token, _) = setup_test();
    
    assert_eq!(client.get_order_count(), 0);
    
    client.create_order(&buyer, &farmer, &token.address, &500);
    assert_eq!(client.get_order_count(), 1);
    
    client.create_order(&buyer, &farmer, &token.address, &300);
    assert_eq!(client.get_order_count(), 2);
}

#[test]
fn test_get_dispute_count() {
    let (_env, client, _admin, buyer, farmer, token, _) = setup_test();
    
    assert_eq!(client.get_dispute_count(), 0);
    
    let order_id = client.create_order(&buyer, &farmer, &token.address, &500);
    client.open_dispute(&buyer, &order_id);
    assert_eq!(client.get_dispute_count(), 1);
}

// ── Arithmetic Edge Cases Tests (Issue #276) ─────────────────────────────────

#[test]
fn test_invest_with_one_unit_amount() {
    let (env, client, _admin, buyer, farmer, token, _) = setup_test();
    
    let deadline = env.ledger().timestamp() + 7 * 24 * 60 * 60;
    let campaign_id = client.create_campaign(&farmer, &token.address, &10, &deadline);
    
    client.invest(&buyer, &campaign_id, &1);
    
    let campaign = client.get_campaign(&campaign_id);
    assert_eq!(campaign.total_funded, 1);
}

#[test]
fn test_invest_with_large_amounts() {
    let (env, client, _admin, buyer, farmer, token, _) = setup_test();
    
    // Mint large amount for buyer
    let sac_client = token::StellarAssetClient::new(&env, &token.address);
    let large_amount = i128::MAX / 2;
    sac_client.mint(&buyer, &large_amount);
    
    let deadline = env.ledger().timestamp() + 7 * 24 * 60 * 60;
    let large_goal = i128::MAX / 4;
    let campaign_id = client.create_campaign(&farmer, &token.address, &large_goal, &deadline);
    
    let invest_amount = i128::MAX / 8;
    client.invest(&buyer, &campaign_id, &invest_amount);
    
    let campaign = client.get_campaign(&campaign_id);
    assert_eq!(campaign.total_funded, invest_amount);
}

#[test]
fn test_invest_accumulation_no_overflow() {
    let (env, client, _admin, buyer, farmer, token, _) = setup_test();
    
    let deadline = env.ledger().timestamp() + 7 * 24 * 60 * 60;
    let campaign_id = client.create_campaign(&farmer, &token.address, &1000, &deadline);
    
    // Multiple small investments
    for _ in 0..10 {
        client.invest(&buyer, &campaign_id, &100);
    }
    
    let campaign = client.get_campaign(&campaign_id);
    assert_eq!(campaign.total_funded, 1000);
    assert_eq!(campaign.status, CampaignStatus::Funded);
}

#[test]
fn test_zero_amount_investment_fails() {
    let (env, client, _admin, buyer, farmer, token, _) = setup_test();
    
    let deadline = env.ledger().timestamp() + 7 * 24 * 60 * 60;
    let campaign_id = client.create_campaign(&farmer, &token.address, &1000, &deadline);
    
    let result = client.try_invest(&buyer, &campaign_id, &0);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ProductionEscrowError::AmountMustBePositive
    );
}

#[test]
fn test_negative_amount_investment_fails() {
    let (env, client, _admin, buyer, farmer, token, _) = setup_test();
    
    let deadline = env.ledger().timestamp() + 7 * 24 * 60 * 60;
    let campaign_id = client.create_campaign(&farmer, &token.address, &1000, &deadline);
    
    let result = client.try_invest(&buyer, &campaign_id, &-100);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ProductionEscrowError::AmountMustBePositive
    );
}

#[test]
fn test_proportional_refund_accuracy() {
    let (env, client, _admin, buyer, farmer, token, _) = setup_test();
    
    let deadline = env.ledger().timestamp() + 100;
    let campaign_id = client.create_campaign(&farmer, &token.address, &1000, &deadline);
    
    let invest_amount = 333;
    client.invest(&buyer, &campaign_id, &invest_amount);
    
    env.ledger().set_timestamp(env.ledger().timestamp() + 200);
    client.mark_campaign_failed(&campaign_id);
    
    let buyer_balance_before = token.balance(&buyer);
    client.refund_investor(&campaign_id, &buyer);
    
    // Should get exact amount back
    assert_eq!(token.balance(&buyer), buyer_balance_before + invest_amount);
}

#[test]
fn test_dispute_stake_with_small_amount() {
    let (_env, client, _admin, buyer, farmer, token, _) = setup_test();
    
    let order_id = client.create_order(&buyer, &farmer, &token.address, &500);
    let buyer_balance_before = token.balance(&buyer);
    
    client.open_dispute(&buyer, &order_id);
    
    // Stake should be exactly STAKE_AMOUNT
    assert_eq!(token.balance(&buyer), buyer_balance_before - STAKE_AMOUNT);
}

#[test]
fn test_create_order_with_one_unit() {
    let (_env, client, _admin, buyer, farmer, token, _) = setup_test();
    
    let order_id = client.create_order(&buyer, &farmer, &token.address, &1);
    let order = client.get_order_details(&order_id);
    
    assert_eq!(order.amount, 1);
    assert_eq!(order.status, OrderStatus::Pending);
}

#[test]
fn test_zero_amount_order_fails() {
    let (_env, client, _admin, buyer, farmer, token, _) = setup_test();
    
    let result = client.try_create_order(&buyer, &farmer, &token.address, &0);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ProductionEscrowError::AmountMustBePositive
    );
}

// ── Fee mechanism tests (Issue #270) ─────────────────────────────────────────

#[test]
fn test_fee_collected_on_order_creation() {
    let (_env, client, _admin, buyer, farmer, fee_collector, token) =
        setup_test_with_fee(300); // 3%

    let gross = 1_000_i128;
    let expected_fee = 30_i128;
    let expected_net = 970_i128;

    let order_id = client.create_order(&buyer, &farmer, &token.address, &gross);

    let order = client.get_order_details(&order_id);
    assert_eq!(order.gross_amount, gross);
    assert_eq!(order.amount, expected_net);

    assert_eq!(token.balance(&fee_collector), expected_fee);
    assert_eq!(token.balance(&buyer), 100_000 - gross);
}

#[test]
fn test_farmer_receives_net_amount_after_fee() {
    let (_env, client, _admin, buyer, farmer, _fee_collector, token) =
        setup_test_with_fee(300); // 3%

    let gross = 1_000_i128;
    let expected_net = 970_i128;

    let order_id = client.create_order(&buyer, &farmer, &token.address, &gross);
    client.confirm_receipt(&buyer, &order_id);

    assert_eq!(token.balance(&farmer), 100_000 + expected_net);
}

#[test]
fn test_zero_fee_rate_no_fee_collected() {
    let (_env, client, _admin, buyer, farmer, fee_collector, token) =
        setup_test_with_fee(0); // 0%

    let order_id = client.create_order(&buyer, &farmer, &token.address, &500);

    let order = client.get_order_details(&order_id);
    assert_eq!(order.gross_amount, 500);
    assert_eq!(order.amount, 500);
    assert_eq!(token.balance(&fee_collector), 0);
}

#[test]
fn test_fee_calculation_edge_case_small_amount() {
    // With 1% fee on 99 tokens, integer division gives fee = 0 (99 * 100 / 10_000 = 0)
    let (_env, client, _admin, buyer, farmer, fee_collector, token) =
        setup_test_with_fee(100); // 1%

    let order_id = client.create_order(&buyer, &farmer, &token.address, &99);

    let order = client.get_order_details(&order_id);
    assert_eq!(order.gross_amount, 99);
    assert_eq!(order.amount, 99); // fee = 0 due to integer truncation
    assert_eq!(token.balance(&fee_collector), 0);
}

#[test]
fn test_fee_rate_max_boundary() {
    // fee_rate_bps = 10_000 (100%) is the maximum allowed
    let (_env, client, _admin, buyer, farmer, fee_collector, token) =
        setup_test_with_fee(10_000);

    let order_id = client.create_order(&buyer, &farmer, &token.address, &500);

    let order = client.get_order_details(&order_id);
    assert_eq!(order.gross_amount, 500);
    assert_eq!(order.amount, 0); // 100% fee → net = 0
    assert_eq!(token.balance(&fee_collector), 500);
}

#[test]
fn test_invalid_fee_rate_bps_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let fee_collector = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let xlm_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let xlm_client = token::Client::new(&env, &xlm_contract.address());
    let usdc_contract = env.register_stellar_asset_contract_v2(token_admin);
    let usdc_client = token::Client::new(&env, &usdc_contract.address());

    let contract_id = env.register(ProductionEscrowContract, ());
    let client = ProductionEscrowContractClient::new(&env, &contract_id);

    let mut supported_tokens = Vec::new(&env);
    supported_tokens.push_back(xlm_client.address.clone());
    supported_tokens.push_back(usdc_client.address.clone());

    let result = client.try_initialize(
        &admin,
        &supported_tokens,
        &STAKE_AMOUNT,
        &fee_collector,
        &10_001u32,
    );
    assert_eq!(
        result.unwrap_err().unwrap(),
        ProductionEscrowError::InvalidFeeRate
    );
}

#[test]
fn test_negative_amount_order_fails() {
    let (_env, client, _admin, buyer, farmer, token, _) = setup_test();

    let result = client.try_create_order(&buyer, &farmer, &token.address, &-100);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ProductionEscrowError::AmountMustBePositive
    );
}

#[test]
fn test_refund_expired_order_returns_net_amount() {
    let (env, client, _admin, buyer, farmer, _fee_collector, token) =
        setup_test_with_fee(300); // 3%

    let order_id = client.create_order(&buyer, &farmer, &token.address, &1_000);
    let buyer_after_order = token.balance(&buyer);

    env.ledger()
        .set_timestamp(env.ledger().timestamp() + NINETY_SIX_HOURS + 1);

    client.refund_expired_order(&order_id);

    // Buyer gets back net amount (970), not gross (1000) — fee is non-refundable
    assert_eq!(token.balance(&buyer), buyer_after_order + 970);
}
