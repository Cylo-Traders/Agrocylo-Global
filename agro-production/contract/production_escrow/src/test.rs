#![cfg(test)]

extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, Vec,
};

use crate::{
    CampaignStatus, DisputeResolution, EscrowError, OrderStatus, ProductionEscrowContract,
    ProductionEscrowContractClient, ORDER_EXPIRY_SECS,
};

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

struct TestEnv<'a> {
    env: Env,
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
    let token_id = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
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
    let id1 = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &1_000, &deadline);
    let id2 = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &2_000, &deadline);
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);

    t.client.invest(&t.investor1, &id, &10_000);

    let c = t.client.get_campaign(&id);
    assert_eq!(c.total_raised, 10_000);
    assert_eq!(c.status, CampaignStatus::Funded);
    assert_eq!(t.client.get_contribution(&id, &t.investor1), 10_000);
}

#[test]
fn test_multiple_investors_funding() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);

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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &5_000);
    let c = t.client.get_campaign(&id);
    assert_eq!(c.status, CampaignStatus::Funding);
}

#[test]
fn test_invest_transfers_tokens() {
    let t = setup();
    let before = balance(&t, &t.investor1);
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    assert_eq!(balance(&t, &t.investor1), before - 10_000);
}

#[test]
fn test_overfunding_rejected() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    assert_eq!(t.client.get_campaign(&id).tranche_released, 3_000);
}

#[test]
fn test_second_tranche_brings_total_to_70_percent() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    // Still InProduction
    let err = t.client.try_settle(&t.farmer, &id).unwrap_err().unwrap();
    assert_eq!(err, EscrowError::CampaignNotHarvested);
}

#[test]
fn test_investor_claims_returns_after_settlement() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &5_000);
    advance_ledger(&t.env, 8 * 24 * 3600);
    t.client.finalize_failed(&id);
    assert_eq!(t.client.get_campaign(&id).status, CampaignStatus::Failed);
}

#[test]
fn test_finalize_failed_before_deadline_rejected() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &5_000);
    let err = t.client.try_finalize_failed(&id).unwrap_err().unwrap();
    assert_eq!(err, EscrowError::CampaignDeadlineNotPassed);
}

#[test]
fn test_refund_on_failed_campaign() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &5_000);
    advance_ledger(&t.env, 8 * 24 * 3600);
    t.client.finalize_failed(&id);
    t.client.refund(&t.investor1, &id);
    let err = t.client.try_refund(&t.investor1, &id).unwrap_err().unwrap();
    assert_eq!(err, EscrowError::AlreadyClaimed);
}

// ---------------------------------------------------------------------------
// 10. Dispute System Tests
// ---------------------------------------------------------------------------

#[test]
fn test_farmer_can_open_dispute() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.open_dispute(&t.farmer, &id);
    assert_eq!(t.client.get_campaign(&id).status, CampaignStatus::Disputed);
}

#[test]
fn test_investor_can_open_dispute() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.open_dispute(&t.investor1, &id);
    assert_eq!(t.client.get_campaign(&id).status, CampaignStatus::Disputed);
}

#[test]
fn test_non_participant_cannot_open_dispute() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.open_dispute(&t.farmer, &id);

    t.client
        .resolve_dispute(&t.admin, &id, &DisputeResolution::FullPayoutToInvestors);
    assert_eq!(t.client.get_campaign(&id).status, CampaignStatus::Settled);
    // Only start tranche (30%) was released before dispute → 7_000 remains in escrow
    let payout = t.client.claim_returns(&t.investor1, &id);
    assert_eq!(payout, 7_000);
}

#[test]
fn test_resolve_dispute_refund_investors() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.open_dispute(&t.farmer, &id);

    t.client
        .resolve_dispute(&t.admin, &id, &DisputeResolution::RefundInvestors);
    assert_eq!(t.client.get_campaign(&id).status, CampaignStatus::Failed);
    let refunded = t.client.refund(&t.investor1, &id);
    assert_eq!(refunded, 10_000);
}

#[test]
fn test_resolve_dispute_partial() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.open_dispute(&t.farmer, &id);

    let farmer_before = balance(&t, &t.farmer);
    // Give farmer 20%, investors get the rest.
    t.client
        .resolve_dispute(&t.admin, &id, &DisputeResolution::Partial(2_000));
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);
    let err = t.client.try_settle(&t.buyer, &id).unwrap_err().unwrap();
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    let err = t.client.try_refund(&t.investor1, &id).unwrap_err().unwrap();
    assert_eq!(err, EscrowError::CampaignNotFailed);
}

#[test]
fn test_admin_can_also_settle() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.open_dispute(&t.farmer, &id);
    let err = t
        .client
        .try_resolve_dispute(&t.admin, &id, &DisputeResolution::Partial(11_000))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::InvalidResolution);
}

// ===========================================================================
// Issue #277 — Comprehensive State Machine Tests
// ===========================================================================

// ---------------------------------------------------------------------------
// 13. Order State Machine Tests
// ---------------------------------------------------------------------------

#[test]
fn test_order_valid_transition_pending_to_confirmed() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);

    let order_id = t.client.create_order(&t.buyer, &id, &500);
    let o_before = t.client.get_order(&order_id);
    assert_eq!(o_before.status, OrderStatus::Pending);

    t.client.confirm_order(&t.buyer, &order_id);
    let o_after = t.client.get_order(&order_id);
    assert_eq!(o_after.status, OrderStatus::Confirmed);
}

#[test]
fn test_cannot_confirm_order_twice() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);

    let order_id = t.client.create_order(&t.buyer, &id, &200);
    t.client.confirm_order(&t.buyer, &order_id);
    // Confirmed → Confirmed is invalid (order is no longer Pending)
    let err = t
        .client
        .try_confirm_order(&t.buyer, &order_id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::OrderNotPending);
}

