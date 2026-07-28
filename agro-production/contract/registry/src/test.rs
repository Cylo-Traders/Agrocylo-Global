#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String, Vec};

fn setup_test() -> (
    Env,
    RegistryContractClient<'static>,
    Address,
    Address,
    Address,
    Address,
    Address,
    Address,
) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let escrow_contract = env.register(RegistryContract, ());
    let production_contract = env.register(RegistryContract, ());
    let unauthorized_contract = env.register(RegistryContract, ());
    let farmer_one = Address::generate(&env);
    let farmer_two = Address::generate(&env);
    let registry_id = env.register(RegistryContract, ());
    let client = RegistryContractClient::new(&env, &registry_id);

    client.initialize(&admin, &escrow_contract, &production_contract);

    (
        env,
        client,
        admin,
        escrow_contract,
        production_contract,
        unauthorized_contract,
        farmer_one,
        farmer_two,
    )
}

#[test]
fn test_registry_initializes_correctly() {
    let (_env, client, _admin, escrow_contract, production_contract, _, _, _) = setup_test();

    let refs = client.get_contract_refs();
    assert_eq!(
        refs,
        ContractRefs {
            escrow_contract,
            production_contract,
        }
    );
}

#[test]
fn test_registry_cannot_initialize_twice() {
    let (_env, client, admin, escrow_contract, production_contract, _, _, _) = setup_test();

    let result = client.try_initialize(&admin, &escrow_contract, &production_contract);
    assert_eq!(
        result.unwrap_err().unwrap(),
        RegistryError::AlreadyInitialized
    );
}

#[test]
fn test_register_new_farmer() {
    let (env, client, _, _, _, _, farmer_one, _) = setup_test();

    client.register_farmer(&farmer_one);

    assert!(client.is_farmer_registered(&farmer_one));
    let farmer = client.get_farmer(&farmer_one).unwrap();
    assert_eq!(farmer.address, farmer_one);

    let farmers = client.get_farmers(&0, &50);
    assert_eq!(farmers.len(), 1);
    assert_eq!(farmers.get(0).unwrap(), farmer_one);
}

#[test]
fn test_duplicate_farmer_registration_fails() {
    let (env, client, _, _, _, _, farmer_one, _) = setup_test();

    client.register_farmer(&farmer_one);

    let result = client.try_register_farmer(&farmer_one);
    assert_eq!(
        result.unwrap_err().unwrap(),
        RegistryError::FarmerAlreadyRegistered
    );

    let farmers = client.get_farmers(&0, &50);
    assert_eq!(farmers.len(), 1);
}

#[test]
fn test_register_campaign_from_authorized_production_contract() {
    let (_env, client, _, _, production_contract, _, farmer_one, _) = setup_test();
    client.register_farmer(&farmer_one);

    client.register_campaign(&production_contract, &100, &farmer_one, &Some(44));

    let campaign = client.get_campaign(&100).unwrap();
    assert_eq!(
        campaign,
        CampaignRecord {
            campaign_id: 100,
            farmer: farmer_one,
            source_contract: production_contract,
            linked_escrow_order_id: Some(44),
        }
    );
}

#[test]
fn test_register_campaign_from_authorized_escrow_contract() {
    let (env, client, _, escrow_contract, _, _, farmer_one, _) = setup_test();
    client.register_farmer(&farmer_one);

    client.register_campaign(&escrow_contract, &101, &farmer_one, &Some(88));

    let campaigns = client.get_campaigns(&0, &50);
    assert_eq!(campaigns.len(), 1);
    assert_eq!(campaigns.get(0).unwrap().source_contract, escrow_contract);
}

#[test]
fn test_unauthorized_campaign_registration_is_rejected() {
    let (env, client, _, _, _, unauthorized_contract, farmer_one, _) = setup_test();
    client.register_farmer(&farmer_one);

    let result = client.try_register_campaign(&unauthorized_contract, &200, &farmer_one, &None);
    assert_eq!(
        result.unwrap_err().unwrap(),
        RegistryError::UnauthorizedContract
    );

    let campaigns = client.get_campaigns(&0, &50);
    assert_eq!(campaigns.len(), 0);
}

