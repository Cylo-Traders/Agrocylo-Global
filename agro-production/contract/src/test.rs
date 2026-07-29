#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

#[test]
fn test_initialize() {
    let env = Env::default();
    let contract_id = env.register(CampaignContract, ());
    let client = CampaignContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let fee_collector = Address::generate(&env);
    let supported_tokens = Vec::from_array(&env, [Address::generate(&env)]);

    // 1. Contract initializes successfully exactly once
    client.initialize(&admin, &supported_tokens, &fee_collector);
    
    // Check if it stored everything correctly
    // We can't directly read it through client unless we added getters, but the fact it didn't fail is a start.
}

#[test]
#[should_panic(expected = "HostError: Error(Contract, #1)")]
fn test_initialize_already_initialized() {
    let env = Env::default();
    let contract_id = env.register(CampaignContract, ());
    let client = CampaignContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let fee_collector = Address::generate(&env);
    let supported_tokens = Vec::from_array(&env, [Address::generate(&env)]);

    client.initialize(&admin, &supported_tokens, &fee_collector);

    // 2. Re-initialization is rejected
    client.initialize(&admin, &supported_tokens, &fee_collector);
}

#[test]
fn test_store_and_retrieve_campaign() {
    let env = Env::default();
    let contract_id = env.register(CampaignContract, ());
    let client = CampaignContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let fee_collector = Address::generate(&env);
    let supported_tokens = Vec::from_array(&env, [Address::generate(&env)]);
    client.initialize(&admin, &supported_tokens, &fee_collector);

    let campaign = Campaign {
        campaign_id: 1,
        farmer: Address::generate(&env),
        token: Address::generate(&env),
        target_amount: 1000,
        raised_amount: 0,
        start_time: 100,
        harvest_deadline: 200,
        status: Status::Funding,
    };

    client.store_campaign(&campaign);

    let retrieved = client.get_campaign(&1);

    // 3. A Campaign value can be stored and then retrieved, with every field matching what was stored.
    assert_eq!(retrieved.campaign_id, campaign.campaign_id);
    assert_eq!(retrieved.farmer, campaign.farmer);
    assert_eq!(retrieved.token, campaign.token);
    assert_eq!(retrieved.target_amount, campaign.target_amount);
    assert_eq!(retrieved.raised_amount, campaign.raised_amount);
    assert_eq!(retrieved.start_time, campaign.start_time);
    assert_eq!(retrieved.harvest_deadline, campaign.harvest_deadline);
    assert_eq!(retrieved.status, campaign.status);
}
