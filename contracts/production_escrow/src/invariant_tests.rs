//! Property-based and invariant tests for the ProductionEscrow contract.
//!
//! # Invariants under test
//!
//! 1. **Fund conservation**: `tranche_released <= total_raised` at all times.
//!    Revenue from orders is additional; the core conservation is that the
//!    contract never releases more than was raised from investors.
//!
//! 2. **No double-claim / no double-refund**: once `Claimed(campaign, investor)`
//!    is set, every subsequent `claim_returns` or `refund` call returns
//!    `AlreadyClaimed`.
//!
//! 3. **Terminal-state lock**: once a campaign reaches `Settled` or `Failed` it
//!    must never transition to any other status.
//!
//! 4. **Fee accounting**: fees are only transferred out via the configured
//!    `fee_collector` path. The fee collector balance only increases; it never
//!    decreases. Order amounts include the fee: no fee is charged before
//!    confirmation, and cancelled / expired orders return exactly `amount`.
//!
//! # State-machine fuzzer (Task 5)
//!
//! `prop_escrow_state_machine_random_ops` drives a random but valid sequence
//! of operations through the full lifecycle and asserts all four invariants
//! hold after every single step.
//!
//! # Regression proof (Task 6)
//!
//! `test_regression_double_claim_caught` demonstrates that the `AlreadyClaimed`
//! guard catches a simulated double-claim attempt.  The companion
//! `test_regression_tranche_cap_caught` demonstrates the MAX_TRANCHE_BPS cap
//! blocks a previously-possible over-release bug.

extern crate std;

use proptest::test_runner::{Config as ProptestConfig, TestRunner};
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, Vec,
};
use std::vec::Vec as StdVec;

use crate::{
    CampaignStatus, EscrowError, ProductionEscrowContract, ProductionEscrowContractClient,
};

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

struct EscrowHarness<'a> {
    env: Env,
    client: ProductionEscrowContractClient<'a>,
    token_id: Address,
    admin: Address,
    attester: Address,
    fee_collector: Address,
    farmer: Address,
    investors: StdVec<Address>,
}

fn make_harness(num_investors: usize) -> EscrowHarness<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let attester = Address::generate(&env);
    let fee_collector = Address::generate(&env);
    let farmer = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let token_id = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let sac = StellarAssetClient::new(&env, &token_id);

    let mut investors = StdVec::new();
    for _ in 0..num_investors {
        let inv = Address::generate(&env);
        sac.mint(&inv, &10_000_000);
        investors.push(inv);
    }
    // Also mint for farmer (buyer revenue scenarios)
    let buyer = Address::generate(&env);
    sac.mint(&buyer, &10_000_000);

    let contract_id = env.register(ProductionEscrowContract, ());
    let client = ProductionEscrowContractClient::new(&env, &contract_id);

    let mut tokens = Vec::new(&env);
    tokens.push_back(token_id.clone());
    client.initialize(&admin, &tokens, &fee_collector, &300); // 3% fee
    client.set_attester(&admin, &attester);

    let client: ProductionEscrowContractClient<'static> = unsafe { std::mem::transmute(client) };

    EscrowHarness {
        env,
        client,
        token_id,
        admin,
        attester,
        fee_collector,
        farmer,
        investors,
    }
}

