//! Property-based and invariant tests for the InvestmentBasket contract.
//!
//! # Invariants under test
//!
//! 1. **Deposit conservation**: the sum of all tokens transferred out to
//!    depositors (via `claim_basket_returns` or `withdraw_basket`) must never
//!    exceed the total tokens transferred into the basket contract (total deposits
//!    plus any collection from underlying campaigns). Equivalently:
//!    `sum(payout_i) <= total_collected` for every depositor.
//!
//! 2. **Payout never exceeds collected**: at the moment of every
//!    `claim_basket_returns` call, the per-call payout satisfies:
//!    `payout <= fair_share(total_collected) = total_collected * deposit / total_deposit`.
//!    The cumulative `already_paid` tracking enforces idempotency.
//!
//! 3. **No overpay per depositor**: across multiple `claim_basket_returns`
//!    calls (as more constituents settle), the running total paid to a single
//!    depositor must never exceed their `fair_share` of the basket's
//!    `total_collected` at the time of the final call.
//!
//! # Proptest coverage
//!
//! `test_invariant_payout_never_exceeds_collected_proptest` generates random
//! deposit amounts and constituent configurations and asserts the payout
//! invariant after each claim call.
//!
//! `test_invariant_multi_depositor_proptest` tests multiple depositors in the
//! same basket and asserts that the total paid out never exceeds `total_collected`.

#![cfg(test)]

extern crate std;

use proptest::prelude::*;
use proptest::test_runner::{Config as ProptestConfig, TestRunner};
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, Vec,
};
use std::vec::Vec as StdVec;

use production_escrow_v2::{ProductionEscrowContract, ProductionEscrowContractClient};

use crate::{BasketError, BasketStatus, InvestmentBasketContract, InvestmentBasketContractClient};

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

struct BasketHarness<'a> {
    env: Env,
    basket: InvestmentBasketContractClient<'a>,
    escrow: ProductionEscrowContractClient<'a>,
    token_id: Address,
    admin: Address,
    attester: Address,
    farmer: Address,
    depositors: StdVec<Address>,
    #[allow(dead_code)]
    fee_collector: Address,
}

fn make_basket_harness(num_depositors: usize) -> BasketHarness<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let attester = Address::generate(&env);
    let farmer = Address::generate(&env);
    let fee_collector = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let token_id = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let sac = StellarAssetClient::new(&env, &token_id);

    let mut depositors = StdVec::new();
    for _ in 0..num_depositors {
        let dep = Address::generate(&env);
        sac.mint(&dep, &100_000_000);
        depositors.push(dep);
    }

    let escrow_contract_id = env.register(ProductionEscrowContract, ());
    let escrow = ProductionEscrowContractClient::new(&env, &escrow_contract_id);
    let mut tokens = soroban_sdk::Vec::new(&env);
    tokens.push_back(token_id.clone());
    escrow.initialize(&admin, &tokens, &fee_collector, &0); // 0% fee for clean accounting
    escrow.set_attester(&admin, &attester);

    let basket_contract_id = env.register(InvestmentBasketContract, ());
    let basket = InvestmentBasketContractClient::new(&env, &basket_contract_id);
    basket.initialize(&admin, &escrow_contract_id);

    let env: Env = unsafe { std::mem::transmute(env) };
    let basket: InvestmentBasketContractClient<'static> = unsafe { std::mem::transmute(basket) };
    let escrow: ProductionEscrowContractClient<'static> = unsafe { std::mem::transmute(escrow) };

    BasketHarness {
        env,
        basket,
        escrow,
        token_id,
        admin,
        attester,
        farmer,
        depositors,
        fee_collector,
    }
}

fn advance_basket(h: &BasketHarness<'_>, secs: u64) {
    h.env.ledger().set(LedgerInfo {
        timestamp: h.env.ledger().timestamp() + secs,
        protocol_version: h.env.ledger().protocol_version(),
        sequence_number: h.env.ledger().sequence() + 1,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 1,
        min_persistent_entry_ttl: 1,
        max_entry_ttl: 100_000_001,
    });
}

