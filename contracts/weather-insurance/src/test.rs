#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, token, Address, Env};

fn setup_test_inline() -> (Env, WeatherInsuranceContractClient<'static>, Address, Address, Address, token::Client<'static>) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let oracle = Address::generate(&env);
    let farmer = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_client = token::Client::new(&env, &token_contract.address());
    let token_sac = token::StellarAssetClient::new(&env, &token_contract.address());
    token_sac.mint(&admin, &100_000);
    token_sac.mint(&farmer, &100_000);

    let contract_id = env.register(WeatherInsuranceContract, ());
    let client = WeatherInsuranceContractClient::new(&env, &contract_id);

    client.initialize(&admin, &oracle, &500);

    token_sac.mint(&contract_id, &1_000_000);

    (env, client, admin, oracle, farmer, token_client)
}

fn make_threshold(_env: &Env, param: WeatherParam, min: i128, max: i128) -> ThresholdConfig {
    ThresholdConfig {
        param,
        min_value: min,
        max_value: max,
    }
}

#[test]
fn test_initialize_ok() {
    let (_env, client, _admin, oracle, _farmer, _token) = setup_test_inline();
    assert_eq!(client.get_oracle(), oracle);
}

#[test]
fn test_initialize_rejects_reinit() {
    let (_env, client, admin, _oracle, _farmer, _token) = setup_test_inline();
    let result = client.try_initialize(&admin, &admin, &500);
    assert_eq!(result.unwrap_err().unwrap(), InsuranceError::AlreadyInitialized);
}

#[test]
fn test_initialize_rejects_high_premium() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(WeatherInsuranceContract, ());
    let client = WeatherInsuranceContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let result = client.try_initialize(&admin, &admin, &3000);
    assert_eq!(result.unwrap_err().unwrap(), InsuranceError::PremiumRateTooHigh);
}

#[test]
fn test_take_premium_ok() {
    let (_env, client, admin, _oracle, farmer, token) = setup_test_inline();
    let threshold = make_threshold(&_env, WeatherParam::Rainfall, 100, 500);

    let expiration = _env.ledger().sequence() + 50000;
    token.approve(&admin, &client.address, &5000, &expiration);
    let premium = client.take_premium(&admin, &1, &farmer, &token.address, &100_000, &threshold);
    assert_eq!(premium, 5000);

    let policy = client.get_policy(&1).unwrap();
    assert!(policy.active);
    assert!(!policy.paid_out);
    assert_eq!(policy.premium, 5000);
    assert_eq!(policy.payout_amount, 100_000);
}

#[test]
fn test_take_premium_duplicate_fails() {
    let (_env, client, admin, _oracle, farmer, token) = setup_test_inline();
    let threshold = make_threshold(&_env, WeatherParam::Rainfall, 100, 500);

    let expiration = _env.ledger().sequence() + 50000;
    token.approve(&admin, &client.address, &5000, &expiration);
    client.take_premium(&admin, &1, &farmer, &token.address, &100_000, &threshold);

    let result = client.try_take_premium(&admin, &1, &farmer, &token.address, &100_000, &threshold);
    assert_eq!(result.unwrap_err().unwrap(), InsuranceError::PolicyAlreadyActive);
}

#[test]
fn test_report_breach_rainfall_exceeds_max_pays_out() {
    let (_env, client, admin, oracle, farmer, token) = setup_test_inline();
    let threshold = make_threshold(&_env, WeatherParam::Rainfall, 100, 500);

    let expiration = _env.ledger().sequence() + 50000;
    token.approve(&admin, &client.address, &5000, &expiration);
    client.take_premium(&admin, &1, &farmer, &token.address, &100_000, &threshold);

    let balance_before = token.balance(&farmer);
    client.report_breach(&oracle, &1, &600);
    assert_eq!(token.balance(&farmer), balance_before + 100_000);

    let policy = client.get_policy(&1).unwrap();
    assert!(!policy.active);
    assert!(policy.paid_out);
}

#[test]
fn test_report_breach_rainfall_below_min_pays_out() {
    let (_env, client, admin, oracle, farmer, token) = setup_test_inline();
    let threshold = make_threshold(&_env, WeatherParam::Rainfall, 100, 500);

    let expiration = _env.ledger().sequence() + 50000;
    token.approve(&admin, &client.address, &5000, &expiration);
    client.take_premium(&admin, &1, &farmer, &token.address, &100_000, &threshold);

    let balance_before = token.balance(&farmer);
    client.report_breach(&oracle, &1, &50);
    assert_eq!(token.balance(&farmer), balance_before + 100_000);
}

#[test]
fn test_report_breach_within_threshold_fails() {
    let (_env, client, admin, oracle, farmer, token) = setup_test_inline();
    let threshold = make_threshold(&_env, WeatherParam::Temperature, 10, 40);

    token.approve(&admin, &client.address, &5000, &6311999);
    client.take_premium(&admin, &1, &farmer, &token.address, &100_000, &threshold);

    let result = client.try_report_breach(&oracle, &1, &25);
    assert_eq!(result.unwrap_err().unwrap(), InsuranceError::ThresholdBreachReported);
}

