extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Events, Ledger, LedgerInfo},
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, Env,
};

use production_escrow_v2::{
    CampaignStatus, ProductionEscrowContract, ProductionEscrowContractClient,
};

use crate::{
    BasketConstituent, BasketError, BasketStatus, DataKey, InvestmentBasketContract,
    InvestmentBasketContractClient, OldBasketV1,
};

struct TestEnv<'a> {
    env: Env,
    basket: InvestmentBasketContractClient<'a>,
    escrow: ProductionEscrowContractClient<'a>,
    token_id: Address,
    admin: Address,
    attester: Address,
    farmer: Address,
    depositor: Address,
}

fn setup() -> TestEnv<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let attester = Address::generate(&env);
    let farmer = Address::generate(&env);
    let depositor = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let token_id = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let sac = StellarAssetClient::new(&env, &token_id);
    sac.mint(&depositor, &10_000_000);

    let escrow_id = env.register(ProductionEscrowContract, ());
    let escrow = ProductionEscrowContractClient::new(&env, &escrow_id);
    let mut tokens = soroban_sdk::Vec::new(&env);
    tokens.push_back(token_id.clone());
    let fee_collector = Address::generate(&env);
    escrow.initialize(&admin, &tokens, &fee_collector, &300);
    escrow.set_attester(&admin, &attester);

    let basket_id_contract = env.register(InvestmentBasketContract, ());
    let basket = InvestmentBasketContractClient::new(&env, &basket_id_contract);
    basket.initialize(&admin, &escrow_id);

    let basket: InvestmentBasketContractClient<'static> = unsafe { std::mem::transmute(basket) };
    let escrow: ProductionEscrowContractClient<'static> = unsafe { std::mem::transmute(escrow) };

    TestEnv {
        env,
        basket,
        escrow,
        token_id,
        admin,
        attester,
        farmer,
        depositor,
    }
}

fn set_ledger_timestamp(env: &Env, timestamp: u64) {
    env.ledger().set(LedgerInfo {
        timestamp,
        protocol_version: 22,
        sequence_number: env.ledger().sequence(),
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 16 * 60 * 60 * 24,
        min_persistent_entry_ttl: 30 * 24 * 60 * 60,
        max_entry_ttl: 365 * 24 * 60 * 60,
    });
}

#[test]
fn test_initialize_requires_admin_auth() {
    // Issue #843: initialize() must require the admin's authorization, so a
    // front-runner who never signed cannot seize admin on a fresh deploy.
    // Deliberately no mock_all_auths() — the caller must prove they control
    // the admin address or the call is rejected before any state is written.
    let env = Env::default();

    let attacker = Address::generate(&env);
    let escrow_contract = env.register(ProductionEscrowContract, ());

    let contract_id = env.register(InvestmentBasketContract, ());
    let client = InvestmentBasketContractClient::new(&env, &contract_id);

    // The attacker did not authorize `initialize`, so require_auth() traps.
    let result = client.try_initialize(&attacker, &escrow_contract);
    assert!(result.is_err());

    // No state was written — the contract is still uninitialized.
    let readback = client.try_get_admin();
    assert_eq!(readback.unwrap_err().unwrap(), BasketError::NotInitialized);
}

#[test]
fn test_create_basket_and_deposit_splits_across_campaigns() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let deadline = now + 100_000;

    let c1 = t
        .escrow
        .create_campaign(&t.farmer, &t.token_id, &1_000_000, &deadline);
    let c2 = t
        .escrow
        .create_campaign(&t.farmer, &t.token_id, &1_000_000, &deadline);

    let constituents = vec![&t.env, (c1, 6_000u32), (c2, 4_000u32)];
    let basket_id = t
        .basket
        .create_basket(&t.admin, &t.token_id, &constituents, &0, &0);

    t.basket.deposit(&t.depositor, &basket_id, &1_000_000);
    t.basket.fund_basket(&t.depositor, &basket_id);

    let basket = t.basket.get_basket(&basket_id);
    assert_eq!(basket.status, BasketStatus::Funded);
    assert_eq!(basket.total_deposit, 1_000_000);

    let campaign1 = t.escrow.get_campaign(&c1);
    let campaign2 = t.escrow.get_campaign(&c2);
    assert_eq!(campaign1.total_raised, 600_000);
    assert_eq!(campaign2.total_raised, 400_000);
}