fn token_balance(h: &BasketHarness<'_>, who: &Address) -> i128 {
    TokenClient::new(&h.env, &h.token_id).balance(who)
}

fn future_deadline(h: &BasketHarness<'_>) -> u64 {
    h.env.ledger().timestamp() + 30 * 24 * 3600
}

// ---------------------------------------------------------------------------
// Helpers for common test patterns
// ---------------------------------------------------------------------------

/// Full lifecycle: create basket → deposit → fund (invests into campaign) →
/// advance campaign through production → settle → ready for claim.
/// Returns (basket_id, campaign_id).
fn create_funded_and_settled_basket(
    h: &BasketHarness<'_>,
    depositor: &Address,
    deposit_amount: i128,
) -> (u64, u64) {
    // Campaign target must equal the deposit so fund_basket can fully invest
    let campaign_target = deposit_amount;
    let deadline = future_deadline(h);

    let campaign_id = h
        .escrow
        .create_campaign(&h.farmer, &h.token_id, &campaign_target, &deadline)
        .expect("create campaign");

    // Create basket pointing at this campaign (100% weight)
    let mut constituents = Vec::new(&h.env);
    constituents.push_back((campaign_id, 10_000u32));
    let basket_id = h
        .basket
        .create_basket(&h.admin, &h.token_id, &constituents)
        .expect("create_basket");

    // Depositor deposits into the basket
    h.basket
        .deposit(depositor, &basket_id, &deposit_amount)
        .expect("deposit");

    // fund_basket → basket invests deposit_amount into the campaign
    h.basket.fund_basket(&h.admin, &basket_id).expect("fund_basket");

    let basket = h.basket.get_basket(&basket_id).expect("get_basket");
    assert_eq!(basket.status, BasketStatus::Funded, "basket must be Funded after fund_basket");

    // Run the campaign through to Settled so claim_basket_returns can sweep
    h.escrow
        .start_production(&h.farmer, &campaign_id)
        .expect("start_production");
    h.escrow
        .mark_harvest(&h.farmer, &h.attester, &campaign_id)
        .expect("mark_harvest");
    h.escrow.settle(&h.farmer, &campaign_id).expect("settle");

    (basket_id, campaign_id)
}

// ---------------------------------------------------------------------------
// Invariant 1: Deposit conservation
// ---------------------------------------------------------------------------

/// Total tokens flowing out of the basket must never exceed what flowed in.
#[test]
fn test_invariant_deposit_conservation_single_depositor() {
    let h = make_basket_harness(1);
    let deposit = 10_000i128;

    let (basket_id, _) =
        create_funded_and_settled_basket(&h, &h.depositors[0], deposit);

    let depositor_before = token_balance(&h, &h.depositors[0]);

    let payout = h
        .basket
        .claim_basket_returns(&h.depositors[0], &basket_id)
        .expect("claim_basket_returns");
    assert!(payout > 0, "payout must be positive");

    let depositor_after = token_balance(&h, &h.depositors[0]);
    assert_eq!(depositor_after - depositor_before, payout);

    // Conservation: payout <= total_collected (which came from the campaign)
    let basket_after = h.basket.get_basket(&basket_id).expect("get_basket");
    assert!(
        payout <= basket_after.total_collected,
        "INVARIANT VIOLATED: depositor payout ({}) > total_collected ({})",
        payout,
        basket_after.total_collected
    );
}

