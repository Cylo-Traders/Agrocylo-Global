// SPDX-License-Identifier: MIT
// Agrocylo Global Production Escrow Contract

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol, symbol_short};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Guardian,
    Attester,
    Paused,
}

#[contract]
pub struct ProductionEscrow;

#[contractimpl]
impl ProductionEscrow {
    pub fn initialize(env: Env, guardian: Address, attester: Address) {
        if env.storage().instance().has(&DataKey::Guardian) {
            panic!("already initialized");
        }
        guardian.require_auth();
        env.storage().instance().set(&DataKey::Guardian, &guardian);
        env.storage().instance().set(&DataKey::Attester, &attester);
        env.storage().instance().set(&DataKey::Paused, &false);
    }

    pub fn set_guardian(env: Env, new_guardian: Address) {
        let guardian: Address = env.storage().instance().get(&DataKey::Guardian).unwrap();
        guardian.require_auth();
        new_guardian.require_auth();
        env.storage().instance().set(&DataKey::Guardian, &new_guardian);
    }

    pub fn set_attester(env: Env, new_attester: Address) {
        let guardian: Address = env.storage().instance().get(&DataKey::Guardian).unwrap();
        guardian.require_auth();
        new_attester.require_auth();
        env.storage().instance().set(&DataKey::Attester, &new_attester);
    }

    pub fn get_guardian(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Guardian).unwrap()
    }

    pub fn get_attester(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Attester).unwrap()
    }

    pub fn pause(env: Env) {
        let guardian: Address = env.storage().instance().get(&DataKey::Guardian).unwrap();
        guardian.require_auth();
        env.storage().instance().set(&DataKey::Paused, &true);
    }

    pub fn unpause(env: Env) {
        let guardian: Address = env.storage().instance().get(&DataKey::Guardian).unwrap();
        guardian.require_auth();
        env.storage().instance().set(&DataKey::Paused, &false);
    }
}
