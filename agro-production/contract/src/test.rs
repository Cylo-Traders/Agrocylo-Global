#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

#[test]
fn test_initialize() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ProductionEscrowContract);
    let client = ProductionEscrowContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let fee_collector = Address::generate(&env);
    let supported_tokens = Vec::from_array(&env, [Address::generate(&env), Address::generate(&env)]);

    client.initialize(&admin, &supported_tokens, &fee_collector);

    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_fee_collector(), fee_collector);
    assert_eq!(client.get_supported_tokens(), supported_tokens);
}

#[test]
#[should_panic(expected = "HostError: Error(Contract, #1)")]
fn test_initialize_already_initialized() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ProductionEscrowContract);
    let client = ProductionEscrowContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let fee_collector = Address::generate(&env);
    let supported_tokens = Vec::new(&env);

    client.initialize(&admin, &supported_tokens, &fee_collector);
    client.initialize(&admin, &supported_tokens, &fee_collector);
}

#[test]
fn test_campaign_storage() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ProductionEscrowContract);
    let client = ProductionEscrowContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let fee_collector = Address::generate(&env);
    let supported_tokens = Vec::new(&env);
    client.initialize(&admin, &supported_tokens, &fee_collector);

    let farmer = Address::generate(&env);
    let token = Address::generate(&env);
    let campaign = Campaign {
        campaign_id: 1,
        farmer,
        token,
        target_amount: 1000,
        raised_amount: 0,
        start_time: 100,
        harvest_deadline: 200,
        status: CampaignStatus::FUNDING,
    };

    client.store_campaign(&campaign);
    let retrieved = client.get_campaign(&1);

    assert_eq!(retrieved, campaign);
}