/// For a failed campaign (underfunded), depositor gets their principal back.
#[test]
fn test_invariant_deposit_conservation_failed_campaign_refund() {
    let h = make_basket_harness(1);
    let deposit = 5_000i128;
    // Target is larger than deposit so campaign will remain underfunded → Failed
    let campaign_target = 10_000i128;
    let deadline = h.env.ledger().timestamp() + 60;

    let campaign_id = h
        .escrow
        .create_campaign(&h.farmer, &h.token_id, &campaign_target, &deadline)
        .expect("create campaign");

    let mut constituents = Vec::new(&h.env);
    constituents.push_back((campaign_id, 10_000u32));
    let basket_id = h
        .basket
        .create_basket(&h.admin, &h.token_id, &constituents)
        .expect("create_basket");

    h.basket
        .deposit(&h.depositors[0], &basket_id, &deposit)
        .expect("deposit");

    // fund_basket: invests deposit into the (still Funding) campaign
    h.basket.fund_basket(&h.admin, &basket_id).expect("fund_basket");

    // Advance past deadline → campaign is still Funding → finalize_failed
    advance_basket(&h, 120);
    h.escrow.finalize_failed(&campaign_id).expect("finalize_failed");

    let depositor_before = token_balance(&h, &h.depositors[0]);

    // Claim: basket sweeps refund from failed campaign
    let payout = h
        .basket
        .claim_basket_returns(&h.depositors[0], &basket_id)
        .expect("claim_basket_returns");

    let depositor_after = token_balance(&h, &h.depositors[0]);
    assert_eq!(depositor_after - depositor_before, payout);

    // Conservation: payout <= total_collected
    let basket_final = h.basket.get_basket(&basket_id).expect("get_basket");
    assert!(
        payout <= basket_final.total_collected,
        "payout ({}) exceeds total_collected ({})",
        payout,
        basket_final.total_collected
    );
    // The full deposit should be returned since no tranches were released
    assert_eq!(payout, deposit, "full deposit must be returned when campaign fails before funding target");
}

// ---------------------------------------------------------------------------
// Invariant 2: Payout never exceeds collected at any call
// ---------------------------------------------------------------------------

#[test]
fn test_invariant_payout_never_exceeds_collected_per_call() {
    let h = make_basket_harness(1);
    let deposit = 10_000i128;

    let (basket_id, _) = create_funded_and_settled_basket(&h, &h.depositors[0], deposit);

    let payout = h
        .basket
        .claim_basket_returns(&h.depositors[0], &basket_id)
        .expect("claim_basket_returns");

    let basket = h.basket.get_basket(&basket_id).expect("get_basket");
    assert!(
        payout <= basket.total_collected,
        "payout ({}) exceeds total_collected ({}) on single call",
        payout,
        basket.total_collected
    );
}

/// Proptest: for any positive deposit amount, the first-call payout <=
/// total_collected.
#[test]
fn test_invariant_payout_never_exceeds_collected_proptest() {
    let runner = TestRunner::new(ProptestConfig {
        cases: 15,
        ..ProptestConfig::default()
    });

    runner
        .run(&(1_000i128..=50_000i128), |deposit_amount| {
            let h = make_basket_harness(1);
            let (basket_id, _) =
                create_funded_and_settled_basket(&h, &h.depositors[0], deposit_amount);

            let payout = h
                .basket
                .claim_basket_returns(&h.depositors[0], &basket_id)
                .expect("claim");

            let basket = h.basket.get_basket(&basket_id).expect("get_basket");
            assert!(
                payout <= basket.total_collected,
                "payout ({}) exceeds total_collected ({}) for deposit={}",
                payout,
                basket.total_collected,
                deposit_amount
            );
            Ok(())
        })
        .expect("payout-never-exceeds-collected proptest failed");
}

// ---------------------------------------------------------------------------
// Invariant 3: No overpay per depositor (cumulative)
// ---------------------------------------------------------------------------

/// A depositor calling claim_basket_returns multiple times must never receive
/// more than their fair share of the final total_collected.
#[test]
fn test_invariant_no_overpay_repeatable_claims() {
    let h = make_basket_harness(1);
    let deposit = 10_000i128;

    let (basket_id, _) = create_funded_and_settled_basket(&h, &h.depositors[0], deposit);

    // First claim — campaign is already settled so everything is swept
    let payout1 = h
        .basket
        .claim_basket_returns(&h.depositors[0], &basket_id)
        .expect("first claim");
    assert!(payout1 > 0, "first claim must yield something");

    // Second claim — already_paid covers all of fair_share; must be NothingToClaim
    let result2 = h
        .basket
        .try_claim_basket_returns(&h.depositors[0], &basket_id);

    match result2 {
        Err(Ok(BasketError::NothingToClaim)) => {
            // Expected: full fair share was already paid
        }
        Ok(payout2) => {
            // If unexpectedly some more was collectible, total must still be bounded
            let basket = h.basket.get_basket(&basket_id).expect("get_basket");
            let fair_share =
                (basket.total_collected * deposit) / basket.total_deposit;
            let total_paid = payout1 + payout2;
            assert!(
                total_paid <= fair_share,
                "INVARIANT VIOLATED: total_paid ({}) > fair_share ({}) across two claims",
                total_paid,
                fair_share
            );
        }
        other => panic!("unexpected result: {:?}", other),
    }
}

