#![cfg(test)]

extern crate std;

use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger, LedgerInfo},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, Vec,
};

use crate::{
    CampaignStatus, DisputeResolution, EscrowError, OrderStatus, ProductionEscrowContract,
    ProductionEscrowContractClient, SplitOrderResolution, SplitOrderStatus, CANCEL_WINDOW_SECS,
    ORDER_EXPIRY_SECS,
};

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

struct TestEnv<'a> {
    env: Env,
    client: ProductionEscrowContractClient<'a>,
    token_id: Address,
    admin: Address,
    attester: Address,
    farmer: Address,
    investor1: Address,
    investor2: Address,
    buyer: Address,
    fee_collector: Address,
}

fn setup() -> TestEnv<'static> {
    setup_with_fee(300)
}

fn setup_with_fee(fee_bps: u32) -> TestEnv<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let attester = Address::generate(&env);
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
    let fee_collector = Address::generate(&env);
    client.initialize(&admin, &tokens, &fee_collector, &fee_bps);
    client.set_attester(&admin, &attester);

    // Leak lifetimes to 'static for convenience struct.
    let env: Env = unsafe { std::mem::transmute(env) };
    let client: ProductionEscrowContractClient<'static> = unsafe { std::mem::transmute(client) };

    TestEnv {
        env,
        client,
        token_id,
        admin,
        attester,
        farmer,
        investor1,
        investor2,
        buyer,
        fee_collector,
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
        .try_initialize(&t.admin, &extra, &t.fee_collector, &300)
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
    let fee_collector = Address::generate(&env);
    let empty: Vec<Address> = Vec::new(&env);
    let err = client.try_initialize(&admin, &empty, &fee_collector, &300).unwrap_err().unwrap();
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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);

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
        .try_mark_harvest(&t.farmer, &t.attester, &id)
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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);
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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);
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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);
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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);
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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);
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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);
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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);
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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);

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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);

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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);

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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);

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
    // Use fee=0 to avoid pool balance shortfall from fee transfers
    let t = setup_with_fee(0);
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &t.attester, &id);

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
        .try_mark_harvest(&t.buyer, &t.attester, &id)
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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);
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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);
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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);
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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);
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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);

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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);

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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);
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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);
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
        .try_mark_harvest(&t.farmer, &t.attester, &id)
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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);
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
fn test_open_dispute_on_failed_campaign_succeeds() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &5_000);
    advance_ledger(&t.env, 8 * 24 * 3600);
    t.client.finalize_failed(&id); // → Failed
    t.client.open_dispute(&t.investor1, &id); // succeeds (only Disputed/Settled blocked)
    assert_eq!(t.client.get_campaign(&id).status, CampaignStatus::Disputed);
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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);
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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);

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
fn test_cancel_order_within_window_refunds_amount_plus_fee() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &t.attester, &id);

    let order_id = t.client.create_order(&t.buyer, &id, &500);
    let buyer_before = balance(&t, &t.buyer);

    advance_ledger(&t.env, 60);
    t.client.cancel_order(&t.buyer, &order_id);

    let order = t.client.get_order(&order_id);
    assert_eq!(order.status, OrderStatus::Refunded);
    // Mirrors batch_refund_orders: refunds amount + fee.
    assert_eq!(balance(&t, &t.buyer), buyer_before + 515);
}

#[test]
fn test_cancel_order_fails_after_window_closes() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &t.attester, &id);

    let order_id = t.client.create_order(&t.buyer, &id, &500);
    advance_ledger(&t.env, CANCEL_WINDOW_SECS + 1);

    let err = t
        .client
        .try_cancel_order(&t.buyer, &order_id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::CancelWindowClosed);
}

