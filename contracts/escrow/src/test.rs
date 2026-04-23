#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env,
};

// Shared setup helpers


/// Base escrow setup — creates two tokens, mints 1 000 XLM to `buyer`,
/// registers the contract and calls `initialize`.
fn setup_test() -> (
    Env,
    EscrowContractClient<'static>,
    Address,         // admin
    Address,         // buyer
    Address,         // farmer
    token::Client<'static>,  // xlm
    token::Client<'static>,  // usdc
) {
    let env = Env::default();
    env.mock_all_auths();

    let admin       = Address::generate(&env);
    let buyer       = Address::generate(&env);
    let farmer      = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let xlm_contract   = env.register_stellar_asset_contract_v2(token_admin.clone());
    let xlm_client     = token::Client::new(&env, &xlm_contract.address());
    let xlm_sac_client = token::StellarAssetClient::new(&env, &xlm_contract.address());
    xlm_sac_client.mint(&buyer, &1000);

    let usdc_contract = env.register_stellar_asset_contract_v2(token_admin);
    let usdc_client   = token::Client::new(&env, &usdc_contract.address());

    let contract_id = env.register(EscrowContract, ());
    let client      = EscrowContractClient::new(&env, &contract_id);

    let mut supported_tokens = Vec::new(&env);
    supported_tokens.push_back(xlm_client.address.clone());
    supported_tokens.push_back(usdc_client.address.clone());

    client.initialize(&admin, &supported_tokens);

    (env, client, admin, buyer, farmer, xlm_client, usdc_client)
}

/// Extended campaign setup.
///
/// Returns the base tuple **plus** a third address used as `investor2` and
/// an `xlm_sac_client` so tests can mint extra tokens into the contract to
/// fund investor returns.
fn setup_campaign_test() -> (
    Env,
    EscrowContractClient<'static>,
    Address,         // admin
    Address,         // farmer
    Address,         // investor1  (was "buyer")
    Address,         // investor2
    token::Client<'static>,                  // xlm client
    token::StellarAssetClient<'static>,      // xlm SAC client (for minting)
) {
    let env = Env::default();
    env.mock_all_auths();

    let admin       = Address::generate(&env);
    let farmer      = Address::generate(&env);
    let investor1   = Address::generate(&env);
    let investor2   = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let xlm_contract   = env.register_stellar_asset_contract_v2(token_admin.clone());
    let xlm_client     = token::Client::new(&env, &xlm_contract.address());
    let xlm_sac_client = token::StellarAssetClient::new(&env, &xlm_contract.address());

    // Give each investor enough tokens to invest.
    xlm_sac_client.mint(&investor1, &2000);
    xlm_sac_client.mint(&investor2, &2000);

    let usdc_contract = env.register_stellar_asset_contract_v2(token_admin);
    let usdc_client   = token::Client::new(&env, &usdc_contract.address());

    let contract_id = env.register(EscrowContract, ());
    let client      = EscrowContractClient::new(&env, &contract_id);

    let mut supported_tokens = Vec::new(&env);
    supported_tokens.push_back(xlm_client.address.clone());
    supported_tokens.push_back(usdc_client.address.clone());

    client.initialize(&admin, &supported_tokens);

    (env, client, admin, farmer, investor1, investor2, xlm_client, xlm_sac_client)
}


#[test]
fn test_create_and_confirm_order() {
    let (_env, client, _admin, buyer, farmer, token, _) = setup_test();

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
    let (_env, client, _admin, buyer, farmer, token, _) = setup_test();

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
    let (env, client, _admin, buyer, farmer, token, _) = setup_test();
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
    let (_env, client, _admin, buyer, farmer, token, _) = setup_test();

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
    let (_env, client, _admin, buyer, farmer, token, _) = setup_test();

    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    client.mock_all_auths().confirm_receipt(&buyer, &order_id);

    let order = client.get_order_details(&order_id);
    assert_eq!(order.status, OrderStatus::Completed);
}

#[test]
fn test_confirm_already_completed() {
    let (_env, client, _admin, buyer, farmer, token, _) = setup_test();
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
    let (env, client, _admin, buyer, farmer, token, _) = setup_test();
    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    env.ledger().set_timestamp(env.ledger().timestamp() + 345_601);

    client.mock_all_auths().refund_expired_order(&order_id);

    assert_eq!(token.balance(&buyer), 1000);
    let order = client.get_order_details(&order_id);
    assert_eq!(order.status, OrderStatus::Refunded);
}