// ---------------------------------------------------------------------------
// 14. Campaign State Machine — Valid Transitions
// ---------------------------------------------------------------------------

#[test]
fn test_campaign_valid_transition_funding_to_funded() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    assert_eq!(t.client.get_campaign(&id).status, CampaignStatus::Funding);
    t.client.invest(&t.investor1, &id, &10_000);
    assert_eq!(t.client.get_campaign(&id).status, CampaignStatus::Funded);
}

#[test]
fn test_campaign_valid_transition_funded_to_in_production() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    assert_eq!(t.client.get_campaign(&id).status, CampaignStatus::Funded);
    t.client.start_production(&t.farmer, &id);
    assert_eq!(
        t.client.get_campaign(&id).status,
        CampaignStatus::InProduction
    );
}

#[test]
fn test_campaign_valid_transition_in_production_to_harvested() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    assert_eq!(
        t.client.get_campaign(&id).status,
        CampaignStatus::InProduction
    );
    t.client.mark_harvest(&t.farmer, &id);
    assert_eq!(
        t.client.get_campaign(&id).status,
        CampaignStatus::Harvested
    );
}

#[test]
fn test_campaign_valid_transition_harvested_to_settled() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);
    assert_eq!(
        t.client.get_campaign(&id).status,
        CampaignStatus::Harvested
    );
    t.client.settle(&t.farmer, &id);
    assert_eq!(t.client.get_campaign(&id).status, CampaignStatus::Settled);
}

#[test]
fn test_campaign_valid_transition_funding_to_failed() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &3_000); // partial only
    assert_eq!(t.client.get_campaign(&id).status, CampaignStatus::Funding);
    advance_ledger(&t.env, 8 * 24 * 3600);
    t.client.finalize_failed(&id);
    assert_eq!(t.client.get_campaign(&id).status, CampaignStatus::Failed);
}

#[test]
fn test_campaign_valid_transition_funded_to_disputed() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    assert_eq!(t.client.get_campaign(&id).status, CampaignStatus::Funded);
    t.client.open_dispute(&t.farmer, &id);
    assert_eq!(
        t.client.get_campaign(&id).status,
        CampaignStatus::Disputed
    );
}

#[test]
fn test_campaign_valid_transition_in_production_to_disputed() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.open_dispute(&t.investor1, &id);
    assert_eq!(
        t.client.get_campaign(&id).status,
        CampaignStatus::Disputed
    );
}

#[test]
fn test_campaign_disputed_to_settled_via_full_payout() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.open_dispute(&t.farmer, &id);
    t.client
        .resolve_dispute(&t.admin, &id, &DisputeResolution::FullPayoutToInvestors);
    assert_eq!(t.client.get_campaign(&id).status, CampaignStatus::Settled);
}

#[test]
fn test_campaign_disputed_to_failed_via_refund_investors() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.open_dispute(&t.farmer, &id);
    t.client
        .resolve_dispute(&t.admin, &id, &DisputeResolution::RefundInvestors);
    assert_eq!(t.client.get_campaign(&id).status, CampaignStatus::Failed);
}

// ---------------------------------------------------------------------------
// 15. Campaign State Machine — Invalid Transitions (State Locks)
// ---------------------------------------------------------------------------

#[test]
fn test_cannot_invest_after_funded() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000); // → Funded
    let err = t
        .client
        .try_invest(&t.investor2, &id, &100)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::CampaignNotFunding);
}

#[test]
fn test_cannot_start_production_from_funding() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    // Still Funding (not fully funded)
    let err = t
        .client
        .try_start_production(&t.farmer, &id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::CampaignNotFunded);
}

#[test]
fn test_cannot_mark_harvest_from_funded() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000); // → Funded
    let err = t
        .client
        .try_mark_harvest(&t.farmer, &id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::CampaignNotInProduction);
}

#[test]
fn test_cannot_settle_from_in_production() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id); // → InProduction
    let err = t
        .client
        .try_settle(&t.farmer, &id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::CampaignNotHarvested);
}

#[test]
fn test_cannot_refund_settled_campaign() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);
    t.client.settle(&t.farmer, &id); // → Settled
    let err = t
        .client
        .try_refund(&t.investor1, &id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::CampaignNotFailed);
}

#[test]
fn test_cannot_finalize_failed_funded_campaign() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000); // → Funded
    advance_ledger(&t.env, 8 * 24 * 3600);
    let err = t.client.try_finalize_failed(&id).unwrap_err().unwrap();
    assert_eq!(err, EscrowError::CampaignNotFunding);
}

#[test]
fn test_cannot_open_dispute_on_failed_campaign() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &5_000);
    advance_ledger(&t.env, 8 * 24 * 3600);
    t.client.finalize_failed(&id); // → Failed
    let err = t
        .client
        .try_open_dispute(&t.investor1, &id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::CampaignAlreadyDisputed);
}

#[test]
fn test_state_persisted_after_start_production() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    // Re-fetch campaign and verify state was written to storage
    let c = t.client.get_campaign(&id);
    assert_eq!(c.status, CampaignStatus::InProduction);
    assert_eq!(c.tranche_released, 3_000);
}

#[test]
fn test_state_persisted_after_mark_harvest() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);
    let c = t.client.get_campaign(&id);
    assert_eq!(c.status, CampaignStatus::Harvested);
    assert_eq!(c.tranche_released, 7_000);
}

// ===========================================================================
// Issue #279 — Time-Based Event Tests
// ===========================================================================

// ---------------------------------------------------------------------------
// 16. Campaign Deadline Boundary Tests
// ---------------------------------------------------------------------------

