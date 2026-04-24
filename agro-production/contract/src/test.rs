#![cfg(test)]
use super::*;
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{token, Address, Env, Vec};

#[test]
fn test_create_campaign() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let farmer = Address::generate(&env);
    let token_admin = Address::generate(&env);
    
    let token_id = env.register_stellar_asset_contract(token_admin.clone());
    let supported_tokens = Vec::from_array(&env, [token_id.clone()]);

    let contract_id = env.register_contract(None, AgroProductionContract);
    let client = AgroProductionContractClient::new(&env, &contract_id);

    client.initialize(&admin, &supported_tokens);

    let target_amount = 1000i128;
    let harvest_deadline = env.ledger().timestamp() + 1000;

    let campaign_id = client.create_campaign(&farmer, &token_id, &target_amount, &harvest_deadline);

    assert_eq!(campaign_id, 1);

    let campaign = client.get_campaign(&campaign_id);
    assert_eq!(campaign.farmer, farmer);
    assert_eq!(campaign.target_amount, target_amount);
    assert_eq!(campaign.raised_amount, 0);
    assert_eq!(campaign.status, CampaignStatus::Funding);
}

#[test]
fn test_invest() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let farmer = Address::generate(&env);
    let investor1 = Address::generate(&env);
    let investor2 = Address::generate(&env);
    let token_admin = Address::generate(&env);
    
    let token_id = env.register_stellar_asset_contract(token_admin.clone());
    let token_client = token::StellarAssetClient::new(&env, &token_id);
    
    token_client.mint(&investor1, &1000);
    token_client.mint(&investor2, &2000);

    let supported_tokens = Vec::from_array(&env, [token_id.clone()]);

    let contract_id = env.register_contract(None, AgroProductionContract);
    let client = AgroProductionContractClient::new(&env, &contract_id);

    client.initialize(&admin, &supported_tokens);

    let target_amount = 2000i128;
    let harvest_deadline = env.ledger().timestamp() + 1000;

    let campaign_id = client.create_campaign(&farmer, &token_id, &target_amount, &harvest_deadline);

    client.invest(&investor1, &campaign_id, &500);
    client.invest(&investor2, &campaign_id, &1500);

    let campaign = client.get_campaign(&campaign_id);
    assert_eq!(campaign.raised_amount, 2000);

    let contribution1 = client.get_investor_contribution(&campaign_id, &investor1);
    let contribution2 = client.get_investor_contribution(&campaign_id, &investor2);
    assert_eq!(contribution1, 500);
    assert_eq!(contribution2, 1500);

    // Share in PPM: 500/2000 * 1,000,000 = 250,000
    let share1 = client.get_investor_share(&campaign_id, &investor1);
    let share2 = client.get_investor_share(&campaign_id, &investor2);
    assert_eq!(share1, 250_000);
    assert_eq!(share2, 750_000);
}

#[test]
#[should_panic(expected = "Status(ContractError(4))")]
fn test_unsupported_token() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let farmer = Address::generate(&env);
    let token_admin = Address::generate(&env);
    
    let token_id = env.register_stellar_asset_contract(token_admin.clone());
    let other_token_id = Address::generate(&env);
    let supported_tokens = Vec::from_array(&env, [token_id.clone()]);

    let contract_id = env.register_contract(None, AgroProductionContract);
    let client = AgroProductionContractClient::new(&env, &contract_id);

    client.initialize(&admin, &supported_tokens);

    client.create_campaign(&farmer, &other_token_id, &1000, &10000);
}