#[test]
fn test_refund_unexpired_order_fails() {
    let (env, client, _admin, buyer, farmer, token, _) = setup_test();
    let order_id = client
        .mock_all_auths()
        .create_order(&buyer, &farmer, &token.address, &500);

    env.ledger().set_timestamp(env.ledger().timestamp() + 3600);

    let result = client
        .mock_all_auths()
        .try_refund_expired_order(&order_id);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::OrderNotExpired);
}

#[test]
fn test_create_order_unsupported_token_fails() {
    let (env, client, _admin, buyer, farmer, _, _) = setup_test();
    let unsupported_admin    = Address::generate(&env);
    let unsupported_contract = env.register_stellar_asset_contract_v2(unsupported_admin);
    let unsupported_client   = token::Client::new(&env, &unsupported_contract.address());

    let result = client
        .mock_all_auths()
        .try_create_order(&buyer, &farmer, &unsupported_client.address, &500);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::UnsupportedToken);
}


// Campaign / finalize_settlement / claim_returns tests 

// create_campaign
#[test]
fn test_create_campaign_success() {
    let (_env, client, admin, farmer, _inv1, _inv2, token, _sac) = setup_campaign_test();

    let campaign_id = client.create_campaign(&admin, &farmer, &token.address);
    assert_eq!(campaign_id, 1);

    let campaign = client.get_campaign(&campaign_id);
    assert_eq!(campaign.farmer,         farmer);
    assert_eq!(campaign.total_invested, 0);
    assert_eq!(campaign.return_rate_bps, 0);
    assert_eq!(campaign.status,         CampaignStatus::Active);
    assert!(campaign.settled_at.is_none());
}

#[test]
fn test_create_campaign_non_admin_fails() {
    let (_env, client, _admin, farmer, inv1, _inv2, token, _sac) = setup_campaign_test();

    // inv1 is not the stored admin
    let result = client.try_create_campaign(&inv1, &farmer, &token.address);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::NotAdmin);
}

#[test]
fn test_create_campaign_unsupported_token_fails() {
    let (env, client, admin, farmer, _inv1, _inv2, _token, _sac) = setup_campaign_test();

    let bad_admin    = Address::generate(&env);
    let bad_contract = env.register_stellar_asset_contract_v2(bad_admin);
    let bad_token    = token::Client::new(&env, &bad_contract.address());

    let result = client.try_create_campaign(&admin, &farmer, &bad_token.address);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::UnsupportedToken);
}

// invest 
#[test]
fn test_invest_success() {
    let (_env, client, admin, farmer, inv1, _inv2, token, _sac) = setup_campaign_test();

    let campaign_id = client.create_campaign(&admin, &farmer, &token.address);
    client.invest(&inv1, &campaign_id, &500);

    let campaign = client.get_campaign(&campaign_id);
    assert_eq!(campaign.total_invested, 500);

    let investment = client.get_investment(&campaign_id, &inv1);
    assert_eq!(investment.amount,  500);
    assert_eq!(investment.claimed, false);
}

#[test]
fn test_invest_accumulates() {
    let (_env, client, admin, farmer, inv1, _inv2, token, _sac) = setup_campaign_test();

    let campaign_id = client.create_campaign(&admin, &farmer, &token.address);
    client.invest(&inv1, &campaign_id, &300);
    client.invest(&inv1, &campaign_id, &200);

    let investment = client.get_investment(&campaign_id, &inv1);
    assert_eq!(investment.amount, 500);

    let campaign = client.get_campaign(&campaign_id);
    assert_eq!(campaign.total_invested, 500);
}

#[test]
fn test_invest_in_settled_campaign_fails() {
    let (_env, client, admin, farmer, inv1, _inv2, token, sac) = setup_campaign_test();

    let campaign_id = client.create_campaign(&admin, &farmer, &token.address);
    client.invest(&inv1, &campaign_id, &500);

    // Mint returns into contract then settle
    let contract_addr = client.address.clone();
    sac.mint(&contract_addr, &50);
    client.finalize_settlement(&admin, &campaign_id, &1000); // 10 %

    let result = client.try_invest(&inv1, &campaign_id, &100);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::CampaignNotActive);
}

