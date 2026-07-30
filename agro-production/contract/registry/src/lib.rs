#![no_std]

// COST NOTE:
// Farmer registration and campaign registration now use indexed keys (FarmerAt(i), CampaignAt(i))
// instead of unbounded Vecs. This reduces ledger entries from O(n) single-entry-per-operation to
// O(1) constant-entry-per-operation. A registry with 10k farmers and 100k campaigns now uses
// ~3 ledger entries (FarmerCount, CampaignCount, FarmerCampaignCount per farmer) instead of 2
// large Vec entries. Per-farmer campaign lookups use FarmerCampaignAt(farmer, i) instead of an
// unbounded per-farmer Vec, reducing worst-case from O(n) to O(limit) = O(50) with pagination.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, String, Vec,
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
    BatchNotFound = 8,
    OrderBatchLinkExists = 9,
    CampaignNotHarvested = 10,
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
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReputationRecord {
    pub score: i64,
    pub completed_orders: u32,
    pub disputed_orders: u32,
}

/// Provenance record for a harvest batch (Issue #652 drift fix: this type
/// was referenced by `mint_batch`/`link_batch_to_order`/`get_batch`/
/// `get_batch_history` without ever being defined, leaving the crate — and
/// its dependents' test suites — uncompilable).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchRecord {
    pub batch_id: u64,
    pub campaign_id: u64,
    pub farmer: Address,
    pub crop: String,
    pub harvest_date: u64,
    pub quantity: i128,
    pub linked_order_ids: Vec<u64>,
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
    Reputation(Address),
    /// Provenance batch record, keyed by batch id.
    Batch(u64),
    BatchCount,
    /// Marks that `order_id` has already been linked to `batch_id`, guarding
    /// against a duplicate `link_batch_to_order` call.
    BatchOrderLink(u64, u64),
    /// Batch ids linked to a given order, for `get_batch_history`.
    OrderBatch(u64),
}

