#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Env, Vec
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    NotAuthorized = 2,
    CampaignNotFound = 3,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Status {
    Funding,
    Funded,
    InProduction,
    Harvested,
    Settled,
    Failed,
    Disputed,
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
    pub status: Status,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    SupportedTokens,
    FeeCollector,
    Campaign(u64),
    Initialized,
}

#[contract]
pub struct CampaignContract;

#[contractimpl]
impl CampaignContract {
    pub fn initialize(
        env: Env,
        admin: Address,
        supported_tokens: Vec<Address>,
        fee_collector: Address,
    ) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(ContractError::AlreadyInitialized);
        }
        
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::SupportedTokens, &supported_tokens);
        env.storage().instance().set(&DataKey::FeeCollector, &fee_collector);
        env.storage().instance().set(&DataKey::Initialized, &true);
        
        Ok(())
    }

    pub fn store_campaign(env: Env, campaign: Campaign) {
        env.storage().persistent().set(&DataKey::Campaign(campaign.campaign_id), &campaign);
    }

    pub fn get_campaign(env: Env, campaign_id: u64) -> Result<Campaign, ContractError> {
        env.storage()
            .persistent()
            .get(&DataKey::Campaign(campaign_id))
            .ok_or(ContractError::CampaignNotFound)
    }
}

mod test;