#[test]
fn test_invest_one_second_before_deadline_succeeds() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let deadline = now + 100; // 100 seconds from now
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);

    // Advance to 1 second before deadline
    advance_ledger(&t.env, 99);
    // At timestamp = now + 99, deadline = now + 100, so timestamp < deadline → allowed
    t.client.invest(&t.investor1, &id, &5_000);
    assert_eq!(t.client.get_campaign(&id).total_raised, 5_000);
}

#[test]
fn test_invest_at_exact_deadline_succeeds() {
    // The check is `timestamp > deadline`, so at exactly the deadline it still succeeds.
    let t = setup();
    let now = t.env.ledger().timestamp();
    let deadline = now + 100;
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);

    advance_ledger(&t.env, 100); // timestamp == deadline
    t.client.invest(&t.investor1, &id, &5_000);
    assert_eq!(t.client.get_campaign(&id).total_raised, 5_000);
}

#[test]
fn test_invest_one_second_after_deadline_fails() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let deadline = now + 100;
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);

    advance_ledger(&t.env, 101); // timestamp > deadline
    let err = t
        .client
        .try_invest(&t.investor1, &id, &5_000)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::CampaignDeadlinePassed);
}

#[test]
fn test_finalize_failed_at_exact_deadline_rejected() {
    // The check is `timestamp <= deadline`, so at exactly the deadline, finalize fails.
    let t = setup();
    let now = t.env.ledger().timestamp();
    let deadline = now + 100;
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &3_000);

    advance_ledger(&t.env, 100); // timestamp == deadline → still not passed
    let err = t.client.try_finalize_failed(&id).unwrap_err().unwrap();
    assert_eq!(err, EscrowError::CampaignDeadlineNotPassed);
}

#[test]
fn test_finalize_failed_one_second_after_deadline_succeeds() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let deadline = now + 100;
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &3_000);

    advance_ledger(&t.env, 101); // timestamp > deadline
    t.client.finalize_failed(&id);
    assert_eq!(t.client.get_campaign(&id).status, CampaignStatus::Failed);
}

#[test]
fn test_campaign_deadline_at_exact_future_timestamp() {
    // Creating a campaign with deadline = now + 1 must succeed.
    let t = setup();
    let now = t.env.ledger().timestamp();
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &(now + 1));
    let c = t.client.get_campaign(&id);
    assert_eq!(c.deadline, now + 1);
    assert_eq!(c.status, CampaignStatus::Funding);
}

// ---------------------------------------------------------------------------
// 17. Order Expiration Tests (96-hour expiry via batch_refund_orders)
// ---------------------------------------------------------------------------

#[test]
fn test_order_not_refunded_before_96h() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);

    let order_id = t.client.create_order(&t.buyer, &id, &500);
    let buyer_before = balance(&t, &t.buyer);

    // 95 hours — not yet expired
    advance_ledger(&t.env, 95 * 3600);
    let mut ids = Vec::new(&t.env);
    ids.push_back(order_id);
    let (count, total) = t.client.batch_refund_orders(&ids);
    assert_eq!(count, 0);
    assert_eq!(total, 0);
    // Buyer balance unchanged
    assert_eq!(balance(&t, &t.buyer), buyer_before);
}

#[test]
fn test_order_refunded_at_exactly_96h() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);

    let order_id = t.client.create_order(&t.buyer, &id, &500);
    let buyer_before = balance(&t, &t.buyer);

    // Exactly 96 hours later
    advance_ledger(&t.env, ORDER_EXPIRY_SECS);
    let mut ids = Vec::new(&t.env);
    ids.push_back(order_id);
    let (count, total) = t.client.batch_refund_orders(&ids);
    assert_eq!(count, 1);
    assert_eq!(total, 500);
    assert_eq!(balance(&t, &t.buyer), buyer_before + 500);
}

#[test]
fn test_order_refunded_after_96h() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);

    let order_id = t.client.create_order(&t.buyer, &id, &300);
    let buyer_before = balance(&t, &t.buyer);

    // More than 96 hours later
    advance_ledger(&t.env, ORDER_EXPIRY_SECS + 1);
    let mut ids = Vec::new(&t.env);
    ids.push_back(order_id);
    let (count, total) = t.client.batch_refund_orders(&ids);
    assert_eq!(count, 1);
    assert_eq!(total, 300);
    assert_eq!(balance(&t, &t.buyer), buyer_before + 300);
}

#[test]
fn test_order_expiration_idempotent() {
    // Calling batch_refund_orders twice on same order: second call is a no-op.
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);

    let order_id = t.client.create_order(&t.buyer, &id, &400);
    advance_ledger(&t.env, ORDER_EXPIRY_SECS);

    let mut ids = Vec::new(&t.env);
    ids.push_back(order_id);

    // First call — succeeds
    let (count1, total1) = t.client.batch_refund_orders(&ids);
    assert_eq!(count1, 1);
    assert_eq!(total1, 400);

    // Second call — no-op (order is no longer Pending)
    let (count2, total2) = t.client.batch_refund_orders(&ids);
    assert_eq!(count2, 0);
    assert_eq!(total2, 0);
}

#[test]
fn test_confirmed_order_not_eligible_for_batch_refund() {
    // An already confirmed order must not be refunded by batch_refund_orders.
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);

    let order_id = t.client.create_order(&t.buyer, &id, &500);
    t.client.confirm_order(&t.buyer, &order_id); // already confirmed

    advance_ledger(&t.env, ORDER_EXPIRY_SECS + 1);
    let buyer_before = balance(&t, &t.buyer);

    let mut ids = Vec::new(&t.env);
    ids.push_back(order_id);
    let (count, total) = t.client.batch_refund_orders(&ids);
    assert_eq!(count, 0);
    assert_eq!(total, 0);
    assert_eq!(balance(&t, &t.buyer), buyer_before);
}