/// Multi-depositor: the sum of all depositor payouts must not exceed
/// total_collected.
#[test]
fn test_invariant_multi_depositor_total_payout_bounded() {
    let h = make_basket_harness(3);

    // Each depositor will have their own basket for isolation, but they all
    // invest in the same campaign via a shared basket.
    let per_deposit = 3_000i128;
    let total_deposit = per_deposit * 3;
    let campaign_target = total_deposit;
    let deadline = future_deadline(&h);

    let campaign_id = h
        .escrow
        .create_campaign(&h.farmer, &h.token_id, &campaign_target, &deadline)
        .expect("create campaign");

    let mut constituents = Vec::new(&h.env);
    constituents.push_back((campaign_id, 10_000u32));
    let basket_id = h
        .basket
        .create_basket(&h.admin, &h.token_id, &constituents)
        .expect("create_basket");

    // Each depositor deposits their share
    for dep in &h.depositors {
        h.basket
            .deposit(dep, &basket_id, &per_deposit)
            .expect("deposit");
    }

    // Fund the basket (invests total_deposit into the campaign)
    h.basket.fund_basket(&h.admin, &basket_id).expect("fund_basket");

    // Run campaign through to Settled
    h.escrow.start_production(&h.farmer, &campaign_id).expect("start_production");
    h.escrow.mark_harvest(&h.farmer, &h.attester, &campaign_id).expect("mark_harvest");
    h.escrow.settle(&h.farmer, &campaign_id).expect("settle");

    let mut total_paid = 0i128;
    for dep in &h.depositors {
        let payout = h
            .basket
            .claim_basket_returns(dep, &basket_id)
            .expect("claim");
        total_paid += payout;
    }

    let basket = h.basket.get_basket(&basket_id).expect("get_basket");
    assert!(
        total_paid <= basket.total_collected,
        "INVARIANT VIOLATED: sum of payouts ({}) > total_collected ({})",
        total_paid,
        basket.total_collected
    );
}

/// Proptest: for 2–4 depositors with arbitrary deposit shares, the invariant holds.
#[test]
fn test_invariant_multi_depositor_proptest() {
    let runner = TestRunner::new(ProptestConfig {
        cases: 12,
        ..ProptestConfig::default()
    });

    runner
        .run(
            &proptest::collection::vec(1_000i128..=5_000i128, 2usize..=4usize),
            |deposits| {
                let num = deposits.len();
                let h = make_basket_harness(num);
                let total_deposit: i128 = deposits.iter().sum();
                let campaign_target = total_deposit;
                let deadline = future_deadline(&h);

                let campaign_id = h
                    .escrow
                    .create_campaign(&h.farmer, &h.token_id, &campaign_target, &deadline)
                    .expect("create campaign");

                let mut constituents = Vec::new(&h.env);
                constituents.push_back((campaign_id, 10_000u32));
                let basket_id = h
                    .basket
                    .create_basket(&h.admin, &h.token_id, &constituents)
                    .expect("create_basket");

                for (i, &dep_amount) in deposits.iter().enumerate() {
                    h.basket
                        .deposit(&h.depositors[i], &basket_id, &dep_amount)
                        .expect("deposit");
                }

                h.basket.fund_basket(&h.admin, &basket_id).expect("fund_basket");

                // Settle the campaign
                h.escrow.start_production(&h.farmer, &campaign_id).expect("start_production");
                h.escrow.mark_harvest(&h.farmer, &h.attester, &campaign_id).expect("mark_harvest");
                h.escrow.settle(&h.farmer, &campaign_id).expect("settle");

                let mut total_paid = 0i128;
                for (i, _) in deposits.iter().enumerate() {
                    match h
                        .basket
                        .try_claim_basket_returns(&h.depositors[i], &basket_id)
                    {
                        Ok(payout) => {
                            total_paid += payout;
                        }
                        Err(Ok(BasketError::NothingToClaim)) => {
                            // Rounding can leave tiny amounts uncollectible — acceptable
                        }
                        Err(e) => panic!("unexpected claim error: {:?}", e),
                    }
                }

                let basket = h.basket.get_basket(&basket_id).expect("get_basket");
                assert!(
                    total_paid <= basket.total_collected,
                    "multi-depositor invariant: total_paid ({}) > total_collected ({})",
                    total_paid,
                    basket.total_collected
                );
                Ok(())
            },
        )
        .expect("multi-depositor proptest failed");
}