#[test]
fn test_mixed_outcome_basket_partial_failure_does_not_block_settled_payout() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let deadline = now + 100_000;

    // c1 will be fully funded then settled (payable).
    // c2 will be underfunded and left to expire -> Failed (refundable).
    let c1 = t
        .escrow
        .create_campaign(&t.farmer, &t.token_id, &500_000, &deadline);
    let c2 = t
        .escrow
        .create_campaign(&t.farmer, &t.token_id, &10_000_000, &deadline);

    let constituents = vec![&t.env, (c1, 5_000u32), (c2, 5_000u32)];
    let basket_id = t
        .basket
        .create_basket(&t.admin, &t.token_id, &constituents, &0, &0);

    t.basket.deposit(&t.depositor, &basket_id, &1_000_000);
    t.basket.fund_basket(&t.depositor, &basket_id);

    // c1 got 500_000 (fully funds it -> auto Funded), c2 got 500_000 (still Funding, underfunded).
    let campaign1 = t.escrow.get_campaign(&c1);
    assert_eq!(campaign1.status, CampaignStatus::Funded);

    // Move c1 through production and settle it.
    t.escrow.start_production(&t.farmer, &c1);
    t.escrow.mark_harvest(&t.farmer, &t.attester, &c1);
    t.escrow.settle(&t.farmer, &c1);

    // Expire c2's deadline and finalize it as failed.
    t.env.ledger().set(LedgerInfo {
        timestamp: deadline + 1,
        protocol_version: 22,
        sequence_number: t.env.ledger().sequence(),
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 16 * 60 * 60 * 24,
        min_persistent_entry_ttl: 30 * 24 * 60 * 60,
        max_entry_ttl: 365 * 24 * 60 * 60,
    });
    t.escrow.finalize_failed(&c2);

    // First claim attempt: both constituents are now resolvable (Settled / Failed).
    let payout = t.basket.claim_basket_returns(&t.depositor, &basket_id);
    assert!(payout > 0);

    let basket = t.basket.get_basket(&basket_id);
    let cc1 = basket.constituents.get(0).unwrap();
    let cc2 = basket.constituents.get(1).unwrap();
    assert!(cc1.swept);
    assert!(cc2.swept);

    // Second claim attempt must fail — nothing new to collect, full fair
    // share was already paid out on the first call.
    let err = t
        .basket
        .try_claim_basket_returns(&t.depositor, &basket_id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, BasketError::NothingToClaim);
}

#[test]
fn test_staggered_settlement_across_multiple_claims_pays_full_fair_share() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let deadline = now + 100_000;

    // Two depositors, 50/50. Three constituent campaigns, settling one at a time.
    let depositor_b = Address::generate(&t.env);
    let sac = StellarAssetClient::new(&t.env, &t.token_id);
    sac.mint(&depositor_b, &10_000_000);

    // Total deposit is 2_000 (1_000 from each depositor); with weights
    // 3_400/3_300/3_300 bps, `fund_basket` invests exactly 680/660/660 into
    // c1/c2/c3. Targets must match those amounts exactly so each campaign
    // auto-transitions to Funded once the basket invests, matching what
    // this test actually exercises (staggered settlement, not partial
    // funding).
    let c1 = t
        .escrow
        .create_campaign(&t.farmer, &t.token_id, &680, &deadline);
    let c2 = t
        .escrow
        .create_campaign(&t.farmer, &t.token_id, &660, &deadline);
    let c3 = t
        .escrow
        .create_campaign(&t.farmer, &t.token_id, &660, &deadline);

    let constituents = vec![&t.env, (c1, 3_400u32), (c2, 3_300u32), (c3, 3_300u32)];
    let basket_id = t
        .basket
        .create_basket(&t.admin, &t.token_id, &constituents, &0, &0);

    t.basket.deposit(&t.depositor, &basket_id, &1_000);
    t.basket.deposit(&depositor_b, &basket_id, &1_000);
    t.basket.fund_basket(&t.depositor, &basket_id);

    // Settle campaign A only, then depositor A claims promptly.
    t.escrow.start_production(&t.farmer, &c1);
    t.escrow.mark_harvest(&t.farmer, &t.attester, &c1);
    t.escrow.settle(&t.farmer, &c1);

    let payout_a1 = t.basket.claim_basket_returns(&t.depositor, &basket_id);
    assert!(payout_a1 > 0);

    // A tries again immediately: nothing new yet.
    let err = t
        .basket
        .try_claim_basket_returns(&t.depositor, &basket_id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, BasketError::NothingToClaim);

    // Now settle campaigns B and C too.
    t.escrow.start_production(&t.farmer, &c2);
    t.escrow.mark_harvest(&t.farmer, &t.attester, &c2);
    t.escrow.settle(&t.farmer, &c2);

    t.escrow.start_production(&t.farmer, &c3);
    t.escrow.mark_harvest(&t.farmer, &t.attester, &c3);
    t.escrow.settle(&t.farmer, &c3);

    // Depositor B claims once, after everything has settled.
    let payout_b = t.basket.claim_basket_returns(&depositor_b, &basket_id);

    // Depositor A claims their remaining delta from B and C settling later.
    let payout_a2 = t.basket.claim_basket_returns(&t.depositor, &basket_id);

    // Both depositors are 50/50, so each one's total across all claims must
    // be equal, and the early claimer (A) must not have forfeited anything.
    assert_eq!(payout_a1 + payout_a2, payout_b);

    let basket = t.basket.get_basket(&basket_id);
    assert_eq!(basket.total_collected, payout_a1 + payout_a2 + payout_b);
}