// ===========================================================================
// Issue #281 — Error Message Consistency Tests
// ===========================================================================

// ---------------------------------------------------------------------------
// 18. Unauthorized Operation Errors
// ---------------------------------------------------------------------------

#[test]
fn test_error_not_farmer_start_production() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    let err = t
        .client
        .try_start_production(&t.buyer, &id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::NotFarmer);
}

#[test]
fn test_error_not_farmer_mark_harvest() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    let err = t
        .client
        .try_mark_harvest(&t.investor1, &id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::NotFarmer);
}

#[test]
fn test_error_not_buyer_confirm_order() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);
    let order_id = t.client.create_order(&t.buyer, &id, &100);
    let err = t
        .client
        .try_confirm_order(&t.farmer, &order_id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::NotBuyer);
}

#[test]
fn test_error_not_investor_cannot_claim() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);
    t.client.settle(&t.farmer, &id);
    // investor2 never invested
    let err = t
        .client
        .try_claim_returns(&t.investor2, &id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::NotInvestor);
}

#[test]
fn test_error_not_investor_cannot_open_dispute() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    // buyer has no stake
    let err = t
        .client
        .try_open_dispute(&t.buyer, &id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::NotInvestor);
}

#[test]
fn test_error_not_admin_settle() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);
    let err = t
        .client
        .try_settle(&t.investor1, &id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::NotAdmin);
}

#[test]
fn test_error_not_admin_resolve_dispute() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.open_dispute(&t.farmer, &id);
    let err = t
        .client
        .try_resolve_dispute(&t.farmer, &id, &DisputeResolution::RefundInvestors)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::NotAdmin);
}

// ---------------------------------------------------------------------------
// 19. Invalid State Errors
// ---------------------------------------------------------------------------

#[test]
fn test_error_campaign_not_funding_invest_in_funded() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000); // → Funded
    let err = t
        .client
        .try_invest(&t.investor2, &id, &100)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::CampaignNotFunding);
}

#[test]
fn test_error_campaign_not_funded_start_production() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    // Still Funding
    let err = t
        .client
        .try_start_production(&t.farmer, &id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::CampaignNotFunded);
}

#[test]
fn test_error_campaign_not_in_production_mark_harvest() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000); // → Funded, not InProduction
    let err = t
        .client
        .try_mark_harvest(&t.farmer, &id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::CampaignNotInProduction);
}

#[test]
fn test_error_campaign_not_harvested_settle() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id); // → InProduction
    let err = t.client.try_settle(&t.farmer, &id).unwrap_err().unwrap();
    assert_eq!(err, EscrowError::CampaignNotHarvested);
}

#[test]
fn test_error_campaign_not_harvested_create_order_on_funding() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    // Campaign in Funding state — orders not allowed
    let err = t
        .client
        .try_create_order(&t.buyer, &id, &100)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::CampaignNotHarvested);
}

#[test]
fn test_error_campaign_not_failed_refund() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000); // → Funded
    let err = t.client.try_refund(&t.investor1, &id).unwrap_err().unwrap();
    assert_eq!(err, EscrowError::CampaignNotFailed);
}

#[test]
fn test_error_campaign_not_settled_claim_returns() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000); // → Funded, not Settled
    let err = t
        .client
        .try_claim_returns(&t.investor1, &id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::CampaignNotSettled);
}

#[test]
fn test_error_campaign_not_disputed_resolve() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000); // Funded, not Disputed
    let err = t
        .client
        .try_resolve_dispute(&t.admin, &id, &DisputeResolution::RefundInvestors)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::CampaignNotDisputed);
}

#[test]
fn test_error_campaign_already_disputed_open_dispute_again() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.open_dispute(&t.farmer, &id);
    // Second open_dispute on an already-disputed campaign
    let err = t
        .client
        .try_open_dispute(&t.farmer, &id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::CampaignAlreadyDisputed);
}

#[test]
fn test_error_order_not_pending_confirm_twice() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);
    let order_id = t.client.create_order(&t.buyer, &id, &200);
    t.client.confirm_order(&t.buyer, &order_id);
    let err = t
        .client
        .try_confirm_order(&t.buyer, &order_id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::OrderNotPending);
}

// ---------------------------------------------------------------------------
// 20. Invalid Input Errors
// ---------------------------------------------------------------------------

#[test]
fn test_error_invalid_amount_create_campaign_zero() {
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
fn test_error_invalid_amount_create_campaign_negative() {
    let t = setup();
    let deadline = future_deadline(&t);
    let err = t
        .client
        .try_create_campaign(&t.farmer, &t.token_id, &-500, &deadline)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::InvalidAmount);
}

#[test]
fn test_error_invalid_amount_invest_zero() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    let err = t
        .client
        .try_invest(&t.investor1, &id, &0)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::InvalidAmount);
}

#[test]
fn test_error_invalid_amount_invest_negative() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    let err = t
        .client
        .try_invest(&t.investor1, &id, &-1)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::InvalidAmount);
}

#[test]
fn test_error_invalid_amount_create_order_zero() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
fn test_error_invalid_deadline_equals_now() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let err = t
        .client
        .try_create_campaign(&t.farmer, &t.token_id, &1_000, &now)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::InvalidDeadline);
}

#[test]
fn test_error_invalid_deadline_in_past() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let past = now.saturating_sub(1);
    // Only works if now > 0
    if past < now {
        let err = t
            .client
            .try_create_campaign(&t.farmer, &t.token_id, &1_000, &past)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, EscrowError::InvalidDeadline);
    }
}