// ---------------------------------------------------------------------------
// Invariant: no-overpay per depositor (fair_share bound)
// ---------------------------------------------------------------------------

/// A single depositor's cumulative payout must never exceed
/// `(total_collected * deposit) / total_deposit`.
#[test]
fn test_invariant_per_depositor_fair_share_not_exceeded() {
    let h = make_basket_harness(2);

    let d0_amount = 7_000i128;
    let d1_amount = 3_000i128;
    let total_deposit = d0_amount + d1_amount;
    let campaign_target = total_deposit;
    let deadline = future_deadline(&h);

    let campaign_id = h
        .escrow
        .create_campaign(&h.farmer, &h.token_id, &campaign_target, &deadline)
        .expect("create campaign");

    let mut constituents = Vec::new(&h.env);
    constituents.push_back((campaign_id, 10_000u32));
    let basket_id = h
        .basket
        .create_basket(&h.admin, &h.token_id, &constituents)
        .expect("create_basket");

    h.basket
        .deposit(&h.depositors[0], &basket_id, &d0_amount)
        .expect("deposit 0");
    h.basket
        .deposit(&h.depositors[1], &basket_id, &d1_amount)
        .expect("deposit 1");
    h.basket.fund_basket(&h.admin, &basket_id).expect("fund_basket");

    h.escrow.start_production(&h.farmer, &campaign_id).expect("start_production");
    h.escrow.mark_harvest(&h.farmer, &h.attester, &campaign_id).expect("mark_harvest");
    h.escrow.settle(&h.farmer, &campaign_id).expect("settle");

    let payout0 = h
        .basket
        .claim_basket_returns(&h.depositors[0], &basket_id)
        .expect("claim 0");
    let payout1 = h
        .basket
        .claim_basket_returns(&h.depositors[1], &basket_id)
        .expect("claim 1");

    let basket = h.basket.get_basket(&basket_id).expect("get_basket");
    let collected = basket.total_collected;

    let fair_share_0 = (collected * d0_amount) / total_deposit;
    let fair_share_1 = (collected * d1_amount) / total_deposit;

    assert!(
        payout0 <= fair_share_0,
        "depositor 0 overpaid: payout={} > fair_share={}",
        payout0,
        fair_share_0
    );
    assert!(
        payout1 <= fair_share_1,
        "depositor 1 overpaid: payout={} > fair_share={}",
        payout1,
        fair_share_1
    );
    // Total must be bounded too
    assert!(payout0 + payout1 <= collected);
}

// ---------------------------------------------------------------------------
// Invariant: uninvestable constituents → principal returned dollar-for-dollar
// ---------------------------------------------------------------------------