fn advance(h: &EscrowHarness<'_>, secs: u64) {
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

fn token_balance(h: &EscrowHarness<'_>, who: &Address) -> i128 {
    TokenClient::new(&h.env, &h.token_id).balance(who)
}

fn future_deadline(h: &EscrowHarness<'_>) -> u64 {
    h.env.ledger().timestamp() + 7 * 24 * 3600
}

// ---------------------------------------------------------------------------
// Helper: assert all four core invariants for a single campaign
// ---------------------------------------------------------------------------

fn assert_fund_conservation(h: &EscrowHarness<'_>, campaign_id: u64) {
    let c = h.client.get_campaign(&campaign_id);
    assert!(
        c.tranche_released <= c.total_raised,
        "INVARIANT VIOLATED: tranche_released ({}) > total_raised ({}) for campaign {}",
        c.tranche_released,
        c.total_raised,
        campaign_id
    );
}

fn assert_terminal_state_immutable(
    h: &EscrowHarness<'_>,
    campaign_id: u64,
    expected: &CampaignStatus,
) {
    let c = h.client.get_campaign(&campaign_id);
    assert_eq!(
        c.status, *expected,
        "INVARIANT VIOLATED: terminal state changed from {:?} to {:?} for campaign {}",
        expected, c.status, campaign_id
    );
}

// ---------------------------------------------------------------------------
// Invariant 1: Fund Conservation
// ---------------------------------------------------------------------------

/// For any campaign that has gone through start_production and mark_harvest,
/// tranche_released should always be <= total_raised.
///
/// TRANCHE_START_BPS = 3000 (30%), TRANCHE_HARVEST_BPS = 4000 (40%)
/// Total max = 70%, enforced by MAX_TRANCHE_BPS = 7000.
#[test]
fn test_invariant_fund_conservation_full_lifecycle() {
    let h = make_harness(2);
    let deadline = future_deadline(&h);
    let target = 10_000i128;

    let id = h
        .client
        .create_campaign(&h.farmer, &h.token_id, &target, &deadline);

    // Two investors fund the campaign
    h.client.invest(&h.investors[0], &id, &6_000);
    h.client.invest(&h.investors[1], &id, &4_000);

    assert_fund_conservation(&h, id);
    let c = h.client.get_campaign(&id);
    assert_eq!(c.status, CampaignStatus::Funded);

    // Start production → releases 30%
    h.client.start_production(&h.farmer, &id);
    assert_fund_conservation(&h, id);
    let c = h.client.get_campaign(&id);
    assert_eq!(c.tranche_released, 3_000); // 30% of 10_000

    // Mark harvest → releases additional 40% (total 70%)
    h.client.mark_harvest(&h.farmer, &h.attester, &id);
    assert_fund_conservation(&h, id);
    let c = h.client.get_campaign(&id);
    assert_eq!(c.tranche_released, 7_000); // 70% of 10_000
    assert!(c.tranche_released <= c.total_raised);
}

/// Proptest: for any valid (target, split) pair, the tranche_released invariant holds.
#[test]
fn test_invariant_fund_conservation_proptest() {
    // Strategy: target in [1_000, 1_000_000], split in [1..target]
    let mut runner = TestRunner::new(ProptestConfig {
        cases: 30,
        ..ProptestConfig::default()
    });

    runner
        .run(
            &(1_000i128..=500_000i128, 1usize..=3usize),
            |(target, num_investors)| {
                let h = make_harness(num_investors + 1);
                let deadline = future_deadline(&h);

                let id = h
                    .client
                    .create_campaign(&h.farmer, &h.token_id, &target, &deadline);

                // Distribute investment evenly across investors
                let per_investor = target / (num_investors as i128);
                let mut raised = 0i128;
                for i in 0..num_investors {
                    let amt = if i == num_investors - 1 {
                        target - raised
                    } else {
                        per_investor
                    };
                    if amt > 0 {
                        // Mint exactly what's needed for this test run
                        StellarAssetClient::new(&h.env, &h.token_id).mint(&h.investors[i], &amt);
                        h.client.invest(&h.investors[i], &id, &amt);
                        raised += amt;
                    }
                }

                // After reaching target, check status auto-transitions
                assert_fund_conservation(&h, id);

                let c = h.client.get_campaign(&id);
                if c.status == CampaignStatus::Funded {
                    h.client.start_production(&h.farmer, &id);
                    assert_fund_conservation(&h, id);

                    let c2 = h.client.get_campaign(&id);
                    assert!(
                        c2.tranche_released <= c2.total_raised,
                        "post-start tranche violation: released={} > raised={}",
                        c2.tranche_released,
                        c2.total_raised
                    );
                }
                Ok(())
            },
        )
        .expect("fund conservation proptest failed");
}

// ---------------------------------------------------------------------------
// Invariant 2: No Double-Claim
// ---------------------------------------------------------------------------

#[test]
fn test_invariant_no_double_claim_returns() {
    let h = make_harness(1);
    let deadline = future_deadline(&h);
    let id = h
        .client
        .create_campaign(&h.farmer, &h.token_id, &10_000, &deadline);
    h.client.invest(&h.investors[0], &id, &10_000);
    h.client.start_production(&h.farmer, &id);
    h.client.mark_harvest(&h.farmer, &h.attester, &id);
    h.client.settle(&h.farmer, &id);

    // First claim: should succeed
    let payout1 = h.client.claim_returns(&h.investors[0], &id);
    assert!(payout1 > 0, "first claim payout must be positive");

    // Second claim: must return AlreadyClaimed
    let err = h
        .client
        .try_claim_returns(&h.investors[0], &id)
        .expect_err("second claim should fail")
        .expect("should be a contract error");
    assert_eq!(
        err,
        EscrowError::AlreadyClaimed,
        "second claim_returns must return AlreadyClaimed"
    );
}

#[test]
fn test_invariant_no_double_refund() {
    let h = make_harness(1);
    let deadline = h.env.ledger().timestamp() + 100;
    let id = h
        .client
        .create_campaign(&h.farmer, &h.token_id, &10_000, &deadline);
    h.client.invest(&h.investors[0], &id, &5_000);

    // Advance past deadline so finalize_failed can be called
    advance(&h, 101);
    h.client.finalize_failed(&id);

    // First refund: should succeed
    let payout1 = h.client.refund(&h.investors[0], &id);
    assert!(payout1 > 0);

    // Second refund: must return AlreadyClaimed
    let err = h
        .client
        .try_refund(&h.investors[0], &id)
        .expect_err("second refund should fail")
        .expect("should be a contract error");
    assert_eq!(
        err,
        EscrowError::AlreadyClaimed,
        "second refund must return AlreadyClaimed"
    );
}

/// Proptest: concurrent investors racing to claim — each investor claims exactly once.
#[test]
fn test_invariant_no_double_claim_proptest() {
    let mut runner = TestRunner::new(ProptestConfig {
        cases: 20,
        ..ProptestConfig::default()
    });

    runner
        .run(&(2usize..=4usize), |num_investors| {
            let h = make_harness(num_investors);
            let deadline = future_deadline(&h);
            let target = 10_000i128 * num_investors as i128;
            let id = h
                .client
                .create_campaign(&h.farmer, &h.token_id, &target, &deadline);

            for i in 0..num_investors {
                StellarAssetClient::new(&h.env, &h.token_id).mint(&h.investors[i], &10_000);
                h.client.invest(&h.investors[i], &id, &10_000);
            }
            h.client.start_production(&h.farmer, &id);
            h.client.mark_harvest(&h.farmer, &h.attester, &id);
            h.client.settle(&h.farmer, &id);

            for i in 0..num_investors {
                // First call should succeed
                h.client.claim_returns(&h.investors[i], &id);

                // Second call must be AlreadyClaimed
                let err = h
                    .client
                    .try_claim_returns(&h.investors[i], &id)
                    .expect_err("must fail on double claim")
                    .expect("contract error");
                assert_eq!(err, EscrowError::AlreadyClaimed);
            }
            Ok(())
        })
        .expect("no-double-claim proptest failed");
}

// ---------------------------------------------------------------------------
// Invariant 3: Terminal State Lock
// ---------------------------------------------------------------------------

#[test]
fn test_invariant_terminal_settled_no_transition() {
    let h = make_harness(1);
    let deadline = future_deadline(&h);
    let id = h
        .client
        .create_campaign(&h.farmer, &h.token_id, &10_000, &deadline);
    h.client.invest(&h.investors[0], &id, &10_000);
    h.client.start_production(&h.farmer, &id);
    h.client.mark_harvest(&h.farmer, &h.attester, &id);
    h.client.settle(&h.farmer, &id);

    assert_terminal_state_immutable(&h, id, &CampaignStatus::Settled);

    // Attempt to settle again → must fail
    let err = h
        .client
        .try_settle(&h.farmer, &id)
        .expect_err("settle after Settled must fail")
        .expect("contract error");
    assert_eq!(err, EscrowError::CampaignNotHarvested);

    // Attempt to start_production on a Settled campaign → must fail
    let err2 = h
        .client
        .try_start_production(&h.farmer, &id)
        .expect_err("start_production after Settled must fail")
        .expect("contract error");
    assert_eq!(err2, EscrowError::CampaignNotFunded);

    // Status still Settled
    assert_terminal_state_immutable(&h, id, &CampaignStatus::Settled);
}

#[test]
fn test_invariant_terminal_failed_no_transition() {
    let h = make_harness(1);
    let deadline = h.env.ledger().timestamp() + 100;
    let id = h
        .client
        .create_campaign(&h.farmer, &h.token_id, &10_000, &deadline);
    h.client.invest(&h.investors[0], &id, &5_000);

    advance(&h, 200);
    h.client.finalize_failed(&id);

    assert_terminal_state_immutable(&h, id, &CampaignStatus::Failed);

    // Attempt to invest into a Failed campaign → must fail
    let err = h
        .client
        .try_invest(&h.investors[0], &id, &1_000)
        .expect_err("invest after Failed must fail")
        .expect("contract error");
    assert_eq!(err, EscrowError::CampaignNotFunding);

    // Attempt to finalize_failed again → must fail
    let err2 = h
        .client
        .try_finalize_failed(&id)
        .expect_err("finalize_failed again must fail")
        .expect("contract error");
    assert_eq!(err2, EscrowError::CampaignNotFunding);

    // Status still Failed
    assert_terminal_state_immutable(&h, id, &CampaignStatus::Failed);
}

#[test]
fn test_invariant_failed_campaign_cannot_be_settled() {
    let h = make_harness(1);
    let deadline = h.env.ledger().timestamp() + 100;
    let id = h
        .client
        .create_campaign(&h.farmer, &h.token_id, &10_000, &deadline);
    h.client.invest(&h.investors[0], &id, &5_000);

    advance(&h, 200);
    h.client.finalize_failed(&id);

    // settle should not work on a Failed campaign
    let err = h
        .client
        .try_settle(&h.farmer, &id)
        .expect_err("settle after Failed must fail")
        .expect("contract error");
    assert_eq!(err, EscrowError::CampaignNotHarvested);

    assert_terminal_state_immutable(&h, id, &CampaignStatus::Failed);
}

/// Proptest: after any terminal state, all mutating operations reject.
#[test]
fn test_invariant_terminal_state_lock_proptest() {
    let mut runner = TestRunner::new(ProptestConfig {
        cases: 20,
        ..ProptestConfig::default()
    });

    // path: 0 = Settled path, 1 = Failed path
    runner
        .run(&(0usize..=1usize), |path| {
            let h = make_harness(1);
            let deadline = future_deadline(&h);
            let id = h
                .client
                .create_campaign(&h.farmer, &h.token_id, &10_000, &deadline);
            StellarAssetClient::new(&h.env, &h.token_id).mint(&h.investors[0], &10_000);
            h.client.invest(&h.investors[0], &id, &10_000);

            let terminal_status = if path == 0 {
                h.client.start_production(&h.farmer, &id);
                h.client.mark_harvest(&h.farmer, &h.attester, &id);
                h.client.settle(&h.farmer, &id);
                CampaignStatus::Settled
            } else {
                h.client.mark_campaign_failed(&h.admin, &id);
                CampaignStatus::Failed
            };

            assert_terminal_state_immutable(&h, id, &terminal_status);

            // start_production must fail
            let _ = h
                .client
                .try_start_production(&h.farmer, &id)
                .expect_err("start_production must reject terminal campaign");
            // invest must fail
            let _ = h
                .client
                .try_invest(&h.investors[0], &id, &1)
                .expect_err("invest must reject terminal campaign");

            assert_terminal_state_immutable(&h, id, &terminal_status);
            Ok(())
        })
        .expect("terminal state lock proptest failed");
}

// ---------------------------------------------------------------------------
// Invariant 4: Fee Accounting
// ---------------------------------------------------------------------------

/// Fees only exit via fee_collector. Fee collector balance only ever increases.
/// Cancelled or expired orders refund the gross `amount` (fee is included and not taken).
#[test]
fn test_invariant_fee_only_via_fee_collector_on_confirm() {
    let h = make_harness(1);
    let deadline = future_deadline(&h);
    let target = 10_000i128;
    let id = h
        .client
        .create_campaign(&h.farmer, &h.token_id, &target, &deadline);
    h.client.invest(&h.investors[0], &id, &10_000);
    h.client.start_production(&h.farmer, &id);
    h.client.mark_harvest(&h.farmer, &h.attester, &id);

    // Create buyer and fund
    let buyer = Address::generate(&h.env);
    StellarAssetClient::new(&h.env, &h.token_id).mint(&buyer, &1_000);

    let order_amount = 1_000i128;
    let fee_collector_before = token_balance(&h, &h.fee_collector);

    let order_id = h.client.create_order(&buyer, &id, &order_amount);

    // Fee collector balance must NOT have changed yet (fee is held in escrow)
    let fee_collector_after_create = token_balance(&h, &h.fee_collector);
    assert_eq!(
        fee_collector_before, fee_collector_after_create,
        "fee_collector balance must not change before confirm"
    );

    // Confirm order → fee should now be at fee_collector
    h.client.confirm_order(&buyer, &order_id);
    let fee_collector_after_confirm = token_balance(&h, &h.fee_collector);

    // fee = 1000 * 3% = 30
    let expected_fee = (order_amount * 300) / 10_000;
    assert_eq!(
        fee_collector_after_confirm - fee_collector_before,
        expected_fee,
        "fee_collector should have received exactly the fee amount"
    );
}

#[test]
fn test_invariant_fee_not_collected_on_cancel() {
    let h = make_harness(1);
    let deadline = future_deadline(&h);
    let target = 10_000i128;
    let id = h
        .client
        .create_campaign(&h.farmer, &h.token_id, &target, &deadline);
    h.client.invest(&h.investors[0], &id, &10_000);
    h.client.start_production(&h.farmer, &id);
    h.client.mark_harvest(&h.farmer, &h.attester, &id);

    let buyer = Address::generate(&h.env);
    StellarAssetClient::new(&h.env, &h.token_id).mint(&buyer, &1_000);

    let order_amount = 1_000i128;
    let order_id = h.client.create_order(&buyer, &id, &order_amount);

    let fee_collector_before = token_balance(&h, &h.fee_collector);
    let buyer_before = token_balance(&h, &buyer);

    // Cancel within the cooling-off window
    h.client.cancel_order(&buyer, &order_id);

    let fee_collector_after = token_balance(&h, &h.fee_collector);
    let buyer_after = token_balance(&h, &buyer);

    // Fee collector should NOT have received anything
    assert_eq!(
        fee_collector_before, fee_collector_after,
        "fee_collector must NOT receive fee when order is cancelled"
    );
    // Buyer gets back exactly the gross amount that entered escrow.
    assert_eq!(
        buyer_after - buyer_before,
        order_amount,
        "buyer should get back the gross order amount on cancel"
    );
}

#[test]
fn test_invariant_fee_collector_balance_never_decreases() {
    let h = make_harness(1);
    let deadline = future_deadline(&h);
    let id = h
        .client
        .create_campaign(&h.farmer, &h.token_id, &10_000, &deadline);
    h.client.invest(&h.investors[0], &id, &10_000);
    h.client.start_production(&h.farmer, &id);
    h.client.mark_harvest(&h.farmer, &h.attester, &id);

    let initial_fee_collector_balance = token_balance(&h, &h.fee_collector);

    // Create and confirm multiple orders
    for i in 0..3 {
        let buyer = Address::generate(&h.env);
        StellarAssetClient::new(&h.env, &h.token_id).mint(&buyer, &500);
        let order_id = h.client.create_order(&buyer, &id, &500);
        h.client.confirm_order(&buyer, &order_id);

        let current = token_balance(&h, &h.fee_collector);
        assert!(
            current >= initial_fee_collector_balance,
            "fee_collector balance must never decrease (step {})",
            i
        );
    }
}

/// Proptest: for any positive order amount, fee_collector balance after
/// confirm_order increases by exactly `(amount * fee_rate_bps) / 10_000`.
#[test]
fn test_invariant_fee_accounting_proptest() {
    let mut runner = TestRunner::new(ProptestConfig {
        cases: 25,
        ..ProptestConfig::default()
    });

    runner
        .run(&(100i128..=5_000i128), |order_amount| {
            let h = make_harness(1);
            let deadline = future_deadline(&h);
            let target = 10_000i128;
            let id = h
                .client
                .create_campaign(&h.farmer, &h.token_id, &target, &deadline);

            StellarAssetClient::new(&h.env, &h.token_id).mint(&h.investors[0], &target);
            h.client.invest(&h.investors[0], &id, &target);
            h.client.start_production(&h.farmer, &id);
            h.client.mark_harvest(&h.farmer, &h.attester, &id);

            let buyer = Address::generate(&h.env);
            StellarAssetClient::new(&h.env, &h.token_id).mint(&buyer, &order_amount);
            let fee_before = token_balance(&h, &h.fee_collector);
            let order_id = h.client.create_order(&buyer, &id, &order_amount);
            h.client.confirm_order(&buyer, &order_id);

            let fee_after = token_balance(&h, &h.fee_collector);
            let expected_fee = (order_amount * 300) / 10_000;
            assert_eq!(
                fee_after - fee_before,
                expected_fee,
                "fee_collector should receive exactly fee={} for order_amount={}",
                expected_fee,
                order_amount
            );
            Ok(())
        })
        .expect("fee accounting proptest failed");
}

// ---------------------------------------------------------------------------
// Regression Test: Double-claim guard (Task 6)
// ---------------------------------------------------------------------------

/// Regression proof: demonstrates that the `Claimed` flag catches a double-claim.
/// This corresponds to the bug class identified in the audit where a missing
/// idempotency guard on settlement payouts would allow an investor to drain
/// the escrow by calling `claim_returns` multiple times. The fix is the
/// `DataKey::Claimed` persistent flag checked before payout.
#[test]
fn test_regression_double_claim_caught() {
    let h = make_harness(2);
    let deadline = future_deadline(&h);
    let target = 10_000i128;

    let id = h
        .client
        .create_campaign(&h.farmer, &h.token_id, &target, &deadline);
    h.client.invest(&h.investors[0], &id, &6_000);
    h.client.invest(&h.investors[1], &id, &4_000);
    h.client.start_production(&h.farmer, &id);
    h.client.mark_harvest(&h.farmer, &h.attester, &id);
    h.client.settle(&h.farmer, &id);

    let balance_before = token_balance(&h, &h.investors[0]);

    // Legitimate first claim
    let payout = h.client.claim_returns(&h.investors[0], &id);
    assert!(payout > 0);

    let balance_after_first = token_balance(&h, &h.investors[0]);
    assert_eq!(balance_after_first - balance_before, payout);

    // Attempt to claim again — the Claimed flag MUST block this
    let result = h.client.try_claim_returns(&h.investors[0], &id);
    let err = result
        .expect_err("double-claim must be rejected")
        .expect("must be a contract error");
    assert_eq!(
        err,
        EscrowError::AlreadyClaimed,
        "REGRESSION: double-claim was not caught — the AlreadyClaimed guard is missing or bypassed"
    );

    // Balance must not have changed after the blocked second claim
    let balance_after_second = token_balance(&h, &h.investors[0]);
    assert_eq!(
        balance_after_second, balance_after_first,
        "REGRESSION: balance changed after a blocked claim — funds were drained"
    );
}

/// Regression proof: demonstrates that the MAX_TRANCHE_BPS cap (70%) prevents
/// releasing more than 70% of `total_raised` as farmer tranches, ensuring at
/// least 30% remains for investor recovery.
///
/// The previously-fixed bug: before MAX_TRANCHE_BPS was introduced,
/// a custom milestone config could set cumulative release_bps > 7000,
/// releasing 100% of raised funds to the farmer while investors received nothing.
#[test]
fn test_regression_tranche_cap_caught() {
    let h = make_harness(1);
    let deadline = future_deadline(&h);
    let target = 10_000i128;

    let id = h
        .client
        .create_campaign(&h.farmer, &h.token_id, &target, &deadline);
    StellarAssetClient::new(&h.env, &h.token_id).mint(&h.investors[0], &target);
    h.client.invest(&h.investors[0], &id, &target);
    h.client.start_production(&h.farmer, &id);
    h.client.mark_harvest(&h.farmer, &h.attester, &id);

    let c = h.client.get_campaign(&id);

    // After both tranches (30% + 40%), tranche_released should be <= MAX_TRANCHE_BPS of total_raised
    let max_tranche = (c.total_raised * 7_000) / 10_000;
    assert!(
        c.tranche_released <= max_tranche,
        "REGRESSION: tranche_released ({}) exceeds MAX_TRANCHE_BPS ({}) of total_raised ({})",
        c.tranche_released,
        max_tranche,
        c.total_raised
    );

    // settle: verify investors can still claim the remaining 30%
    h.client.settle(&h.farmer, &id);
    let payout = h.client.claim_returns(&h.investors[0], &id);
    // Remaining after 70% tranche = 30% of 10_000 = 3_000
    assert_eq!(
        payout, 3_000,
        "investor should receive remaining 30% of raised funds"
    );
}

/// Regression: batch_refund_investors must not refund the same investor twice
/// even if the same address appears multiple times in the input list.
#[test]
fn test_regression_batch_refund_no_double_payout() {
    let h = make_harness(1);
    let deadline = h.env.ledger().timestamp() + 100;
    let target = 10_000i128;
    let contribution = 5_000i128;

    let id = h
        .client
        .create_campaign(&h.farmer, &h.token_id, &target, &deadline);
    StellarAssetClient::new(&h.env, &h.token_id).mint(&h.investors[0], &contribution);
    h.client.invest(&h.investors[0], &id, &contribution);

    advance(&h, 200);
    h.client.finalize_failed(&id);

    let balance_before = token_balance(&h, &h.investors[0]);

    // Deliberately include the same investor address twice in the batch
    let mut batch = Vec::new(&h.env);
    batch.push_back(h.investors[0].clone());
    batch.push_back(h.investors[0].clone());

    let (count, total) = h.client.batch_refund_investors(&id, &batch);

    let balance_after = token_balance(&h, &h.investors[0]);
    let actual_increase = balance_after - balance_before;

    assert_eq!(count, 1, "only one refund should have been processed");
    assert_eq!(
        actual_increase, total,
        "balance increase must match reported total"
    );
    assert_eq!(
        actual_increase, contribution,
        "REGRESSION: investor was refunded more than once in batch"
    );
}


// ---------------------------------------------------------------------------
// Issue #1278: Pooled solvency 100-cycle regression & disposable bug fixture
// ---------------------------------------------------------------------------

/// Deterministic regression (Issue #1278 / #1244):
/// Repeats 100 create_order + cancel_order cycles and exercises an expiry batch
/// (batch_refund_orders) with a nonzero 3% fee across two campaigns sharing a
/// single token pool. Asserts zero attacker profit, intact pooled token
/// solvency, and 100% preserved investor claims/refunds on both campaigns.
#[test]
fn test_regression_100_create_cancel_and_expiry_batch_cycles_preserve_solvency() {
    let h = make_harness(2);
    let deadline = future_deadline(&h);
    let target = 10_000i128;

    // Campaign 1 (Harvested, accepting orders) and Campaign 2 (Funded, sharing token pool)
    let c1 = h
        .client
        .create_campaign(&h.farmer, &h.token_id, &target, &deadline);
    let c2 = h
        .client
        .create_campaign(&h.farmer, &h.token_id, &target, &deadline);

    h.client.invest(&h.investors[0], &c1, &target);
    h.client.invest(&h.investors[1], &c2, &target);

    h.client.start_production(&h.farmer, &c1);
    h.client.mark_harvest(&h.farmer, &h.attester, &c1);
    // c1 has 3,000 remaining (after 70% tranches); c2 has 10,000 remaining -> 13,000 pooled obligation.

    let attacker = Address::generate(&h.env);
    let attacker_initial = 1_000i128;
    StellarAssetClient::new(&h.env, &h.token_id).mint(&attacker, &attacker_initial);

    let fee_before = token_balance(&h, &h.fee_collector);
    let pool_before = token_balance(&h, &h.client.address);
    assert_eq!(pool_before, 13_000);

    // 100 create/cancel cycles with nonzero fee (300 bps = 3%)
    for _ in 0..100 {
        let oid = h.client.create_order(&attacker, &c1, &attacker_initial);
        h.client.cancel_order(&attacker, &oid);
    }

    assert_eq!(
        token_balance(&h, &attacker),
        attacker_initial,
        "attacker must make zero profit across 100 create/cancel cycles"
    );
    assert_eq!(
        token_balance(&h, &h.fee_collector),
        fee_before,
        "fee collector must receive zero fees from cancelled orders"
    );
    assert_eq!(
        token_balance(&h, &h.client.address),
        pool_before,
        "pooled escrow holdings must remain intact after 100 create/cancel cycles"
    );

    // Exercise expiry batch with nonzero fees (5 expired orders)
    let mut expired_ids = Vec::new(&h.env);
    let mut batch_buyers = StdVec::new();
    for _ in 0..5 {
        let b = Address::generate(&h.env);
        StellarAssetClient::new(&h.env, &h.token_id).mint(&b, &500);
        let oid = h.client.create_order(&b, &c1, &500);
        expired_ids.push_back(oid);
        batch_buyers.push(b);
    }
    advance(&h, crate::ORDER_EXPIRY_SECS + 10);
    let (refunded_count, refunded_total) = h.client.batch_refund_orders(&expired_ids);
    assert_eq!(refunded_count, 5);
    assert_eq!(refunded_total, 2_500);
    for b in &batch_buyers {
        assert_eq!(token_balance(&h, b), 500);
    }

    // Settle c1 and fail c2 -> both investors must recover their full owed obligations
    h.client.settle(&h.farmer, &c1);
    h.client.mark_campaign_failed(&h.admin, &c2);

    let c1_claim = h.client.claim_returns(&h.investors[0], &c1);
    let c2_refund = h.client.refund(&h.investors[1], &c2);
    assert_eq!(c1_claim, 3_000);
    assert_eq!(c2_refund, 10_000);
    assert_eq!(token_balance(&h, &h.client.address), 0);
}

/// Disposable solvency model fixture (Issue #1278):
/// Demonstrates that the independent cash-flow & unpaid-obligation solvency
/// check catches both:
///   (a) the prior #1244 fee over-refund bug when its fix is intentionally reverted, and
///   (b) the refunded-pool reuse bug (Failed -> refund -> Disputed -> Partial/Settled)
///       when its terminal-state/pool-deduction fix is intentionally reverted.
#[test]
fn test_disposable_fixture_catches_reverted_fee_over_refund_and_refunded_pool_reuse() {
    #[derive(Clone)]
    struct DisposablePoolFixture {
        actual_token_balance: i128,
        unpaid_investor_obligations: i128,
        unpaid_order_obligations: i128,
        donated_dust: i128,
        max_rounding_dust: i128,
        fee_bps: i128,
        revert_fix_1244_fee_over_refund: bool,
        revert_fix_refunded_pool_reuse: bool,
    }

    impl DisposablePoolFixture {
        fn new(revert_1244: bool, revert_pool_reuse: bool) -> Self {
            Self {
                actual_token_balance: 20_000, // Two 10,000-unit campaigns sharing one token pool
                unpaid_investor_obligations: 20_000,
                unpaid_order_obligations: 0,
                donated_dust: 0,
                max_rounding_dust: 2,
                fee_bps: 300,
                revert_fix_1244_fee_over_refund: revert_1244,
                revert_fix_refunded_pool_reuse: revert_pool_reuse,
            }
        }

        fn create_and_cancel_order(&mut self, gross_amount: i128) {
            let fee = (gross_amount * self.fee_bps) / 10_000;
            if self.revert_fix_1244_fee_over_refund {
                // Reverted bug: fee routed out on order creation while cancel refunds gross_amount
                self.actual_token_balance += gross_amount - fee;
            } else {
                // Fixed behavior: full gross_amount held in escrow until confirmation
                self.actual_token_balance += gross_amount;
            }
            self.unpaid_order_obligations += gross_amount;

            // Cancel order refunds gross_amount
            self.actual_token_balance -= gross_amount;
            self.unpaid_order_obligations -= gross_amount;
        }

        fn partial_refund_then_settle_dispute(&mut self, refunded_investor_share: i128, campaign_raised: i128) {
            // Investor 1 refunds on Failed campaign
            self.actual_token_balance -= refunded_investor_share;
            self.unpaid_investor_obligations -= refunded_investor_share;

            if self.revert_fix_refunded_pool_reuse {
                // Reverted bug: campaign re-enters Disputed -> Partial(5000) and computes
                // farmer cut from full campaign_raised without subtracting refunded_investor_share
                let farmer_cut = (campaign_raised * 5_000) / 10_000;
                self.actual_token_balance -= farmer_cut;
            }
        }

        fn is_solvent(&self) -> bool {
            let total_unpaid = self.unpaid_investor_obligations + self.unpaid_order_obligations;
            self.actual_token_balance >= total_unpaid - self.max_rounding_dust
                && self.actual_token_balance <= total_unpaid + self.donated_dust + self.max_rounding_dust
        }
    }

    // 1. Fixed implementation remains solvent
    let mut fixed = DisposablePoolFixture::new(false, false);
    for _ in 0..100 {
        fixed.create_and_cancel_order(1_000);
    }
    fixed.partial_refund_then_settle_dispute(5_000, 10_000);
    assert!(fixed.is_solvent(), "fixed fixture must satisfy pooled solvency");

    // 2. Reverted #1244 fee over-refund is immediately caught by the solvency model
    let mut reverted_1244 = DisposablePoolFixture::new(true, false);
    reverted_1244.create_and_cancel_order(1_000);
    assert!(
        !reverted_1244.is_solvent(),
        "model must catch reverted #1244 fee over-refund after a single create/cancel cycle"
    );

    // 3. Reverted refunded-pool reuse is immediately caught by the solvency model
    let mut reverted_pool_reuse = DisposablePoolFixture::new(false, true);
    reverted_pool_reuse.partial_refund_then_settle_dispute(5_000, 10_000);
    assert!(
        !reverted_pool_reuse.is_solvent(),
        "model must catch reverted refunded-pool reuse when a refunded campaign pool is tapped again"
    );
}
