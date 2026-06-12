#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String};

#[test]
fn test_initialize() {
    let env = Env::default();
    let contract_id = env.register_contract(None, RegistryContract);
    let client = RegistryContractClient::new(&env, &contract_id);

    let escrow = Address::generate(&env);
    let production = Address::generate(&env);

    client.initialize(&escrow, &production);

    assert_eq!(client.get_escrow(), escrow);
    assert_eq!(client.get_production(), production);
}

#[test]
#[should_panic(expected = "HostError: Error(Contract, #1)")]
fn test_initialize_already_initialized() {
    let env = Env::default();
    let contract_id = env.register_contract(None, RegistryContract);
    let client = RegistryContractClient::new(&env, &contract_id);

    let escrow = Address::generate(&env);
    let production = Address::generate(&env);

    client.initialize(&escrow, &production);
    client.initialize(&escrow, &production);
}

#[test]
fn test_register_farmer() {
    let env = Env::default();
    let contract_id = env.register_contract(None, RegistryContract);
    let client = RegistryContractClient::new(&env, &contract_id);

    let escrow = Address::generate(&env);
    let production = Address::generate(&env);
    client.initialize(&escrow, &production);

    let farmer = Address::generate(&env);
    let metadata_ref = String::from_str(&env, "ipfs://farmer-metadata");

    client.register_farmer(&farmer, &metadata_ref);

    assert_eq!(client.get_farmer(&farmer), Some(metadata_ref));
}

#[test]
fn test_get_farmer_not_registered() {
    let env = Env::default();
    let contract_id = env.register_contract(None, RegistryContract);
    let client = RegistryContractClient::new(&env, &contract_id);

    let farmer = Address::generate(&env);
    assert_eq!(client.get_farmer(&farmer), None);
}