#[test]
fn test_multiple_campaigns_are_indexed_per_farmer() {
    let (env, client, _, escrow_contract, production_contract, _, farmer_one, farmer_two) =
        setup_test();
    client.register_farmer(&farmer_one);
    client.register_farmer(&farmer_two);

    client.register_campaign(&production_contract, &1, &farmer_one, &Some(10));
    client.register_campaign(&escrow_contract, &2, &farmer_one, &Some(11));
    client.register_campaign(&production_contract, &3, &farmer_two, &Some(12));

    let farmer_one_campaigns = client.get_farmer_campaigns(&farmer_one, &0, &50);
    assert_eq!(farmer_one_campaigns.len(), 2);
    assert_eq!(farmer_one_campaigns.get(0).unwrap().campaign_id, 1);
    assert_eq!(farmer_one_campaigns.get(1).unwrap().campaign_id, 2);

    let farmer_two_campaigns = client.get_farmer_campaigns(&farmer_two, &0, &50);
    assert_eq!(farmer_two_campaigns.len(), 1);
    assert_eq!(farmer_two_campaigns.get(0).unwrap().campaign_id, 3);
}

#[test]
fn test_get_all_campaigns_returns_complete_results() {
    let (env, client, _, _, production_contract, _, farmer_one, farmer_two) = setup_test();
    client.register_farmer(&farmer_one);
    client.register_farmer(&farmer_two);

    client.register_campaign(&production_contract, &10, &farmer_one, &Some(50));
    client.register_campaign(&production_contract, &11, &farmer_two, &None);

    let all_campaigns = client.get_campaigns(&0, &50);
    assert_eq!(all_campaigns.len(), 2);
    assert_eq!(all_campaigns.get(0).unwrap().campaign_id, 10);
    assert_eq!(all_campaigns.get(1).unwrap().campaign_id, 11);
}

#[test]
fn test_empty_campaign_lists_are_handled_safely() {
    let (env, client, _, _, _, _, farmer_one, _) = setup_test();
    client.register_farmer(&farmer_one);

    let all_campaigns = client.get_campaigns(&0, &50);
    assert_eq!(all_campaigns, Vec::new(&env));

    let farmer_campaigns = client.get_farmer_campaigns(&farmer_one, &0, &50);
    assert_eq!(farmer_campaigns, Vec::new(&env));
}

#[test]
fn test_campaign_registration_requires_registered_farmer() {
    let (env, client, _, _, production_contract, _, farmer_one, _) = setup_test();

    let result = client.try_register_campaign(&production_contract, &500, &farmer_one, &None);
    assert_eq!(
        result.unwrap_err().unwrap(),
        RegistryError::FarmerNotRegistered
    );

    let campaigns = client.get_campaigns(&0, &50);
    assert_eq!(campaigns.len(), 0);
}

#[test]
fn test_invalid_farmer_addresses_are_rejected() {
    let (_env, client, _, escrow_contract, _production_contract, _, _farmer_one, _) = setup_test();

    let register_result = client.try_register_farmer(&escrow_contract);
    assert_eq!(
        register_result.unwrap_err().unwrap(),
        RegistryError::InvalidFarmerAddress
    );
}

#[test]
fn test_repeated_campaign_entries_do_not_corrupt_state() {
    let (env, client, _, _, production_contract, _, farmer_one, _) = setup_test();
    client.register_farmer(&farmer_one);

    client.register_campaign(&production_contract, &700, &farmer_one, &Some(99));

    let duplicate_result =
        client.try_register_campaign(&production_contract, &700, &farmer_one, &Some(100));
    assert_eq!(
        duplicate_result.unwrap_err().unwrap(),
        RegistryError::CampaignAlreadyRegistered
    );

    let all_campaigns = client.get_campaigns(&0, &50);
    assert_eq!(all_campaigns.len(), 1);
    assert_eq!(
        all_campaigns.get(0).unwrap().linked_escrow_order_id,
        Some(99)
    );

    let farmer_campaigns = client.get_farmer_campaigns(&farmer_one, &0, &50);
    assert_eq!(farmer_campaigns.len(), 1);
}

// ── Provenance Registry Tests ──────────────────────────────────────────────

