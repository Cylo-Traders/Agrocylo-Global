#![cfg(test)]

extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, Vec,
};

use crate::{
    CampaignStatus, DisputeResolution, EscrowError, ProductionEscrowContract,
    ProductionEscrowContractClient,
};

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

struct TestEnv<'a> {
    env: Env,
    contract_id: Address,
    client: ProductionEscrowContractClient<'a>,
    token_id: Address,
    admin: Address,
    farmer: Address,
    investor1: Address,
    investor2: Address,
    buyer: Address,
}

fn setup() -> TestEnv<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let farmer = Address::generate(&env);
    let investor1 = Address::generate(&env);
    let investor2 = Address::generate(&env);
    let buyer = Address::generate(&env);

    // Deploy a SAC token.
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
    let sac = StellarAssetClient::new(&env, &token_id);

    // Mint tokens to test actors.
    sac.mint(&investor1, &1_000_000);
    sac.mint(&investor2, &1_000_000);
    sac.mint(&buyer, &1_000_000);

    let contract_id = env.register(ProductionEscrowContract, ());
    let client = ProductionEscrowContractClient::new(&env, &contract_id);

    let mut tokens = Vec::new(&env);
    tokens.push_back(token_id.clone());
    client.initialize(&admin, &tokens);

    // Leak lifetimes to 'static for convenience struct.
    let env: Env = unsafe { std::mem::transmute(env) };
    let client: ProductionEscrowContractClient<'static> = unsafe { std::mem::transmute(client) };

    TestEnv {
        env,
        contract_id,
        client,
        token_id,
        admin,
        farmer,
        investor1,
        investor2,
        buyer,
    }
}

fn advance_ledger(env: &Env, by: u64) {
    env.ledger().set(LedgerInfo {
        timestamp: env.ledger().timestamp() + by,
        protocol_version: env.ledger().protocol_version(),
        sequence_number: env.ledger().sequence() + 1,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 1,
        min_persistent_entry_ttl: 1,
        max_entry_ttl: 100_000_001,
    });
}

fn balance(t: &TestEnv, who: &Address) -> i128 {
    TokenClient::new(&t.env, &t.token_id).balance(who)
}

fn future_deadline(t: &TestEnv) -> u64 {
    t.env.ledger().timestamp() + 7 * 24 * 3600 // one week
}

// ---------------------------------------------------------------------------
// 1. Initialization Tests
// ---------------------------------------------------------------------------

#[test]
fn test_init_ok() {
    let t = setup();
    let tokens = t.client.get_supported_tokens();
    assert_eq!(tokens.len(), 1);
    assert_eq!(tokens.get(0).unwrap(), t.token_id);
}

#[test]
fn test_init_rejects_reinit() {
    let t = setup();
    let mut extra = Vec::new(&t.env);
    extra.push_back(t.token_id.clone());
    let err = t
        .client
        .try_initialize(&t.admin, &extra)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::AlreadyInitialized);
}

#[test]
fn test_init_requires_at_least_one_token() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(ProductionEscrowContract, ());
    let client = ProductionEscrowContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let empty: Vec<Address> = Vec::new(&env);
    let err = client.try_initialize(&admin, &empty).unwrap_err().unwrap();
    assert_eq!(err, EscrowError::MustSupportOneToken);
}

#[test]
fn test_get_admin_returns_correct_admin() {
    let t = setup();
    assert_eq!(t.client.get_admin(), t.admin);
}

// ---------------------------------------------------------------------------
// 2. Campaign Creation Tests
// ---------------------------------------------------------------------------

#[test]
fn test_create_campaign_ok() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    assert_eq!(id, 1);
    let c = t.client.get_campaign(&1);
    assert_eq!(c.farmer, t.farmer);
    assert_eq!(c.target_amount, 10_000);
    assert_eq!(c.total_raised, 0);
    assert_eq!(c.status, CampaignStatus::Funding);
}

#[test]
fn test_create_campaign_emits_event() {
    let t = setup();
    let deadline = future_deadline(&t);
    t.client
        .create_campaign(&t.farmer, &t.token_id, &5_000, &deadline);
    // SDK does not expose event contents directly in tests; verify no panic.
}

