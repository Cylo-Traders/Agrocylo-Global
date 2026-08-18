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

// ── On-chain farmer reputation (Issue #592) ─────────────────────────────────

#[test]
fn test_reputation_starts_at_zero_for_unknown_farmer() {
    let (_env, client, _, _, _, _, farmer_one, _) = setup_test();

    let rep = client.get_reputation(&farmer_one);
    assert_eq!(
        rep,
        ReputationRecord {
            score: 0,
            completed_orders: 0,
            disputed_orders: 0,
        }
    );
}

#[test]
fn test_reputation_accumulates_across_successful_orders() {
    let (_env, client, _, escrow_contract, _, _, farmer_one, _) = setup_test();

    client.record_order_outcome(&escrow_contract, &farmer_one, &None);
    client.record_order_outcome(&escrow_contract, &farmer_one, &None);
    let rep = client.record_order_outcome(&escrow_contract, &farmer_one, &None);

    assert_eq!(rep.completed_orders, 3);
    assert_eq!(rep.disputed_orders, 0);
    assert_eq!(rep.score, 30);
    assert_eq!(client.get_reputation(&farmer_one), rep);
}

#[test]
fn test_reputation_penalized_on_dispute_refund_to_buyer() {
    let (_env, client, _, escrow_contract, _, _, farmer_one, _) = setup_test();

    client.record_order_outcome(&escrow_contract, &farmer_one, &None);
    let rep = client.record_order_outcome(&escrow_contract, &farmer_one, &Some(10_000u32));

    // +10 for the completed order, then a full-refund dispute applies the max penalty.
    assert_eq!(rep.completed_orders, 1);
    assert_eq!(rep.disputed_orders, 1);
    assert_eq!(rep.score, 10 - 15);
}

#[test]
fn test_reputation_rewarded_when_dispute_released_to_farmer() {
    let (_env, client, _, escrow_contract, _, _, farmer_one, _) = setup_test();

    let rep = client.record_order_outcome(&escrow_contract, &farmer_one, &Some(0u32));

    assert_eq!(rep.disputed_orders, 1);
    assert_eq!(rep.score, 10);
}

#[test]
fn test_reputation_split_dispute_is_proportional() {
    let (_env, client, _, escrow_contract, _, _, farmer_one, _) = setup_test();

    // 50/50 split: half the completion reward, half the dispute penalty.
    let rep = client.record_order_outcome(&escrow_contract, &farmer_one, &Some(5_000u32));

    assert_eq!(rep.score, 5 - 7); // (10_000-5000)*10/10_000 - 5000*15/10_000
}

#[test]
fn test_reputation_update_from_production_contract_is_authorized() {
    let (_env, client, _, _, production_contract, _, farmer_one, _) = setup_test();

    let rep =
        client.record_order_outcome(&production_contract, &farmer_one, &None);
    assert_eq!(rep.score, 10);
}

#[test]
fn test_reputation_update_from_unauthorized_caller_fails() {
    let (_env, client, _, _, _, unauthorized_contract, farmer_one, _) = setup_test();

    let result =
        client.try_record_order_outcome(&unauthorized_contract, &farmer_one, &None);
    assert_eq!(
        result.unwrap_err().unwrap(),
        RegistryError::UnauthorizedContract
    );

    // No score should have been written for a rejected call.
    assert_eq!(client.get_reputation(&farmer_one).score, 0);
}

#[test]
fn test_reputation_is_tracked_independently_per_farmer() {
    let (_env, client, _, escrow_contract, _, _, farmer_one, farmer_two) = setup_test();

    client.record_order_outcome(&escrow_contract, &farmer_one, &None);
    client.record_order_outcome(&escrow_contract, &farmer_two, &Some(10_000u32));

    assert_eq!(client.get_reputation(&farmer_one).score, 10);
    assert_eq!(client.get_reputation(&farmer_two).score, -5);
}

// ---------------------------------------------------------------------------
// Upgrade, guardian, pause (Issue #757)
// ---------------------------------------------------------------------------

#[test]
fn test_upgrade_bypassing_governance_rejected() {
    let (env, client, _, _, _, _, _, _) = setup_test();
    let attacker = Address::generate(&env);
    let dummy_wasm_hash = BytesN::from_array(&env, &[9u8; 32]);
    let result = client.try_upgrade(&attacker, &dummy_wasm_hash);
    assert_eq!(result.unwrap_err().unwrap(), RegistryError::NotAdmin);
}

#[test]
fn test_guardian_pause_blocks_register_farmer_governance_only_unpauses() {
    let (env, client, admin, _, _, _, farmer_one, _) = setup_test();

    let guardian = Address::generate(&env);
    client.set_guardian(&admin, &guardian);

    client.pause(&guardian);
    assert!(client.is_paused());

    let result = client.try_register_farmer(&farmer_one);
    assert_eq!(result.unwrap_err().unwrap(), RegistryError::ContractPaused);

    let err = client.try_unpause(&guardian).unwrap_err().unwrap();
    assert_eq!(err, RegistryError::NotAdmin);

    client.unpause(&admin);
    assert!(!client.is_paused());
    client.register_farmer(&farmer_one);
    assert!(client.is_farmer_registered(&farmer_one));
}
