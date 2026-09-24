#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, BytesN, Env,
    Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum InsuranceError {
    AlreadyInitialized = 1,
    ContractNotInitialized = 2,
    CampaignNotRegistered = 3,
    PolicyAlreadyActive = 4,
    PolicyNotActive = 5,
    PremiumExpired = 6,
    ThresholdBreachReported = 7,
    NotOracle = 8,
    NotAdmin = 9,
    InvalidThreshold = 10,
    AlreadyPaidOut = 11,
    PremiumRateTooHigh = 12,
    ContractPaused = 13,
    AlreadyPaused = 14,
    NotPaused = 15,
    InvalidGovernanceContract = 16,
    ReportedValueOutOfBounds = 17,
    PendingPayoutActive = 18,
    PendingPayoutNotFound = 19,
    ChallengeWindowActive = 20,
    InsufficientReserves = 21,
    InsufficientCapital = 22,
    InvalidQuorum = 23,
    OracleAlreadyReported = 24,
    UnauthorizedCaller = 25,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum WeatherParam {
    Rainfall,
    Temperature,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ThresholdConfig {
    pub param: WeatherParam,
    pub min_value: i128,
    pub max_value: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Policy {
    pub campaign_id: u64,
    pub farmer: Address,
    pub token: Address,
    pub premium: i128,
    pub payout_amount: i128,
    pub threshold: ThresholdConfig,
    pub active: bool,
    pub paid_out: bool,
    pub created_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingPayout {
    pub campaign_id: u64,
    pub farmer: Address,
    pub payout_amount: i128,
    pub token: Address,
    pub reported_value: i128,
    pub reported_at: u64,
    pub unlock_time: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    GovernanceContract,
    Guardian,
    Paused,
    SchemaVersion,
    Oracles,
    OracleQuorum,
    PremiumRateBps,
    ChallengeWindowSecs,
    Policy(u64),
    PolicyCount,
    PendingPayout(u64),
    OracleReport(u64, Address),
    OracleReportCount(u64),
    TotalReserves(Address),
    TotalExposure(Address),
    CapitalProvider(Address, Address),
}

const CURRENT_SCHEMA_VERSION: u32 = 1;
const INSTANCE_TTL_THRESHOLD: u32 = 1_000;
const INSTANCE_TTL_EXTEND: u32 = 100_000;
const PERSISTENT_TTL_THRESHOLD: u32 = 1_000;
const PERSISTENT_TTL_EXTEND: u32 = 100_000;
const BPS_DENOM: i128 = 10_000;
const DEFAULT_CHALLENGE_WINDOW_SECS: u64 = 3600;

mod governance_client {
    use soroban_sdk::{Address, Env, Error as HostError, Symbol, Val, Vec};

    pub fn verify(env: &Env, governance: &Address) -> Result<(), ()> {
        let func = Symbol::new(env, "get_admin");
        let args: Vec<Val> = Vec::new(env);
        match env.try_invoke_contract::<Val, HostError>(governance, &func, args) {
            Ok(_) => Ok(()),
            Err(_) => Err(()),
        }
    }
}

fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND);
}

fn require_initialized(env: &Env) -> Result<(), InsuranceError> {
    if !env.storage().instance().has(&DataKey::Admin) {
        return Err(InsuranceError::ContractNotInitialized);
    }
    Ok(())
}

fn require_not_paused(env: &Env) -> Result<(), InsuranceError> {
    if env
        .storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false)
    {
        return Err(InsuranceError::ContractPaused);
    }
    Ok(())
}

fn require_governed_caller(env: &Env, caller: &Address) -> Result<(), InsuranceError> {
    if let Some(governance) = env
        .storage()
        .instance()
        .get::<_, Address>(&DataKey::GovernanceContract)
    {
        if *caller != governance {
            return Err(InsuranceError::NotAdmin);
        }
        return Ok(());
    }
    let admin_addr: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(InsuranceError::ContractNotInitialized)?;
    if *caller != admin_addr {
        return Err(InsuranceError::NotAdmin);
    }
    Ok(())
}

fn check_plausibility_bounds(param: &WeatherParam, value: i128) -> Result<(), InsuranceError> {
    match param {
        WeatherParam::Rainfall => {
            // Rainfall in mm (cannot be negative, sane upper limit 10,000 mm)
            if !(0..=10_000).contains(&value) {
                return Err(InsuranceError::ReportedValueOutOfBounds);
            }
        }
        WeatherParam::Temperature => {
            // Temperature in degrees Celsius (sane range -100 to 100)
            if !(-100..=100).contains(&value) {
                return Err(InsuranceError::ReportedValueOutOfBounds);
            }
        }
    }
    Ok(())
}

#[contract]
pub struct WeatherInsuranceContract;

#[contractimpl]
impl WeatherInsuranceContract {
    pub fn initialize(
        env: Env,
        admin: Address,
        oracles: Vec<Address>,
        quorum: u32,
        premium_rate_bps: u32,
    ) -> Result<(), InsuranceError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(InsuranceError::AlreadyInitialized);
        }
        admin.require_auth();

        if premium_rate_bps > 2000 {
            return Err(InsuranceError::PremiumRateTooHigh);
        }

        if quorum == 0 || quorum > oracles.len() || oracles.is_empty() {
            return Err(InsuranceError::InvalidQuorum);
        }

        bump_instance(&env);

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Oracles, &oracles);
        env.storage()
            .instance()
            .set(&DataKey::OracleQuorum, &quorum);
        env.storage()
            .instance()
            .set(&DataKey::PremiumRateBps, &premium_rate_bps);
        env.storage()
            .instance()
            .set(&DataKey::SchemaVersion, &CURRENT_SCHEMA_VERSION);
        env.storage().instance().set(
            &DataKey::ChallengeWindowSecs,
            &DEFAULT_CHALLENGE_WINDOW_SECS,
        );

        Ok(())
    }

    // ── Governance, upgrade, guardian, pause ─────────────────────────────────

    pub fn set_governance_contract(
        env: Env,
        caller: Address,
        governance: Address,
    ) -> Result<(), InsuranceError> {
        caller.require_auth();
        require_governed_caller(&env, &caller)?;
        governance_client::verify(&env, &governance)
            .map_err(|_| InsuranceError::InvalidGovernanceContract)?;
        bump_instance(&env);
        env.storage()
            .instance()
            .set(&DataKey::GovernanceContract, &governance);
        Ok(())
    }

    pub fn get_governance_contract(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::GovernanceContract)
    }

    pub fn upgrade(
        env: Env,
        caller: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), InsuranceError> {
        caller.require_auth();
        require_governed_caller(&env, &caller)?;
        bump_instance(&env);
        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());
        env.events().publish(
            (symbol_short!("insur"), symbol_short!("upgraded")),
            (new_wasm_hash,),
        );
        Ok(())
    }

    pub fn set_guardian(
        env: Env,
        caller: Address,
        guardian: Address,
    ) -> Result<(), InsuranceError> {
        caller.require_auth();
        require_governed_caller(&env, &caller)?;
        bump_instance(&env);
        env.storage().instance().set(&DataKey::Guardian, &guardian);
        Ok(())
    }

    pub fn get_guardian(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Guardian)
    }

    pub fn pause(env: Env, caller: Address) -> Result<(), InsuranceError> {
        caller.require_auth();
        bump_instance(&env);
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
        let is_admin = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::Admin)
            .map(|a| a == caller)
            .unwrap_or(false);

        if !is_guardian && !is_governance && !is_admin {
            return Err(InsuranceError::NotAdmin);
        }
        if env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
        {
            return Err(InsuranceError::AlreadyPaused);
        }
        env.storage().instance().set(&DataKey::Paused, &true);
        env.events()
            .publish((symbol_short!("insur"), symbol_short!("paused")), (caller,));
        Ok(())
    }

    pub fn unpause(env: Env, caller: Address) -> Result<(), InsuranceError> {
        caller.require_auth();
        require_governed_caller(&env, &caller)?;
        bump_instance(&env);
        if !env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
        {
            return Err(InsuranceError::NotPaused);
        }
        env.storage().instance().set(&DataKey::Paused, &false);
        env.events().publish(
            (symbol_short!("insur"), symbol_short!("unpaused")),
            (caller,),
        );
        Ok(())
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    pub fn bump_instance_ttl(env: Env) {
        bump_instance(&env);
    }

    pub fn migrate(env: Env, caller: Address) -> Result<u32, InsuranceError> {
        caller.require_auth();
        require_governed_caller(&env, &caller)?;
        bump_instance(&env);
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

    // ── Oracle Management ───────────────────────────────────────────────────

    pub fn set_oracles(
        env: Env,
        caller: Address,
        oracles: Vec<Address>,
        quorum: u32,
    ) -> Result<(), InsuranceError> {
        caller.require_auth();
        require_governed_caller(&env, &caller)?;
        if quorum == 0 || quorum > oracles.len() || oracles.is_empty() {
            return Err(InsuranceError::InvalidQuorum);
        }
        bump_instance(&env);
        env.storage().instance().set(&DataKey::Oracles, &oracles);
        env.storage()
            .instance()
            .set(&DataKey::OracleQuorum, &quorum);
        Ok(())
    }

    pub fn get_oracles(env: Env) -> Result<Vec<Address>, InsuranceError> {
        require_initialized(&env)?;
        env.storage()
            .instance()
            .get(&DataKey::Oracles)
            .ok_or(InsuranceError::ContractNotInitialized)
    }

    pub fn get_oracle_quorum(env: Env) -> Result<u32, InsuranceError> {
        require_initialized(&env)?;
        env.storage()
            .instance()
            .get(&DataKey::OracleQuorum)
            .ok_or(InsuranceError::ContractNotInitialized)
    }

    pub fn get_admin(env: Env) -> Result<Address, InsuranceError> {
        require_initialized(&env)?;
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(InsuranceError::ContractNotInitialized)
    }

    // ── Challenge Window Configuration ──────────────────────────────────────

    pub fn set_challenge_window(
        env: Env,
        caller: Address,
        seconds: u64,
    ) -> Result<(), InsuranceError> {
        caller.require_auth();
        require_governed_caller(&env, &caller)?;
        bump_instance(&env);
        env.storage()
            .instance()
            .set(&DataKey::ChallengeWindowSecs, &seconds);
        Ok(())
    }

    pub fn get_challenge_window(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::ChallengeWindowSecs)
            .unwrap_or(DEFAULT_CHALLENGE_WINDOW_SECS)
    }

    // ── Capital Provider / Solvency Pool ────────────────────────────────────

    pub fn deposit_capital(
        env: Env,
        provider: Address,
        token: Address,
        amount: i128,
    ) -> Result<(), InsuranceError> {
        require_initialized(&env)?;
        require_not_paused(&env)?;
        provider.require_auth();
        bump_instance(&env);

        if amount <= 0 {
            return Err(InsuranceError::InvalidThreshold);
        }

        token::Client::new(&env, &token).transfer(
            &provider,
            &env.current_contract_address(),
            &amount,
        );

        let reserves: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalReserves(token.clone()))
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalReserves(token.clone()), &(reserves + amount));

        let provider_bal: i128 = env
            .storage()
            .instance()
            .get(&DataKey::CapitalProvider(provider.clone(), token.clone()))
            .unwrap_or(0);
        env.storage().instance().set(
            &DataKey::CapitalProvider(provider.clone(), token.clone()),
            &(provider_bal + amount),
        );

        env.events().publish(
            (symbol_short!("insur"), symbol_short!("cap_dep")),
            (provider, token, amount),
        );

        Ok(())
    }

    pub fn withdraw_capital(
        env: Env,
        provider: Address,
        token: Address,
        amount: i128,
    ) -> Result<(), InsuranceError> {
        require_initialized(&env)?;
        require_not_paused(&env)?;
        provider.require_auth();
        bump_instance(&env);

        if amount <= 0 {
            return Err(InsuranceError::InvalidThreshold);
        }

        let provider_bal: i128 = env
            .storage()
            .instance()
            .get(&DataKey::CapitalProvider(provider.clone(), token.clone()))
            .unwrap_or(0);
        if provider_bal < amount {
            return Err(InsuranceError::InsufficientCapital);
        }

        let reserves: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalReserves(token.clone()))
            .unwrap_or(0);
        let exposure: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalExposure(token.clone()))
            .unwrap_or(0);

        let available = reserves - exposure;
        if available < amount {
            return Err(InsuranceError::InsufficientReserves);
        }

        env.storage().instance().set(
            &DataKey::CapitalProvider(provider.clone(), token.clone()),
            &(provider_bal - amount),
        );
        env.storage()
            .instance()
            .set(&DataKey::TotalReserves(token.clone()), &(reserves - amount));

        token::Client::new(&env, &token).transfer(
            &env.current_contract_address(),
            &provider,
            &amount,
        );

        env.events().publish(
            (symbol_short!("insur"), symbol_short!("cap_wdr")),
            (provider, token, amount),
        );

        Ok(())
    }

    pub fn get_pool_solvency(env: Env, token: Address) -> (i128, i128) {
        let reserves: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalReserves(token.clone()))
            .unwrap_or(0);
        let exposure: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalExposure(token))
            .unwrap_or(0);
        (reserves, exposure)
    }

    pub fn get_capital_provider_balance(env: Env, provider: Address, token: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::CapitalProvider(provider, token))
            .unwrap_or(0)
    }

    // ── Policy Management ───────────────────────────────────────────────────

    pub fn get_policy(env: Env, campaign_id: u64) -> Result<Option<Policy>, InsuranceError> {
        require_initialized(&env)?;
        Ok(env
            .storage()
            .persistent()
            .get(&DataKey::Policy(campaign_id)))
    }

    pub fn get_premium_rate(env: Env) -> Result<u32, InsuranceError> {
        require_initialized(&env)?;
        env.storage()
            .instance()
            .get(&DataKey::PremiumRateBps)
            .ok_or(InsuranceError::ContractNotInitialized)
    }

    pub fn take_premium(
        env: Env,
        caller: Address,
        campaign_id: u64,
        farmer: Address,
        token: Address,
        funding_amount: i128,
        threshold: ThresholdConfig,
    ) -> Result<i128, InsuranceError> {
        require_initialized(&env)?;
        require_not_paused(&env)?;
        caller.require_auth();
        bump_instance(&env);

        let premium_rate_bps: u32 = env
            .storage()
            .instance()
            .get(&DataKey::PremiumRateBps)
            .ok_or(InsuranceError::ContractNotInitialized)?;

        if env
            .storage()
            .persistent()
            .has(&DataKey::Policy(campaign_id))
        {
            return Err(InsuranceError::PolicyAlreadyActive);
        }

        let premium = funding_amount * premium_rate_bps as i128 / BPS_DENOM;
        if premium <= 0 {
            return Err(InsuranceError::InvalidThreshold);
        }

        let payout_amount = funding_amount;

        // Solvency check: Total Exposure + payout_amount <= Total Reserves + premium
        let reserves: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalReserves(token.clone()))
            .unwrap_or(0);
        let exposure: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalExposure(token.clone()))
            .unwrap_or(0);

        let new_reserves = reserves + premium;
        let new_exposure = exposure + payout_amount;

        if new_exposure > new_reserves {
            return Err(InsuranceError::InsufficientReserves);
        }

        token::Client::new(&env, &token).transfer(
            &caller,
            &env.current_contract_address(),
            &premium,
        );

        env.storage()
            .instance()
            .set(&DataKey::TotalReserves(token.clone()), &new_reserves);
        env.storage()
            .instance()
            .set(&DataKey::TotalExposure(token.clone()), &new_exposure);

        let policy = Policy {
            campaign_id,
            farmer: farmer.clone(),
            token: token.clone(),
            premium,
            payout_amount,
            threshold,
            active: true,
            paid_out: false,
            created_at: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Policy(campaign_id), &policy);
        env.storage().persistent().extend_ttl(
            &DataKey::Policy(campaign_id),
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_EXTEND,
        );

        let policy_count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::PolicyCount)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::PolicyCount, &(policy_count + 1));

        env.events().publish(
            (symbol_short!("insur"), symbol_short!("premium")),
            (campaign_id, farmer, premium, payout_amount),
        );

        Ok(premium)
    }

    // ── Breach Reporting & Challenge Window ──────────────────────────────────

    pub fn report_breach(
        env: Env,
        oracle: Address,
        campaign_id: u64,
        reported_value: i128,
    ) -> Result<bool, InsuranceError> {
        require_initialized(&env)?;
        require_not_paused(&env)?;
        oracle.require_auth();
        bump_instance(&env);

        let oracles: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Oracles)
            .ok_or(InsuranceError::ContractNotInitialized)?;
        if !oracles.contains(&oracle) {
            return Err(InsuranceError::NotOracle);
        }

        let quorum: u32 = env
            .storage()
            .instance()
            .get(&DataKey::OracleQuorum)
            .unwrap_or(1);

        let policy: Policy = env
            .storage()
            .persistent()
            .get(&DataKey::Policy(campaign_id))
            .ok_or(InsuranceError::PolicyNotActive)?;
        if !policy.active {
            return Err(InsuranceError::PolicyNotActive);
        }
        if policy.paid_out {
            return Err(InsuranceError::AlreadyPaidOut);
        }

        if env
            .storage()
            .persistent()
            .has(&DataKey::PendingPayout(campaign_id))
        {
            return Err(InsuranceError::PendingPayoutActive);
        }

        check_plausibility_bounds(&policy.threshold.param, reported_value)?;

        let breached = match &policy.threshold.param {
            WeatherParam::Rainfall | WeatherParam::Temperature => {
                reported_value < policy.threshold.min_value
                    || reported_value > policy.threshold.max_value
            }
        };

        if !breached {
            return Err(InsuranceError::ThresholdBreachReported);
        }

        let report_key = DataKey::OracleReport(campaign_id, oracle.clone());
        if env.storage().persistent().has(&report_key) {
            return Err(InsuranceError::OracleAlreadyReported);
        }

        env.storage().persistent().set(&report_key, &reported_value);

        let report_count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::OracleReportCount(campaign_id))
            .unwrap_or(0)
            + 1;
        env.storage()
            .persistent()
            .set(&DataKey::OracleReportCount(campaign_id), &report_count);

        if report_count >= quorum {
            let challenge_window: u64 = env
                .storage()
                .instance()
                .get(&DataKey::ChallengeWindowSecs)
                .unwrap_or(DEFAULT_CHALLENGE_WINDOW_SECS);

            let pending = PendingPayout {
                campaign_id,
                farmer: policy.farmer.clone(),
                payout_amount: policy.payout_amount,
                token: policy.token.clone(),
                reported_value,
                reported_at: env.ledger().timestamp(),
                unlock_time: env.ledger().timestamp() + challenge_window,
            };

            env.storage()
                .persistent()
                .set(&DataKey::PendingPayout(campaign_id), &pending);

            env.events().publish(
                (symbol_short!("insur"), symbol_short!("p_payout")),
                (
                    campaign_id,
                    policy.farmer,
                    policy.payout_amount,
                    reported_value,
                ),
            );

            Ok(true)
        } else {
            Ok(false)
        }
    }

    pub fn finalize_payout(env: Env, campaign_id: u64) -> Result<(), InsuranceError> {
        require_initialized(&env)?;
        require_not_paused(&env)?;
        bump_instance(&env);

        let pending: PendingPayout = env
            .storage()
            .persistent()
            .get(&DataKey::PendingPayout(campaign_id))
            .ok_or(InsuranceError::PendingPayoutNotFound)?;

        if env.ledger().timestamp() < pending.unlock_time {
            return Err(InsuranceError::ChallengeWindowActive);
        }

        let mut policy: Policy = env
            .storage()
            .persistent()
            .get(&DataKey::Policy(campaign_id))
            .ok_or(InsuranceError::PolicyNotActive)?;

        if !policy.active {
            return Err(InsuranceError::PolicyNotActive);
        }
        if policy.paid_out {
            return Err(InsuranceError::AlreadyPaidOut);
        }

        let reserves: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalReserves(pending.token.clone()))
            .unwrap_or(0);
        let exposure: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalExposure(pending.token.clone()))
            .unwrap_or(0);

        if reserves < pending.payout_amount {
            return Err(InsuranceError::InsufficientReserves);
        }

        env.storage().instance().set(
            &DataKey::TotalReserves(pending.token.clone()),
            &(reserves - pending.payout_amount),
        );
        env.storage().instance().set(
            &DataKey::TotalExposure(pending.token.clone()),
            &(exposure.saturating_sub(pending.payout_amount)),
        );

        policy.active = false;
        policy.paid_out = true;

        env.storage()
            .persistent()
            .set(&DataKey::Policy(campaign_id), &policy);
        env.storage()
            .persistent()
            .remove(&DataKey::PendingPayout(campaign_id));

        token::Client::new(&env, &pending.token).transfer(
            &env.current_contract_address(),
            &pending.farmer,
            &pending.payout_amount,
        );

        env.events().publish(
            (symbol_short!("insur"), symbol_short!("payout")),
            (
                campaign_id,
                pending.farmer,
                pending.payout_amount,
                pending.reported_value,
            ),
        );

        Ok(())
    }

    pub fn cancel_pending_payout(
        env: Env,
        caller: Address,
        campaign_id: u64,
    ) -> Result<(), InsuranceError> {
        require_initialized(&env)?;
        caller.require_auth();
        bump_instance(&env);

        let is_guardian = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::Guardian)
            .map(|g| g == caller)
            .unwrap_or(false);
        let is_governed = require_governed_caller(&env, &caller).is_ok();

        if !is_guardian && !is_governed {
            return Err(InsuranceError::NotAdmin);
        }

        if !env
            .storage()
            .persistent()
            .has(&DataKey::PendingPayout(campaign_id))
        {
            return Err(InsuranceError::PendingPayoutNotFound);
        }

        env.storage()
            .persistent()
            .remove(&DataKey::PendingPayout(campaign_id));

        env.events().publish(
            (symbol_short!("insur"), symbol_short!("c_payout")),
            (campaign_id, caller),
        );

        Ok(())
    }

    pub fn get_pending_payout(env: Env, campaign_id: u64) -> Option<PendingPayout> {
        env.storage()
            .persistent()
            .get(&DataKey::PendingPayout(campaign_id))
    }

    pub fn expire_policy(
        env: Env,
        caller: Address,
        campaign_id: u64,
    ) -> Result<(), InsuranceError> {
        require_initialized(&env)?;
        caller.require_auth();
        require_governed_caller(&env, &caller)?;
        bump_instance(&env);

        let mut policy: Policy = env
            .storage()
            .persistent()
            .get(&DataKey::Policy(campaign_id))
            .ok_or(InsuranceError::PolicyNotActive)?;
        if !policy.active {
            return Err(InsuranceError::PolicyNotActive);
        }
        if policy.paid_out {
            return Err(InsuranceError::AlreadyPaidOut);
        }
        policy.active = false;
        env.storage()
            .persistent()
            .set(&DataKey::Policy(campaign_id), &policy);

        let exposure: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalExposure(policy.token.clone()))
            .unwrap_or(0);
        env.storage().instance().set(
            &DataKey::TotalExposure(policy.token),
            &(exposure.saturating_sub(policy.payout_amount)),
        );

        Ok(())
    }

    pub fn get_policy_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::PolicyCount)
            .unwrap_or(0)
    }
}

mod test;
