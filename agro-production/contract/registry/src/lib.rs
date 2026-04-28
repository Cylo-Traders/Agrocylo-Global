#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, Vec};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RegistryError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    FarmerAlreadyRegistered = 3,
    FarmerNotRegistered = 4,
    CampaignAlreadyRegistered = 5,
    UnauthorizedContract = 6,
    InvalidFarmerAddress = 7,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractRefs {
    pub escrow_contract: Address,
    pub production_contract: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FarmerRecord {
    pub address: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CampaignRecord {
    pub campaign_id: u64,
    pub farmer: Address,
    pub source_contract: Address,
    pub linked_escrow_order_id: Option<u64>,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    EscrowContract,
    ProductionContract,
    Farmer(Address),
    Farmers,
    Campaign(u64),
    AllCampaignIds,
    FarmerCampaigns(Address),
}

#[contract]
pub struct RegistryContract;

#[contractimpl]
impl RegistryContract {
    pub fn initialize(
        env: Env,
        admin: Address,
        escrow_contract: Address,
        production_contract: Address,
    ) -> Result<(), RegistryError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(RegistryError::AlreadyInitialized);
        }

        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::EscrowContract, &escrow_contract);
        env.storage()
            .instance()
            .set(&DataKey::ProductionContract, &production_contract);

        // (registry, updated) → emitted on initialization and any future contract re-linking
        env.events().publish(
            (symbol_short!("registry"), symbol_short!("updated")),
            (escrow_contract, production_contract),
        );

        Ok(())
    }

    pub fn get_contract_refs(env: Env) -> Result<ContractRefs, RegistryError> {
        let refs = read_contract_refs(&env)?;
        Ok(refs)
    }

    pub fn register_farmer(env: Env, farmer: Address) -> Result<(), RegistryError> {
        require_initialized(&env)?;
        validate_farmer_address(&env, &farmer)?;
        farmer.require_auth();

        if env
            .storage()
            .persistent()
            .has(&DataKey::Farmer(farmer.clone()))
        {
            return Err(RegistryError::FarmerAlreadyRegistered);
        }

        let farmer_record = FarmerRecord {
            address: farmer.clone(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::Farmer(farmer.clone()), &farmer_record);

        let mut farmers = read_farmer_list(&env);
        farmers.push_back(farmer.clone());
        env.storage().persistent().set(&DataKey::Farmers, &farmers);

        let campaign_ids: Vec<u64> = Vec::new(&env);
        env.storage()
            .persistent()
            .set(&DataKey::FarmerCampaigns(farmer.clone()), &campaign_ids);

        // (farmer, registered) → farmer_address
        env.events().publish(
            (symbol_short!("farmer"), symbol_short!("registerd")),
            (farmer,),
        );

        Ok(())
    }

    pub fn is_farmer_registered(env: Env, farmer: Address) -> Result<bool, RegistryError> {
        require_initialized(&env)?;
        Ok(env.storage().persistent().has(&DataKey::Farmer(farmer)))
    }

    pub fn get_farmer(env: Env, farmer: Address) -> Result<Option<FarmerRecord>, RegistryError> {
        require_initialized(&env)?;
        Ok(env.storage().persistent().get(&DataKey::Farmer(farmer)))
    }

    pub fn get_all_farmers(env: Env) -> Result<Vec<Address>, RegistryError> {
        require_initialized(&env)?;
        Ok(read_farmer_list(&env))
    }

    pub fn register_campaign(
        env: Env,
        source_contract: Address,
        campaign_id: u64,
        farmer: Address,
        linked_escrow_order_id: Option<u64>,
    ) -> Result<(), RegistryError> {
        let refs = read_contract_refs(&env)?;
        validate_farmer_address(&env, &farmer)?;
        source_contract.require_auth();

        if !is_authorized_contract(&source_contract, &refs) {
            return Err(RegistryError::UnauthorizedContract);
        }

        if !env
            .storage()
            .persistent()
            .has(&DataKey::Farmer(farmer.clone()))
        {
            return Err(RegistryError::FarmerNotRegistered);
        }

        if env
            .storage()
            .persistent()
            .has(&DataKey::Campaign(campaign_id))
        {
            return Err(RegistryError::CampaignAlreadyRegistered);
        }

        let campaign = CampaignRecord {
            campaign_id,
            farmer: farmer.clone(),
            source_contract,
            linked_escrow_order_id,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Campaign(campaign_id), &campaign);

        let mut all_campaign_ids = read_all_campaign_ids(&env);
        all_campaign_ids.push_back(campaign_id);
        env.storage()
            .persistent()
            .set(&DataKey::AllCampaignIds, &all_campaign_ids);

        let mut farmer_campaign_ids = read_farmer_campaign_ids(&env, &farmer);
        farmer_campaign_ids.push_back(campaign_id);
        env.storage()
            .persistent()
            .set(&DataKey::FarmerCampaigns(farmer.clone()), &farmer_campaign_ids);

        // (campaign, registered) → (campaign_id, farmer_address)
        env.events().publish(
            (symbol_short!("campaign"), symbol_short!("registerd")),
            (campaign_id, farmer),
        );

        Ok(())
    }

    pub fn get_campaign(
        env: Env,
        campaign_id: u64,
    ) -> Result<Option<CampaignRecord>, RegistryError> {
        require_initialized(&env)?;
        Ok(env
            .storage()
            .persistent()
            .get(&DataKey::Campaign(campaign_id)))
    }

    pub fn get_all_campaigns(env: Env) -> Result<Vec<CampaignRecord>, RegistryError> {
        require_initialized(&env)?;
        let ids = read_all_campaign_ids(&env);
        Ok(read_campaigns_from_ids(&env, ids))
    }

    pub fn get_campaigns_by_farmer(
        env: Env,
        farmer: Address,
    ) -> Result<Vec<CampaignRecord>, RegistryError> {
        require_initialized(&env)?;
        let ids = read_farmer_campaign_ids(&env, &farmer);
        Ok(read_campaigns_from_ids(&env, ids))
    }
}

