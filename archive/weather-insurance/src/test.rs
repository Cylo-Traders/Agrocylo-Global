#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, vec, Address, Env, Vec,
};

fn setup_test_inline() -> (
    Env,
    WeatherInsuranceContractClient<'static>,
    Address,
    Vec<Address>,
    Address,
    token::Client<'static>,
) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let oracle1 = Address::generate(&env);
    let oracle2 = Address::generate(&env);
    let oracle3 = Address::generate(&env);
    let oracles = vec![&env, oracle1, oracle2, oracle3];
    let farmer = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_client = token::Client::new(&env, &token_contract.address());
    let token_sac = token::StellarAssetClient::new(&env, &token_contract.address());
    token_sac.mint(&admin, &10_000_000);
    token_sac.mint(&farmer, &10_000_000);

    let contract_id = env.register(WeatherInsuranceContract, ());
    let client = WeatherInsuranceContractClient::new(&env, &contract_id);

    client.initialize(&admin, &oracles, &2, &500);

    token_sac.mint(&contract_id, &1_000_000);

    (env, client, admin, oracles, farmer, token_client)
}

fn make_threshold(_env: &Env, param: WeatherParam, min: i128, max: i128) -> ThresholdConfig {
    ThresholdConfig {
        param,
        min_value: min,
        max_value: max,
    }
}

// ---------------------------------------------------------------------------
// Issue #842: Hardening tests (Init auth, Pause/Unpause, Instance TTL, Upgrade)
// ---------------------------------------------------------------------------

#[test]
fn test_initialize_ok() {
    let (_env, client, admin, oracles, _farmer, _token) = setup_test_inline();
    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_oracles(), oracles);
    assert_eq!(client.get_oracle_quorum(), 2);
    assert_eq!(client.get_schema_version(), 1);
}

#[test]
fn test_initialize_second_time_rejected() {
    let (_env, client, admin, oracles, _farmer, _token) = setup_test_inline();
    let result = client.try_initialize(&admin, &oracles, &2, &500);
    assert_eq!(
        result.unwrap_err().unwrap(),
        InsuranceError::AlreadyInitialized
    );
}

#[test]
fn test_initialize_requires_admin_auth() {
    // Issue #843: initialize() must require the admin's authorization, so a
    // front-runner who never signed cannot seize admin on a fresh deploy.
    // Deliberately no mock_all_auths() — the caller must prove they control
    // the admin address or the call is rejected before any state is written.
    let env = Env::default();
    env.ledger().set_timestamp(1_000_000);

    let attacker = Address::generate(&env);
    let oracle = Address::generate(&env);
    let oracles = vec![&env, oracle];

    let contract_id = env.register(WeatherInsuranceContract, ());
    let client = WeatherInsuranceContractClient::new(&env, &contract_id);

    // The attacker did not authorize `initialize`, so require_auth() traps.
    let result = client.try_initialize(&attacker, &oracles, &1, &500);
    assert!(result.is_err());

    // No state was written — the contract is still uninitialized.
    let readback = client.try_get_admin();
    assert_eq!(
        readback.unwrap_err().unwrap(),
        InsuranceError::ContractNotInitialized
    );
}

#[test]
fn test_initialize_rejects_high_premium() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(WeatherInsuranceContract, ());
    let client = WeatherInsuranceContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let oracle = Address::generate(&env);
    let oracles = vec![&env, oracle];
    let result = client.try_initialize(&admin, &oracles, &1, &3000);
    assert_eq!(
        result.unwrap_err().unwrap(),
        InsuranceError::PremiumRateTooHigh
    );
}

#[test]
fn test_pause_blocks_take_premium_and_report_breach_unpause_restores() {
    let (env, client, admin, oracles, farmer, token) = setup_test_inline();

    // Deposit capital so reserves exist
    token.approve(
        &admin,
        &client.address,
        &500_000,
        &(env.ledger().sequence() + 50000),
    );
    client.deposit_capital(&admin, &token.address, &500_000);

    // Pause contract
    client.pause(&admin);
    assert!(client.is_paused());

    let threshold = make_threshold(&env, WeatherParam::Rainfall, 100, 500);
    token.approve(
        &admin,
        &client.address,
        &5000,
        &(env.ledger().sequence() + 50000),
    );

    // take_premium blocked while paused
    let err = client
        .try_take_premium(&admin, &1, &farmer, &token.address, &100_000, &threshold)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, InsuranceError::ContractPaused);

    // Unpause contract
    client.unpause(&admin);
    assert!(!client.is_paused());

    // take_premium succeeds after unpause
    client.take_premium(&admin, &1, &farmer, &token.address, &100_000, &threshold);

    // Pause again and verify report_breach is blocked
    client.pause(&admin);
    let oracle1 = oracles.get(0).unwrap();
    let err2 = client
        .try_report_breach(&oracle1, &1, &600)
        .unwrap_err()
        .unwrap();
    assert_eq!(err2, InsuranceError::ContractPaused);
}

