#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env};

fn setup_test() -> (Env, CampaignContractClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let farmer = Address::generate(&env);

    let contract_id = env.register(CampaignContract, ());
    let client = CampaignContractClient::new(&env, &contract_id);

    client.initialize(&admin);

    (env, client, admin, farmer)
}

#[test]
fn test_register_farmer() {
    let (_env, client, _admin, farmer) = setup_test();
    client.register_farmer(&farmer);
    let farmer_data = client.get_farmer(&farmer);
    assert!(farmer_data.registered);
}

#[test]
fn test_create_campaign() {
    let (_env, client, _admin, farmer) = setup_test();
    client.register_farmer(&farmer);
    let campaign_id = client.create_campaign(&farmer, &1000);
    assert_eq!(campaign_id, 1);
    let campaign = client.get_campaign(&campaign_id);
    assert_eq!(campaign.status, CampaignStatus::Pending);
}

#[test]
fn test_invest_and_funded() {
    let (env, client, _admin, farmer) = setup_test();
    let investor = Address::generate(&env);
    client.register_farmer(&farmer);
    let campaign_id = client.create_campaign(&farmer, &1000);
    client.invest(&investor, &campaign_id, &500);
    client.invest(&investor, &campaign_id, &600);
    let campaign = client.get_campaign(&campaign_id);
    assert_eq!(campaign.status, CampaignStatus::Funded);
}

#[test]
fn test_start_production() {
    let (env, client, _admin, farmer) = setup_test();
    let investor = Address::generate(&env);
    client.register_farmer(&farmer);
    let campaign_id = client.create_campaign(&farmer, &1000);
    client.invest(&investor, &campaign_id, &1000);
    client.start_production(&farmer, &campaign_id);
    let campaign = client.get_campaign(&campaign_id);
    assert_eq!(campaign.status, CampaignStatus::InProduction);
}

#[test]
fn test_mark_harvest() {
    let (env, client, _admin, farmer) = setup_test();
    let investor = Address::generate(&env);
    client.register_farmer(&farmer);
    let campaign_id = client.create_campaign(&farmer, &1000);
    client.invest(&investor, &campaign_id, &1000);
    client.start_production(&farmer, &campaign_id);
    client.mark_harvest(&farmer, &campaign_id);
    let campaign = client.get_campaign(&campaign_id);
    assert_eq!(campaign.status, CampaignStatus::Harvested);
}

#[test]
fn test_settle_campaign() {
    let (env, client, _admin, farmer) = setup_test();
    let investor = Address::generate(&env);
    client.register_farmer(&farmer);
    let campaign_id = client.create_campaign(&farmer, &1000);
    client.invest(&investor, &campaign_id, &1000);
    client.start_production(&farmer, &campaign_id);
    client.mark_harvest(&farmer, &campaign_id);
    client.settle_campaign(&campaign_id);
    let campaign = client.get_campaign(&campaign_id);
    assert_eq!(campaign.status, CampaignStatus::Settled);
}

#[test]
fn test_tranche_release() {
    let (env, client, _admin, farmer) = setup_test();
    let investor = Address::generate(&env);
    client.register_farmer(&farmer);
    let campaign_id = client.create_campaign(&farmer, &1000);
    client.invest(&investor, &campaign_id, &1000);
    client.start_production(&farmer, &campaign_id);
    let amount = client.release_tranche(&campaign_id, &0);
    assert_eq!(amount, 400);
    let campaign = client.get_campaign(&campaign_id);
    assert!(campaign.initial_released);
}

#[test]
fn test_no_invest_after_funded() {
    let (env, client, _admin, farmer) = setup_test();
    let investor = Address::generate(&env);
    client.register_farmer(&farmer);
    let campaign_id = client.create_campaign(&farmer, &1000);
    client.invest(&investor, &campaign_id, &1000);
    let result = client.try_invest(&investor, &campaign_id, &100);
    assert!(result.is_err());
}

#[test]
fn test_no_harvest_before_production() {
    let (env, client, _admin, farmer) = setup_test();
    let investor = Address::generate(&env);
    client.register_farmer(&farmer);
    let campaign_id = client.create_campaign(&farmer, &1000);
    client.invest(&investor, &campaign_id, &1000);
    let result = client.try_mark_harvest(&farmer, &campaign_id);
    assert!(result.is_err());
}

#[test]
fn test_no_settle_twice() {
    let (env, client, _admin, farmer) = setup_test();
    let investor = Address::generate(&env);
    client.register_farmer(&farmer);
    let campaign_id = client.create_campaign(&farmer, &1000);
    client.invest(&investor, &campaign_id, &1000);
    client.start_production(&farmer, &campaign_id);
    client.mark_harvest(&farmer, &campaign_id);
    client.settle_campaign(&campaign_id);
    let result = client.try_settle_campaign(&campaign_id);
    assert!(result.is_err());
}

#[test]
fn test_dispute_resolve() {
    let (env, client, _admin, farmer) = setup_test();
    let investor = Address::generate(&env);
    client.register_farmer(&farmer);
    let campaign_id = client.create_campaign(&farmer, &1000);
    client.invest(&investor, &campaign_id, &1000);
    client.start_production(&farmer, &campaign_id);
    client.dispute_campaign(&campaign_id);
    let campaign = client.get_campaign(&campaign_id);
    assert_eq!(campaign.status, CampaignStatus::Disputed);
    client.resolve_campaign(&campaign_id, &true);
    let resolved = client.get_campaign(&campaign_id);
    assert_eq!(resolved.status, CampaignStatus::Settled);
}