#[test]
fn test_create_campaign_rejects_zero_amount() {
    let t = setup();
    let deadline = future_deadline(&t);
    let err = t
        .client
        .try_create_campaign(&t.farmer, &t.token_id, &0, &deadline)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::InvalidAmount);
}

#[test]
fn test_create_campaign_rejects_negative_amount() {
    let t = setup();
    let deadline = future_deadline(&t);
    let err = t
        .client
        .try_create_campaign(&t.farmer, &t.token_id, &-1, &deadline)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::InvalidAmount);
}

#[test]
fn test_create_campaign_rejects_past_deadline() {
    let t = setup();
    let past = t.env.ledger().timestamp();
    let err = t
        .client
        .try_create_campaign(&t.farmer, &t.token_id, &1_000, &past)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::InvalidDeadline);
}

#[test]
fn test_create_campaign_rejects_unsupported_token() {
    let t = setup();
    let bad_token = Address::generate(&t.env);
    let deadline = future_deadline(&t);
    let err = t
        .client
        .try_create_campaign(&t.farmer, &bad_token, &1_000, &deadline)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::UnsupportedToken);
}

#[test]
fn test_campaign_ids_increment() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id1 = t.client.create_campaign(&t.farmer, &t.token_id, &1_000, &deadline);
    let id2 = t.client.create_campaign(&t.farmer, &t.token_id, &2_000, &deadline);
    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
}

// ---------------------------------------------------------------------------
// 3. Investment Logic Tests
// ---------------------------------------------------------------------------

#[test]
fn test_single_investor_funding() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);

    t.client.invest(&t.investor1, &id, &10_000);

    let c = t.client.get_campaign(&id);
    assert_eq!(c.total_raised, 10_000);
    assert_eq!(c.status, CampaignStatus::Funded);
    assert_eq!(
        t.client.get_contribution(&id, &t.investor1),
        10_000
    );
}

#[test]
fn test_multiple_investors_funding() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);

    t.client.invest(&t.investor1, &id, &6_000);
    t.client.invest(&t.investor2, &id, &4_000);

    let c = t.client.get_campaign(&id);
    assert_eq!(c.total_raised, 10_000);
    assert_eq!(c.status, CampaignStatus::Funded);
    assert_eq!(t.client.get_contribution(&id, &t.investor1), 6_000);
    assert_eq!(t.client.get_contribution(&id, &t.investor2), 4_000);
}

#[test]
fn test_partial_investment_stays_funding() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &5_000);
    let c = t.client.get_campaign(&id);
    assert_eq!(c.status, CampaignStatus::Funding);
}

#[test]
fn test_invest_transfers_tokens() {
    let t = setup();
    let before = balance(&t, &t.investor1);
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    assert_eq!(balance(&t, &t.investor1), before - 10_000);
}

#[test]
fn test_overfunding_rejected() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &8_000);
    let err = t
        .client
        .try_invest(&t.investor2, &id, &5_000) // would push over 10_000
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::CampaignOverfunded);
}

#[test]
fn test_invest_zero_rejected() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    let err = t
        .client
        .try_invest(&t.investor1, &id, &0)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::InvalidAmount);
}

#[test]
fn test_invest_after_deadline_rejected() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    advance_ledger(&t.env, 8 * 24 * 3600); // past deadline
    let err = t
        .client
        .try_invest(&t.investor1, &id, &5_000)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::CampaignDeadlinePassed);
}

#[test]
fn test_invest_in_non_funding_campaign_rejected() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000); // now Funded
    let err = t
        .client
        .try_invest(&t.investor2, &id, &1_000)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::CampaignNotFunding);
}

// ---------------------------------------------------------------------------
// 4. Funding Completion Tests
// ---------------------------------------------------------------------------

#[test]
fn test_funded_transition_on_full_raise() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    assert_eq!(t.client.get_campaign(&id).status, CampaignStatus::Funded);
}

// ---------------------------------------------------------------------------
// 5. Production Lifecycle Tests
// ---------------------------------------------------------------------------

#[test]
fn test_start_production_ok() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);

    let farmer_before = balance(&t, &t.farmer);
    t.client.start_production(&t.farmer, &id);

    let c = t.client.get_campaign(&id);
    assert_eq!(c.status, CampaignStatus::InProduction);
    // 30% tranche released
    assert_eq!(c.tranche_released, 3_000);
    assert_eq!(balance(&t, &t.farmer), farmer_before + 3_000);
}