#[test]
fn test_instance_ttl_bumping() {
    let (env, client, admin, _oracles, _farmer, _token) = setup_test_inline();

    env.ledger().with_mut(|li| {
        li.sequence_number += 500;
    });

    client.bump_instance_ttl();

    assert_eq!(client.get_admin(), admin);
}

#[test]
fn test_guardian_role() {
    let (_env, client, admin, _oracles, _farmer, _token) = setup_test_inline();
    let guardian = Address::generate(&_env);

    client.set_guardian(&admin, &guardian);
    assert_eq!(client.get_guardian(), Some(guardian.clone()));

    // Guardian can pause instantly
    client.pause(&guardian);
    assert!(client.is_paused());

    // Guardian cannot unpause (unpause is governance-gated)
    let err = client.try_unpause(&guardian).unwrap_err().unwrap();
    assert_eq!(err, InsuranceError::NotAdmin);

    // Admin/governance can unpause
    client.unpause(&admin);
    assert!(!client.is_paused());
}

// ---------------------------------------------------------------------------
// Issue #841: Oracle quorum, Plausibility bounds, Challenge window
// ---------------------------------------------------------------------------

#[test]
fn test_single_oracle_in_quorum_cannot_trigger_payout_alone() {
    let (env, client, admin, oracles, farmer, token) = setup_test_inline();

    // Deposit reserves
    token.approve(
        &admin,
        &client.address,
        &500_000,
        &(env.ledger().sequence() + 50000),
    );
    client.deposit_capital(&admin, &token.address, &500_000);

    let threshold = make_threshold(&env, WeatherParam::Rainfall, 100, 500);
    token.approve(
        &admin,
        &client.address,
        &5000,
        &(env.ledger().sequence() + 50000),
    );
    client.take_premium(&admin, &1, &farmer, &token.address, &100_000, &threshold);

    let oracle1 = oracles.get(0).unwrap();
    let oracle2 = oracles.get(1).unwrap();

    // First oracle reports breach (quorum is 2)
    let reached = client.report_breach(&oracle1, &1, &600);
    assert!(!reached); // Quorum not reached yet

    // Pending payout should not exist yet
    assert!(client.get_pending_payout(&1).is_none());

    // Second oracle reports breach
    let reached2 = client.report_breach(&oracle2, &1, &600);
    assert!(reached2); // Quorum reached!

    // Pending payout created with challenge window
    assert!(client.get_pending_payout(&1).is_some());
}

#[test]
fn test_out_of_bounds_report_rejected() {
    let (env, client, admin, oracles, farmer, token) = setup_test_inline();

    token.approve(
        &admin,
        &client.address,
        &500_000,
        &(env.ledger().sequence() + 50000),
    );
    client.deposit_capital(&admin, &token.address, &500_000);

    let threshold = make_threshold(&env, WeatherParam::Rainfall, 100, 500);
    token.approve(
        &admin,
        &client.address,
        &5000,
        &(env.ledger().sequence() + 50000),
    );
    client.take_premium(&admin, &1, &farmer, &token.address, &100_000, &threshold);

    let oracle1 = oracles.get(0).unwrap();

    // Negative rainfall is out of bounds
    let err = client
        .try_report_breach(&oracle1, &1, &-10)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, InsuranceError::ReportedValueOutOfBounds);

    // Unreasonably large rainfall (>10,000) is out of bounds
    let err2 = client
        .try_report_breach(&oracle1, &1, &20_000)
        .unwrap_err()
        .unwrap();
    assert_eq!(err2, InsuranceError::ReportedValueOutOfBounds);
}

#[test]
fn test_challenge_window_cancellation_and_finalization() {
    let (env, client, admin, oracles, farmer, token) = setup_test_inline();

    token.approve(
        &admin,
        &client.address,
        &500_000,
        &(env.ledger().sequence() + 50000),
    );
    client.deposit_capital(&admin, &token.address, &500_000);

    let threshold = make_threshold(&env, WeatherParam::Rainfall, 100, 500);
    token.approve(
        &admin,
        &client.address,
        &5000,
        &(env.ledger().sequence() + 50000),
    );
    client.take_premium(&admin, &1, &farmer, &token.address, &100_000, &threshold);

    let oracle1 = oracles.get(0).unwrap();
    let oracle2 = oracles.get(1).unwrap();

    client.report_breach(&oracle1, &1, &600);
    client.report_breach(&oracle2, &1, &600);

    // Finalizing immediately before window expires fails
    let err = client.try_finalize_payout(&1).unwrap_err().unwrap();
    assert_eq!(err, InsuranceError::ChallengeWindowActive);

    // Guardian or Admin cancels pending payout
    client.cancel_pending_payout(&admin, &1);
    assert!(client.get_pending_payout(&1).is_none());

    // Policy is still active since payout was cancelled
    let policy = client.get_policy(&1).unwrap();
    assert!(policy.active);
    assert!(!policy.paid_out);
}