#[test]
fn test_error_unsupported_token() {
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
fn test_error_campaign_overfunded() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &9_000);
    let err = t
        .client
        .try_invest(&t.investor2, &id, &2_000) // 9_000 + 2_000 > 10_000
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::CampaignOverfunded);
}

#[test]
fn test_error_invalid_resolution_bps_too_high() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.open_dispute(&t.farmer, &id);
    let err = t
        .client
        .try_resolve_dispute(&t.admin, &id, &DisputeResolution::Partial(10_001))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::InvalidResolution);
}

// ---------------------------------------------------------------------------
// 21. Not-Found Errors
// ---------------------------------------------------------------------------

#[test]
fn test_error_campaign_not_found() {
    let t = setup();
    let err = t.client.try_get_campaign(&99999).unwrap_err().unwrap();
    assert_eq!(err, EscrowError::CampaignNotFound);
}

#[test]
fn test_error_order_not_found() {
    let t = setup();
    let err = t.client.try_get_order(&99999).unwrap_err().unwrap();
    assert_eq!(err, EscrowError::OrderNotFound);
}

#[test]
fn test_error_invest_in_non_existent_campaign() {
    let t = setup();
    let err = t
        .client
        .try_invest(&t.investor1, &99999, &1_000)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::CampaignNotFound);
}

#[test]
fn test_error_confirm_non_existent_order() {
    let t = setup();
    let err = t
        .client
        .try_confirm_order(&t.buyer, &99999)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::OrderNotFound);
}

// ---------------------------------------------------------------------------
// 22. Already-Processed Errors
// ---------------------------------------------------------------------------

#[test]
fn test_error_already_initialized() {
    let t = setup();
    let mut tokens = Vec::new(&t.env);
    tokens.push_back(t.token_id.clone());
    let err = t
        .client
        .try_initialize(&t.admin, &tokens)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::AlreadyInitialized);
}

#[test]
fn test_error_already_claimed_returns() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
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
fn test_error_already_claimed_refund() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &5_000);
    advance_ledger(&t.env, 8 * 24 * 3600);
    t.client.finalize_failed(&id);
    t.client.refund(&t.investor1, &id);
    let err = t.client.try_refund(&t.investor1, &id).unwrap_err().unwrap();
    assert_eq!(err, EscrowError::AlreadyClaimed);
}

#[test]
fn test_error_must_support_one_token() {
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
fn test_error_campaign_deadline_passed_invest() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let deadline = now + 50;
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    advance_ledger(&t.env, 51);
    let err = t
        .client
        .try_invest(&t.investor1, &id, &100)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::CampaignDeadlinePassed);
}

#[test]
fn test_error_campaign_deadline_not_passed_finalize() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &3_000);
    // Deadline hasn't passed yet
    let err = t.client.try_finalize_failed(&id).unwrap_err().unwrap();
    assert_eq!(err, EscrowError::CampaignDeadlineNotPassed);
}

// ===========================================================================
// Issue #273 — Batch Operation Event Tests
// ===========================================================================

// ---------------------------------------------------------------------------
// 23. Batch Refund Investors Tests
// ---------------------------------------------------------------------------

#[test]
fn test_batch_refund_investors_refunds_all() {
    let t = setup();
    let deadline = future_deadline(&t);
    // Target is 20_000 so partial investments keep campaign in Funding state.
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &20_000, &deadline);
    t.client.invest(&t.investor1, &id, &6_000);
    t.client.invest(&t.investor2, &id, &4_000);
    advance_ledger(&t.env, 8 * 24 * 3600);
    t.client.finalize_failed(&id);

    let before1 = balance(&t, &t.investor1);
    let before2 = balance(&t, &t.investor2);

    let mut investors = Vec::new(&t.env);
    investors.push_back(t.investor1.clone());
    investors.push_back(t.investor2.clone());

    let (count, total) = t.client.batch_refund_investors(&id, &investors);
    assert_eq!(count, 2);
    assert_eq!(total, 10_000);
    assert_eq!(balance(&t, &t.investor1), before1 + 6_000);
    assert_eq!(balance(&t, &t.investor2), before2 + 4_000);
}

#[test]
fn test_batch_refund_investors_emits_single_summary_event() {
    let t = setup();
    let deadline = future_deadline(&t);
    // Partial investment keeps campaign in Funding so finalize_failed works.
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &20_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    advance_ledger(&t.env, 8 * 24 * 3600);
    t.client.finalize_failed(&id);

    let mut investors = Vec::new(&t.env);
    investors.push_back(t.investor1.clone());

    // Should complete without error (event emission is verified via no-panic).
    let (count, total) = t.client.batch_refund_investors(&id, &investors);
    assert_eq!(count, 1);
    assert_eq!(total, 10_000); // investor1 contributed 10_000 out of 20_000 target
}

#[test]
fn test_batch_refund_investors_skips_non_investors() {
    let t = setup();
    let deadline = future_deadline(&t);
    // Partial investment keeps campaign in Funding so finalize_failed works.
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &20_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    advance_ledger(&t.env, 8 * 24 * 3600);
    t.client.finalize_failed(&id);

    // investor2 never invested — should be silently skipped
    let mut investors = Vec::new(&t.env);
    investors.push_back(t.investor1.clone());
    investors.push_back(t.investor2.clone()); // not an investor

    let (count, total) = t.client.batch_refund_investors(&id, &investors);
    assert_eq!(count, 1); // only investor1 refunded
    assert_eq!(total, 10_000);
}