/// When fund_basket skips a constituent (campaign already Failed/past deadline),
/// that share is credited to total_collected immediately so the depositor
/// gets their principal back via claim_basket_returns without admin action.
#[test]
fn test_invariant_uninvestable_constituent_principal_returned() {
    let h = make_basket_harness(1);

    // Campaign that will be Failed before fund_basket runs
    let deadline_soon = h.env.ledger().timestamp() + 10;
    let dead_target = 10_000i128;
    let campaign_dead = h
        .escrow
        .create_campaign(&h.farmer, &h.token_id, &dead_target, &deadline_soon)
        .expect("create dead campaign");

    // Campaign that will succeed — deposit 5_000, target 5_000
    let live_target = 5_000i128;
    let live_deadline = future_deadline(&h);
    let campaign_live = h
        .escrow
        .create_campaign(&h.farmer, &h.token_id, &live_target, &live_deadline)
        .expect("create live campaign");

    // Create a basket with 50% in dead campaign, 50% in live campaign
    // The total deposit will be 10_000 (5_000 per constituent)
    let deposit = 10_000i128;
    let mut constituents = Vec::new(&h.env);
    constituents.push_back((campaign_dead, 5_000u32));
    constituents.push_back((campaign_live, 5_000u32));

    let basket_id = h
        .basket
        .create_basket(&h.admin, &h.token_id, &constituents)
        .expect("create_basket");

    h.basket
        .deposit(&h.depositors[0], &basket_id, &deposit)
        .expect("deposit");

    // Advance past campaign_dead's deadline and mark it failed
    advance_basket(&h, 20);
    h.escrow.finalize_failed(&campaign_dead).expect("finalize_failed");

    // fund_basket: campaign_dead invest will fail (deadline passed),
    // so its 5_000 share stays in basket and is credited to total_collected
    h.basket.fund_basket(&h.admin, &basket_id).expect("fund_basket");

    let basket_after_fund = h.basket.get_basket(&basket_id).expect("get_basket");
    assert_eq!(basket_after_fund.status, BasketStatus::Funded);
    // Dead constituent's 5_000 should be in total_collected
    assert_eq!(basket_after_fund.total_collected, 5_000);

    let depositor_before = token_balance(&h, &h.depositors[0]);

    // First claim: gets back the 5_000 from the dead constituent immediately
    let payout1 = h
        .basket
        .claim_basket_returns(&h.depositors[0], &basket_id)
        .expect("claim 1");
    assert_eq!(payout1, 5_000, "depositor should immediately recover the dead constituent's share");

    let depositor_after_1 = token_balance(&h, &h.depositors[0]);
    assert_eq!(depositor_after_1 - depositor_before, payout1);

    // Now settle campaign_live so the remaining 5_000 is collectible
    h.escrow.start_production(&h.farmer, &campaign_live).expect("start_production");
    h.escrow.mark_harvest(&h.farmer, &h.attester, &campaign_live).expect("mark_harvest");
    h.escrow.settle(&h.farmer, &campaign_live).expect("settle");

    // Second claim: sweeps the live campaign
    let payout2 = h
        .basket
        .claim_basket_returns(&h.depositors[0], &basket_id)
        .expect("claim 2");
    assert!(payout2 > 0, "second claim must yield additional from live campaign");

    let basket_final = h.basket.get_basket(&basket_id).expect("get_basket");
    let total_paid = payout1 + payout2;

    // Conservation invariant: total paid out <= total collected
    assert!(
        total_paid <= basket_final.total_collected,
        "total_paid ({}) must not exceed total_collected ({})",
        total_paid,
        basket_final.total_collected
    );
}

// ---------------------------------------------------------------------------
// Invariant: withdraw_basket (escape hatch) respects principal conservation
// ---------------------------------------------------------------------------

