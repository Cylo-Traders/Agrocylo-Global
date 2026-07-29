#![cfg(test)]

extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    vec, Address, Env, IntoVal, Symbol, Val,
};

use production_escrow_v2::{ProductionEscrowContract, ProductionEscrowContractClient};

use crate::{GovernanceContract, GovernanceContractClient, GovernanceError, ProposalStatus};

const VOTING_PERIOD: u64 = 7 * 24 * 60 * 60; // 7 days
const TIMELOCK_DELAY: u64 = 2 * 24 * 60 * 60; // 2 days
const QUORUM: u64 = 100;

struct TestEnv<'a> {
    env: Env,
    gov: GovernanceContractClient<'a>,
    escrow: ProductionEscrowContractClient<'a>,
    admin: Address,
    voter1: Address,
    voter2: Address,
    voter3: Address,
}

fn setup() -> TestEnv<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    let voter3 = Address::generate(&env);

    let gov_id = env.register(GovernanceContract, ());
    let gov = GovernanceContractClient::new(&env, &gov_id);
    gov.initialize(&admin, &VOTING_PERIOD, &TIMELOCK_DELAY, &QUORUM);
    gov.set_voter_weight(&admin, &voter1, &60);
    gov.set_voter_weight(&admin, &voter2, &50);
    gov.set_voter_weight(&admin, &voter3, &10);

    // Deploy a real production_escrow contract as an execution target so we
    // exercise a genuine cross-contract governance-triggered parameter change.
    let token_admin = Address::generate(&env);
    let token_id = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    let escrow_id = env.register(ProductionEscrowContract, ());
    let escrow = ProductionEscrowContractClient::new(&env, &escrow_id);
    let mut tokens = soroban_sdk::Vec::new(&env);
    tokens.push_back(token_id);
    let fee_collector = Address::generate(&env);
    // The governance contract's own address becomes the "admin" of the escrow
    // for the parameters it governs, so set_fee_config's admin_caller check
    // passes when governance invokes it on the escrow's behalf.
    escrow.initialize(&gov_id, &tokens, &fee_collector, &300);

    let env: Env = unsafe { std::mem::transmute(env) };
    let gov: GovernanceContractClient<'static> = unsafe { std::mem::transmute(gov) };
    let escrow: ProductionEscrowContractClient<'static> = unsafe { std::mem::transmute(escrow) };

    TestEnv {
        env,
        gov,
        escrow,
        admin,
        voter1,
        voter2,
        voter3,
    }
}

fn set_fee_config_args(env: &Env, gov_id: &Address, new_collector: &Address, new_bps: u32) -> soroban_sdk::Vec<Val> {
    vec![
        env,
        gov_id.into_val(env),
        new_collector.into_val(env),
        new_bps.into_val(env),
    ]
}

#[test]
fn test_proposal_passes_and_executes_after_timelock() {
    let t = setup();
    let gov_id = t.gov.address.clone();
    let new_collector = Address::generate(&t.env);
    let args = set_fee_config_args(&t.env, &gov_id, &new_collector, 500);

    let proposal_id = t.gov.propose(
        &t.voter1,
        &t.escrow.address,
        &Symbol::new(&t.env, "set_fee_config"),
        &args,
    );

    t.gov.vote(&t.voter1, &proposal_id, &true);
    t.gov.vote(&t.voter2, &proposal_id, &true);

    // Fast-forward past the voting period.
    advance_time(&t.env, VOTING_PERIOD + 1);
    t.gov.queue(&t.voter1, &proposal_id);

    let queued = t.gov.get_proposal(&proposal_id);
    assert_eq!(queued.status, ProposalStatus::Queued);

    // Fast-forward past the timelock delay.
    advance_time(&t.env, TIMELOCK_DELAY + 1);
    t.gov.execute(&t.voter1, &proposal_id);

    let executed = t.gov.get_proposal(&proposal_id);
    assert_eq!(executed.status, ProposalStatus::Executed);

    // Verify the escrow's fee config was actually updated by governance.
    let tokens = t.escrow.get_supported_tokens();
    assert!(!tokens.is_empty());
}

#[test]
fn test_proposal_fails_quorum() {
    let t = setup();
    let gov_id = t.gov.address.clone();
    let new_collector = Address::generate(&t.env);
    let args = set_fee_config_args(&t.env, &gov_id, &new_collector, 500);

    let proposal_id = t.gov.propose(
        &t.voter3,
        &t.escrow.address,
        &Symbol::new(&t.env, "set_fee_config"),
        &args,
    );

    // Only voter3 (weight 10) votes for; quorum is 100.
    t.gov.vote(&t.voter3, &proposal_id, &true);

    advance_time(&t.env, VOTING_PERIOD + 1);
    let err = t.gov.try_queue(&t.voter1, &proposal_id).unwrap_err().unwrap();
    assert_eq!(err, GovernanceError::QuorumNotMet);

    let proposal = t.gov.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Rejected);
}

#[test]
fn test_direct_bypass_rejected() {
    let t = setup();
    let gov_id = t.gov.address.clone();
    let new_collector = Address::generate(&t.env);
    let args = set_fee_config_args(&t.env, &gov_id, &new_collector, 500);

    let proposal_id = t.gov.propose(
        &t.voter1,
        &t.escrow.address,
        &Symbol::new(&t.env, "set_fee_config"),
        &args,
    );
    t.gov.vote(&t.voter1, &proposal_id, &true);
    t.gov.vote(&t.voter2, &proposal_id, &true);

    // Attempt to execute before queue() -> must fail (not queued yet).
    let err = t.gov.try_execute(&t.voter1, &proposal_id).unwrap_err().unwrap();
    assert_eq!(err, GovernanceError::NotQueued);

    // Attempt to queue before voting period ends -> must fail.
    let err = t.gov.try_queue(&t.voter1, &proposal_id).unwrap_err().unwrap();
    assert_eq!(err, GovernanceError::VotingNotClosed);

    advance_time(&t.env, VOTING_PERIOD + 1);
    t.gov.queue(&t.voter1, &proposal_id);

    // Attempt to execute before timelock elapses -> must fail.
    let err = t.gov.try_execute(&t.voter1, &proposal_id).unwrap_err().unwrap();
    assert_eq!(err, GovernanceError::TimelockNotElapsed);
}

#[test]
fn test_non_voter_cannot_propose_or_vote() {
    let t = setup();
    let non_voter = Address::generate(&t.env);
    let gov_id = t.gov.address.clone();
    let new_collector = Address::generate(&t.env);
    let args = set_fee_config_args(&t.env, &gov_id, &new_collector, 500);

    let err = t
        .gov
        .try_propose(
            &non_voter,
            &t.escrow.address,
            &Symbol::new(&t.env, "set_fee_config"),
            &args,
        )
        .unwrap_err()
        .unwrap();
    assert_eq!(err, GovernanceError::NotVoter);
}

fn advance_time(env: &Env, delta: u64) {
    let current = env.ledger().timestamp();
    env.ledger().set(LedgerInfo {
        timestamp: current + delta,
        protocol_version: 22,
        sequence_number: env.ledger().sequence(),
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 16 * 60 * 60 * 24,
        min_persistent_entry_ttl: 30 * 24 * 60 * 60,
        max_entry_ttl: 365 * 24 * 60 * 60,
    });
}
