#![no_std]
use soroban_sdk::{contract, contracterror, contractimpl, contracttype, token, symbol_short, Address, Env, Vec, Symbol};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum CampaignError {
    AlreadyInitialized = 1,
    AmountMustBePositive = 2,
    ContractNotInitialized = 3,
    UnsupportedToken = 4,
    CampaignDoesNotExist = 5,
    CampaignNotFunding = 6,
    DeadlinePassed = 7,
    InsufficientFunds = 8,
    Overflow = 9,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CampaignStatus {
    Funding,
    Successful,
    Failed,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Campaign {
    pub farmer: Address,
    pub token: Address,
    pub target_amount: i128,
    pub raised_amount: i128,
    pub harvest_deadline: u64,
    pub status: CampaignStatus,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Campaign(u64),
    CampaignCount,
    InvestorPosition(u64, Address),
    SupportedTokens,
    Admin,
}

#[contract]
pub struct AgroProductionContract;

#[contractimpl]
impl AgroProductionContract {
    pub fn initialize(
        env: Env,
        admin: Address,
        supported_tokens: Vec<Address>,
    ) -> Result<(), CampaignError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(CampaignError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::SupportedTokens, &supported_tokens);
        env.storage().instance().set(&DataKey::CampaignCount, &0u64);
        Ok(())
    }

    pub fn create_campaign(
        env: Env,
        farmer: Address,
        token: Address,
        target_amount: i128,
        harvest_deadline: u64,
    ) -> Result<u64, CampaignError> {
        farmer.require_auth();

        if target_amount <= 0 {
            return Err(CampaignError::AmountMustBePositive);
        }

        let supported_tokens: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::SupportedTokens)
            .ok_or(CampaignError::ContractNotInitialized)?;

        if !supported_tokens.contains(&token) {
            return Err(CampaignError::UnsupportedToken);
        }

        let mut campaign_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::CampaignCount)
            .unwrap_or(0);
        
        campaign_id = campaign_id.checked_add(1).ok_or(CampaignError::Overflow)?;
        env.storage().instance().set(&DataKey::CampaignCount, &campaign_id);

        let campaign = Campaign {
            farmer: farmer.clone(),
            token: token.clone(),
            target_amount,
            raised_amount: 0,
            harvest_deadline,
            status: CampaignStatus::Funding,
        };

        env.storage().persistent().set(&DataKey::Campaign(campaign_id), &campaign);
        env.storage().persistent().extend_ttl(&DataKey::Campaign(campaign_id), 1000, 100000);

        env.events().publish(
            (symbol_short!("campaign"), symbol_short!("created")),
            (campaign_id, farmer, token, target_amount),
        );

        Ok(campaign_id)
    }

    pub fn invest(
        env: Env,
        investor: Address,
        campaign_id: u64,
        amount: i128,
    ) -> Result<(), CampaignError> {
        investor.require_auth();

        if amount <= 0 {
            return Err(CampaignError::AmountMustBePositive);
        }

        let mut campaign: Campaign = env
            .storage()
            .persistent()
            .get(&DataKey::Campaign(campaign_id))
            .ok_or(CampaignError::CampaignDoesNotExist)?;

        if campaign.status != CampaignStatus::Funding {
            return Err(CampaignError::CampaignNotFunding);
        }

        if env.ledger().timestamp() >= campaign.harvest_deadline {
            return Err(CampaignError::DeadlinePassed);
        }

        let token_client = token::Client::new(&env, &campaign.token);
        token_client.transfer(&investor, &env.current_contract_address(), &amount);

        campaign.raised_amount = campaign.raised_amount.checked_add(amount).ok_or(CampaignError::Overflow)?;
        
        // Update investor position
        let mut investor_contribution: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::InvestorPosition(campaign_id, investor.clone()))
            .unwrap_or(0);
        
        investor_contribution = investor_contribution.checked_add(amount).ok_or(CampaignError::Overflow)?;
        env.storage().persistent().set(&DataKey::InvestorPosition(campaign_id, investor.clone()), &investor_contribution);
        env.storage().persistent().extend_ttl(&DataKey::InvestorPosition(campaign_id, investor.clone()), 1000, 100000);

        // Update campaign state
        if campaign.raised_amount >= campaign.target_amount {
            // Success condition could be handled here or explicitly by admin
            // For now, we just keep it funding until deadline or manually closed
        }

        env.storage().persistent().set(&DataKey::Campaign(campaign_id), &campaign);
        env.storage().persistent().extend_ttl(&DataKey::Campaign(campaign_id), 1000, 100000);

        env.events().publish(
            (symbol_short!("invest"), symbol_short!("success")),
            (campaign_id, investor, amount),
        );

        Ok(())
    }

    pub fn get_campaign(env: Env, campaign_id: u64) -> Result<Campaign, CampaignError> {
        env.storage()
            .persistent()
            .get(&DataKey::Campaign(campaign_id))
            .ok_or(CampaignError::CampaignDoesNotExist)
    }

    pub fn get_investor_contribution(env: Env, campaign_id: u64, investor: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::InvestorPosition(campaign_id, investor))
            .unwrap_or(0)
    }

    pub fn get_investor_share(env: Env, campaign_id: u64, investor: Address) -> Result<i128, CampaignError> {
        let campaign = Self::get_campaign(env.clone(), campaign_id)?;
        if campaign.raised_amount == 0 {
            return Ok(0);
        }
        let contribution = Self::get_investor_contribution(env.clone(), campaign_id, investor);
        
        // Share represented as parts per million (PPM) for precision
        // share = (contribution * 1_000_000) / total_raised
        let share = contribution
            .checked_mul(1_000_000)
            .ok_or(CampaignError::Overflow)?
            .checked_div(campaign.raised_amount)
            .unwrap_or(0);
            
        Ok(share)
    }
}