#[test]
fn test_challenge_window_finalization_after_expiration() {
    let (env, client, admin, oracles, farmer, token) = setup_test_inline();

    token.approve(
        &admin,
        &client.address,
        &500_000,
        &(env.ledger().sequence() + 50000),
    );
    client.deposit_capital(&admin, &token.address, &500_000);

    let threshold = make_threshold(&env, WeatherParam::Rainfall, 100, 500);
    token.approve(
        &admin,
        &client.address,
        &5000,
        &(env.ledger().sequence() + 50000),
    );
    client.take_premium(&admin, &1, &farmer, &token.address, &100_000, &threshold);

    let oracle1 = oracles.get(0).unwrap();
    let oracle2 = oracles.get(1).unwrap();

    client.report_breach(&oracle1, &1, &600);
    client.report_breach(&oracle2, &1, &600);

    // Advance time past challenge window (3600s)
    let current_time = env.ledger().timestamp();
    env.ledger().set_timestamp(current_time + 4000);

    let balance_before = token.balance(&farmer);
    client.finalize_payout(&1);

    assert_eq!(token.balance(&farmer), balance_before + 100_000);
    let policy = client.get_policy(&1).unwrap();
    assert!(!policy.active);
    assert!(policy.paid_out);
}

// ---------------------------------------------------------------------------
// Issue #840: Capital reserves & Solvency invariant tests
// ---------------------------------------------------------------------------

#[test]
fn test_take_premium_rejected_when_exposure_exceeds_reserves() {
    let (env, client, admin, _oracles, farmer, token) = setup_test_inline();

    let threshold = make_threshold(&env, WeatherParam::Rainfall, 100, 500);
    token.approve(
        &admin,
        &client.address,
        &5000,
        &(env.ledger().sequence() + 50000),
    );

    // Without capital reserves deposited, total_reserves = premium = 5000.
    // Exposure = 100,000 > 5000 reserves -> rejected for insolvency!
    let err = client
        .try_take_premium(&admin, &1, &farmer, &token.address, &100_000, &threshold)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, InsuranceError::InsufficientReserves);
}

#[test]
fn test_capital_provider_deposit_and_withdrawal() {
    let (env, client, admin, _oracles, _farmer, token) = setup_test_inline();

    token.approve(
        &admin,
        &client.address,
        &200_000,
        &(env.ledger().sequence() + 50000),
    );

    client.deposit_capital(&admin, &token.address, &200_000);
    assert_eq!(
        client.get_capital_provider_balance(&admin, &token.address),
        200_000
    );

    let (reserves, exposure) = client.get_pool_solvency(&token.address);
    assert_eq!(reserves, 200_000);
    assert_eq!(exposure, 0);

    // Withdraw capital
    client.withdraw_capital(&admin, &token.address, &50_000);
    assert_eq!(
        client.get_capital_provider_balance(&admin, &token.address),
        150_000
    );
}

#[test]
fn test_multi_policy_pool_solvency_and_payout_conservation() {
    let (env, client, admin, oracles, farmer, token) = setup_test_inline();

    // Deposit 200,000 capital reserve
    token.approve(
        &admin,
        &client.address,
        &200_000,
        &(env.ledger().sequence() + 50000),
    );
    client.deposit_capital(&admin, &token.address, &200_000);

    let threshold1 = make_threshold(&env, WeatherParam::Rainfall, 100, 500);
    let threshold2 = make_threshold(&env, WeatherParam::Temperature, 10, 40);

    token.approve(
        &admin,
        &client.address,
        &10_000,
        &(env.ledger().sequence() + 50000),
    );

    // Policy 1: 100,000 payout (premium 5,000)
    let prem1 = client.take_premium(&admin, &1, &farmer, &token.address, &100_000, &threshold1);
    assert_eq!(prem1, 5000);

    // Policy 2: 100,000 payout (premium 5,000)
    let prem2 = client.take_premium(&admin, &2, &farmer, &token.address, &100_000, &threshold2);
    assert_eq!(prem2, 5000);

    let (reserves, exposure) = client.get_pool_solvency(&token.address);
    assert_eq!(reserves, 210_000); // 200,000 capital + 10,000 premiums
    assert_eq!(exposure, 200_000); // Policy 1 + Policy 2 exposure

    // Breach on Policy 1
    let oracle1 = oracles.get(0).unwrap();
    let oracle2 = oracles.get(1).unwrap();
    client.report_breach(&oracle1, &1, &600);
    client.report_breach(&oracle2, &1, &600);

    env.ledger().set_timestamp(env.ledger().timestamp() + 4000);
    client.finalize_payout(&1);

    // Remaining solvency pool can still back Policy 2
    let (reserves_after, exposure_after) = client.get_pool_solvency(&token.address);
    assert_eq!(reserves_after, 110_000);
    assert_eq!(exposure_after, 100_000);

    // Solvency invariant holds: reserves (110k) >= exposure (100k)
    assert!(reserves_after >= exposure_after);
}