#[test]
fn test_report_breach_non_oracle_fails() {
    let (_env, client, admin, _oracle, farmer, token) = setup_test_inline();
    let threshold = make_threshold(&_env, WeatherParam::Rainfall, 100, 500);

    token.approve(&admin, &client.address, &5000, &6311999);
    client.take_premium(&admin, &1, &farmer, &token.address, &100_000, &threshold);

    let not_oracle = Address::generate(&_env);
    let result = client.try_report_breach(&not_oracle, &1, &600);
    assert_eq!(result.unwrap_err().unwrap(), InsuranceError::NotOracle);
}

#[test]
fn test_report_breach_no_policy_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let oracle = Address::generate(&env);
    let contract_id = env.register(WeatherInsuranceContract, ());
    let client = WeatherInsuranceContractClient::new(&env, &contract_id);
    client.initialize(&admin, &oracle, &500);
    let result = client.try_report_breach(&oracle, &99, &600);
    assert_eq!(result.unwrap_err().unwrap(), InsuranceError::PolicyNotActive);
}

#[test]
fn test_expire_policy_ok() {
    let (_env, client, admin, _oracle, farmer, token) = setup_test_inline();
    let threshold = make_threshold(&_env, WeatherParam::Rainfall, 100, 500);

    token.approve(&admin, &client.address, &5000, &6311999);
    client.take_premium(&admin, &1, &farmer, &token.address, &100_000, &threshold);

    client.expire_policy(&admin, &1);
    let policy = client.get_policy(&1).unwrap();
    assert!(!policy.active);
}

#[test]
fn test_expire_policy_non_admin_fails() {
    let (_env, client, _admin, _oracle, farmer, token) = setup_test_inline();

    let result = client.try_expire_policy(&farmer, &1);
    assert!(result.is_err());
}

#[test]
fn test_double_payout_fails() {
    let (_env, client, admin, oracle, farmer, token) = setup_test_inline();
    let threshold = make_threshold(&_env, WeatherParam::Rainfall, 100, 500);

    let expiration = _env.ledger().sequence() + 50000;
    token.approve(&admin, &client.address, &5000, &expiration);
    client.take_premium(&admin, &1, &farmer, &token.address, &100_000, &threshold);

    client.report_breach(&oracle, &1, &600);
    let result = client.try_report_breach(&oracle, &1, &600);
    assert_eq!(result.unwrap_err().unwrap(), InsuranceError::PolicyNotActive);
}

#[test]
fn test_temperature_threshold_breach_pays_out() {
    let (_env, client, admin, oracle, farmer, token) = setup_test_inline();
    let threshold = make_threshold(&_env, WeatherParam::Temperature, 15, 35);

    token.approve(&admin, &client.address, &5000, &6311999);
    client.take_premium(&admin, &1, &farmer, &token.address, &100_000, &threshold);

    let balance_before = token.balance(&farmer);
    client.report_breach(&oracle, &1, &45);
    assert_eq!(token.balance(&farmer), balance_before + 100_000);
}

#[test]
fn test_policy_count_increments() {
    let (_env, client, admin, _oracle, farmer, token) = setup_test_inline();

    assert_eq!(client.get_policy_count(), 0);

    let threshold = make_threshold(&_env, WeatherParam::Rainfall, 100, 500);
    token.approve(&admin, &client.address, &5000, &6311999);
    client.take_premium(&admin, &1, &farmer, &token.address, &100_000, &threshold);

    assert_eq!(client.get_policy_count(), 1);
}

#[test]
fn test_set_oracle_ok() {
    let (_env, client, admin, _oracle, _farmer, _token) = setup_test_inline();
    let new_oracle = Address::generate(&_env);
    client.set_oracle(&admin, &new_oracle);
    assert_eq!(client.get_oracle(), new_oracle);
}

#[test]
fn test_set_oracle_non_admin_fails() {
    let (_env, client, _admin, _oracle, farmer, _token) = setup_test_inline();
    let result = client.try_set_oracle(&farmer, &farmer);
    assert!(result.is_err());
}

#[test]
fn test_premium_deducted_from_funding() {
    let (_env, client, admin, _oracle, farmer, token) = setup_test_inline();
    let threshold = make_threshold(&_env, WeatherParam::Rainfall, 100, 500);
    let funding_amount: i128 = 100_000;
    let expected_premium: i128 = funding_amount * 500 / 10_000;

    let balance_before = token.balance(&admin);
    token.approve(&admin, &client.address, &expected_premium, &6311999);
    let premium = client.take_premium(&admin, &1, &farmer, &token.address, &funding_amount, &threshold);
    assert_eq!(premium, expected_premium);
    assert_eq!(token.balance(&admin), balance_before - expected_premium);
}