/// withdraw_basket returns exactly the depositor's contribution, no more, no less.
#[test]
fn test_invariant_withdraw_basket_returns_exact_principal() {
    let h = make_basket_harness(1);

    // Create a basket but never call fund_basket
    let deadline = future_deadline(&h);
    let campaign_id = h
        .escrow
        .create_campaign(&h.farmer, &h.token_id, &10_000, &deadline)
        .expect("create campaign");

    let mut constituents = Vec::new(&h.env);
    constituents.push_back((campaign_id, 10_000u32));
    let basket_id = h
        .basket
        .create_basket(&h.admin, &h.token_id, &constituents)
        .expect("create_basket");

    let deposit = 8_000i128;
    h.basket
        .deposit(&h.depositors[0], &basket_id, &deposit)
        .expect("deposit");

    let balance_before = token_balance(&h, &h.depositors[0]);

    // Too early to withdraw
    let err = h
        .basket
        .try_withdraw_basket(&h.depositors[0], &basket_id)
        .expect_err("withdraw before delay must fail")
        .expect("contract error");
    assert_eq!(err, BasketError::WithdrawTooEarly);

    // Advance past the 7-day withdraw delay
    advance_basket(&h, 7 * 24 * 3600 + 1);

    let payout = h
        .basket
        .withdraw_basket(&h.depositors[0], &basket_id)
        .expect("withdraw_basket must succeed after delay");
    assert_eq!(
        payout, deposit,
        "withdraw must return exactly the deposited amount"
    );

    let balance_after = token_balance(&h, &h.depositors[0]);
    assert_eq!(balance_after - balance_before, deposit);

    // Attempt second withdraw — nothing left
    let err2 = h
        .basket
        .try_withdraw_basket(&h.depositors[0], &basket_id)
        .expect_err("second withdraw must fail")
        .expect("contract error");
    assert_eq!(err2, BasketError::NothingToWithdraw);
}

// ---------------------------------------------------------------------------
// Regression: no-overpay with staggered multi-claim
// ---------------------------------------------------------------------------

/// Regression for the staggered settlement bug class: a depositor who claims
/// early (after only some constituents settle) must not forfeit their
/// remaining entitlement from constituents that settle later.
/// Specifically: `fair_share(total_at_t2) - already_paid(t1)` must be
/// correctly computed as `fair_share(t2) - fair_share(t1)`, not 0.
#[test]
fn test_regression_staggered_claim_no_forfeiture() {
    let h = make_basket_harness(1);
    let deposit = 10_000i128;

    // Two campaigns, 50/50 in a basket, settling at different times
    let c1_target = 5_000i128;
    let c2_target = 5_000i128;
    let deadline = future_deadline(&h);

    let c1 = h.escrow.create_campaign(&h.farmer, &h.token_id, &c1_target, &deadline)
        .expect("create c1");
    let c2 = h.escrow.create_campaign(&h.farmer, &h.token_id, &c2_target, &deadline)
        .expect("create c2");

    let mut constituents = Vec::new(&h.env);
    constituents.push_back((c1, 5_000u32));
    constituents.push_back((c2, 5_000u32));
    let basket_id = h.basket.create_basket(&h.admin, &h.token_id, &constituents)
        .expect("create_basket");

    h.basket.deposit(&h.depositors[0], &basket_id, &deposit).expect("deposit");
    h.basket.fund_basket(&h.admin, &basket_id).expect("fund_basket");

    // Settle only c1 first
    h.escrow.start_production(&h.farmer, &c1).expect("start_production c1");
    h.escrow.mark_harvest(&h.farmer, &h.attester, &c1).expect("mark_harvest c1");
    h.escrow.settle(&h.farmer, &c1).expect("settle c1");

    // Claim after c1 settles (c2 not yet settled)
    let payout1 = h.basket.claim_basket_returns(&h.depositors[0], &basket_id)
        .expect("claim after c1");
    assert!(payout1 > 0);

    // Now settle c2
    h.escrow.start_production(&h.farmer, &c2).expect("start_production c2");
    h.escrow.mark_harvest(&h.farmer, &h.attester, &c2).expect("mark_harvest c2");
    h.escrow.settle(&h.farmer, &c2).expect("settle c2");

    // Second claim should yield additional (not NothingToClaim)
    let payout2 = h.basket.claim_basket_returns(&h.depositors[0], &basket_id)
        .expect("claim after c2 — must not forfeit remaining entitlement");
    assert!(
        payout2 > 0,
        "REGRESSION: staggered claim forfeited remaining entitlement after c2 settled"
    );

    // Total conservation
    let basket_final = h.basket.get_basket(&basket_id).expect("get_basket");
    let total_paid = payout1 + payout2;
    assert!(
        total_paid <= basket_final.total_collected,
        "total_paid ({}) must not exceed total_collected ({})",
        total_paid,
        basket_final.total_collected
    );
}