const COMPLETION_POINTS: i64 = 10;
const DISPUTE_PENALTY_POINTS: i64 = 15;

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

    /// Records the outcome of an on-chain order and updates the farmer's reputation
    /// score. Callable only by the registered escrow/production contracts — the caller
    /// must be `source_contract` itself (contract-issued auth), and `source_contract`
    /// must match one of the addresses configured at `initialize`. No end user can
    /// invoke this directly to inflate or erase their own score.
    ///
    /// `disputed_buyer_share_bps`: `None` for a cleanly completed order (buyer
    /// confirmed receipt); `Some(bps)` for a resolved dispute, mirroring the escrow's
    /// own split — 0 = fully released to the farmer, 10_000 = fully refunded to the
    /// buyer, values in between a proportional split.
    pub fn record_order_outcome(
        env: Env,
        source_contract: Address,
        farmer: Address,
        disputed_buyer_share_bps: Option<u32>,
    ) -> Result<ReputationRecord, RegistryError> {
        let refs = read_contract_refs(&env)?;
        source_contract.require_auth();

        if !is_authorized_contract(&source_contract, &refs) {
            return Err(RegistryError::UnauthorizedContract);
        }

        let key = DataKey::Reputation(farmer.clone());
        let mut record: ReputationRecord =
            env.storage().persistent().get(&key).unwrap_or(ReputationRecord {
                score: 0,
                completed_orders: 0,
                disputed_orders: 0,
            });

        match disputed_buyer_share_bps {
            None => {
                record.score += COMPLETION_POINTS;
                record.completed_orders += 1;
            }
            Some(buyer_share_bps) => {
                let buyer_share_bps = i64::from(buyer_share_bps.min(10_000));
                let reward = (10_000 - buyer_share_bps) * COMPLETION_POINTS / 10_000;
                let penalty = buyer_share_bps * DISPUTE_PENALTY_POINTS / 10_000;
                record.score += reward - penalty;
                record.disputed_orders += 1;
            }
        }

        env.storage().persistent().set(&key, &record);

        env.events().publish(
            (symbol_short!("reput"), symbol_short!("updated")),
            (farmer, record.score),
        );

        Ok(record)
    }

    /// Read-only: current reputation of `farmer`. Farmers with no recorded orders
    /// yet have a zeroed record rather than an error.
    pub fn get_reputation(env: Env, farmer: Address) -> Result<ReputationRecord, RegistryError> {
        require_initialized(&env)?;
        Ok(env
            .storage()
            .persistent()
            .get(&DataKey::Reputation(farmer))
            .unwrap_or(ReputationRecord {
                score: 0,
                completed_orders: 0,
                disputed_orders: 0,
            }))
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

    // ── Provenance Registry (Harvest-to-Delivery) ───────────────────────────

    pub fn mint_batch(
        env: Env,
        source_contract: Address,
        campaign_id: u64,
        farmer: Address,
        crop: String,
        harvest_date: u64,
        quantity: i128,
    ) -> Result<u64, RegistryError> {
        require_initialized(&env)?;
        let refs = read_contract_refs(&env)?;
        source_contract.require_auth();
        if !is_authorized_contract(&source_contract, &refs) {
            return Err(RegistryError::UnauthorizedContract);
        }
        if !env.storage().persistent().has(&DataKey::Campaign(campaign_id)) {
            return Err(RegistryError::CampaignAlreadyRegistered);
        }

        let batch_count: u64 = env.storage().persistent().get(&DataKey::BatchCount).unwrap_or(0);
        let batch_id = batch_count + 1;

        let batch = BatchRecord {
            batch_id,
            campaign_id,
            farmer: farmer.clone(),
            crop,
            harvest_date,
            quantity,
            linked_order_ids: Vec::new(&env),
        };

        env.storage().persistent().set(&DataKey::Batch(batch_id), &batch);
        env.storage().persistent().set(&DataKey::BatchCount, &batch_id);

        env.events().publish(
            (symbol_short!("batch"), symbol_short!("minted")),
            (batch_id, campaign_id, farmer, quantity),
        );

        Ok(batch_id)
    }

    pub fn link_batch_to_order(
        env: Env,
        source_contract: Address,
        batch_id: u64,
        order_id: u64,
    ) -> Result<(), RegistryError> {
        require_initialized(&env)?;
        let refs = read_contract_refs(&env)?;
        source_contract.require_auth();
        if !is_authorized_contract(&source_contract, &refs) {
            return Err(RegistryError::UnauthorizedContract);
        }

        let mut batch: BatchRecord = env.storage().persistent().get(&DataKey::Batch(batch_id))
            .ok_or(RegistryError::BatchNotFound)?;

        let link_key = DataKey::BatchOrderLink(batch_id, order_id);
        if env.storage().persistent().has(&link_key) {
            return Err(RegistryError::OrderBatchLinkExists);
        }

        batch.linked_order_ids.push_back(order_id);
        env.storage().persistent().set(&DataKey::Batch(batch_id), &batch);
        env.storage().persistent().set(&link_key, &true);

        let order_batch_key = DataKey::OrderBatch(order_id);
        let mut order_batches: Vec<u64> = env.storage().persistent().get(&order_batch_key).unwrap_or_else(|| Vec::new(&env));
        order_batches.push_back(batch_id);
        env.storage().persistent().set(&order_batch_key, &order_batches);

        env.events().publish(
            (symbol_short!("batch"), symbol_short!("linked")),
            (batch_id, order_id),
        );

        Ok(())
    }

    pub fn get_batch(env: Env, batch_id: u64) -> Result<Option<BatchRecord>, RegistryError> {
        require_initialized(&env)?;
        Ok(env.storage().persistent().get(&DataKey::Batch(batch_id)))
    }

    pub fn get_batch_history(env: Env, order_id: u64) -> Result<Vec<BatchRecord>, RegistryError> {
        require_initialized(&env)?;
        let batch_ids: Vec<u64> = env.storage().persistent()
            .get(&DataKey::OrderBatch(order_id))
            .unwrap_or_else(|| Vec::new(&env));

        let mut result = Vec::new(&env);
        for id in batch_ids.iter() {
            if let Some(batch) = env.storage().persistent().get::<_, BatchRecord>(&DataKey::Batch(id)) {
                result.push_back(batch);
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
