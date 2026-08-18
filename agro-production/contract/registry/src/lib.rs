#![no_std]

// COST NOTE:
// Farmer registration and campaign registration now use indexed keys (FarmerAt(i), CampaignAt(i))
// instead of unbounded Vecs. This reduces ledger entries from O(n) single-entry-per-operation to
// O(1) constant-entry-per-operation. A registry with 10k farmers and 100k campaigns now uses
// ~3 ledger entries (FarmerCount, CampaignCount, FarmerCampaignCount per farmer) instead of 2
// large Vec entries. Per-farmer campaign lookups use FarmerCampaignAt(farmer, i) instead of an
// unbounded per-farmer Vec, reducing worst-case from O(n) to O(limit) = O(50) with pagination.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, BytesN, Env,
    Error as HostError, Symbol, Val, Vec,
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

    NotAdmin = 8,
    InvalidGovernanceContract = 9,
    ContractPaused = 10,
    NotPaused = 11,
    AlreadyPaused = 12,
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
    /// Governance contract authorized to gate `upgrade`/`set_guardian`/
    /// `unpause`/`migrate` (Issue #757). Falls back to admin-only while
    /// unset, same pattern as the escrow contracts.
    GovernanceContract,
    /// Address allowed to instantly `pause` without going through
    /// governance's full proposal flow.
    Guardian,
    Paused,
    SchemaVersion,
}

/// Current on-chain storage layout version (Issue #757). Bump when a stored
/// `#[contracttype]` gains/loses/reshapes a field, and extend `migrate` to
/// translate existing entries — see `docs/CONTRACT_UPGRADES.md`.
const CURRENT_SCHEMA_VERSION: u32 = 1;

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

        env.storage()
            .instance()
            .set(&DataKey::SchemaVersion, &CURRENT_SCHEMA_VERSION);

        // (registry, updated) → emitted on initialization and any future contract re-linking
        env.events().publish(
            (symbol_short!("registry"), symbol_short!("updated")),
            (escrow_contract, production_contract),
        );

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Governance, upgrade, guardian, pause (Issue #757)
    // -----------------------------------------------------------------------

    /// Set (or update) the governance contract address. Admin-only bootstrap
    /// while unset; governance-only once set (same hardened pattern as
    /// `contracts/escrow`/`production_escrow` post-#680). `governance` must
    /// be a live contract implementing the expected interface, checked via a
    /// known view-function call before it's accepted.
    pub fn set_governance_contract(
        env: Env,
        caller: Address,
        governance: Address,
    ) -> Result<(), RegistryError> {
        caller.require_auth();
        require_governed_caller(&env, &caller)?;
        governance_client::verify(&env, &governance)
            .map_err(|_| RegistryError::InvalidGovernanceContract)?;
        env.storage()
            .instance()
            .set(&DataKey::GovernanceContract, &governance);
        Ok(())
    }

    pub fn get_governance_contract(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::GovernanceContract)
    }

    /// Upgrades this contract's WASM. Governance-gated: admin-only while no
    /// governance is configured, governance-only once it is. Callers should
    /// use governance's `propose_upgrade`, which applies the longer upgrade
    /// timelock. See `docs/CONTRACT_UPGRADES.md` for the required
    /// pause -> upgrade -> migrate -> unpause sequencing.
    pub fn upgrade(env: Env, caller: Address, new_wasm_hash: BytesN<32>) -> Result<(), RegistryError> {
        caller.require_auth();
        require_governed_caller(&env, &caller)?;
        env.deployer().update_current_contract_wasm(new_wasm_hash.clone());
        env.events().publish(
            (symbol_short!("registry"), symbol_short!("upgraded")),
            (new_wasm_hash,),
        );
        Ok(())
    }

    /// Sets the guardian allowed to `pause` instantly. Governance-gated
    /// identically to `set_governance_contract`.
    pub fn set_guardian(env: Env, caller: Address, guardian: Address) -> Result<(), RegistryError> {
        caller.require_auth();
        require_governed_caller(&env, &caller)?;
        env.storage().instance().set(&DataKey::Guardian, &guardian);
        Ok(())
    }

    /// Instant pause — no timelock — callable by the guardian or the
    /// configured governance contract.
    pub fn pause(env: Env, caller: Address) -> Result<(), RegistryError> {
        caller.require_auth();
        let is_guardian = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::Guardian)
            .map(|g| g == caller)
            .unwrap_or(false);
        let is_governance = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::GovernanceContract)
            .map(|g| g == caller)
            .unwrap_or(false);
        if !is_guardian && !is_governance {
            return Err(RegistryError::NotAdmin);
        }
        if env.storage().instance().get(&DataKey::Paused).unwrap_or(false) {
            return Err(RegistryError::AlreadyPaused);
        }
        env.storage().instance().set(&DataKey::Paused, &true);
        env.events().publish(
            (symbol_short!("registry"), symbol_short!("paused")),
            (caller,),
        );
        Ok(())
    }

    /// Unpause. Deliberately governance-only (never the guardian).
    pub fn unpause(env: Env, caller: Address) -> Result<(), RegistryError> {
        caller.require_auth();
        require_governed_caller(&env, &caller)?;
        if !env.storage().instance().get(&DataKey::Paused).unwrap_or(false) {
            return Err(RegistryError::NotPaused);
        }
        env.storage().instance().set(&DataKey::Paused, &false);
        env.events().publish(
            (symbol_short!("registry"), symbol_short!("unpausd")),
            (caller,),
        );
        Ok(())
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage().instance().get(&DataKey::Paused).unwrap_or(false)
    }

    /// Storage migration hook. This contract's schema hasn't changed since
    /// `CURRENT_SCHEMA_VERSION` was introduced — nothing to translate yet.
    /// A future layout-changing upgrade extends this with an old-shape read
    /// + new-shape write per affected `DataKey`, following the worked
    /// example in `investment_basket::migrate`. Governance-gated, and
    /// expected to run while `is_paused()` — see
    /// `docs/CONTRACT_UPGRADES.md`.
    pub fn migrate(env: Env, caller: Address) -> Result<u32, RegistryError> {
        caller.require_auth();
        require_governed_caller(&env, &caller)?;
        let stored: u32 = env
            .storage()
            .instance()
            .get(&DataKey::SchemaVersion)
            .unwrap_or(0);
        if stored < CURRENT_SCHEMA_VERSION {
            env.storage()
                .instance()
                .set(&DataKey::SchemaVersion, &CURRENT_SCHEMA_VERSION);
        }
        Ok(CURRENT_SCHEMA_VERSION)
    }

    pub fn get_schema_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::SchemaVersion)
            .unwrap_or(0)
    }

    pub fn get_guardian(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Guardian)
    }

    pub fn get_contract_refs(env: Env) -> Result<ContractRefs, RegistryError> {
        let refs = read_contract_refs(&env)?;
        Ok(refs)
    }

    pub fn register_farmer(env: Env, farmer: Address) -> Result<(), RegistryError> {
        require_initialized(&env)?;
        require_not_paused(&env)?;
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
        require_not_paused(&env)?;
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
}

