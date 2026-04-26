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

    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let xlm_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let xlm_client = token::Client::new(&env, &xlm_contract.address());
    let xlm_admin_client = token::StellarAssetClient::new(&env, &xlm_contract.address());
    xlm_admin_client.mint(&buyer, &10_000);
    xlm_admin_client.mint(&farmer, &10_000);

    let usdc_contract = env.register_stellar_asset_contract_v2(token_admin);
    let usdc_client = token::Client::new(&env, &usdc_contract.address());

    let contract_id = env.register(ProductionEscrowContract, ());
    let client = ProductionEscrowContractClient::new(&env, &contract_id);

    let mut supported_tokens = Vec::new(&env);
    supported_tokens.push_back(xlm_client.address.clone());
    supported_tokens.push_back(usdc_client.address.clone());

    client.initialize(&admin, &supported_tokens, &STAKE_AMOUNT);

    (env, client, admin, buyer, farmer, xlm_client, usdc_client)
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
    assert_eq!(token.balance(&farmer), 10_500);
}

#[test]
fn test_refund_expired_order() {
    let (env, client, _admin, buyer, farmer, token, _) = setup_test();

    let order_id = client.create_order(&buyer, &farmer, &token.address, &500);
    env.ledger().set_timestamp(env.ledger().timestamp() + NINETY_SIX_HOURS + 1);

    client.refund_expired_order(&order_id);
    let order = client.get_order_details(&order_id);
    assert_eq!(order.status, OrderStatus::Refunded);
    assert_eq!(token.balance(&buyer), 10_000);
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
    env.ledger().set_timestamp(env.ledger().timestamp() + DISPUTE_COOLDOWN_SECONDS / 2);

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
    env.ledger().set_timestamp(env.ledger().timestamp() + DISPUTE_COOLDOWN_SECONDS + 1);

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

    // Buyer gets stake + order amount back.
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
    // Counterparty (farmer) gets the order amount.
    assert_eq!(token.balance(&farmer), farmer_balance_before + 500);

    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.status, DisputeStatus::Rejected);
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