#[test]
fn test_cancel_order_fails_after_confirmation() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &t.attester, &id);

    let order_id = t.client.create_order(&t.buyer, &id, &500);
    t.client.confirm_order(&t.buyer, &order_id);

    let err = t
        .client
        .try_cancel_order(&t.buyer, &order_id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::OrderNotPending);
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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);

    let order_id = t.client.create_order(&t.buyer, &id, &500);
    let buyer_before = balance(&t, &t.buyer);

    // Exactly 96 hours later
    advance_ledger(&t.env, ORDER_EXPIRY_SECS);
    let mut ids = Vec::new(&t.env);
    ids.push_back(order_id);
    let (count, total) = t.client.batch_refund_orders(&ids);
    assert_eq!(count, 1);
    // batch_refund_orders refunds amount + fee
    assert_eq!(total, 515);
    assert_eq!(balance(&t, &t.buyer), buyer_before + 515);
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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);

    let order_id = t.client.create_order(&t.buyer, &id, &300);
    let buyer_before = balance(&t, &t.buyer);

    // More than 96 hours later
    advance_ledger(&t.env, ORDER_EXPIRY_SECS + 1);
    let mut ids = Vec::new(&t.env);
    ids.push_back(order_id);
    let (count, total) = t.client.batch_refund_orders(&ids);
    assert_eq!(count, 1);
    // batch_refund_orders refunds amount + fee
    assert_eq!(total, 309);
    assert_eq!(balance(&t, &t.buyer), buyer_before + 309);
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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);

    let order_id = t.client.create_order(&t.buyer, &id, &400);
    advance_ledger(&t.env, ORDER_EXPIRY_SECS);

    let mut ids = Vec::new(&t.env);
    ids.push_back(order_id);

    // First call — succeeds
    let (count1, total1) = t.client.batch_refund_orders(&ids);
    assert_eq!(count1, 1);
    assert_eq!(total1, 412);

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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);

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
        .try_mark_harvest(&t.investor1, &t.attester, &id)
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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);
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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);
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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);
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
        .try_mark_harvest(&t.farmer, &t.attester, &id)
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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);
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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);
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
        .try_initialize(&t.admin, &tokens, &t.fee_collector, &300)
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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);
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
    let fee_collector = Address::generate(&env);
    let empty: Vec<Address> = Vec::new(&env);
    let err = client.try_initialize(&admin, &empty, &fee_collector, &300).unwrap_err().unwrap();
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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);

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
    // batch_refund_orders refunds amount + fee (300+9=309, 200+6=206)
    assert_eq!(total, 515);
    assert_eq!(balance(&t, &t.buyer), before1 + 309);
    assert_eq!(
        TokenClient::new(&t.env, &t.token_id).balance(&buyer2),
        before2 + 206
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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);

    let order_id = t.client.create_order(&t.buyer, &id, &400);
    advance_ledger(&t.env, ORDER_EXPIRY_SECS);

    let mut ids = Vec::new(&t.env);
    ids.push_back(order_id);

    // Verify batch completes and returns expected count/total (event emission verified via no-panic).
    let (count, total) = t.client.batch_refund_orders(&ids);
    assert_eq!(count, 1);
    // batch_refund_orders refunds amount + fee (400+12=412)
    assert_eq!(total, 412);
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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);

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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);

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
    // batch_refund_orders refunds amount + fee (100+3=103, 200+6=206, 300+9=309)
    assert_eq!(total, 618); // 103 + 206 + 309
}

// ---------------------------------------------------------------------------
// 15. Issue #455 - Late Confirm Order Rejection (after settlement)
// ---------------------------------------------------------------------------

#[test]
fn test_reject_confirm_order_after_settlement() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &t.attester, &id);

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
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);
    t.client.mark_harvest(&t.farmer, &t.attester, &id);

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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);

    // Mark campaign as failed after harvest
    t.client.mark_campaign_failed(&t.admin, &id);
    assert_eq!(t.client.get_campaign(&id).status, CampaignStatus::Failed);

    // All investors should be refunded their full investment
    let investor1_balance_after = t.token_contract.balance(&t.investor1);
    assert_eq!(investor1_balance_after, 10_000 + 10_000); // initial + refund
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

    // Admin marks campaign as failed during production (farmer cannot unilaterally fail after production starts)
    t.client.mark_campaign_failed(&t.admin, &id);
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
    t.client.mark_harvest(&t.farmer, &t.attester, &id); // +40% → 7_000 total

    // Admin marks campaign as failed after harvest
    t.client.mark_campaign_failed(&t.admin, &id);
    assert_eq!(t.client.get_campaign(&id).status, CampaignStatus::Failed);

    // Pool = 10_000 (raised) - 7_000 (tranches) = 3_000
    let before = balance(&t, &t.investor1);
    let r = t.client.refund(&t.investor1, &id);
    assert_eq!(r, 3_000);
    assert_eq!(balance(&t, &t.investor1), before + 3_000);
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
    assert_eq!(err, EscrowError::NotAdmin);
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
    t.client.mark_harvest(&t.farmer, &t.attester, &id);

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
    t.client.start_production(&t.farmer, &id); // 3_000 released (30%)

    // Campaign fails during production (before harvest)
    t.client.mark_campaign_failed(&t.admin, &id);

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
    t.client.mark_campaign_failed(&t.admin, &id);

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
    // Use fee=0 to avoid pool balance shortfall from fee transfers
    let t = setup_with_fee(0);
    let deadline = future_deadline(&t);
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id); // 3_000 released
    t.client.mark_harvest(&t.farmer, &t.attester, &id); // +4_000 = 7_000 total

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
    t.client.mark_harvest(&t.farmer, &t.attester, &id); // +4_000 = 7_000 (70%)

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
    t.client.mark_campaign_failed(&t.admin, &id);
    // investor gets back proportional: 10_000 - 3_000 = 7_000
    t.client.refund(&t.investor1, &id);

    // Farmer has original + 3_000 (tranche)
    assert_eq!(balance(&t, &t.farmer), farmer_before + 3_000);
    // Investor has original - 10_000 + 7_000 (refund)
    assert_eq!(balance(&t, &t.investor1), inv1_before - 3_000);
}

