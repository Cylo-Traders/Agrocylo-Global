#![no_std]
use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, String};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RegistryError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Escrow,
    Production,
    Farmer(Address),
}

#[contract]
pub struct RegistryContract;

#[contractimpl]
impl RegistryContract {
    pub fn initialize(
        env: Env,
        escrow: Address,
        production: Address,
    ) -> Result<(), RegistryError> {
        if env.storage().instance().has(&DataKey::Escrow) {
            return Err(RegistryError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Escrow, &escrow);
        env.storage().instance().set(&DataKey::Production, &production);
        Ok(())
    }

    pub fn register_farmer(env: Env, farmer: Address, metadata_ref: String) -> Result<(), RegistryError> {
        if !env.storage().instance().has(&DataKey::Escrow) {
            return Err(RegistryError::NotInitialized);
        }
        
        env.storage().persistent().set(&DataKey::Farmer(farmer), &metadata_ref);
        
        // Extend TTL for persistent storage
        env.storage().persistent().extend_ttl(&DataKey::Farmer(farmer.clone()), 1000, 100000);
        
        Ok(())
    }

    pub fn get_farmer(env: Env, farmer: Address) -> Option<String> {
        env.storage().persistent().get(&DataKey::Farmer(farmer))
    }

    pub fn get_escrow(env: Env) -> Result<Address, RegistryError> {
        env.storage()
            .instance()
            .get(&DataKey::Escrow)
            .ok_or(RegistryError::NotInitialized)
    }

    pub fn get_production(env: Env) -> Result<Address, RegistryError> {
        env.storage()
            .instance()
            .get(&DataKey::Production)
            .ok_or(RegistryError::NotInitialized)
    }
}

mod test;