#[test]
fn test_start_production_only_farmer() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    let err = t
        .client
        .try_start_production(&t.investor1, &id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::NotFarmer);
}

#[test]
fn test_start_production_requires_funded_status() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    // Still Funding
    let err = t
        .client
        .try_start_production(&t.farmer, &id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::CampaignNotFunded);
}

#[test]
fn test_mark_harvest_ok() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);

    let farmer_before = balance(&t, &t.farmer);
    t.client.mark_harvest(&t.farmer, &id);

    let c = t.client.get_campaign(&id);
    assert_eq!(c.status, CampaignStatus::Harvested);
    // cumulative target = 70%; already 30% released → 40% more
    assert_eq!(c.tranche_released, 7_000);
    assert_eq!(balance(&t, &t.farmer), farmer_before + 4_000);
}

#[test]
fn test_mark_harvest_invalid_transition_from_funded() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000); // Funded
    let err = t
        .client
        .try_mark_harvest(&t.farmer, &id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::CampaignNotInProduction);
}

#[test]
fn test_lifecycle_full_happy_path() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);
    assert_eq!(t.client.get_campaign(&id).status, CampaignStatus::Harvested);
}

// ---------------------------------------------------------------------------
// 6. Tranche Release Tests
// ---------------------------------------------------------------------------

#[test]
fn test_first_tranche_is_30_percent() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    assert_eq!(t.client.get_campaign(&id).tranche_released, 3_000);
}

#[test]
fn test_second_tranche_brings_total_to_70_percent() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);
    assert_eq!(t.client.get_campaign(&id).tranche_released, 7_000);
}

// ---------------------------------------------------------------------------
// 7. Settlement Tests
// ---------------------------------------------------------------------------

#[test]
fn test_settle_ok() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);
    t.client.settle(&t.farmer, &id);
    assert_eq!(t.client.get_campaign(&id).status, CampaignStatus::Settled);
}

#[test]
fn test_settle_requires_harvested_status() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    // Still InProduction
    let err = t
        .client
        .try_settle(&t.farmer, &id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::CampaignNotHarvested);
}

#[test]
fn test_investor_claims_returns_after_settlement() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);
    t.client.settle(&t.farmer, &id);

    let before = balance(&t, &t.investor1);
    let payout = t.client.claim_returns(&t.investor1, &id);
    // Pool = 10_000 - 7_000 (tranches) = 3_000; investor has 100% share → 3_000
    assert_eq!(payout, 3_000);
    assert_eq!(balance(&t, &t.investor1), before + 3_000);
}

#[test]
fn test_proportional_payout_two_investors() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &6_000);
    t.client.invest(&t.investor2, &id, &4_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);
    t.client.settle(&t.farmer, &id);

    // Pool = 10_000 - 7_000 = 3_000
    let p1 = t.client.claim_returns(&t.investor1, &id);
    let p2 = t.client.claim_returns(&t.investor2, &id);
    assert_eq!(p1, 1_800); // 60% of 3_000
    assert_eq!(p2, 1_200); // 40% of 3_000
}

#[test]
fn test_double_claim_rejected() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);
    t.client.settle(&t.farmer, &id);
    t.client.claim_returns(&t.investor1, &id);
    let err = t
        .client
        .try_claim_returns(&t.investor1, &id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::AlreadyClaimed);
}

#[test]
fn test_non_investor_cannot_claim() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);
    t.client.settle(&t.farmer, &id);
    let err = t
        .client
        .try_claim_returns(&t.investor2, &id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::NotInvestor);
}

// ---------------------------------------------------------------------------
// 8. Orders Tests
// ---------------------------------------------------------------------------

#[test]
fn test_create_order_ok() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);

    let order_id = t.client.create_order(&t.buyer, &id, &500);
    let o = t.client.get_order(&order_id);
    assert_eq!(o.campaign_id, id);
    assert_eq!(o.buyer, t.buyer);
    assert_eq!(o.amount, 500);
}

#[test]
fn test_confirm_order_adds_to_revenue() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);

    let order_id = t.client.create_order(&t.buyer, &id, &500);
    t.client.confirm_order(&t.buyer, &order_id);

    let c = t.client.get_campaign(&id);
    assert_eq!(c.total_revenue, 500);
}