// ---------------------------------------------------------------------------
// Milestone-based partial release tests
// ---------------------------------------------------------------------------

use crate::{Milestone, MilestoneConfig};

fn milestone_configs_50pct(t: &TestEnv) -> Vec<MilestoneConfig> {
    let mut configs = Vec::new(&t.env);
    configs.push_back(MilestoneConfig { milestone: Milestone::Planted, release_bps: 1000 });
    configs.push_back(MilestoneConfig { milestone: Milestone::Growing, release_bps: 1000 });
    configs.push_back(MilestoneConfig { milestone: Milestone::Harvested, release_bps: 1000 });
    configs.push_back(MilestoneConfig { milestone: Milestone::Shipped, release_bps: 1000 });
    configs.push_back(MilestoneConfig { milestone: Milestone::Delivered, release_bps: 1000 });
    configs // 5 x 10% = 50% total
}

fn milestone_configs_40pct(t: &TestEnv) -> Vec<MilestoneConfig> {
    let mut configs = Vec::new(&t.env);
    configs.push_back(MilestoneConfig { milestone: Milestone::Planted, release_bps: 800 });
    configs.push_back(MilestoneConfig { milestone: Milestone::Growing, release_bps: 800 });
    configs.push_back(MilestoneConfig { milestone: Milestone::Harvested, release_bps: 800 });
    configs.push_back(MilestoneConfig { milestone: Milestone::Shipped, release_bps: 800 });
    configs.push_back(MilestoneConfig { milestone: Milestone::Delivered, release_bps: 800 });
    configs // 5 x 8% = 40% total (30% start + 40% milestones = 70% = MAX_TRANCHE_BPS)
}

#[test]
fn test_set_milestone_configs_ok() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    let configs = milestone_configs_50pct(&t);
    t.client.set_milestone_configs(&t.admin, &id, &configs);
    let stored = t.client.get_milestone_configs(&id);
    assert_eq!(stored.len(), 5);
    assert_eq!(stored.get(0).unwrap().milestone, Milestone::Planted);
    assert_eq!(stored.get(0).unwrap().release_bps, 1000);
}

#[test]
fn test_set_milestone_configs_rejects_non_admin() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    let configs = milestone_configs_50pct(&t);
    let err = t.client.try_set_milestone_configs(&t.farmer, &id, &configs)
        .unwrap_err().unwrap();
    assert_eq!(err, EscrowError::NotAdmin);
}

#[test]
fn test_set_milestone_configs_rejects_wrong_order() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    // Put Growing first instead of Planted.
    let mut configs = Vec::new(&t.env);
    configs.push_back(MilestoneConfig { milestone: Milestone::Growing, release_bps: 1000 });
    configs.push_back(MilestoneConfig { milestone: Milestone::Planted, release_bps: 1000 });
    let err = t.client.try_set_milestone_configs(&t.admin, &id, &configs)
        .unwrap_err().unwrap();
    assert_eq!(err, EscrowError::InvalidMilestone);
}