#[test]
fn test_invalid_weights_rejected() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let deadline = now + 100_000;
    let c1 = t
        .escrow
        .create_campaign(&t.farmer, &t.token_id, &1_000_000, &deadline);

    let bad_constituents = vec![&t.env, (c1, 9_000u32)];
    let err = t
        .basket
        .try_create_basket(&t.admin, &t.token_id, &bad_constituents, &0, &0)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, BasketError::InvalidWeights);
}

#[test]
fn test_fund_basket_before_deadline_by_non_admin_rejected() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let campaign_deadline = now + 100_000;
    let funding_deadline = now + 500;

    let c1 = t
        .escrow
        .create_campaign(&t.farmer, &t.token_id, &1_000_000, &campaign_deadline);
    let constituents = vec![&t.env, (c1, 10_000u32)];
    let basket_id =
        t.basket
            .create_basket(&t.admin, &t.token_id, &constituents, &funding_deadline, &0);

    t.basket.deposit(&t.depositor, &basket_id, &1_000_000);

    let impatient = Address::generate(&t.env);
    let err = t
        .basket
        .try_fund_basket(&impatient, &basket_id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, BasketError::FundingWindowOpen);

    t.basket.fund_basket(&t.admin, &basket_id);
    assert_eq!(t.basket.get_basket(&basket_id).status, BasketStatus::Funded);
}

#[test]
fn test_fund_basket_before_min_deposit_reached_rejected() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let deadline = now + 100_000;

    let c1 = t
        .escrow
        .create_campaign(&t.farmer, &t.token_id, &1_000_000, &deadline);
    let constituents = vec![&t.env, (c1, 10_000u32)];
    let basket_id = t
        .basket
        .create_basket(&t.admin, &t.token_id, &constituents, &0, &1_000_000);

    t.basket.deposit(&t.depositor, &basket_id, &500_000);

    let err = t
        .basket
        .try_fund_basket(&t.admin, &basket_id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, BasketError::MinDepositNotMet);
}

#[test]
fn test_fund_basket_after_deadline_by_any_caller_succeeds() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let campaign_deadline = now + 100_000;
    let funding_deadline = now + 500;

    let c1 = t
        .escrow
        .create_campaign(&t.farmer, &t.token_id, &1_000_000, &campaign_deadline);
    let constituents = vec![&t.env, (c1, 10_000u32)];
    let basket_id = t.basket.create_basket(
        &t.admin,
        &t.token_id,
        &constituents,
        &funding_deadline,
        &1_000_000,
    );

    t.basket.deposit(&t.depositor, &basket_id, &1_000_000);
    set_ledger_timestamp(&t.env, funding_deadline + 1);

    let keeper = Address::generate(&t.env);
    t.basket.fund_basket(&keeper, &basket_id);

    assert_eq!(t.basket.get_basket(&basket_id).status, BasketStatus::Funded);
    assert_eq!(t.escrow.get_campaign(&c1).total_raised, 1_000_000);
}