fn require_initialized(env: &Env) -> Result<(), RegistryError> {
    if !env.storage().instance().has(&DataKey::Admin) {
        return Err(RegistryError::NotInitialized);
    }
    Ok(())
}

/// Enforces that `caller` is the authorized party for governance-gated
/// actions: the governance contract if one has been set via
/// `set_governance_contract`, otherwise the raw admin as a fallback.
fn require_governed_caller(env: &Env, caller: &Address) -> Result<(), RegistryError> {
    if let Some(governance) = env
        .storage()
        .instance()
        .get::<_, Address>(&DataKey::GovernanceContract)
    {
        if *caller != governance {
            return Err(RegistryError::NotAdmin);
        }
        return Ok(());
    }
    let admin_addr: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(RegistryError::NotInitialized)?;
    if *caller != admin_addr {
        return Err(RegistryError::NotAdmin);
    }
    Ok(())
}

/// Gates `register_farmer`/`register_campaign` only — deliberately *not*
/// `record_order_outcome`, which the escrow contracts invoke via a plain
/// (non-`try_`) cross-contract call as part of their own `confirm_receipt`/
/// `resolve_dispute` core paths. Pausing that too would let a registry
/// pause brick unrelated escrow functionality, which is a bigger blast
/// radius than the pause is meant to have — see `docs/CONTRACT_UPGRADES.md`.
fn require_not_paused(env: &Env) -> Result<(), RegistryError> {
    if env.storage().instance().get(&DataKey::Paused).unwrap_or(false) {
        return Err(RegistryError::ContractPaused);
    }
    Ok(())
}

/// Verifies a candidate governance address is a real deployed governance
/// contract (mirrors the check added to the escrow contracts in #680).
mod governance_client {
    use super::{Address, Env, HostError, Symbol, Val, Vec};

    pub fn verify(env: &Env, governance: &Address) -> Result<(), ()> {
        let func = Symbol::new(env, "get_admin");
        let args: Vec<Val> = Vec::new(env);
        match env.try_invoke_contract::<Val, HostError>(governance, &func, args) {
            Ok(_) => Ok(()),
            Err(_) => Err(()),
        }
    }
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