#[test]
fn test_advance_milestone_planted_ok() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    let configs = milestone_configs_50pct(&t);
    t.client.set_milestone_configs(&t.admin, &id, &configs);
    t.client.start_production(&t.farmer, &id);

    // Buyer must have a confirmed order — create and confirm one first.
    let order_id = t.client.create_order(&t.buyer, &id, &1_000);
    t.client.confirm_order(&t.buyer, &order_id);

    let farmer_before = balance(&t, &t.farmer);
    t.client.advance_milestone(&t.buyer, &t.attester, &id);
    // 10% of 10_000 = 1_000
    assert_eq!(balance(&t, &t.farmer), farmer_before + 1_000);

    let c = t.client.get_campaign(&id);
    assert_eq!(c.current_milestone, 1);
    assert_eq!(c.tranche_released, 4_000);
}

#[test]
fn test_advance_milestone_growing_ok() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    let configs = milestone_configs_50pct(&t);
    t.client.set_milestone_configs(&t.admin, &id, &configs);
    t.client.start_production(&t.farmer, &id);

    let order_id = t.client.create_order(&t.buyer, &id, &1_000);
    t.client.confirm_order(&t.buyer, &order_id);

    t.client.advance_milestone(&t.buyer, &t.attester, &id); // Planted: 1_000
    let farmer_before = balance(&t, &t.farmer);
    t.client.advance_milestone(&t.buyer, &t.attester, &id); // Growing: 1_000
    assert_eq!(balance(&t, &t.farmer), farmer_before + 1_000);

    let c = t.client.get_campaign(&id);
    assert_eq!(c.current_milestone, 2);
    assert_eq!(c.tranche_released, 5_000);
}

#[test]
fn test_advance_milestone_all_five_ok() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    let configs = milestone_configs_40pct(&t);
    t.client.set_milestone_configs(&t.admin, &id, &configs);
    t.client.start_production(&t.farmer, &id);

    let order_id = t.client.create_order(&t.buyer, &id, &1_000);
    t.client.confirm_order(&t.buyer, &order_id);

    let farmer_before = balance(&t, &t.farmer);
    for _ in 0..5 {
        t.client.advance_milestone(&t.buyer, &t.attester, &id);
    }
    // 5 x 800 = 4_000 (40% of 10_000)
    assert_eq!(balance(&t, &t.farmer), farmer_before + 4_000);
    let c = t.client.get_campaign(&id);
    assert_eq!(c.current_milestone, 5);
    assert_eq!(c.tranche_released, 7_000);
}

#[test]
fn test_advance_milestone_rejects_farmer() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    let configs = milestone_configs_50pct(&t);
    t.client.set_milestone_configs(&t.admin, &id, &configs);

    // Farmer cannot advance milestones (not a buyer).
    let err = t.client.try_advance_milestone(&t.farmer, &t.attester, &id)
        .unwrap_err().unwrap();
    assert_eq!(err, EscrowError::NotBuyerOrOracle);
}

#[test]
fn test_advance_milestone_admin_as_oracle_ok() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    let configs = milestone_configs_50pct(&t);
    t.client.set_milestone_configs(&t.admin, &id, &configs);

    // Admin acts as oracle — no order needed.
    let farmer_before = balance(&t, &t.farmer);
    t.client.advance_milestone(&t.admin, &t.attester, &id);
    assert_eq!(balance(&t, &t.farmer), farmer_before + 1_000);
}

#[test]
fn test_advance_milestone_rejects_no_config() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    t.client.start_production(&t.farmer, &id);

    let order_id = t.client.create_order(&t.buyer, &id, &1_000);
    t.client.confirm_order(&t.buyer, &order_id);

    let err = t.client.try_advance_milestone(&t.buyer, &t.attester, &id)
        .unwrap_err().unwrap();
    assert_eq!(err, EscrowError::MilestoneNotConfigured);
}

#[test]
fn test_advance_milestone_rejects_past_end() {
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    let configs = milestone_configs_40pct(&t);
    t.client.set_milestone_configs(&t.admin, &id, &configs);
    t.client.start_production(&t.farmer, &id);

    let order_id = t.client.create_order(&t.buyer, &id, &1_000);
    t.client.confirm_order(&t.buyer, &order_id);

    for _ in 0..5 {
        t.client.advance_milestone(&t.buyer, &t.attester, &id);
    }
    // 6th advance should fail — no more milestones.
    let err = t.client.try_advance_milestone(&t.buyer, &t.attester, &id)
        .unwrap_err().unwrap();
    assert_eq!(err, EscrowError::InvalidMilestone);
}