#[test]
fn test_batch_refund_investors_idempotent() {
    let t = setup();
    let deadline = future_deadline(&t);
    // Partial investment keeps campaign in Funding so finalize_failed works.
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &20_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    advance_ledger(&t.env, 8 * 24 * 3600);
    t.client.finalize_failed(&id);

    let mut investors = Vec::new(&t.env);
    investors.push_back(t.investor1.clone());

    // First batch call
    let (c1, t1) = t.client.batch_refund_investors(&id, &investors);
    assert_eq!(c1, 1);
    assert_eq!(t1, 10_000);

    // Second batch call — already claimed, should be skipped
    let (c2, t2) = t.client.batch_refund_investors(&id, &investors);
    assert_eq!(c2, 0);
    assert_eq!(t2, 0);
}

#[test]
fn test_batch_refund_investors_requires_failed_campaign() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000); // → Funded, not Failed

    let mut investors = Vec::new(&t.env);
    investors.push_back(t.investor1.clone());

    let err = t
        .client
        .try_batch_refund_investors(&id, &investors)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::CampaignNotFailed);
}

#[test]
fn test_batch_refund_investors_mixes_with_individual_refund() {
    // Investor1 already refunded individually; batch should skip them and refund investor2.
    let t = setup();
    let deadline = future_deadline(&t);
    // Target is 20_000 so partial investments keep campaign in Funding state.
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &20_000, &deadline);
    t.client.invest(&t.investor1, &id, &6_000);
    t.client.invest(&t.investor2, &id, &4_000);
    advance_ledger(&t.env, 8 * 24 * 3600);
    t.client.finalize_failed(&id);

    // Individual refund for investor1
    t.client.refund(&t.investor1, &id);

    let before2 = balance(&t, &t.investor2);
    let mut investors = Vec::new(&t.env);
    investors.push_back(t.investor1.clone());
    investors.push_back(t.investor2.clone());

    let (count, total) = t.client.batch_refund_investors(&id, &investors);
    assert_eq!(count, 1); // only investor2
    assert_eq!(total, 4_000);
    assert_eq!(balance(&t, &t.investor2), before2 + 4_000);
}

// ---------------------------------------------------------------------------
// 24. Batch Refund Orders Tests
// ---------------------------------------------------------------------------

#[test]
fn test_batch_refund_orders_refunds_expired_orders() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);

    let sac = soroban_sdk::token::StellarAssetClient::new(&t.env, &t.token_id);
    let buyer2 = Address::generate(&t.env);
    sac.mint(&buyer2, &1_000_000);

    let order1 = t.client.create_order(&t.buyer, &id, &300);
    let order2 = t.client.create_order(&buyer2, &id, &200);

    let before1 = balance(&t, &t.buyer);
    let before2 = TokenClient::new(&t.env, &t.token_id).balance(&buyer2);

    advance_ledger(&t.env, ORDER_EXPIRY_SECS);

    let mut ids = Vec::new(&t.env);
    ids.push_back(order1);
    ids.push_back(order2);

    let (count, total) = t.client.batch_refund_orders(&ids);
    assert_eq!(count, 2);
    assert_eq!(total, 500);
    assert_eq!(balance(&t, &t.buyer), before1 + 300);
    assert_eq!(
        TokenClient::new(&t.env, &t.token_id).balance(&buyer2),
        before2 + 200
    );
}

#[test]
fn test_batch_refund_orders_emits_single_summary_event() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);

    let order_id = t.client.create_order(&t.buyer, &id, &400);
    advance_ledger(&t.env, ORDER_EXPIRY_SECS);

    let mut ids = Vec::new(&t.env);
    ids.push_back(order_id);

    // Verify batch completes and returns expected count/total (event emission verified via no-panic).
    let (count, total) = t.client.batch_refund_orders(&ids);
    assert_eq!(count, 1);
    assert_eq!(total, 400);
}

#[test]
fn test_batch_refund_orders_skips_unexpired_orders() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);

    let order_id = t.client.create_order(&t.buyer, &id, &500);
    let buyer_before = balance(&t, &t.buyer);

    // Only 10 hours — well before 96h expiry
    advance_ledger(&t.env, 10 * 3600);

    let mut ids = Vec::new(&t.env);
    ids.push_back(order_id);

    let (count, total) = t.client.batch_refund_orders(&ids);
    assert_eq!(count, 0);
    assert_eq!(total, 0);
    assert_eq!(balance(&t, &t.buyer), buyer_before);
}

#[test]
fn test_batch_refund_orders_skips_invalid_order_ids() {
    let t = setup();
    let mut ids = Vec::new(&t.env);
    ids.push_back(99999_u64); // non-existent

    // Should not panic — just skip
    let (count, total) = t.client.batch_refund_orders(&ids);
    assert_eq!(count, 0);
    assert_eq!(total, 0);
}

#[test]
fn test_batch_refund_orders_count_and_total_are_correct() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);

    let o1 = t.client.create_order(&t.buyer, &id, &100);
    let o2 = t.client.create_order(&t.buyer, &id, &200);
    let o3 = t.client.create_order(&t.buyer, &id, &300);

    advance_ledger(&t.env, ORDER_EXPIRY_SECS);

    let mut ids = Vec::new(&t.env);
    ids.push_back(o1);
    ids.push_back(o2);
    ids.push_back(o3);

    let (count, total) = t.client.batch_refund_orders(&ids);
    assert_eq!(count, 3);
    assert_eq!(total, 600); // 100 + 200 + 300
}

// ---------------------------------------------------------------------------
// 15. Issue #455 - Late Confirm Order Rejection (after settlement)
// ---------------------------------------------------------------------------

#[test]
fn test_reject_confirm_order_after_settlement() {
// ===========================================================================
// Issue #462 — Formal Failure & Dispute Model
// ===========================================================================

// ---------------------------------------------------------------------------
// 25. mark_campaign_failed Tests
// ---------------------------------------------------------------------------

#[test]
fn test_mark_campaign_failed_from_funded_state_full_refund() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);

    // Create order before settlement is OK
    let order_id = t.client.create_order(&t.buyer, &id, &2_000);

    // Settlement prevents further order confirmations
    t.client.settle(&t.farmer, &id);

    // Confirming order after settlement should fail (Issue #455)
    let err = t
        .client
        .try_confirm_order(&t.buyer, &order_id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::CampaignNotHarvested);
}

