#![no_std]

// COST NOTE:
// Farmer registration and campaign registration now use indexed keys (FarmerAt(i), CampaignAt(i))
// instead of unbounded Vecs. This reduces ledger entries from O(n) single-entry-per-operation to
// O(1) constant-entry-per-operation. A registry with 10k farmers and 100k campaigns now uses
// ~3 ledger entries (FarmerCount, CampaignCount, FarmerCampaignCount per farmer) instead of 2
// large Vec entries. Per-farmer campaign lookups use FarmerCampaignAt(farmer, i) instead of an
// unbounded per-farmer Vec, reducing worst-case from O(n) to O(limit) = O(50) with pagination.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, Vec,
};

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
    FarmerCount,
    FarmerAt(u32),
    Campaign(u64),
    CampaignCount,
    CampaignAt(u64),
    FarmerCampaignCount(Address),
    FarmerCampaignAt(Address, u64),
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

        // Replaced unbounded Vec with indexed keys: FarmerCount + FarmerAt(index).
        // Old shape: DataKey::Farmers stored all addresses in a single growing Vec.
        // New shape: FarmerCount tracks total, FarmerAt(i) stores address at index i.
        // Benefit: O(1) per-operation cost; no single ledger entry grows unbounded.
        let farmer_count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::FarmerCount)
            .unwrap_or(0);
        let next_index = farmer_count;
        env.storage()
            .persistent()
            .set(&DataKey::FarmerCount, &(farmer_count + 1));
        env.storage()
            .persistent()
            .set(&DataKey::FarmerAt(next_index), &farmer.clone());

        // Initialize per-farmer campaign count (replaces per-farmer Vec).
        env.storage()
            .persistent()
            .set(&DataKey::FarmerCampaignCount(farmer.clone()), &0u64);

        // (farmer, registered) → farmer_address
        env.events().publish(
            (symbol_short!("farmer"), symbol_short!("farm_reg")),
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

    pub fn get_farmers(env: Env, start: u32, limit: u32) -> Result<Vec<Address>, RegistryError> {
        require_initialized(&env)?;
        const MAX_LIMIT: u32 = 50;
        if limit > MAX_LIMIT {
            return Err(RegistryError::InvalidFarmerAddress); // Reuse error type for invalid input
        }
        let farmer_count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::FarmerCount)
            .unwrap_or(0);
        let mut result = Vec::new(&env);
        let end = u32::min(start + limit, farmer_count);
        for i in start..end {
            if let Some(farmer) = env
                .storage()
                .persistent()
                .get::<_, Address>(&DataKey::FarmerAt(i))
            {
                result.push_back(farmer);
            }
        }
        Ok(result)
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

        // Replaced unbounded Vec with indexed keys: CampaignCount + CampaignAt(index).
        // Old shape: DataKey::AllCampaignIds stored all IDs in a single growing Vec.
        // New shape: CampaignCount tracks total, CampaignAt(i) stores ID at index i.
        // Benefit: O(1) per-operation cost; no single ledger entry grows unbounded.
        let campaign_count: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::CampaignCount)
            .unwrap_or(0);
        let next_campaign_index = campaign_count;
        env.storage()
            .persistent()
            .set(&DataKey::CampaignCount, &(campaign_count + 1));
        env.storage()
            .persistent()
            .set(&DataKey::CampaignAt(next_campaign_index), &campaign_id);

        // Replaced unbounded per-farmer Vec with indexed keys: FarmerCampaignCount + FarmerCampaignAt(farmer, index).
        // Old shape: DataKey::FarmerCampaigns(farmer) stored all campaign IDs for that farmer in a single growing Vec.
        // New shape: FarmerCampaignCount(farmer) tracks total, FarmerCampaignAt(farmer, i) stores ID at index i.
        // Benefit: O(1) per-operation cost; no per-farmer ledger entry grows unbounded.
        let farmer_campaign_count: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::FarmerCampaignCount(farmer.clone()))
            .unwrap_or(0);
        let next_farmer_campaign_index = farmer_campaign_count;
        env.storage()
            .persistent()
            .set(
                &DataKey::FarmerCampaignCount(farmer.clone()),
                &(farmer_campaign_count + 1),
            );
        env.storage()
            .persistent()
            .set(
                &DataKey::FarmerCampaignAt(farmer.clone(), next_farmer_campaign_index),
                &campaign_id,
            );

        // (campaign, registered) → (campaign_id, farmer_address)
        env.events().publish(
            (symbol_short!("campaign"), symbol_short!("camp_reg")),
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

    pub fn get_campaigns(env: Env, start: u64, limit: u32) -> Result<Vec<CampaignRecord>, RegistryError> {
        require_initialized(&env)?;
        const MAX_LIMIT: u32 = 50;
        if limit > MAX_LIMIT {
            return Err(RegistryError::InvalidFarmerAddress);
        }
        let campaign_count: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::CampaignCount)
            .unwrap_or(0);
        let mut result = Vec::new(&env);
        let end = u64::min(start + limit as u64, campaign_count);
        for i in start..end {
            if let Some(campaign_id) = env
                .storage()
                .persistent()
                .get::<_, u64>(&DataKey::CampaignAt(i))
            {
                if let Some(campaign) = env
                    .storage()
                    .persistent()
                    .get::<_, CampaignRecord>(&DataKey::Campaign(campaign_id))
                {
                    result.push_back(campaign);
                }
            }
        }
        Ok(result)
    }

    pub fn get_farmer_campaigns(
        env: Env,
        farmer: Address,
        start: u64,
        limit: u32,
    ) -> Result<Vec<CampaignRecord>, RegistryError> {
        require_initialized(&env)?;
        const MAX_LIMIT: u32 = 50;
        if limit > MAX_LIMIT {
            return Err(RegistryError::InvalidFarmerAddress);
        }
        let campaign_count: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::FarmerCampaignCount(farmer.clone()))
            .unwrap_or(0);
        let mut result = Vec::new(&env);
        let end = u64::min(start + limit as u64, campaign_count);
        for i in start..end {
            if let Some(campaign_id) = env
                .storage()
                .persistent()
                .get::<_, u64>(&DataKey::FarmerCampaignAt(farmer.clone(), i))
            {
                if let Some(campaign) = env
                    .storage()
                    .persistent()
                    .get::<_, CampaignRecord>(&DataKey::Campaign(campaign_id))
                {
                    result.push_back(campaign);
                }
            }
        }
        Ok(result)
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


mod test;