fn require_initialized(env: &Env) -> Result<(), RegistryError> {
    if !env.storage().instance().has(&DataKey::Admin) {
        return Err(RegistryError::NotInitialized);
    }
    Ok(())
}

fn read_contract_refs(env: &Env) -> Result<ContractRefs, RegistryError> {
    require_initialized(env)?;

    let escrow_contract = env
        .storage()
        .instance()
        .get(&DataKey::EscrowContract)
        .ok_or(RegistryError::NotInitialized)?;
    let production_contract = env
        .storage()
        .instance()
        .get(&DataKey::ProductionContract)
        .ok_or(RegistryError::NotInitialized)?;

    Ok(ContractRefs {
        escrow_contract,
        production_contract,
    })
}

fn validate_farmer_address(env: &Env, farmer: &Address) -> Result<(), RegistryError> {
    if env.current_contract_address() == farmer.clone() {
        return Err(RegistryError::InvalidFarmerAddress);
    }

    if let Ok(refs) = read_contract_refs(env) {
        if refs.escrow_contract == farmer.clone() || refs.production_contract == farmer.clone() {
            return Err(RegistryError::InvalidFarmerAddress);
        }
    }

    Ok(())
}

fn is_authorized_contract(source_contract: &Address, refs: &ContractRefs) -> bool {
    source_contract.clone() == refs.escrow_contract
        || source_contract.clone() == refs.production_contract
}

fn read_farmer_list(env: &Env) -> Vec<Address> {
    env.storage()
        .persistent()
        .get(&DataKey::Farmers)
        .unwrap_or_else(|| Vec::new(env))
}

fn read_all_campaign_ids(env: &Env) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::AllCampaignIds)
        .unwrap_or_else(|| Vec::new(env))
}

fn read_farmer_campaign_ids(env: &Env, farmer: &Address) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::FarmerCampaigns(farmer.clone()))
        .unwrap_or_else(|| Vec::new(env))
}

fn read_campaigns_from_ids(env: &Env, ids: Vec<u64>) -> Vec<CampaignRecord> {
    let mut campaigns = Vec::new(env);
    for campaign_id in ids.iter() {
        if let Some(campaign) = env
            .storage()
            .persistent()
            .get(&DataKey::Campaign(campaign_id))
        {
            campaigns.push_back(campaign);
        }
    }
    campaigns
}

mod test;