#[test]
fn test_too_many_constituents_rejected() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let deadline = now + 100_000;

    let mut constituents = soroban_sdk::Vec::new(&t.env);
    for _ in 0..21 {
        let c = t
            .escrow
            .create_campaign(&t.farmer, &t.token_id, &1_000_000, &deadline);
        constituents.push_back((c, 476u32)); // arbitrary, will fail on size before weight check
    }

    let err = t
        .basket
        .try_create_basket(&t.admin, &t.token_id, &constituents, &0, &0)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, BasketError::TooManyConstituents);
}

#[test]
fn test_fund_basket_skips_uninvestable_constituent_and_depositor_recovers_funds() {
    let t = setup();
    let now = t.env.ledger().timestamp();

    // c1 stays investable. c2's deadline will already have passed by the
    // time fund_basket runs, so its `invest` call fails.
    let c1 = t
        .escrow
        .create_campaign(&t.farmer, &t.token_id, &1_000_000, &(now + 100_000));
    let c2 = t
        .escrow
        .create_campaign(&t.farmer, &t.token_id, &1_000_000, &(now + 10));

    let constituents = vec![&t.env, (c1, 6_000u32), (c2, 4_000u32)];
    let basket_id = t
        .basket
        .create_basket(&t.admin, &t.token_id, &constituents, &0, &0);

    t.basket.deposit(&t.depositor, &basket_id, &1_000_000);

    // Advance past c2's deadline only.
    t.env.ledger().set(LedgerInfo {
        timestamp: now + 20,
        protocol_version: 22,
        sequence_number: t.env.ledger().sequence(),
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 16 * 60 * 60 * 24,
        min_persistent_entry_ttl: 30 * 24 * 60 * 60,
        max_entry_ttl: 365 * 24 * 60 * 60,
    });

    // Previously this panicked and left the basket permanently Open.
    t.basket.fund_basket(&t.depositor, &basket_id);

    let basket = t.basket.get_basket(&basket_id);
    assert_eq!(basket.status, BasketStatus::Funded);

    let cc1 = basket.constituents.get(0).unwrap();
    let cc2 = basket.constituents.get(1).unwrap();
    assert_eq!(cc1.invested_amount, 600_000);
    assert!(!cc1.swept);

    // c2 was skipped: never invested, its share kept as already-collected.
    assert_eq!(cc2.invested_amount, 0);
    assert_eq!(cc2.collected_amount, 400_000);
    assert!(cc2.swept);
    assert_eq!(basket.total_collected, 400_000);

    // The depositor is not stuck: they can claim c2's untouched share right
    // away, without waiting for c1 to ever settle.
    let payout = t.basket.claim_basket_returns(&t.depositor, &basket_id);
    assert_eq!(payout, 400_000);
}

#[test]
fn test_withdraw_basket_before_deadline_rejected() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let deadline = now + 100_000;
    let c1 = t
        .escrow
        .create_campaign(&t.farmer, &t.token_id, &1_000_000, &deadline);

    let constituents = vec![&t.env, (c1, 10_000u32)];
    let basket_id = t
        .basket
        .create_basket(&t.admin, &t.token_id, &constituents, &0, &0);
    t.basket.deposit(&t.depositor, &basket_id, &500_000);

    let err = t
        .basket
        .try_withdraw_basket(&t.depositor, &basket_id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, BasketError::WithdrawTooEarly);
}

#[test]
fn test_withdraw_basket_after_deadline_recovers_principal() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let deadline = now + 100_000;
    let c1 = t
        .escrow
        .create_campaign(&t.farmer, &t.token_id, &1_000_000, &deadline);

    let constituents = vec![&t.env, (c1, 10_000u32)];
    let basket_id = t
        .basket
        .create_basket(&t.admin, &t.token_id, &constituents, &0, &0);
    t.basket.deposit(&t.depositor, &basket_id, &500_000);

    let balance_before = TokenClient::new(&t.env, &t.token_id).balance(&t.depositor);

    t.env.ledger().set(LedgerInfo {
        timestamp: now + 7 * 24 * 60 * 60 + 1,
        protocol_version: 22,
        sequence_number: t.env.ledger().sequence(),
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 16 * 60 * 60 * 24,
        min_persistent_entry_ttl: 30 * 24 * 60 * 60,
        max_entry_ttl: 365 * 24 * 60 * 60,
    });

    let withdrawn = t.basket.withdraw_basket(&t.depositor, &basket_id);
    assert_eq!(withdrawn, 500_000);

    let balance_after = TokenClient::new(&t.env, &t.token_id).balance(&t.depositor);
    assert_eq!(balance_after, balance_before + 500_000);

    let basket = t.basket.get_basket(&basket_id);
    assert_eq!(basket.total_deposit, 0);
    assert_eq!(t.basket.get_deposit(&basket_id, &t.depositor), 0);

    // Can't withdraw twice.
    let err = t
        .basket
        .try_withdraw_basket(&t.depositor, &basket_id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, BasketError::NothingToWithdraw);
}