fn setup_provenance() -> (Env, RegistryContractClient<'static>, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let escrow_contract = env.register(RegistryContract, ());
    let production_contract = env.register(RegistryContract, ());
    let farmer = Address::generate(&env);
    let registry_id = env.register(RegistryContract, ());
    let client = RegistryContractClient::new(&env, &registry_id);
    client.initialize(&admin, &escrow_contract, &production_contract);
    client.register_farmer(&farmer);
    client.register_campaign(&production_contract, &1, &farmer, &None);
    let env: Env = unsafe { core::mem::transmute(env) };
    let client: RegistryContractClient<'static> = unsafe { core::mem::transmute(client) };
    (env, client, production_contract, farmer, escrow_contract)
}

#[test]
fn test_mint_batch_ok() {
    let (env, client, prod_contract, farmer, _escrow) = setup_provenance();

    let batch_id = client.mint_batch(
        &prod_contract,
        &1,
        &farmer,
        &String::from_str(&env, "Corn"),
        &1000,
        &5000,
    );
    assert_eq!(batch_id, 1);

    let batch = client.get_batch(&batch_id).unwrap();
    assert_eq!(batch.campaign_id, 1);
    assert_eq!(batch.farmer, farmer);
    assert_eq!(batch.quantity, 5000);
}

#[test]
fn test_mint_batch_unauthorized_fails() {
    let (env, client, _prod_contract, farmer, _escrow) = setup_provenance();
    let bad_contract = env.register(RegistryContract, ());

    let result = client.try_mint_batch(
        &bad_contract,
        &1,
        &farmer,
        &String::from_str(&env, "Wheat"),
        &1000,
        &3000,
    );
    assert_eq!(result.unwrap_err().unwrap(), RegistryError::UnauthorizedContract);
}

#[test]
fn test_link_batch_to_order_ok() {
    let (env, client, prod_contract, farmer, _escrow) = setup_provenance();

    let batch_id = client.mint_batch(
        &prod_contract,
        &1,
        &farmer,
        &String::from_str(&env, "Rice"),
        &1000,
        &2000,
    );

    client.link_batch_to_order(&prod_contract, &batch_id, &42);
    let batch = client.get_batch(&batch_id).unwrap();
    assert_eq!(batch.linked_order_ids.len(), 1);
    assert_eq!(batch.linked_order_ids.get(0).unwrap(), 42);
}

#[test]
fn test_link_batch_to_multiple_orders() {
    let (env, client, prod_contract, farmer, _escrow) = setup_provenance();

    let batch_id = client.mint_batch(
        &prod_contract,
        &1,
        &farmer,
        &String::from_str(&env, "Corn"),
        &1000,
        &5000,
    );

    client.link_batch_to_order(&prod_contract, &batch_id, &10);
    client.link_batch_to_order(&prod_contract, &batch_id, &11);

    let batch = client.get_batch(&batch_id).unwrap();
    assert_eq!(batch.linked_order_ids.len(), 2);
}

#[test]
fn test_get_batch_history_returns_provenance_chain() {
    let (env, client, prod_contract, farmer, _escrow) = setup_provenance();

    let b1 = client.mint_batch(
        &prod_contract,
        &1,
        &farmer,
        &String::from_str(&env, "Corn"),
        &1000,
        &3000,
    );
    let b2 = client.mint_batch(
        &prod_contract,
        &1,
        &farmer,
        &String::from_str(&env, "Beans"),
        &1000,
        &2000,
    );

    client.link_batch_to_order(&prod_contract, &b1, &77);
    client.link_batch_to_order(&prod_contract, &b2, &77);

    let history = client.get_batch_history(&77);
    assert_eq!(history.len(), 2);
}

#[test]
fn test_get_batch_history_empty_for_unlinked_order() {
    let (_env, client, _prod_contract, _farmer, _escrow) = setup_provenance();
    let history = client.get_batch_history(&999);
    assert_eq!(history.len(), 0);
}

#[test]
fn test_duplicate_batch_order_link_fails() {
    let (env, client, prod_contract, farmer, _escrow) = setup_provenance();

    let batch_id = client.mint_batch(
        &prod_contract,
        &1,
        &farmer,
        &String::from_str(&env, "Soy"),
        &1000,
        &4000,
    );

    client.link_batch_to_order(&prod_contract, &batch_id, &55);
    let result = client.try_link_batch_to_order(&prod_contract, &batch_id, &55);
    assert_eq!(result.unwrap_err().unwrap(), RegistryError::OrderBatchLinkExists);
}
