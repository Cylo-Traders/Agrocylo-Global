#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    NotAuthorized = 2,
    CampaignNotFound = 3,
    FarmerNotFound = 4,
    InvalidState = 5,
    FundingNotComplete = 6,
    FundingAlreadyComplete = 7,
    TrancheAlreadyReleased = 8,
    InvalidAmount = 9,
    CampaignNotFunded = 10,
    CampaignNotInProduction = 11,
    NotFarmer = 12,
    AlreadyHarvested = 13,
    AlreadySettled = 14,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CampaignStatus {
    Pending,
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
    pub id: u64,
    pub farmer: Address,
    pub target_amount: i128,
    pub raised_amount: i128,
    pub status: CampaignStatus,
    pub initial_release_percent: u32,
    pub mid_release_percent: u32,
    pub final_release_percent: u32,
    pub initial_released: bool,
    pub mid_released: bool,
    pub final_released: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Farmer {
    pub address: Address,
    pub registered: bool,
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
    Campaign(u64),
    Farmer(Address),
    FarmerById(u64),
    CampaignCount,
    Admin,
    RegistryInitialized,
}

const INITIAL_RELEASE_PERCENT: u32 = 40;
const MID_RELEASE_PERCENT: u32 = 30;
const FINAL_RELEASE_PERCENT: u32 = 30;

#[contract]
pub struct CampaignContract;

#[contractimpl]
impl CampaignContract {
    pub fn initialize(env: Env, admin: Address) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::RegistryInitialized) {
            return Err(ContractError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::RegistryInitialized, &true);
        env.events()
            .publish((symbol_short!("reg"), symbol_short!("init")), admin);
        Ok(())
    }

    pub fn register_farmer(env: Env, farmer: Address) -> Result<(), ContractError> {
        farmer.require_auth();

        if env
            .storage()
            .persistent()
            .has(&DataKey::Farmer(farmer.clone()))
        {
            return Err(ContractError::AlreadyInitialized);
        }

        let farmer_count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::CampaignCount)
            .unwrap_or(0);

        env.storage().persistent().set(
            &DataKey::Farmer(farmer.clone()),
            &Farmer {
                address: farmer.clone(),
                registered: true,
            },
        );
        env.storage()
            .persistent()
            .set(&DataKey::FarmerById(farmer_count + 1), &farmer);

        env.events().publish(
            (symbol_short!("farmer"), symbol_short!("regd")),
            (farmer_count + 1, farmer),
        );
        Ok(())
    }

    pub fn create_campaign(
        env: Env,
        farmer: Address,
        target_amount: i128,
    ) -> Result<u64, ContractError> {
        farmer.require_auth();

        if target_amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        let _farmer_data: Farmer = env
            .storage()
            .persistent()
            .get(&DataKey::Farmer(farmer.clone()))
            .ok_or(ContractError::FarmerNotFound)?;

        let campaign_count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::CampaignCount)
            .unwrap_or(0);

        let campaign_id = campaign_count + 1;
        env.storage()
            .instance()
            .set(&DataKey::CampaignCount, &campaign_id);

        let campaign = Campaign {
            id: campaign_id,
            farmer: farmer.clone(),
            target_amount,
            raised_amount: 0,
            status: CampaignStatus::Pending,
            initial_release_percent: INITIAL_RELEASE_PERCENT,
            mid_release_percent: MID_RELEASE_PERCENT,
            final_release_percent: FINAL_RELEASE_PERCENT,
            initial_released: false,
            mid_released: false,
            final_released: false,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Campaign(campaign_id), &campaign);

        env.events().publish(
            (symbol_short!("camp"), symbol_short!("created")),
            (campaign_id, farmer, target_amount),
        );

        Ok(campaign_id)
    }

    pub fn invest(
        env: Env,
        investor: Address,
        campaign_id: u64,
        amount: i128,
    ) -> Result<i128, ContractError> {
        investor.require_auth();

        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        let mut campaign: Campaign = env
            .storage()
            .persistent()
            .get(&DataKey::Campaign(campaign_id))
            .ok_or(ContractError::CampaignNotFound)?;

        if campaign.status != CampaignStatus::Pending {
            return Err(ContractError::InvalidState);
        }

        let new_raised = campaign.raised_amount + amount;
        campaign.raised_amount = new_raised;

        let was_not_funded = campaign.status == CampaignStatus::Pending;
        if was_not_funded && new_raised >= campaign.target_amount {
            campaign.status = CampaignStatus::Funded;
            env.events().publish(
                (symbol_short!("camp"), symbol_short!("funded")),
                (campaign_id, new_raised, campaign.target_amount),
            );
        }

        env.storage()
            .persistent()
            .set(&DataKey::Campaign(campaign_id), &campaign);

        env.events().publish(
            (symbol_short!("camp"), symbol_short!("invest")),
            (campaign_id, investor, amount, new_raised),
        );

        Ok(new_raised)
    }

    pub fn check_funding_complete(env: Env, campaign_id: u64) -> Result<bool, ContractError> {
        let campaign: Campaign = env
            .storage()
            .persistent()
            .get(&DataKey::Campaign(campaign_id))
            .ok_or(ContractError::CampaignNotFound)?;

        Ok(campaign.raised_amount >= campaign.target_amount)
    }

    pub fn start_production(
        env: Env,
        farmer: Address,
        campaign_id: u64,
    ) -> Result<(), ContractError> {
        farmer.require_auth();

        let mut campaign: Campaign = env
            .storage()
            .persistent()
            .get(&DataKey::Campaign(campaign_id))
            .ok_or(ContractError::CampaignNotFound)?;

        if campaign.farmer != farmer {
            return Err(ContractError::NotFarmer);
        }

        if campaign.status != CampaignStatus::Funded {
            return Err(ContractError::CampaignNotFunded);
        }

        campaign.status = CampaignStatus::InProduction;
        env.storage()
            .persistent()
            .set(&DataKey::Campaign(campaign_id), &campaign);

        env.events().publish(
            (symbol_short!("camp"), symbol_short!("started")),
            (campaign_id, farmer),
        );

        Ok(())
    }

    pub fn mark_harvest(env: Env, farmer: Address, campaign_id: u64) -> Result<(), ContractError> {
        farmer.require_auth();

        let mut campaign: Campaign = env
            .storage()
            .persistent()
            .get(&DataKey::Campaign(campaign_id))
            .ok_or(ContractError::CampaignNotFound)?;

        if campaign.farmer != farmer {
            return Err(ContractError::NotFarmer);
        }

        if campaign.status != CampaignStatus::InProduction {
            return Err(ContractError::CampaignNotInProduction);
        }

        campaign.status = CampaignStatus::Harvested;
        env.storage()
            .persistent()
            .set(&DataKey::Campaign(campaign_id), &campaign);

        env.events().publish(
            (symbol_short!("camp"), symbol_short!("harvest")),
            (campaign_id, farmer),
        );

        Ok(())
    }

    pub fn settle_campaign(env: Env, campaign_id: u64) -> Result<(), ContractError> {
        let mut campaign: Campaign = env
            .storage()
            .persistent()
            .get(&DataKey::Campaign(campaign_id))
            .ok_or(ContractError::CampaignNotFound)?;

        if campaign.status == CampaignStatus::Settled {
            return Err(ContractError::AlreadySettled);
        }

        if campaign.status != CampaignStatus::Harvested {
            return Err(ContractError::InvalidState);
        }

        campaign.status = CampaignStatus::Settled;
        env.storage()
            .persistent()
            .set(&DataKey::Campaign(campaign_id), &campaign);

        env.events().publish(
            (symbol_short!("camp"), symbol_short!("settled")),
            campaign_id,
        );

        Ok(())
    }

    pub fn release_tranche(
        env: Env,
        campaign_id: u64,
        tranche: u32,
    ) -> Result<i128, ContractError> {
        let mut campaign: Campaign = env
            .storage()
            .persistent()
            .get(&DataKey::Campaign(campaign_id))
            .ok_or(ContractError::CampaignNotFound)?;

        if campaign.status != CampaignStatus::Funded
            && campaign.status != CampaignStatus::InProduction
            && campaign.status != CampaignStatus::Harvested
            && campaign.status != CampaignStatus::Settled
        {
            return Err(ContractError::CampaignNotFunded);
        }

        let release_amount = match tranche {
            0 => {
                if campaign.initial_released {
                    return Err(ContractError::TrancheAlreadyReleased);
                }
                campaign.initial_released = true;
                (campaign.raised_amount * campaign.initial_release_percent as i128) / 100
            }
            1 => {
                if campaign.mid_released {
                    return Err(ContractError::TrancheAlreadyReleased);
                }
                campaign.mid_released = true;
                (campaign.raised_amount * campaign.mid_release_percent as i128) / 100
            }
            2 => {
                if campaign.final_released {
                    return Err(ContractError::TrancheAlreadyReleased);
                }
                campaign.final_released = true;
                (campaign.raised_amount * campaign.final_release_percent as i128) / 100
            }
            _ => return Err(ContractError::InvalidState),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Campaign(campaign_id), &campaign);

        env.events().publish(
            (symbol_short!("camp"), symbol_short!("tranche")),
            (campaign_id, tranche, release_amount),
        );

        Ok(release_amount)
    }

    pub fn fail_campaign(env: Env, campaign_id: u64) -> Result<(), ContractError> {
        let mut campaign: Campaign = env
            .storage()
            .persistent()
            .get(&DataKey::Campaign(campaign_id))
            .ok_or(ContractError::CampaignNotFound)?;

        if campaign.status != CampaignStatus::Pending && campaign.status != CampaignStatus::Funded {
            return Err(ContractError::InvalidState);
        }

        campaign.status = CampaignStatus::Failed;
        env.storage()
            .persistent()
            .set(&DataKey::Campaign(campaign_id), &campaign);

        env.events().publish(
            (symbol_short!("camp"), symbol_short!("failed")),
            campaign_id,
        );

        Ok(())
    }

    pub fn dispute_campaign(env: Env, campaign_id: u64) -> Result<(), ContractError> {
        let mut campaign: Campaign = env
            .storage()
            .persistent()
            .get(&DataKey::Campaign(campaign_id))
            .ok_or(ContractError::CampaignNotFound)?;

        if campaign.status != CampaignStatus::Funded
            && campaign.status != CampaignStatus::InProduction
            && campaign.status != CampaignStatus::Harvested
        {
            return Err(ContractError::InvalidState);
        }

        campaign.status = CampaignStatus::Disputed;
        env.storage()
            .persistent()
            .set(&DataKey::Campaign(campaign_id), &campaign);

        env.events().publish(
            (symbol_short!("camp"), symbol_short!("disputed")),
            campaign_id,
        );

        Ok(())
    }

    pub fn resolve_campaign(
        env: Env,
        campaign_id: u64,
        success: bool,
    ) -> Result<(), ContractError> {
        let mut campaign: Campaign = env
            .storage()
            .persistent()
            .get(&DataKey::Campaign(campaign_id))
            .ok_or(ContractError::CampaignNotFound)?;

        if campaign.status != CampaignStatus::Disputed {
            return Err(ContractError::InvalidState);
        }

        campaign.status = if success {
            CampaignStatus::Settled
        } else {
            CampaignStatus::Failed
        };

        env.storage()
            .persistent()
            .set(&DataKey::Campaign(campaign_id), &campaign);

        env.events().publish(
            (symbol_short!("camp"), symbol_short!("resolved")),
            (campaign_id, success),
        );

        Ok(())
    }

    pub fn get_campaign(env: Env, campaign_id: u64) -> Result<Campaign, ContractError> {
        env.storage()
            .persistent()
            .get(&DataKey::Campaign(campaign_id))
            .ok_or(ContractError::CampaignNotFound)
    }

    pub fn get_farmer(env: Env, farmer: Address) -> Result<Farmer, ContractError> {
        env.storage()
            .persistent()
            .get(&DataKey::Farmer(farmer))
            .ok_or(ContractError::FarmerNotFound)
    }
}

mod test;