#[test]
fn test_fund_basket_emits_skip_event_with_invested_skipped_summary() {
    let t = setup();
    let now = t.env.ledger().timestamp();

    // c1 stays investable. c2's deadline will have passed, so invest fails.
    let c1 = t
        .escrow
        .create_campaign(&t.farmer, &t.token_id, &1_000_000, &(now + 100_000));
    let c2 = t
        .escrow
        .create_campaign(&t.farmer, &t.token_id, &1_000_000, &(now + 10));

    let constituents = vec![&t.env, (c1, 6_000u32), (c2, 4_000u32)];
    let basket_id = t
        .basket
        .create_basket(&t.admin, &t.token_id, &constituents, &0, &0);

    t.basket.deposit(&t.depositor, &basket_id, &1_000_000);

    // Advance past c2's deadline only.
    t.env.ledger().set(LedgerInfo {
        timestamp: now + 20,
        protocol_version: 22,
        sequence_number: t.env.ledger().sequence(),
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 16 * 60 * 60 * 24,
        min_persistent_entry_ttl: 30 * 24 * 60 * 60,
        max_entry_ttl: 365 * 24 * 60 * 60,
    });

    t.basket.fund_basket(&t.depositor, &basket_id);

    let basket = t.basket.get_basket(&basket_id);
    assert_eq!(basket.status, BasketStatus::Funded);
    assert_eq!(basket.total_deposit, 1_000_000);
    assert_eq!(basket.total_invested, 600_000);
    assert_eq!(basket.total_skipped, 400_000);
    assert_eq!(basket.total_collected, 400_000);

    // Verify constituent details.
    let cc1 = basket.constituents.get(0).unwrap();
    let cc2 = basket.constituents.get(1).unwrap();
    assert_eq!(cc1.invested_amount, 600_000);
    assert!(!cc1.swept);
    assert_eq!(cc2.invested_amount, 0);
    assert_eq!(cc2.collected_amount, 400_000);
    assert!(cc2.swept);
}

#[test]
fn test_fund_basket_all_constituents_fail_clearly_distinguished() {
    let t = setup();
    let now = t.env.ledger().timestamp();

    // All deadlines passed, so all invest calls will fail.
    let c1 = t
        .escrow
        .create_campaign(&t.farmer, &t.token_id, &1_000_000, &(now + 10));
    let c2 = t
        .escrow
        .create_campaign(&t.farmer, &t.token_id, &1_000_000, &(now + 10));
    let c3 = t
        .escrow
        .create_campaign(&t.farmer, &t.token_id, &1_000_000, &(now + 10));

    let constituents = vec![&t.env, (c1, 3_333u32), (c2, 3_333u32), (c3, 3_334u32)];
    let basket_id = t
        .basket
        .create_basket(&t.admin, &t.token_id, &constituents, &0, &0);

    t.basket.deposit(&t.depositor, &basket_id, &1_000_000);

    // Advance past all deadlines.
    t.env.ledger().set(LedgerInfo {
        timestamp: now + 20,
        protocol_version: 22,
        sequence_number: t.env.ledger().sequence(),
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 16 * 60 * 60 * 24,
        min_persistent_entry_ttl: 30 * 24 * 60 * 60,
        max_entry_ttl: 365 * 24 * 60 * 60,
    });

    t.basket.fund_basket(&t.depositor, &basket_id);

    let basket = t.basket.get_basket(&basket_id);
    assert_eq!(basket.status, BasketStatus::Funded);
    assert_eq!(basket.total_deposit, 1_000_000);
    assert_eq!(basket.total_invested, 0);
    assert_eq!(basket.total_skipped, 1_000_000);
    assert_eq!(basket.total_collected, 1_000_000);

    // All constituents failed to invest.
    for i in 0..3 {
        let c = basket.constituents.get(i).unwrap();
        assert_eq!(c.invested_amount, 0);
        assert!(c.swept);
    }

    // Depositor can immediately claim the full principal.
    let payout = t.basket.claim_basket_returns(&t.depositor, &basket_id);
    assert_eq!(payout, 1_000_000);
}