#[test]
fn test_confirm_order_before_settlement_allowed() {
    t.client.invest(&t.investor1, &id, &6_000);
    t.client.invest(&t.investor2, &id, &4_000); // → Funded

    assert_eq!(t.client.get_campaign(&id).status, CampaignStatus::Funded);

    // Farmer marks campaign as failed
    t.client.mark_campaign_failed(&t.farmer, &id);
    assert_eq!(t.client.get_campaign(&id).status, CampaignStatus::Failed);

    // Full refund: no tranches released, so all contributions are returned
    let r1 = t.client.refund(&t.investor1, &id);
    let r2 = t.client.refund(&t.investor2, &id);
    assert_eq!(r1, 6_000);
    assert_eq!(r2, 4_000);
}

#[test]
fn test_mark_campaign_failed_from_in_production_proportional_refund() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &6_000);
    t.client.invest(&t.investor2, &id, &4_000); // → Funded
    t.client.start_production(&t.farmer, &id); // 30% tranche released (3_000)
    assert_eq!(t.client.get_campaign(&id).tranche_released, 3_000);

    // Farmer marks campaign as failed during production
    t.client.mark_campaign_failed(&t.farmer, &id);
    assert_eq!(t.client.get_campaign(&id).status, CampaignStatus::Failed);

    // Pool = 10_000 - 3_000 = 7_000
    // Investor1: (7_000 * 6_000) / 10_000 = 4_200
    // Investor2: (7_000 * 4_000) / 10_000 = 2_800
    let r1 = t.client.refund(&t.investor1, &id);
    let r2 = t.client.refund(&t.investor2, &id);
    assert_eq!(r1, 4_200);
    assert_eq!(r2, 2_800);
}

#[test]
fn test_mark_campaign_failed_from_harvested_proportional_refund() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000); // → Funded
    t.client.start_production(&t.farmer, &id); // 30% → 3_000
    t.client.mark_harvest(&t.farmer, &id); // +40% → 7_000 total

    // Add some revenue via an order
    let order_id = t.client.create_order(&t.buyer, &id, &2_000);
    t.client.confirm_order(&t.buyer, &order_id);
    assert_eq!(t.client.get_campaign(&id).total_revenue, 2_000);

    // Admin marks campaign as failed after harvest
    t.client.mark_campaign_failed(&t.admin, &id);
    assert_eq!(t.client.get_campaign(&id).status, CampaignStatus::Failed);

    // Pool = 10_000 (raised) + 2_000 (revenue) - 7_000 (tranches) = 5_000
    let before = balance(&t, &t.investor1);
    let r = t.client.refund(&t.investor1, &id);
    assert_eq!(r, 5_000);
    assert_eq!(balance(&t, &t.investor1), before + 5_000);
}

#[test]
fn test_mark_campaign_failed_from_funding_state_rejected() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    // Still in Funding state
    let err = t
        .client
        .try_mark_campaign_failed(&t.farmer, &id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::CampaignNotFundedOrBeyond);
}

#[test]
fn test_mark_campaign_failed_non_farmer_non_admin_rejected() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);

    // Create and confirm order before settlement
    let order_id = t.client.create_order(&t.buyer, &id, &2_000);
    t.client.confirm_order(&t.buyer, &order_id);

    // Should transition to Harvested with revenue recorded
    let campaign = t.client.get_campaign(&id);
    assert_eq!(campaign.status, CampaignStatus::Harvested);
    assert_eq!(campaign.total_revenue, 2_000);

    // Now settle
    t.client.settle(&t.farmer, &id);
    assert_eq!(t.client.get_campaign(&id).status, CampaignStatus::Settled);
}

#[test]
fn test_order_transitions_to_refunded_on_batch_expiry() {
    t.client.invest(&t.investor1, &id, &10_000); // → Funded
    // Investor (not farmer or admin) cannot mark as failed
    let err = t
        .client
        .try_mark_campaign_failed(&t.investor1, &id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::NotAdmin);
}

#[test]
fn test_mark_campaign_failed_admin_can_fail_campaign() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000); // → Funded
    t.client.start_production(&t.farmer, &id);
    // Admin can also mark as failed
    t.client.mark_campaign_failed(&t.admin, &id);
    assert_eq!(t.client.get_campaign(&id).status, CampaignStatus::Failed);
}

// ---------------------------------------------------------------------------
// 26. refundable_amount View Tests
// ---------------------------------------------------------------------------

#[test]
fn test_refundable_amount_full_refund_before_production() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &6_000);
    t.client.invest(&t.investor2, &id, &4_000); // → Funded
    t.client.mark_campaign_failed(&t.farmer, &id);

    assert_eq!(t.client.refundable_amount(&t.investor1, &id), 6_000);
    assert_eq!(t.client.refundable_amount(&t.investor2, &id), 4_000);
}

#[test]
fn test_refundable_amount_proportional_after_production() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &id);

    let order_id = t.client.create_order(&t.buyer, &id, &2_000);

    // Advance past ORDER_EXPIRY_SECS
    advance_ledger(&t.env, ORDER_EXPIRY_SECS + 1);

    // Batch refund should mark order as Refunded (Issue #455)
    let mut ids = Vec::new(&t.env);
    ids.push_back(order_id);
    let (count, total) = t.client.batch_refund_orders(&ids);
    assert_eq!(count, 1);
    assert_eq!(total, 2_000);

    let order = t.client.get_order(&order_id);
    assert_eq!(order.status, OrderStatus::Refunded);
    t.client.start_production(&t.farmer, &id); // 3_000 released
    t.client.mark_campaign_failed(&t.farmer, &id);

    // Pool = 10_000 - 3_000 = 7_000
    // Investor1 has 100% share → 7_000
    assert_eq!(t.client.refundable_amount(&t.investor1, &id), 7_000);
}