//  finalize_settlement
#[test]
fn test_finalize_settlement_transfers_principal_to_farmer() {
    let (_env, client, admin, farmer, inv1, inv2, token, sac) = setup_campaign_test();

    let campaign_id = client.create_campaign(&admin, &farmer, &token.address);
    client.invest(&inv1, &campaign_id, &600);
    client.invest(&inv2, &campaign_id, &400);

    // mint return tokens so the contract can pay investors later (1 000 total × 10 % = 100)
    let contract_addr = client.address.clone();
    sac.mint(&contract_addr, &100);

    // Farmer balance before settlement
    assert_eq!(token.balance(&farmer), 0);

    client.finalize_settlement(&admin, &campaign_id, &1000); // 10 % return

    // Farmer must have received the full 1 000 principal
    assert_eq!(token.balance(&farmer), 1000);

    let campaign = client.get_campaign(&campaign_id);
    assert_eq!(campaign.status,          CampaignStatus::Settled);
    assert_eq!(campaign.return_rate_bps, 1000);
    assert!(campaign.settled_at.is_some());
}

#[test]
fn test_finalize_settlement_zero_investment() {
    let (_env, client, admin, farmer, _inv1, _inv2, token, _sac) = setup_campaign_test();

    let campaign_id = client.create_campaign(&admin, &farmer, &token.address);

    // No investors  settlement should still succeed with zero transfer
    client.finalize_settlement(&admin, &campaign_id, &500);

    let campaign = client.get_campaign(&campaign_id);
    assert_eq!(campaign.status,         CampaignStatus::Settled);
    assert_eq!(campaign.total_invested, 0);
    assert_eq!(token.balance(&farmer),  0);
}

#[test]
fn test_finalize_settlement_non_admin_fails() {
    let (_env, client, admin, farmer, inv1, _inv2, token, _sac) = setup_campaign_test();

    let campaign_id = client.create_campaign(&admin, &farmer, &token.address);
    client.invest(&inv1, &campaign_id, &500);

    let result = client.try_finalize_settlement(&inv1, &campaign_id, &1000);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::NotAdmin);
}

#[test]
fn test_finalize_settlement_twice_fails() {
    let (_env, client, admin, farmer, inv1, _inv2, token, sac) = setup_campaign_test();

    let campaign_id = client.create_campaign(&admin, &farmer, &token.address);
    client.invest(&inv1, &campaign_id, &500);

    let contract_addr = client.address.clone();
    sac.mint(&contract_addr, &50);

    client.finalize_settlement(&admin, &campaign_id, &1000);

    let result = client.try_finalize_settlement(&admin, &campaign_id, &500);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::CampaignAlreadySettled);
}

#[test]
fn test_finalize_settlement_return_rate_too_high_fails() {
    let (_env, client, admin, farmer, _inv1, _inv2, token, _sac) = setup_campaign_test();

    let campaign_id = client.create_campaign(&admin, &farmer, &token.address);

    // 10 001 bps > MAX_RETURN_RATE_BPS (10 000)
    let result = client.try_finalize_settlement(&admin, &campaign_id, &10_001);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::ReturnRateTooHigh);
}

// claim_returns
#[test]
fn test_claim_returns_correct_payout() {
    let (_env, client, admin, farmer, inv1, _inv2, token, sac) = setup_campaign_test();

    let campaign_id = client.create_campaign(&admin, &farmer, &token.address);

    // inv1 invests 1 000
    client.invest(&inv1, &campaign_id, &1000);

    // Mint full payout amount into contract (principal + 10% return = 1100)
    let contract_addr = client.address.clone();
    sac.mint(&contract_addr, &1100);

    client.finalize_settlement(&admin, &campaign_id, &1000); // 10 %

    let payout = client.claim_returns(&inv1, &campaign_id);

    // Expected: 1 000 principal + 1 000 × 10 % = 1 100
    assert_eq!(payout, 1100);
    // inv1 started with 2 000; spent 1 000 on invest; has 1 000 left; receives 1 100 = 2 100 total
    assert_eq!(token.balance(&inv1), 2100);

    let investment = client.get_investment(&campaign_id, &inv1);
    assert_eq!(investment.claimed, true);
}