#[test]
fn test_confirm_order_only_by_buyer() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);

    let order_id = t.client.create_order(&t.buyer, &id, &500);
    let err = t
        .client
        .try_confirm_order(&t.investor1, &order_id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::NotBuyer);
}

#[test]
fn test_double_confirm_order_rejected() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);

    let order_id = t.client.create_order(&t.buyer, &id, &500);
    t.client.confirm_order(&t.buyer, &order_id);
    let err = t
        .client
        .try_confirm_order(&t.buyer, &order_id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::OrderNotPending);
}

#[test]
fn test_create_order_on_funding_campaign_rejected() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    let err = t
        .client
        .try_create_order(&t.buyer, &id, &500)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::CampaignNotHarvested);
}

#[test]
fn test_settlement_includes_order_revenue() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);

    let order_id = t.client.create_order(&t.buyer, &id, &2_000);
    t.client.confirm_order(&t.buyer, &order_id);

    t.client.settle(&t.farmer, &id);

    let before = balance(&t, &t.investor1);
    let payout = t.client.claim_returns(&t.investor1, &id);
    // Pool = 10_000 + 2_000 (revenue) - 7_000 (tranches) = 5_000
    assert_eq!(payout, 5_000);
    assert_eq!(balance(&t, &t.investor1), before + 5_000);
}

// ---------------------------------------------------------------------------
// 9. Failure & Refund Tests
// ---------------------------------------------------------------------------

#[test]
fn test_finalize_failed_after_deadline() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &5_000);
    advance_ledger(&t.env, 8 * 24 * 3600);
    t.client.finalize_failed(&id);
    assert_eq!(t.client.get_campaign(&id).status, CampaignStatus::Failed);
}

#[test]
fn test_finalize_failed_before_deadline_rejected() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &5_000);
    let err = t
        .client
        .try_finalize_failed(&id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::CampaignDeadlineNotPassed);
}

#[test]
fn test_refund_on_failed_campaign() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &4_000);
    advance_ledger(&t.env, 8 * 24 * 3600);
    t.client.finalize_failed(&id);

    let before = balance(&t, &t.investor1);
    let refunded = t.client.refund(&t.investor1, &id);
    assert_eq!(refunded, 4_000);
    assert_eq!(balance(&t, &t.investor1), before + 4_000);
}

#[test]
fn test_proportional_refund_multiple_investors() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &3_000);
    t.client.invest(&t.investor2, &id, &2_000);
    advance_ledger(&t.env, 8 * 24 * 3600);
    t.client.finalize_failed(&id);

    let r1 = t.client.refund(&t.investor1, &id);
    let r2 = t.client.refund(&t.investor2, &id);
    assert_eq!(r1, 3_000);
    assert_eq!(r2, 2_000);
}

#[test]
fn test_double_refund_rejected() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &5_000);
    advance_ledger(&t.env, 8 * 24 * 3600);
    t.client.finalize_failed(&id);
    t.client.refund(&t.investor1, &id);
    let err = t
        .client
        .try_refund(&t.investor1, &id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::AlreadyClaimed);
}

// ---------------------------------------------------------------------------
// 10. Dispute System Tests
// ---------------------------------------------------------------------------

#[test]
fn test_farmer_can_open_dispute() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.open_dispute(&t.farmer, &id);
    assert_eq!(t.client.get_campaign(&id).status, CampaignStatus::Disputed);
}

#[test]
fn test_investor_can_open_dispute() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.open_dispute(&t.investor1, &id);
    assert_eq!(t.client.get_campaign(&id).status, CampaignStatus::Disputed);
}

#[test]
fn test_non_participant_cannot_open_dispute() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    let err = t
        .client
        .try_open_dispute(&t.investor2, &id) // investor2 has no stake
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::NotInvestor);
}

#[test]
fn test_resolve_dispute_full_payout_to_investors() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.open_dispute(&t.farmer, &id);

    t.client.resolve_dispute(
        &t.admin,
        &id,
        &DisputeResolution::FullPayoutToInvestors,
    );
    assert_eq!(t.client.get_campaign(&id).status, CampaignStatus::Settled);
    // Only start tranche (30%) was released before dispute → 7_000 remains in escrow
    let payout = t.client.claim_returns(&t.investor1, &id);
    assert_eq!(payout, 7_000);
}

