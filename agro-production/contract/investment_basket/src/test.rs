#![cfg(test)]

extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, Env,
};

use production_escrow_v2::{
    CampaignStatus, ProductionEscrowContract, ProductionEscrowContractClient,
};

use crate::{BasketError, BasketStatus, InvestmentBasketContract, InvestmentBasketContractClient};

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

    let env: Env = unsafe { std::mem::transmute(env) };
    let basket: InvestmentBasketContractClient<'static> =
        unsafe { std::mem::transmute(basket) };
    let escrow: ProductionEscrowContractClient<'static> =
        unsafe { std::mem::transmute(escrow) };

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

#[test]
fn test_create_basket_and_deposit_splits_across_campaigns() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let deadline = now + 100_000;

    let c1 = t.escrow.create_campaign(&t.farmer, &t.token_id, &1_000_000, &deadline);
    let c2 = t.escrow.create_campaign(&t.farmer, &t.token_id, &1_000_000, &deadline);

    let constituents = vec![&t.env, (c1, 6_000u32), (c2, 4_000u32)];
    let basket_id = t.basket.create_basket(&t.admin, &t.token_id, &constituents);

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
    let c1 = t.escrow.create_campaign(&t.farmer, &t.token_id, &500_000, &deadline);
    let c2 = t.escrow.create_campaign(&t.farmer, &t.token_id, &10_000_000, &deadline);

    let constituents = vec![&t.env, (c1, 5_000u32), (c2, 5_000u32)];
    let basket_id = t.basket.create_basket(&t.admin, &t.token_id, &constituents);

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

    let c1 = t.escrow.create_campaign(&t.farmer, &t.token_id, &3_000, &deadline);
    let c2 = t.escrow.create_campaign(&t.farmer, &t.token_id, &2_000, &deadline);
    let c3 = t.escrow.create_campaign(&t.farmer, &t.token_id, &2_000, &deadline);

    let constituents = vec![&t.env, (c1, 3_400u32), (c2, 3_300u32), (c3, 3_300u32)];
    let basket_id = t.basket.create_basket(&t.admin, &t.token_id, &constituents);

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
    let c1 = t.escrow.create_campaign(&t.farmer, &t.token_id, &1_000_000, &deadline);

    let bad_constituents = vec![&t.env, (c1, 9_000u32)];
    let err = t
        .basket
        .try_create_basket(&t.admin, &t.token_id, &bad_constituents)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, BasketError::InvalidWeights);
}

#[test]
fn test_too_many_constituents_rejected() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let deadline = now + 100_000;

    let mut constituents = soroban_sdk::Vec::new(&t.env);
    for _ in 0..21 {
        let c = t.escrow.create_campaign(&t.farmer, &t.token_id, &1_000_000, &deadline);
        constituents.push_back((c, 476u32)); // arbitrary, will fail on size before weight check
    }

    let err = t
        .basket
        .try_create_basket(&t.admin, &t.token_id, &constituents)
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
    let c1 = t.escrow.create_campaign(&t.farmer, &t.token_id, &1_000_000, &(now + 100_000));
    let c2 = t.escrow.create_campaign(&t.farmer, &t.token_id, &1_000_000, &(now + 10));

    let constituents = vec![&t.env, (c1, 6_000u32), (c2, 4_000u32)];
    let basket_id = t.basket.create_basket(&t.admin, &t.token_id, &constituents);

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
    let c1 = t.escrow.create_campaign(&t.farmer, &t.token_id, &1_000_000, &deadline);

    let constituents = vec![&t.env, (c1, 10_000u32)];
    let basket_id = t.basket.create_basket(&t.admin, &t.token_id, &constituents);
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
    let c1 = t.escrow.create_campaign(&t.farmer, &t.token_id, &1_000_000, &deadline);

    let constituents = vec![&t.env, (c1, 10_000u32)];
    let basket_id = t.basket.create_basket(&t.admin, &t.token_id, &constituents);
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
