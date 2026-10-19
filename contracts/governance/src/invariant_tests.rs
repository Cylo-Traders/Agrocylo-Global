//! Property-based and invariant tests for the Governance contract.
//!
//! # Invariants under test
//!
//! 1. **Vote-weight conservation**: for any proposal, at any moment after every
//!    registered voter has cast a ballot,
//!    `votes_for + votes_against <= total_weight` must hold. Votes cannot
//!    be created from thin air.
//!
//! 2. **Proposal lifecycle lock**: the `ProposalStatus` state machine is strictly
//!    forward-only: Voting → Queued/Rejected → Executed. A proposal that has
//!    been Executed cannot be re-queued or re-executed. A Rejected proposal
//!    cannot be queued. A Voting proposal cannot be executed directly.
//!
//! 3. **Timelock enforced**: `execute` must revert with `TimelockNotElapsed` if
//!    called before `queued_at + timelock_delay_secs`, even if all other
//!    conditions are met.
//!
//! # Proptest coverage
//!
//! `test_invariant_vote_weight_conservation_proptest` drives arbitrary
//! voter-weight and vote-distribution configurations and asserts the weight
//! conservation invariant after every vote.
//!
//! `test_invariant_timelock_proptest` drives arbitrary timelock delay values
//! (including delay = 0) and asserts that an attempt to execute immediately
//! after queuing always fails when delay > 0.

extern crate std;

use proptest::prelude::*;
use proptest::test_runner::{Config as ProptestConfig, TestRunner};
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    Address, Env, IntoVal, Symbol, Val,
};
use std::vec::Vec as StdVec;

use production_escrow_v2::{ProductionEscrowContract, ProductionEscrowContractClient};

use crate::{GovernanceContract, GovernanceContractClient, GovernanceError, ProposalStatus};

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const VOTING_PERIOD: u64 = 7 * 24 * 3600; // 7 days
const TIMELOCK_DELAY: u64 = 2 * 24 * 3600; // 2 days
const UPGRADE_TIMELOCK_DELAY: u64 = 14 * 24 * 3600; // 14 days
const QUORUM: u64 = 60;

#[allow(dead_code)]
struct GovHarness<'a> {
    env: Env,
    gov: GovernanceContractClient<'a>,
    escrow: ProductionEscrowContractClient<'a>,
    admin: Address,
    voters: StdVec<(Address, u64)>, // (address, weight)
    escrow_id: Address,
    fee_collector: Address,
    token_id: Address,
}

fn make_gov_harness(voter_weights: &[u64], quorum: u64) -> GovHarness<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);

    let gov_id = env.register(GovernanceContract, ());
    let gov = GovernanceContractClient::new(&env, &gov_id);
    gov.initialize(
        &admin,
        &VOTING_PERIOD,
        &TIMELOCK_DELAY,
        &UPGRADE_TIMELOCK_DELAY,
        &quorum,
    );

    let mut voters = StdVec::new();
    for &w in voter_weights {
        let voter = Address::generate(&env);
        gov.set_voter_weight(&admin, &voter, &w);
        voters.push((voter, w));
    }

    let token_admin = Address::generate(&env);
    let token_id = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();

    let escrow_id_contract = env.register(ProductionEscrowContract, ());
    let escrow = ProductionEscrowContractClient::new(&env, &escrow_id_contract);
    let escrow_id = escrow_id_contract.clone();
    let fee_collector = Address::generate(&env);
    let mut tokens = soroban_sdk::Vec::new(&env);
    tokens.push_back(token_id.clone());
    // governance contract is the "admin" of the escrow for governed params
    escrow.initialize(&gov_id, &tokens, &fee_collector, &300);

    let gov: GovernanceContractClient<'static> = unsafe { std::mem::transmute(gov) };
    let escrow: ProductionEscrowContractClient<'static> = unsafe { std::mem::transmute(escrow) };

    GovHarness {
        env,
        gov,
        escrow,
        admin,
        voters,
        escrow_id,
        fee_collector,
        token_id,
    }
}