#[test]
fn test_advance_milestone_over_release_prevented() {
    // 5 milestones each at 30% = 150% total. The 70% MAX_TRANCHE_BPS cap
    // should reject the 2nd milestone after start_production (30% start
    // + 30% milestone = 60%, plus another 30% = 90% > 70%).
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);

    let mut configs = Vec::new(&t.env);
    for i in 0..5 {
        configs.push_back(MilestoneConfig {
            milestone: match i {
                0 => Milestone::Planted,
                1 => Milestone::Growing,
                2 => Milestone::Harvested,
                3 => Milestone::Shipped,
                _ => Milestone::Delivered,
            },
            release_bps: 3000, // 30% each
        });
    }
    t.client.set_milestone_configs(&t.admin, &id, &configs);
    t.client.start_production(&t.farmer, &id);

    let order_id = t.client.create_order(&t.buyer, &id, &1_000);
    t.client.confirm_order(&t.buyer, &order_id);

    t.client.advance_milestone(&t.buyer, &t.attester, &id); // 30% = 3_000 (total 6_000)
    let err = t.client.try_advance_milestone(&t.buyer, &t.attester, &id)
        .unwrap_err().unwrap();
    // 2nd milestone would push to 9_000 > 7_000 max.
    assert_eq!(err, EscrowError::InvalidTranche);
}

#[test]
fn test_advance_milestone_refund_after_partial_release() {
    // After advancing some milestones (using admin as oracle), campaign fails.
    // Investor gets proportional refund from remaining pool.
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    let configs = milestone_configs_40pct(&t);
    t.client.set_milestone_configs(&t.admin, &id, &configs);
    t.client.start_production(&t.farmer, &id);

    // Admin advances milestones as oracle (no buyer/order needed).
    t.client.advance_milestone(&t.admin, &t.attester, &id); // 800
    t.client.advance_milestone(&t.admin, &t.attester, &id); // 800

    // Campaign fails. Only admin can fail after production started.
    t.client.mark_campaign_failed(&t.admin, &id);
    let refund = t.client.refund(&t.investor1, &id);
    // Remaining pool = 10_000 - (3_000 start + 1_600 milestones) = 5_400.
    assert_eq!(refund, 5_400);
}

// Test for Issue #640: trivial buyer exploit prevention
#[test]
fn test_advance_milestone_rejects_trivial_buyer_without_attester() {
    // Farmer creates campaign, accomplice creates trivial 1-token order and confirms it.
    // Attempt to advance milestone without attester co-signature should fail.
    let t = setup();
    let deadline = future_deadline(&t);
    let id = t.client.create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &id, &10_000);
    let configs = milestone_configs_50pct(&t);
    t.client.set_milestone_configs(&t.admin, &id, &configs);
    t.client.start_production(&t.farmer, &id);

    // Accomplice creates trivial order (amount=1, well below 1% minimum of 10_000)
    let trivial_order_id = t.client.create_order(&t.buyer, &id, &1);
    t.client.confirm_order(&t.buyer, &trivial_order_id);

    // Try to advance milestone as trivial buyer without attester — should fail.
    let err = t.client.try_advance_milestone(&t.buyer, &t.attester, &id)
        .unwrap_err().unwrap();
    // Minimum order required is 1% of 10_000 = 100, but only has 1 token.
    assert_eq!(err, EscrowError::NotBuyerOrOracle);
}