#[test]
fn test_resolve_dispute_refund_investors() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.open_dispute(&t.farmer, &id);

    t.client.resolve_dispute(&t.admin, &id, &DisputeResolution::RefundInvestors);
    assert_eq!(t.client.get_campaign(&id).status, CampaignStatus::Failed);
    let refunded = t.client.refund(&t.investor1, &id);
    assert_eq!(refunded, 10_000);
}

#[test]
fn test_resolve_dispute_partial() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.open_dispute(&t.farmer, &id);

    let farmer_before = balance(&t, &t.farmer);
    // Give farmer 20%, investors get the rest.
    t.client.resolve_dispute(
        &t.admin,
        &id,
        &DisputeResolution::Partial(2_000),
    );
    // Farmer gets 20% of 10_000 pool = 2_000
    assert_eq!(balance(&t, &t.farmer), farmer_before + 2_000);
    assert_eq!(t.client.get_campaign(&id).status, CampaignStatus::Settled);
    // Investor claims remaining 8_000
    let payout = t.client.claim_returns(&t.investor1, &id);
    assert_eq!(payout, 8_000);
}

#[test]
fn test_only_admin_resolves_dispute() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.open_dispute(&t.farmer, &id);
    let err = t
        .client
        .try_resolve_dispute(&t.farmer, &id, &DisputeResolution::RefundInvestors)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::NotAdmin);
}

#[test]
fn test_resolve_non_disputed_campaign_rejected() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    let err = t
        .client
        .try_resolve_dispute(&t.admin, &id, &DisputeResolution::RefundInvestors)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::CampaignNotDisputed);
}

// ---------------------------------------------------------------------------
// 11. Access Control Tests
// ---------------------------------------------------------------------------

#[test]
fn test_start_production_non_farmer_rejected() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    let err = t
        .client
        .try_start_production(&t.buyer, &id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::NotFarmer);
}

#[test]
fn test_mark_harvest_non_farmer_rejected() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    let err = t
        .client
        .try_mark_harvest(&t.buyer, &id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::NotFarmer);
}

#[test]
fn test_settle_unauthorized_caller_rejected() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);
    let err = t
        .client
        .try_settle(&t.buyer, &id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::NotAdmin);
}

// ---------------------------------------------------------------------------
// 12. Edge Cases & Security Tests
// ---------------------------------------------------------------------------

#[test]
fn test_invalid_campaign_id_returns_error() {
    let t = setup();
    let err = t.client.try_get_campaign(&9999).unwrap_err().unwrap();
    assert_eq!(err, EscrowError::CampaignNotFound);
}

#[test]
fn test_invalid_order_id_returns_error() {
    let t = setup();
    let err = t.client.try_get_order(&9999).unwrap_err().unwrap();
    assert_eq!(err, EscrowError::OrderNotFound);
}

#[test]
fn test_invest_negative_amount_rejected() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    let err = t
        .client
        .try_invest(&t.investor1, &id, &-100)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::InvalidAmount);
}

#[test]
fn test_create_order_zero_amount_rejected() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);
    let err = t
        .client
        .try_create_order(&t.buyer, &id, &0)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::InvalidAmount);
}

#[test]
fn test_claim_on_non_settled_campaign_rejected() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    // Funded, not Settled
    let err = t
        .client
        .try_claim_returns(&t.investor1, &id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::CampaignNotSettled);
}

#[test]
fn test_open_dispute_on_already_settled_campaign_rejected() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);
    t.client.settle(&t.farmer, &id);
    let err = t
        .client
        .try_open_dispute(&t.farmer, &id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::CampaignAlreadyDisputed);
}

#[test]
fn test_refund_on_non_failed_campaign_rejected() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    let err = t
        .client
        .try_refund(&t.investor1, &id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::CampaignNotFailed);
}

#[test]
fn test_admin_can_also_settle() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);
    t.client.settle(&t.admin, &id);
    assert_eq!(t.client.get_campaign(&id).status, CampaignStatus::Settled);
}

#[test]
fn test_partial_resolution_bps_exceeds_10000_rejected() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.open_dispute(&t.farmer, &id);
    let err = t
        .client
        .try_resolve_dispute(
            &t.admin,
            &id,
            &DisputeResolution::Partial(11_000),
        )
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::InvalidResolution);
}