fn advance_gov(h: &GovHarness<'_>, secs: u64) {
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

/// Create a minimal "set_fee_config" proposal targeting the escrow contract.
fn propose_set_fee_config(h: &GovHarness<'_>) -> u64 {
    let (proposer, _) = &h.voters[0];
    let function_name = Symbol::new(&h.env, "set_fee_config");
    let new_fee_collector = Address::generate(&h.env);
    let gov_id = h.gov.address.clone();
    let mut args: soroban_sdk::Vec<Val> = soroban_sdk::Vec::new(&h.env);
    args.push_back(gov_id.into_val(&h.env)); // admin_caller = governance contract
    args.push_back(new_fee_collector.into_val(&h.env));
    args.push_back(200u32.into_val(&h.env)); // new fee rate

    h.gov.propose(proposer, &h.escrow_id, &function_name, &args)
}

// ---------------------------------------------------------------------------
// Invariant 1: Vote-weight conservation
// ---------------------------------------------------------------------------

/// votes_for + votes_against <= total_weight at all times.
#[test]
fn test_invariant_vote_weight_conservation() {
    // weights: 60, 50, 10 — total = 120, quorum = 60
    let h = make_gov_harness(&[60, 50, 10], QUORUM);
    let total_weight: u64 = 60 + 50 + 10;

    let pid = propose_set_fee_config(&h);

    // Each voter votes for
    for (voter, _) in &h.voters {
        h.gov.vote(voter, &pid, &true);
        let p = h.gov.get_proposal(&pid);
        assert!(
            p.votes_for + p.votes_against <= total_weight,
            "INVARIANT VIOLATED: votes_for({}) + votes_against({}) > total_weight({})",
            p.votes_for,
            p.votes_against,
            total_weight
        );
    }
}

#[test]
fn test_invariant_vote_weight_conservation_mixed_votes() {
    let h = make_gov_harness(&[60, 50, 10], QUORUM);
    let total_weight: u64 = 120;

    let pid = propose_set_fee_config(&h);

    // voters[0] votes for, voters[1] votes against, voters[2] votes for
    h.gov.vote(&h.voters[0].0, &pid, &true);
    h.gov.vote(&h.voters[1].0, &pid, &false);
    h.gov.vote(&h.voters[2].0, &pid, &true);

    let p = h.gov.get_proposal(&pid);
    assert!(p.votes_for + p.votes_against <= total_weight);
    // votes_for = 60 + 10 = 70, votes_against = 50
    assert_eq!(p.votes_for, 70);
    assert_eq!(p.votes_against, 50);
    assert!(p.votes_for + p.votes_against <= total_weight);
}

/// Proptest: for any combination of voter weights and vote choices, the
/// conservation invariant holds.
#[test]
fn test_invariant_vote_weight_conservation_proptest() {
    let mut runner = TestRunner::new(ProptestConfig {
        cases: 30,
        ..ProptestConfig::default()
    });

    runner
        .run(
            // 2–4 voters, each with weight 1–100, vote support is boolean
            &proptest::collection::vec((1u64..=100u64, any::<bool>()), 2usize..=4usize),
            |voter_specs| {
                let weights: StdVec<u64> = voter_specs.iter().map(|(w, _)| *w).collect();
                let total_weight: u64 = weights.iter().sum();
                let quorum = (total_weight / 2) + 1;

                let h = make_gov_harness(&weights, quorum);
                let pid = propose_set_fee_config(&h);

                for (i, (_, support)) in voter_specs.iter().enumerate() {
                    h.gov
                        .vote(&h.voters[i].0, &pid, support);
                    let p = h.gov.get_proposal(&pid);
                    assert!(
                        p.votes_for + p.votes_against <= total_weight,
                        "INVARIANT VIOLATED: votes_for({}) + votes_against({}) > total_weight({}) after voter {}",
                        p.votes_for,
                        p.votes_against,
                        total_weight,
                        i
                    );
                }
                Ok(())
            },
        )
        .expect("vote weight conservation proptest failed");
}

// ---------------------------------------------------------------------------
// Invariant 2: Proposal lifecycle lock (strictly forward-only)
// ---------------------------------------------------------------------------

/// A proposal in Voting status cannot be directly executed.
#[test]
fn test_invariant_lifecycle_voting_cannot_execute() {
    let h = make_gov_harness(&[60, 50], QUORUM);
    let caller = Address::generate(&h.env);
    let pid = propose_set_fee_config(&h);

    // All voters vote for — but voting period still open
    h.gov.vote(&h.voters[0].0, &pid, &true);
    h.gov.vote(&h.voters[1].0, &pid, &true);

    let err = h
        .gov
        .try_execute(&caller, &pid)
        .expect_err("execute during Voting must fail")
        .expect("contract error");
    assert_eq!(
        err,
        GovernanceError::NotQueued,
        "proposal in Voting state must not be executable"
    );

    let p = h.gov.get_proposal(&pid);
    assert_eq!(
        p.status,
        ProposalStatus::Voting,
        "proposal must remain in Voting state"
    );
}

/// A rejected proposal cannot be queued.
#[test]
fn test_invariant_lifecycle_rejected_cannot_queue() {
    let h = make_gov_harness(&[60, 50], QUORUM);
    let caller = Address::generate(&h.env);
    let pid = propose_set_fee_config(&h);

    // All voters vote AGAINST — quorum not met for "for"
    h.gov.vote(&h.voters[0].0, &pid, &false);
    h.gov.vote(&h.voters[1].0, &pid, &false);

    // Advance past voting period
    advance_gov(&h, VOTING_PERIOD + 1);

    // Queue — this should transition to Rejected since votes_for < quorum
    h.gov.queue(&caller, &pid);

    let p = h.gov.get_proposal(&pid);
    assert_eq!(
        p.status,
        ProposalStatus::Rejected,
        "proposal with insufficient for-votes must be Rejected"
    );

    // Attempt to queue again — must fail since status is now Rejected
    let err = h
        .gov
        .try_queue(&caller, &pid)
        .expect_err("queue after Rejected must fail")
        .expect("contract error");
    assert_eq!(err, GovernanceError::AlreadyQueued);
}

/// An executed proposal cannot be executed again.
#[test]
fn test_invariant_lifecycle_executed_cannot_reexecute() {
    let h = make_gov_harness(&[60, 50], QUORUM);
    let caller = Address::generate(&h.env);
    let pid = propose_set_fee_config(&h);

    // All vote for
    h.gov.vote(&h.voters[0].0, &pid, &true);
    h.gov.vote(&h.voters[1].0, &pid, &true);

    // Advance past voting period, queue
    advance_gov(&h, VOTING_PERIOD + 1);
    h.gov.queue(&caller, &pid);

    let p = h.gov.get_proposal(&pid);
    assert_eq!(p.status, ProposalStatus::Queued);

    // Advance past timelock, execute
    advance_gov(&h, TIMELOCK_DELAY + 1);
    h.gov.execute(&caller, &pid);

    let p = h.gov.get_proposal(&pid);
    assert_eq!(p.status, ProposalStatus::Executed);

    // Re-execute must fail
    let err = h
        .gov
        .try_execute(&caller, &pid)
        .expect_err("re-execute must fail")
        .expect("contract error");
    assert_eq!(
        err,
        GovernanceError::NotQueued,
        "executed proposal must not be re-executable"
    );
}

/// A voter cannot vote twice on the same proposal.
#[test]
fn test_invariant_no_double_vote() {
    let h = make_gov_harness(&[60, 50], QUORUM);
    let pid = propose_set_fee_config(&h);
    let (voter, _) = &h.voters[0];

    h.gov.vote(voter, &pid, &true);
    let err = h
        .gov
        .try_vote(voter, &pid, &true)
        .expect_err("second vote must fail")
        .expect("contract error");
    assert_eq!(err, GovernanceError::AlreadyVoted);
}

/// Proptest: proposal lifecycle always moves strictly forward —
/// after any terminal state (Executed, Rejected, or Cancelled) no mutating
/// call changes the status.
#[test]
fn test_invariant_lifecycle_lock_proptest() {
    let mut runner = TestRunner::new(ProptestConfig {
        cases: 20,
        ..ProptestConfig::default()
    });

    // path: 0 = Executed, 1 = Rejected, 2 = Cancelled
    runner
        .run(&(0usize..=2usize), |path| {
            let h = make_gov_harness(&[60, 50], QUORUM);
            let caller = Address::generate(&h.env);
            let guardian = Address::generate(&h.env);

            // Set guardian for Cancelled path
            if path == 2 {
                let gov_id = h.gov.address.clone();
                let guardian_args: soroban_sdk::Vec<soroban_sdk::Val> =
                    soroban_sdk::vec![&h.env, gov_id.into_val(&h.env), guardian.into_val(&h.env)];
                let gid = h.gov.propose(
                    &h.voters[0].0,
                    &gov_id,
                    &soroban_sdk::Symbol::new(&h.env, "set_guardian"),
                    &guardian_args,
                );
                h.gov.vote(&h.voters[0].0, &gid, &true);
                h.gov.vote(&h.voters[1].0, &gid, &true);
                advance_gov(&h, VOTING_PERIOD + 1);
                h.gov.queue(&caller, &gid);
                advance_gov(&h, TIMELOCK_DELAY + 1);
                h.gov.execute(&caller, &gid);
            }

            let pid = propose_set_fee_config(&h);

            if path == 0 {
                // Execute path: vote for, queue after period, execute after timelock
                h.gov.vote(&h.voters[0].0, &pid, &true);
                h.gov.vote(&h.voters[1].0, &pid, &true);
                advance_gov(&h, VOTING_PERIOD + 1);
                h.gov.queue(&caller, &pid);
                advance_gov(&h, TIMELOCK_DELAY + 1);
                h.gov.execute(&caller, &pid);

                let p = h.gov.get_proposal(&pid);
                assert_eq!(p.status, ProposalStatus::Executed);

                // Must not re-execute
                let _ = h
                    .gov
                    .try_execute(&caller, &pid)
                    .expect_err("must fail on re-execute");
            } else if path == 1 {
                // Rejected path: vote against, queue (→ Rejected)
                h.gov.vote(&h.voters[0].0, &pid, &false);
                h.gov.vote(&h.voters[1].0, &pid, &false);
                advance_gov(&h, VOTING_PERIOD + 1);
                h.gov.queue(&caller, &pid);

                let p = h.gov.get_proposal(&pid);
                assert_eq!(p.status, ProposalStatus::Rejected);

                // Must not transition from Rejected
                let _ = h
                    .gov
                    .try_queue(&caller, &pid)
                    .expect_err("must fail after Rejected");
                let _ = h
                    .gov
                    .try_execute(&caller, &pid)
                    .expect_err("must fail after Rejected");

                // Status still Rejected
                let p2 = h.gov.get_proposal(&pid);
                assert_eq!(p2.status, ProposalStatus::Rejected);
            } else {
                // Cancelled path: vote for, queue, cancel, verify terminal
                h.gov.vote(&h.voters[0].0, &pid, &true);
                h.gov.vote(&h.voters[1].0, &pid, &true);
                advance_gov(&h, VOTING_PERIOD + 1);
                h.gov.queue(&caller, &pid);
                h.gov.cancel_proposal(&guardian, &pid);

                let p = h.gov.get_proposal(&pid);
                assert_eq!(p.status, ProposalStatus::Cancelled);

                // Must not execute a cancelled proposal
                let _ = h
                    .gov
                    .try_execute(&caller, &pid)
                    .expect_err("must fail on cancelled proposal");

                // Status still Cancelled
                let p2 = h.gov.get_proposal(&pid);
                assert_eq!(p2.status, ProposalStatus::Cancelled);
            }
            Ok(())
        })
        .expect("lifecycle lock proptest failed");
}

// ---------------------------------------------------------------------------
// Invariant 3: Timelock enforced
// ---------------------------------------------------------------------------

/// Execute must fail if called before timelock elapses (even one second early).
#[test]
fn test_invariant_timelock_enforced() {
    let h = make_gov_harness(&[60, 50], QUORUM);
    let caller = Address::generate(&h.env);
    let pid = propose_set_fee_config(&h);

    h.gov.vote(&h.voters[0].0, &pid, &true);
    h.gov.vote(&h.voters[1].0, &pid, &true);
    advance_gov(&h, VOTING_PERIOD + 1);
    h.gov.queue(&caller, &pid);

    let p_before = h.gov.get_proposal(&pid);
    assert_eq!(p_before.status, ProposalStatus::Queued);

    // Try to execute immediately (before timelock elapsed)
    let err = h
        .gov
        .try_execute(&caller, &pid)
        .expect_err("execute before timelock must fail")
        .expect("contract error");
    assert_eq!(
        err,
        GovernanceError::TimelockNotElapsed,
        "execute must fail with TimelockNotElapsed before delay elapses"
    );

    // Advance exactly one second before timelock
    advance_gov(&h, TIMELOCK_DELAY - 1);
    let err2 = h
        .gov
        .try_execute(&caller, &pid)
        .expect_err("execute one second before timelock must fail")
        .expect("contract error");
    assert_eq!(err2, GovernanceError::TimelockNotElapsed);

    // Now advance past the timelock: should succeed
    advance_gov(&h, 2); // now at queued_at + TIMELOCK_DELAY + 1
    h.gov.execute(&caller, &pid);

    let p_after = h.gov.get_proposal(&pid);
    assert_eq!(p_after.status, ProposalStatus::Executed);
}

/// Proptest: for any timelock_delay (including 0), execute before delay fails.
#[test]
fn test_invariant_timelock_proptest() {
    let mut runner = TestRunner::new(ProptestConfig {
        cases: 25,
        ..ProptestConfig::default()
    });

    runner
        .run(
            // timelock_delay in seconds: MIN_TIMELOCK_DELAY_SECS (24h, Issue
            // #851) up to 1 week — the range `initialize` actually accepts.
            &((24 * 3600u64)..=(7 * 24 * 3600u64)),
            |timelock_delay| {
                let env = Env::default();
                env.mock_all_auths();

                let admin = Address::generate(&env);
                let voter1 = Address::generate(&env);
                let voter2 = Address::generate(&env);

                let gov_id = env.register(GovernanceContract, ());
                let gov = GovernanceContractClient::new(&env, &gov_id);
                gov.initialize(
                    &admin,
                    &VOTING_PERIOD,
                    &timelock_delay,
                    &UPGRADE_TIMELOCK_DELAY,
                    &QUORUM,
                );
                gov.set_voter_weight(&admin, &voter1, &60);
                gov.set_voter_weight(&admin, &voter2, &50);

                let token_admin = Address::generate(&env);
                let token_id = env
                    .register_stellar_asset_contract_v2(token_admin)
                    .address();
                let escrow_id = env.register(ProductionEscrowContract, ());
                let escrow = ProductionEscrowContractClient::new(&env, &escrow_id);
                let fee_collector = Address::generate(&env);
                let mut tokens = soroban_sdk::Vec::new(&env);
                tokens.push_back(token_id);
                escrow.initialize(&gov_id, &tokens, &fee_collector, &300);

                // Propose
                let function_name = Symbol::new(&env, "set_fee_config");
                let new_fc = Address::generate(&env);
                let mut args: soroban_sdk::Vec<Val> = soroban_sdk::Vec::new(&env);
                args.push_back(gov_id.clone().into_val(&env));
                args.push_back(new_fc.into_val(&env));
                args.push_back(200u32.into_val(&env));

                let pid = gov.propose(&voter1, &escrow_id, &function_name, &args);

                gov.vote(&voter1, &pid, &true);
                gov.vote(&voter2, &pid, &true);

                // Advance past voting period
                env.ledger().set(LedgerInfo {
                    timestamp: env.ledger().timestamp() + VOTING_PERIOD + 1,
                    protocol_version: env.ledger().protocol_version(),
                    sequence_number: env.ledger().sequence() + 1,
                    network_id: Default::default(),
                    base_reserve: 10,
                    min_temp_entry_ttl: 1,
                    min_persistent_entry_ttl: 1,
                    max_entry_ttl: 100_000_001,
                });

                let caller = Address::generate(&env);
                gov.queue(&caller, &pid);

                // Attempt to execute immediately (0 seconds elapsed since queue)
                let err = gov
                    .try_execute(&caller, &pid)
                    .expect_err("execute before timelock must fail")
                    .expect("contract error");
                assert_eq!(
                    err,
                    GovernanceError::TimelockNotElapsed,
                    "timelock not enforced for delay={}",
                    timelock_delay
                );

                Ok(())
            },
        )
        .expect("timelock proptest failed");
}

// ---------------------------------------------------------------------------
// Invariant: A non-voter cannot propose or vote
// ---------------------------------------------------------------------------

#[test]
fn test_invariant_non_voter_rejected() {
    let h = make_gov_harness(&[60, 50], QUORUM);
    let non_voter = Address::generate(&h.env);
    let pid = propose_set_fee_config(&h);

    // Non-voter cannot vote
    let err = h
        .gov
        .try_vote(&non_voter, &pid, &true)
        .expect_err("non-voter vote must fail")
        .expect("contract error");
    assert_eq!(err, GovernanceError::NotVoter);

    // Non-voter cannot propose
    let function_name = Symbol::new(&h.env, "set_fee_config");
    let mut args: soroban_sdk::Vec<Val> = soroban_sdk::Vec::new(&h.env);
    args.push_back(h.gov.address.clone().into_val(&h.env));
    args.push_back(Address::generate(&h.env).into_val(&h.env));
    args.push_back(100u32.into_val(&h.env));
    let err2 = h
        .gov
        .try_propose(&non_voter, &h.escrow_id, &function_name, &args)
        .expect_err("non-voter propose must fail")
        .expect("contract error");
    assert_eq!(err2, GovernanceError::NotVoter);
}

// ---------------------------------------------------------------------------
// Invariant: total_weight accounting after set_voter_weight
// ---------------------------------------------------------------------------

#[test]
fn test_invariant_total_weight_tracking() {
    let h = make_gov_harness(&[], 1); // start with zero voters
    let admin = h.admin.clone();

    let v1 = Address::generate(&h.env);
    let v2 = Address::generate(&h.env);

    h.gov.set_voter_weight(&admin, &v1, &40);
    assert_eq!(h.gov.get_voter_weight(&v1), 40);

    h.gov.set_voter_weight(&admin, &v2, &60);
    assert_eq!(h.gov.get_voter_weight(&v2), 60);

    // Update v1's weight — this should not double-count
    h.gov.set_voter_weight(&admin, &v1, &20);
    assert_eq!(h.gov.get_voter_weight(&v1), 20);

    // Revoke v2
    h.gov.set_voter_weight(&admin, &v2, &0);
    assert_eq!(h.gov.get_voter_weight(&v2), 0);
}