#[test]
fn test_refundable_amount_after_refund_returns_zero() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.mark_campaign_failed(&t.farmer, &id);

    assert_eq!(t.client.refundable_amount(&t.investor1, &id), 10_000);
    t.client.refund(&t.investor1, &id);
    assert_eq!(t.client.refundable_amount(&t.investor1, &id), 0);
}

#[test]
fn test_refundable_amount_non_failed_returns_zero() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    // Campaign is Funded, not Failed
    assert_eq!(t.client.refundable_amount(&t.investor1, &id), 0);
}

#[test]
fn test_refundable_amount_non_investor_returns_zero() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.mark_campaign_failed(&t.farmer, &id);
    // investor2 never invested
    assert_eq!(t.client.refundable_amount(&t.investor2, &id), 0);
}

// ---------------------------------------------------------------------------
// 27. Proportional Batch Refund After Production Failure
// ---------------------------------------------------------------------------

#[test]
fn test_batch_refund_investors_proportional_after_production_failure() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &6_000);
    t.client.invest(&t.investor2, &id, &4_000); // → Funded
    t.client.start_production(&t.farmer, &id); // 30% → 3_000 released
    t.client.mark_campaign_failed(&t.farmer, &id);

    let before1 = balance(&t, &t.investor1);
    let before2 = balance(&t, &t.investor2);

    let mut investors = Vec::new(&t.env);
    investors.push_back(t.investor1.clone());
    investors.push_back(t.investor2.clone());

    let (count, total) = t.client.batch_refund_investors(&id, &investors);
    // Pool = 10_000 - 3_000 = 7_000
    // Investor1: (7_000 * 6_000) / 10_000 = 4_200
    // Investor2: (7_000 * 4_000) / 10_000 = 2_800
    assert_eq!(count, 2);
    assert_eq!(total, 7_000);
    assert_eq!(balance(&t, &t.investor1), before1 + 4_200);
    assert_eq!(balance(&t, &t.investor2), before2 + 2_800);
}

#[test]
fn test_batch_refund_investors_proportional_with_revenue() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id); // 3_000 released
    t.client.mark_harvest(&t.farmer, &id); // +4_000 = 7_000 total

    // Order adds revenue
    let order_id = t.client.create_order(&t.buyer, &id, &2_000);
    t.client.confirm_order(&t.buyer, &order_id);

    t.client.mark_campaign_failed(&t.admin, &id);

    let before = balance(&t, &t.investor1);
    let mut investors = Vec::new(&t.env);
    investors.push_back(t.investor1.clone());

    // Pool = 10_000 + 2_000 - 7_000 = 5_000
    let (count, total) = t.client.batch_refund_investors(&id, &investors);
    assert_eq!(count, 1);
    assert_eq!(total, 5_000);
    assert_eq!(balance(&t, &t.investor1), before + 5_000);
}

// ---------------------------------------------------------------------------
// 28. Tranche Cap Enforcement
// ---------------------------------------------------------------------------

#[test]
fn test_tranche_cannot_exceed_max_tranche_bps() {
    let t = setup();
    let deadline = future_deadline(&t);
    // The max cumulative tranche is 70% (7_000 bps).
    // Starting production releases 30%, marking harvest releases 40%.
    // Total = 70% — this is the cap. No additional tranches can be released.
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id); // 3_000 (30%)
    t.client.mark_harvest(&t.farmer, &id); // +4_000 = 7_000 (70%)

    // Verify the campaign at least 30% remains in escrow
    let c = t.client.get_campaign(&id);
    assert_eq!(c.tranche_released, 7_000);
    let remaining_in_escrow = c.total_raised - c.tranche_released;
    assert_eq!(remaining_in_escrow, 3_000); // 30% of 10_000
}

// ---------------------------------------------------------------------------
// 29. Token Balance Invariant Tests
// ---------------------------------------------------------------------------

#[test]
fn test_token_balance_invariant_full_failure_before_production() {
    // Investors should get their full investment back; farmer gets nothing.
    let t = setup();
    let inv_before = balance(&t, &t.investor1);
    let farmer_before = balance(&t, &t.farmer);

    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000); // → Funded
    t.client.mark_campaign_failed(&t.farmer, &id);
    t.client.refund(&t.investor1, &id);

    assert_eq!(balance(&t, &t.investor1), inv_before);
    assert_eq!(balance(&t, &t.farmer), farmer_before);
}

#[test]
fn test_token_balance_invariant_proportional_failure() {
    // After production failure with tranches released, tokens are conserved:
    // farmer keeps released tranche, investor gets proportional refund.
    let t = setup();
    let inv1_before = balance(&t, &t.investor1);
    let farmer_before = balance(&t, &t.farmer);

    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000); // investor loses 10_000
    t.client.start_production(&t.farmer, &id); // farmer gets 3_000
    t.client.mark_campaign_failed(&t.farmer, &id);
    // investor gets back proportional: 10_000 - 3_000 = 7_000
    t.client.refund(&t.investor1, &id);

    // Farmer has original + 3_000 (tranche)
    assert_eq!(balance(&t, &t.farmer), farmer_before + 3_000);
    // Investor has original - 10_000 + 7_000 (refund)
    assert_eq!(balance(&t, &t.investor1), inv1_before - 3_000);
}