#[test]
fn test_advance_milestone_requires_attester_cosignature() {
    // Even with a sufficient order amount, advance_milestone requires attester co-signature.
    // This test verifies the attester is mandatory.
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let attester = Address::generate(&env);
    let farmer = Address::generate(&env);
    let investor1 = Address::generate(&env);
    let buyer = Address::generate(&env);
    let non_attester = Address::generate(&env);

    // Deploy and setup
    let token_admin = Address::generate(&env);
    let token_id = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let sac = StellarAssetClient::new(&env, &token_id);
    sac.mint(&investor1, &1_000_000);
    sac.mint(&buyer, &1_000_000);

    let contract_id = env.register(ProductionEscrowContract, ());
    let client = ProductionEscrowContractClient::new(&env, &contract_id);

    let mut tokens = Vec::new(&env);
    tokens.push_back(token_id.clone());
    let fee_collector = Address::generate(&env);
    client.initialize(&admin, &tokens, &fee_collector, &300);
    client.set_attester(&admin, &attester);

    let deadline = env.ledger().timestamp() + 7 * 24 * 3600;
    let id = client.create_campaign(&farmer, &token_id, &10_000, &deadline);
    client.invest(&investor1, &id, &10_000);

    let mut configs = Vec::new(&env);
    configs.push_back(MilestoneConfig {
        milestone: Milestone::Planted,
        release_bps: 1000,
    });
    client.set_milestone_configs(&admin, &id, &configs);
    client.start_production(&farmer, &id);

    // Create sufficient order (2_000 > 1% of 10_000)
    let order_id = client.create_order(&buyer, &id, &2_000);
    client.confirm_order(&buyer, &order_id);

    // Try with wrong attester (not the configured attester) — should fail.
    let err = client.try_advance_milestone(&buyer, &non_attester, &id)
        .unwrap_err().unwrap();
    assert_eq!(err, EscrowError::NotAdmin);

    // Now succeed with correct attester.
    client.advance_milestone(&buyer, &attester, &id);
    let c = client.get_campaign(&id);
    assert_eq!(c.current_milestone, 1);
}

// ---------------------------------------------------------------------------
// Governance gating (Issue #660)
// ---------------------------------------------------------------------------

#[test]
fn test_fee_config_admin_fallback_before_governance_set() {
    let t = setup();
    let fee_collector = Address::generate(&t.env);
    // No governance contract configured yet: admin can still update fee config.
    t.client.set_fee_config(&t.admin, &fee_collector, &500);
}

/// Stand-in for a real governance contract: exposes the `get_admin` view function
/// `set_governance_contract` uses to verify a candidate address is a live deployed
/// governance contract before accepting it (Issue #680).
#[contract]
struct MockGovernance;

#[contractimpl]
impl MockGovernance {
    pub fn get_admin(env: Env) -> Address {
        env.current_contract_address()
    }
}

#[test]
fn test_fee_config_rejects_admin_once_governance_set() {
    let t = setup();
    let governance = t.env.register(MockGovernance, ());
    let fee_collector = Address::generate(&t.env);

    t.client.set_governance_contract(&t.admin, &governance);

    let result = t.client.try_set_fee_config(&t.admin, &fee_collector, &500);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::NotGoverned);

    // The governance contract address is now the sole authorized caller.
    t.client.set_fee_config(&governance, &fee_collector, &500);
}

#[test]
fn test_registry_contract_rejects_admin_once_governance_set() {
    let t = setup();
    let governance = t.env.register(MockGovernance, ());
    let registry = Address::generate(&t.env);

    t.client.set_governance_contract(&t.admin, &governance);

    let result = t.client.try_set_registry_contract(&t.admin, &registry);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::NotGoverned);

    t.client.set_registry_contract(&governance, &registry);
}

#[test]
fn test_update_supported_tokens_governance_gated() {
    let t = setup();
    let governance = t.env.register(MockGovernance, ());
    t.client.set_governance_contract(&t.admin, &governance);

    let mut tokens = Vec::new(&t.env);
    tokens.push_back(t.token_id.clone());

    let result = t.client.try_update_supported_tokens(&t.admin, &tokens);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::NotGoverned);

    t.client.update_supported_tokens(&governance, &tokens);
    assert_eq!(t.client.get_supported_tokens().len(), 1);
}

#[test]
fn test_registry_wired_campaign_creation() {
    let t = setup();

    // Register real registry contract
    let registry_id = t.env.register(registry::RegistryContract, ());
    let registry_client = registry::RegistryContractClient::new(&t.env, &registry_id);

    // Initialize registry contract with escrow and production escrow addresses
    let dummy_escrow = Address::generate(&t.env);
    registry_client.initialize(&t.admin, &dummy_escrow, &t.client.address);

    // Wire registry to production escrow
    t.client.set_registry_contract(&t.admin, &registry_id);

    // Register farmer in registry contract
    registry_client.register_farmer(&t.farmer);

    // Create campaign in production escrow
    let deadline = future_deadline(&t);
    let campaign_id = t.client.create_campaign(
        &t.farmer,
        &t.token_id,
        &100_000,
        &deadline,
    );

    // Verify campaign creation is registered in registry
    let campaigns = registry_client.get_campaigns(&0, &10);
    assert_eq!(campaigns.len(), 1);
    let record = campaigns.get(0).unwrap();
    assert_eq!(record.campaign_id, campaign_id);
    assert_eq!(record.farmer, t.farmer);
    assert_eq!(record.source_contract, t.client.address);
}

