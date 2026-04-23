#![no_std]
use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, Vec};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    CampaignNotFound = 3,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CampaignStatus {
    FUNDING,
    FUNDED,
    IN_PRODUCTION,
    HARVESTED,
    SETTLED,
    FAILED,
    DISPUTED,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Campaign {
    pub campaign_id: u64,
    pub farmer: Address,
    pub token: Address,
    pub target_amount: i128,
    pub raised_amount: i128,
    pub start_time: u64,
    pub harvest_deadline: u64,
    pub status: CampaignStatus,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    SupportedTokens,
    FeeCollector,
    Campaign(u64),
}

#[contract]
pub struct ProductionEscrowContract;

#[contractimpl]
impl ProductionEscrowContract {
    pub fn initialize(
        env: Env,
        admin: Address,
        supported_tokens: Vec<Address>,
        fee_collector: Address,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::SupportedTokens, &supported_tokens);
        env.storage().instance().set(&DataKey::FeeCollector, &fee_collector);
        Ok(())
    }

    pub fn get_campaign(env: Env, campaign_id: u64) -> Result<Campaign, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Campaign(campaign_id))
            .ok_or(Error::CampaignNotFound)
    }

    // Helper for testing storage/retrieval
    pub fn store_campaign(env: Env, campaign: Campaign) -> Result<(), Error> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::NotInitialized);
        }
        env.storage().persistent().set(&DataKey::Campaign(campaign.campaign_id), &campaign);
        Ok(())
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        env.storage().instance().get(&DataKey::Admin).ok_or(Error::NotInitialized)
    }

    pub fn get_supported_tokens(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::SupportedTokens)
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn get_fee_collector(env: Env) -> Result<Address, Error> {
        env.storage().instance().get(&DataKey::FeeCollector).ok_or(Error::NotInitialized)
    }
}

mod test;