#[test]
fn test_claim_returns_zero_rate_returns_principal_only() {
    let (_env, client, admin, farmer, inv1, _inv2, token, _sac) = setup_campaign_test();

    let campaign_id = client.create_campaign(&admin, &farmer, &token.address);
    client.invest(&inv1, &campaign_id, &800);

    // Mint principal back so the contract can pay it out
    let contract_addr = client.address.clone();
    let sac = token::StellarAssetClient::new(&_env, &token.address);
    sac.mint(&contract_addr, &800);

    client.finalize_settlement(&admin, &campaign_id, &0); // 0 % return

    // Principal was already sent to farmer; we minted 800 for return funds
    let payout = client.claim_returns(&inv1, &campaign_id);
    assert_eq!(payout, 800); // zero return → just principal back
}

#[test]
fn test_claim_returns_multiple_investors() {
    let (_env, client, admin, farmer, inv1, inv2, token, sac) = setup_campaign_test();

    let campaign_id = client.create_campaign(&admin, &farmer, &token.address);
    client.invest(&inv1, &campaign_id, &1000);
    client.invest(&inv2, &campaign_id, &1000);

    // total_invested = 2 000; 10 % return = 200
    // Each investor gets: 1000 + 100 = 1100
    // Total payout needed: 2200
    let contract_addr = client.address.clone();
    sac.mint(&contract_addr, &2200);

    client.finalize_settlement(&admin, &campaign_id, &1000); // 10 %

    let payout1 = client.claim_returns(&inv1, &campaign_id);
    let payout2 = client.claim_returns(&inv2, &campaign_id);

    assert_eq!(payout1, 1100);
    assert_eq!(payout2, 1100);
}

#[test]
fn test_claim_returns_before_settlement_fails() {
    let (_env, client, admin, farmer, inv1, _inv2, token, _sac) = setup_campaign_test();

    let campaign_id = client.create_campaign(&admin, &farmer, &token.address);
    client.invest(&inv1, &campaign_id, &500);

    // Campaign still Active — claim must fail
    let result = client.try_claim_returns(&inv1, &campaign_id);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::CampaignNotSettled);
}

#[test]
fn test_claim_returns_double_claim_fails() {
    let (_env, client, admin, farmer, inv1, _inv2, token, sac) = setup_campaign_test();

    let campaign_id = client.create_campaign(&admin, &farmer, &token.address);
    client.invest(&inv1, &campaign_id, &500);

    let contract_addr = client.address.clone();
    sac.mint(&contract_addr, &550); // Full payout: 500 + (500 * 10% = 50) = 550

    client.finalize_settlement(&admin, &campaign_id, &1000);
    client.claim_returns(&inv1, &campaign_id); // first claim — succeeds

    // Second claim must be rejected
    let result = client.try_claim_returns(&inv1, &campaign_id);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::AlreadyClaimed);
}

#[test]
fn test_claim_returns_non_investor_fails() {
    let (env, client, admin, farmer, inv1, _inv2, token, sac) = setup_campaign_test();
    let outsider = Address::generate(&env);

    let campaign_id = client.create_campaign(&admin, &farmer, &token.address);
    client.invest(&inv1, &campaign_id, &500);

    let contract_addr = client.address.clone();
    sac.mint(&contract_addr, &50);

    client.finalize_settlement(&admin, &campaign_id, &1000);

    // Outsider never invested
    let result = client.try_claim_returns(&outsider, &campaign_id);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::NotAnInvestor);
}

#[test]
fn test_claim_returns_nonexistent_campaign_fails() {
    let (_env, client, _admin, _farmer, inv1, _inv2, _token, _sac) = setup_campaign_test();

    let result = client.try_claim_returns(&inv1, &999);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::CampaignDoesNotExist);
}

// ── get_investment ────────────────────────────────────────────────────────────
#[test]
fn test_get_investment_not_found_fails() {
    let (env, client, admin, farmer, _inv1, _inv2, token, _sac) = setup_campaign_test();
    let stranger = Address::generate(&env);

    let campaign_id = client.create_campaign(&admin, &farmer, &token.address);

    let result = client.try_get_investment(&campaign_id, &stranger);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::NotAnInvestor);
}

#[test]
fn test_get_campaign_not_found_fails() {
    let (_env, client, ..) = setup_campaign_test();

    let result = client.try_get_campaign(&999);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::CampaignDoesNotExist);
}