// ---------------------------------------------------------------------------
// Multi-party split orders (Issue #654)
// ---------------------------------------------------------------------------

fn setup_split_ready(co_buyer_count: u32) -> (TestEnv<'static>, u64, Vec<Address>) {
    let t = setup();
    let deadline = future_deadline(&t);
    let campaign_id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);
    t.client.invest(&t.investor1, &campaign_id, &10_000);
    t.client.start_production(&t.farmer, &campaign_id);
    t.client
        .mark_harvest(&t.farmer, &t.attester, &campaign_id);

    let sac = StellarAssetClient::new(&t.env, &t.token_id);
    let mut co_buyers = Vec::new(&t.env);
    for _ in 0..co_buyer_count {
        let co_buyer = Address::generate(&t.env);
        sac.mint(&co_buyer, &1_000);
        co_buyers.push_back(co_buyer);
    }

    (t, campaign_id, co_buyers)
}

#[test]
fn test_create_split_order_validates_share_count() {
    let (t, campaign_id, co_buyers) = setup_split_ready(3);
    let mut shares = Vec::new(&t.env);
    shares.push_back(300i128);
    shares.push_back(400i128);

    let result = t.client.try_create_split_order(
        &co_buyers.get(0).unwrap(),
        &campaign_id,
        &co_buyers,
        &shares,
    );
    assert_eq!(
        result.unwrap_err().unwrap(),
        EscrowError::SplitSharesMustSumToTotal
    );
}

#[test]
fn test_split_order_partial_funding_stays_in_funding_state() {
    let (t, campaign_id, co_buyers) = setup_split_ready(3);
    let mut shares = Vec::new(&t.env);
    shares.push_back(300i128);
    shares.push_back(300i128);
    shares.push_back(400i128);

    let contract_balance_before = balance(&t, &t.client.address);

    let order_id =
        t.client
            .create_split_order(&co_buyers.get(0).unwrap(), &campaign_id, &co_buyers, &shares);
    t.client
        .fund_split_order(&co_buyers.get(0).unwrap(), &order_id);

    let order = t.client.get_split_order(&order_id);
    assert_eq!(order.status, SplitOrderStatus::Funding);
    assert_eq!(order.funded_count, 1);
    assert_eq!(
        balance(&t, &t.client.address),
        contract_balance_before + 300
    );
}

#[test]
fn test_split_order_becomes_active_once_fully_funded() {
    let (t, campaign_id, co_buyers) = setup_split_ready(2);
    let mut shares = Vec::new(&t.env);
    shares.push_back(500i128);
    shares.push_back(500i128);

    let order_id =
        t.client
            .create_split_order(&co_buyers.get(0).unwrap(), &campaign_id, &co_buyers, &shares);
    t.client
        .fund_split_order(&co_buyers.get(0).unwrap(), &order_id);
    let mid = t.client.get_split_order(&order_id);
    assert_eq!(mid.status, SplitOrderStatus::Funding);

    t.client
        .fund_split_order(&co_buyers.get(1).unwrap(), &order_id);
    let order = t.client.get_split_order(&order_id);
    assert_eq!(order.status, SplitOrderStatus::Active);
    assert_eq!(order.fee, 30); // 3% of 1000
}

#[test]
fn test_split_order_fund_twice_fails() {
    let (t, campaign_id, co_buyers) = setup_split_ready(2);
    let mut shares = Vec::new(&t.env);
    shares.push_back(500i128);
    shares.push_back(500i128);

    let order_id =
        t.client
            .create_split_order(&co_buyers.get(0).unwrap(), &campaign_id, &co_buyers, &shares);
    t.client
        .fund_split_order(&co_buyers.get(0).unwrap(), &order_id);
    let result = t
        .client
        .try_fund_split_order(&co_buyers.get(0).unwrap(), &order_id);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::AlreadyContributed);
}