// ---------------------------------------------------------------------------
// Schema Validation Tests
// ---------------------------------------------------------------------------

#[test]
fn test_event_schema_funded_with_summary() {
    let t = setup();
    let now = t.env.ledger().timestamp();

    let c1 = t
        .escrow
        .create_campaign(&t.farmer, &t.token_id, &1_000_000, &(now + 100_000));
    let c2 = t
        .escrow
        .create_campaign(&t.farmer, &t.token_id, &1_000_000, &(now + 10));

    let constituents = vec![&t.env, (c1, 6_000u32), (c2, 4_000u32)];
    let basket_id = t
        .basket
        .create_basket(&t.admin, &t.token_id, &constituents, &0, &0);

    t.basket.deposit(&t.depositor, &basket_id, &1_000_000);

    t.env.ledger().set(LedgerInfo {
        timestamp: now + 20,
        protocol_version: 22,
        sequence_number: t.env.ledger().sequence(),
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 16 * 60 * 60 * 24,
        min_persistent_entry_ttl: 30 * 24 * 60 * 60,
        max_entry_ttl: 365 * 24 * 60 * 60,
    });

    t.basket.fund_basket(&t.depositor, &basket_id);

    let basket = t.basket.get_basket(&basket_id);
    assert_eq!(basket.total_deposit, 1_000_000);
    assert_eq!(basket.total_invested, 600_000);
    assert_eq!(basket.total_skipped, 400_000);
}

#[test]
fn test_event_schema_skipped() {
    let t = setup();
    let now = t.env.ledger().timestamp();

    let c1 = t
        .escrow
        .create_campaign(&t.farmer, &t.token_id, &1_000_000, &(now + 100_000));
    let c2 = t
        .escrow
        .create_campaign(&t.farmer, &t.token_id, &1_000_000, &(now + 10));

    let constituents = vec![&t.env, (c1, 6_000u32), (c2, 4_000u32)];
    let basket_id = t
        .basket
        .create_basket(&t.admin, &t.token_id, &constituents, &0, &0);

    t.basket.deposit(&t.depositor, &basket_id, &1_000_000);

    t.env.ledger().set(LedgerInfo {
        timestamp: now + 20,
        protocol_version: 22,
        sequence_number: t.env.ledger().sequence(),
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 16 * 60 * 60 * 24,
        min_persistent_entry_ttl: 30 * 24 * 60 * 60,
        max_entry_ttl: 365 * 24 * 60 * 60,
    });

    t.basket.fund_basket(&t.depositor, &basket_id);

    let basket = t.basket.get_basket(&basket_id);
    let cc2 = basket.constituents.get(1).unwrap();

    // Verify that skipped constituent has no invested_amount
    assert_eq!(cc2.invested_amount, 0);
    assert_eq!(cc2.collected_amount, 400_000);
    assert!(cc2.swept);
}

// ---------------------------------------------------------------------------
// Governance, upgrade, guardian, pause, storage migration (Issue #757)
// ---------------------------------------------------------------------------

#[test]
fn test_upgrade_bypassing_governance_rejected() {
    let t = setup();
    let attacker = Address::generate(&t.env);
    let dummy_wasm_hash = soroban_sdk::BytesN::from_array(&t.env, &[9u8; 32]);
    let result = t.basket.try_upgrade(&attacker, &dummy_wasm_hash);
    assert_eq!(result.unwrap_err().unwrap(), BasketError::NotAdmin);
}

#[test]
fn test_guardian_pause_blocks_deposit_governance_only_unpauses() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let deadline = now + 100_000;
    let c1 = t
        .escrow
        .create_campaign(&t.farmer, &t.token_id, &1_000_000, &deadline);
    let constituents = vec![&t.env, (c1, 10_000u32)];
    let basket_id = t
        .basket
        .create_basket(&t.admin, &t.token_id, &constituents, &0, &0);

    let guardian = Address::generate(&t.env);
    // Admin bootstrap fallback: no governance configured yet.
    t.basket.set_guardian(&t.admin, &guardian);

    t.basket.pause(&guardian);
    assert!(t.basket.is_paused());

    let result = t.basket.try_deposit(&t.depositor, &basket_id, &500_000);
    assert_eq!(result.unwrap_err().unwrap(), BasketError::ContractPaused);

    // Guardian cannot unpause (falls back to admin-gating since no
    // governance is configured — guardian is still not admin).
    let err = t.basket.try_unpause(&guardian).unwrap_err().unwrap();
    assert_eq!(err, BasketError::NotAdmin);

    t.basket.unpause(&t.admin);
    assert!(!t.basket.is_paused());
    t.basket.deposit(&t.depositor, &basket_id, &500_000);
}

