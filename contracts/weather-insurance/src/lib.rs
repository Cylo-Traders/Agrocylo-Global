#![no_std]
use soroban_sdk::{contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env, String, Vec};

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
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Oracle,
    PremiumRateBps,
    Policy(u64),
    PolicyCount,
}

const TTL_THRESHOLD: u32 = 1000;
const TTL_EXTEND_TO: u32 = 100_000;
const BPS_DENOM: i128 = 10_000;

#[contract]
pub struct WeatherInsuranceContract;

#[contractimpl]
impl WeatherInsuranceContract {
    pub fn initialize(env: Env, admin: Address, oracle: Address, premium_rate_bps: u32) -> Result<(), InsuranceError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(InsuranceError::AlreadyInitialized);
        }
        if premium_rate_bps > 2000 {
            return Err(InsuranceError::PremiumRateTooHigh);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Oracle, &oracle);
        env.storage().instance().set(&DataKey::PremiumRateBps, &premium_rate_bps);
        Ok(())
    }

    pub fn set_oracle(env: Env, admin: Address, oracle: Address) -> Result<(), InsuranceError> {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).ok_or(InsuranceError::ContractNotInitialized)?;
        if admin != stored_admin {
            return Err(InsuranceError::NotAdmin);
        }
        env.storage().instance().set(&DataKey::Oracle, &oracle);
        Ok(())
    }

    pub fn get_oracle(env: Env) -> Result<Address, InsuranceError> {
        env.storage().instance().get(&DataKey::Oracle).ok_or(InsuranceError::ContractNotInitialized)
    }

    pub fn get_admin(env: Env) -> Result<Address, InsuranceError> {
        env.storage().instance().get(&DataKey::Admin).ok_or(InsuranceError::ContractNotInitialized)
    }

    pub fn get_policy(env: Env, campaign_id: u64) -> Result<Option<Policy>, InsuranceError> {
        Ok(env.storage().persistent().get(&DataKey::Policy(campaign_id)))
    }

    pub fn get_premium_rate(env: Env) -> Result<u32, InsuranceError> {
        env.storage().instance().get(&DataKey::PremiumRateBps).ok_or(InsuranceError::ContractNotInitialized)
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
        caller.require_auth();
        let premium_rate_bps: u32 = env.storage().instance().get(&DataKey::PremiumRateBps).ok_or(InsuranceError::ContractNotInitialized)?;

        if env.storage().persistent().has(&DataKey::Policy(campaign_id)) {
            return Err(InsuranceError::PolicyAlreadyActive);
        }

        let premium = funding_amount * premium_rate_bps as i128 / BPS_DENOM;
        if premium <= 0 {
            return Err(InsuranceError::InvalidThreshold);
        }

        let payout_amount = funding_amount;

        token::Client::new(&env, &token).transfer(&caller, &env.current_contract_address(), &premium);

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

        env.storage().persistent().set(&DataKey::Policy(campaign_id), &policy);
        env.storage().persistent().extend_ttl(&DataKey::Policy(campaign_id), TTL_THRESHOLD, TTL_EXTEND_TO);

        let policy_count: u64 = env.storage().instance().get(&DataKey::PolicyCount).unwrap_or(0);
        env.storage().instance().set(&DataKey::PolicyCount, &(policy_count + 1));

        env.events().publish(
            (symbol_short!("insurance"), symbol_short!("premium")),
            (campaign_id, farmer, premium, payout_amount),
        );

        Ok(premium)
    }

    pub fn report_breach(
        env: Env,
        oracle: Address,
        campaign_id: u64,
        reported_value: i128,
    ) -> Result<(), InsuranceError> {
        oracle.require_auth();
        let stored_oracle: Address = env.storage().instance().get(&DataKey::Oracle).ok_or(InsuranceError::ContractNotInitialized)?;
        if oracle != stored_oracle {
            return Err(InsuranceError::NotOracle);
        }

        let mut policy: Policy = env.storage().persistent().get(&DataKey::Policy(campaign_id)).ok_or(InsuranceError::PolicyNotActive)?;
        if !policy.active {
            return Err(InsuranceError::PolicyNotActive);
        }
        if policy.paid_out {
            return Err(InsuranceError::AlreadyPaidOut);
        }

        let breached = match &policy.threshold.param {
            WeatherParam::Rainfall | WeatherParam::Temperature => {
                reported_value < policy.threshold.min_value || reported_value > policy.threshold.max_value
            }
        };

        if !breached {
            return Err(InsuranceError::ThresholdBreachReported);
        }

        policy.active = false;
        policy.paid_out = true;

        token::Client::new(&env, &policy.token).transfer(
            &env.current_contract_address(),
            &policy.farmer,
            &policy.payout_amount,
        );

        env.storage().persistent().set(&DataKey::Policy(campaign_id), &policy);

        env.events().publish(
            (symbol_short!("insurance"), symbol_short!("payout")),
            (campaign_id, policy.farmer, policy.payout_amount, reported_value),
        );

        Ok(())
    }

    pub fn expire_policy(
        env: Env,
        caller: Address,
        campaign_id: u64,
    ) -> Result<(), InsuranceError> {
        caller.require_auth();
        let admin: Address = env.storage().instance().get(&DataKey::Admin).ok_or(InsuranceError::ContractNotInitialized)?;
        if caller != admin {
            return Err(InsuranceError::NotAdmin);
        }
        let mut policy: Policy = env.storage().persistent().get(&DataKey::Policy(campaign_id)).ok_or(InsuranceError::PolicyNotActive)?;
        if !policy.active {
            return Err(InsuranceError::PolicyNotActive);
        }
        if policy.paid_out {
            return Err(InsuranceError::AlreadyPaidOut);
        }
        policy.active = false;
        env.storage().persistent().set(&DataKey::Policy(campaign_id), &policy);
        Ok(())
    }

    pub fn get_policy_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::PolicyCount).unwrap_or(0)
    }
}

mod test;