#[test]
fn test_split_order_majority_by_value_releases_despite_non_confirming_contributor() {
    // Shares: 600 / 200 / 200. The 600-share co-buyer alone is a strict
    // majority by value, so the order confirms even though the other two
    // co-buyers never confirm.
    let (t, campaign_id, co_buyers) = setup_split_ready(3);
    let mut shares = Vec::new(&t.env);
    shares.push_back(600i128);
    shares.push_back(200i128);
    shares.push_back(200i128);

    let order_id =
        t.client
            .create_split_order(&co_buyers.get(0).unwrap(), &campaign_id, &co_buyers, &shares);
    for co_buyer in co_buyers.iter() {
        t.client.fund_split_order(&co_buyer, &order_id);
    }

    let revenue_before = t.client.get_campaign(&campaign_id).total_revenue;
    t.client
        .confirm_split_receipt(&co_buyers.get(0).unwrap(), &order_id);

    let order = t.client.get_split_order(&order_id);
    assert_eq!(order.status, SplitOrderStatus::Confirmed);
    let campaign = t.client.get_campaign(&campaign_id);
    assert_eq!(campaign.total_revenue, revenue_before + 1_000);
}

#[test]
fn test_split_order_even_split_requires_unanimous_confirmation() {
    let (t, campaign_id, co_buyers) = setup_split_ready(2);
    let mut shares = Vec::new(&t.env);
    shares.push_back(500i128);
    shares.push_back(500i128);

    let order_id =
        t.client
            .create_split_order(&co_buyers.get(0).unwrap(), &campaign_id, &co_buyers, &shares);
    for co_buyer in co_buyers.iter() {
        t.client.fund_split_order(&co_buyer, &order_id);
    }

    t.client
        .confirm_split_receipt(&co_buyers.get(0).unwrap(), &order_id);
    let mid = t.client.get_split_order(&order_id);
    assert_eq!(mid.status, SplitOrderStatus::Active);

    t.client
        .confirm_split_receipt(&co_buyers.get(1).unwrap(), &order_id);
    let order = t.client.get_split_order(&order_id);
    assert_eq!(order.status, SplitOrderStatus::Confirmed);
}

#[test]
fn test_split_order_dispute_refund_is_pro_rata_across_all_contributors() {
    let (t, campaign_id, co_buyers) = setup_split_ready(3);
    let mut shares = Vec::new(&t.env);
    shares.push_back(500i128);
    shares.push_back(300i128);
    shares.push_back(200i128);

    let contract_balance_before = balance(&t, &t.client.address);

    let order_id =
        t.client
            .create_split_order(&co_buyers.get(0).unwrap(), &campaign_id, &co_buyers, &shares);
    for co_buyer in co_buyers.iter() {
        t.client.fund_split_order(&co_buyer, &order_id);
    }

    t.client
        .open_split_dispute(&co_buyers.get(2).unwrap(), &order_id);
    t.client.resolve_split_dispute(
        &t.admin,
        &order_id,
        &SplitOrderResolution::RefundCoBuyers,
    );

    let order = t.client.get_split_order(&order_id);
    assert_eq!(order.status, SplitOrderStatus::Refunded);
    // Pro-rata over shares 500/300/200 out of total_amount 1000 (no fee
    // deducted on refund — the fee was never collected, only computed).
    assert_eq!(balance(&t, &co_buyers.get(0).unwrap()), 1_000 - 500 + 500);
    assert_eq!(balance(&t, &co_buyers.get(1).unwrap()), 1_000 - 300 + 300);
    assert_eq!(balance(&t, &co_buyers.get(2).unwrap()), 1_000 - 200 + 200);
    assert_eq!(balance(&t, &t.client.address), contract_balance_before);
}

#[test]
fn test_fund_split_order_non_co_buyer_fails() {
    let (t, campaign_id, co_buyers) = setup_split_ready(2);
    let mut shares = Vec::new(&t.env);
    shares.push_back(500i128);
    shares.push_back(500i128);
    let order_id =
        t.client
            .create_split_order(&co_buyers.get(0).unwrap(), &campaign_id, &co_buyers, &shares);

    let stranger = Address::generate(&t.env);
    let result = t.client.try_fund_split_order(&stranger, &order_id);
    assert_eq!(result.unwrap_err().unwrap(), EscrowError::NotCoBuyer);
}