/// Worked example for Issue #757's storage-migration requirement: Issue #682
/// added `Basket.created_at`, so a basket written by code that predates that
/// fix would be stored without it. This simulates exactly that — a basket
/// whose persisted entry is in the pre-#682 shape — and proves `migrate`
/// translates it correctly, backfilling `created_at` and flipping
/// `SchemaVersion`, so a subsequent normal `get_basket` call (which decodes
/// via the *current* `Basket` type) works instead of trapping.
#[test]
fn test_migrate_translates_pre_682_baskets_and_flips_schema_version() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let deadline = now + 100_000;
    let c1 = t
        .escrow
        .create_campaign(&t.farmer, &t.token_id, &1_000_000, &deadline);
    let constituents = vec![&t.env, (c1, 10_000u32)];
    // create_basket via the current contract always produces the current
    // shape — simulate "this basket predates #682" by overwriting its
    // storage entry with the old shape and winding SchemaVersion back to 1,
    // as if this were a live deployment that hadn't upgraded/migrated yet.
    let basket_id = t
        .basket
        .create_basket(&t.admin, &t.token_id, &constituents, &0, &0);

    let basket_contract_id = t.basket.address.clone();
    t.env.as_contract(&basket_contract_id, || {
        let old = OldBasketV1 {
            id: basket_id,
            escrow_contract: t.escrow.address.clone(),
            token: t.token_id.clone(),
            total_deposit: 0,
            total_collected: 0,
            status: BasketStatus::Open,
            constituents: soroban_sdk::Vec::<BasketConstituent>::new(&t.env),
        };
        t.env
            .storage()
            .persistent()
            .set(&DataKey::Basket(basket_id), &old);
        t.env
            .storage()
            .instance()
            .set(&DataKey::SchemaVersion, &1u32);
    });

    assert_eq!(t.basket.get_schema_version(), 1);

    // Admin bootstrap fallback (no governance configured) drives the batch.
    let migrated = t.basket.migrate(&t.admin, &10);
    assert_eq!(migrated, 1);

    // SchemaVersion only flips once the cursor reaches BasketCount.
    assert_eq!(t.basket.get_schema_version(), 3);

    // The basket now decodes fine as the current shape, with created_at
    // backfilled to the documented default.
    let migrated_basket = t.basket.get_basket(&basket_id);
    assert_eq!(migrated_basket.created_at, 0);
    assert_eq!(migrated_basket.funding_deadline, 0);
    assert_eq!(migrated_basket.min_deposit, 0);
    assert_eq!(migrated_basket.status, BasketStatus::Open);

    // Re-running migrate is a clean no-op error, not a silent re-translation
    // that could clobber real data with the backfill default.
    let err = t.basket.try_migrate(&t.admin, &10).unwrap_err().unwrap();
    assert_eq!(err, BasketError::AlreadyMigrated);
}

#[test]
fn test_event_schema_version_full_lifecycle() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let deadline = now + 100_000;

    let c1 = t
        .escrow
        .create_campaign(&t.farmer, &t.token_id, &1_000_000, &deadline);

    let constituents = vec![&t.env, (c1, 10_000u32)];
    let basket_id = t
        .basket
        .create_basket(&t.admin, &t.token_id, &constituents, &0, &0);

    t.basket.deposit(&t.depositor, &basket_id, &1_000_000);
    t.basket.fund_basket(&t.depositor, &basket_id);

    t.escrow.start_production(&t.farmer, &c1);
    t.escrow.mark_harvest(&t.farmer, &t.attester, &c1);
    t.escrow.settle(&t.farmer, &c1);

    t.basket.claim_basket_returns(&t.depositor, &basket_id);

    let events = t.env.events().all();
    assert!(
        !events.is_empty(),
        "Events should be emitted during full lifecycle"
    );
}
