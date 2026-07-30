#![no_std]
//! Governance contract (Issue #660).
//!
//! A lightweight proposal + timelock + weighted-vote contract that becomes
//! the sole authorized caller for protocol-critical parameter changes
//! (fee config, registry/token whitelist) on both escrow contracts, replacing
//! raw `admin_caller == admin` checks for those specific parameters. Dispute
//! resolution and other operational admin functions stay out of scope and
//! keep using the existing single-admin path on the escrow contracts.
//!
//! Flow:
//!   propose -> vote (during voting_period_secs) -> queue (once quorum met)
//!   -> execute (after timelock_delay_secs has elapsed since queue) -> Executed
//!
//! `voting_period_secs` and `timelock_delay_secs` are configured once at
//! `initialize` (deploy time) and apply to every proposal.
//!
//! Execution is generic: a proposal carries a target contract address, a
//! function name, and pre-encoded args, so it can call
//! `production_escrow::set_fee_config`, `set_registry_contract`, or the
//! legacy `contracts/escrow` fee/token-whitelist setters once those contracts
//! are updated to accept this contract's address as `admin_caller`.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, Symbol, Val,
    Vec,
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum GovernanceError {
    AlreadyInitialized = 1,
    NotInitialized = 2,

    NotVoter = 10,
    AlreadyVoted = 11,
    InvalidWeight = 12,

    ProposalNotFound = 20,
    VotingClosed = 21,
    VotingNotClosed = 22,
    QuorumNotMet = 23,
    NotQueued = 24,
    TimelockNotElapsed = 25,
    AlreadyExecuted = 26,
    AlreadyQueued = 27,

    InvalidConfig = 30,
}

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProposalStatus {
    Voting,
    Queued,
    Executed,
    /// Voting period ended without reaching quorum; cannot be queued.
    Rejected,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Proposal {
    pub id: u64,
    pub proposer: Address,
    /// Escrow (or any) contract this proposal will call on execution.
    pub target_contract: Address,
    /// Function name to invoke on the target contract, e.g. "set_fee_config".
    pub function_name: Symbol,
    /// Pre-encoded arguments passed to the target function verbatim. The
    /// governance contract's own address is expected to be the first arg
    /// (the `admin_caller`/authorized-caller position) on both escrow
    /// contracts, so callee-side auth checks pass once wired.
    pub args: Vec<Val>,
    pub created_at: u64,
    pub voting_ends_at: u64,
    /// Set once the proposal is queued; execution allowed at queued_at + timelock.
    pub queued_at: u64,
    pub votes_for: u64,
    pub votes_against: u64,
    pub status: ProposalStatus,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    VotingPeriodSecs,
    TimelockDelaySecs,
    QuorumWeight,
    /// Voting weight assigned to a given address. Zero/absent = not a voter.
    VoterWeight(Address),
    TotalWeight,
    ProposalCount,
    Proposal(u64),
    Vote(u64, Address),
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

fn t_governance() -> Symbol {
    symbol_short!("governnc")
}

const TTL_THRESHOLD: u32 = 1_000;
const TTL_EXTEND: u32 = 100_000;

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct GovernanceContract;

#[contractimpl]
impl GovernanceContract {
    /// Initialize the governance contract. `voting_period_secs` and
    /// `timelock_delay_secs` are fixed for the contract's lifetime, per the
    /// acceptance criteria ("configurable at deploy time"). `quorum_weight`
    /// is the minimum total `votes_for` weight required to queue a proposal.
    pub fn initialize(
        env: Env,
        admin: Address,
        voting_period_secs: u64,
        timelock_delay_secs: u64,
        quorum_weight: u64,
    ) -> Result<(), GovernanceError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(GovernanceError::AlreadyInitialized);
        }
        admin.require_auth();
        if voting_period_secs == 0 || quorum_weight == 0 {
            return Err(GovernanceError::InvalidConfig);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::VotingPeriodSecs, &voting_period_secs);
        env.storage()
            .instance()
            .set(&DataKey::TimelockDelaySecs, &timelock_delay_secs);
        env.storage()
            .instance()
            .set(&DataKey::QuorumWeight, &quorum_weight);
        env.storage().instance().set(&DataKey::TotalWeight, &0u64);
        Ok(())
    }

    /// Admin assigns (or updates) a voter's weight. Setting weight to 0
    /// effectively revokes voting rights. This is the only privileged,
    /// single-key action left in the contract — assigning who gets to
    /// weight-vote is a bootstrapping concern, not a parameter change.
    pub fn set_voter_weight(
        env: Env,
        admin_caller: Address,
        voter: Address,
        weight: u64,
    ) -> Result<(), GovernanceError> {
        admin_caller.require_auth();
        let admin = read_admin(&env)?;
        if admin_caller != admin {
            return Err(GovernanceError::NotVoter);
        }

        let key = DataKey::VoterWeight(voter);
        let prev: u64 = env.storage().instance().get(&key).unwrap_or(0);
        let total: u64 = env
            .storage()
            .instance()
            .get(&DataKey::TotalWeight)
            .unwrap_or(0);
        let new_total = total
            .checked_sub(prev)
            .and_then(|t| t.checked_add(weight))
            .ok_or(GovernanceError::InvalidWeight)?;

        env.storage().instance().set(&key, &weight);
        env.storage()
            .instance()
            .set(&DataKey::TotalWeight, &new_total);
        Ok(())
    }

    /// Any registered voter can propose a parameter change. The proposal
    /// targets `target_contract::function_name(args...)`.
    pub fn propose(
        env: Env,
        proposer: Address,
        target_contract: Address,
        function_name: Symbol,
        args: Vec<Val>,
    ) -> Result<u64, GovernanceError> {
        proposer.require_auth();
        let weight = voter_weight(&env, &proposer);
        if weight == 0 {
            return Err(GovernanceError::NotVoter);
        }

        let voting_period_secs: u64 = env
            .storage()
            .instance()
            .get(&DataKey::VotingPeriodSecs)
            .ok_or(GovernanceError::NotInitialized)?;

        let mut id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::ProposalCount)
            .unwrap_or(0);
        id += 1;
        env.storage().instance().set(&DataKey::ProposalCount, &id);

        let now = env.ledger().timestamp();
        let proposal = Proposal {
            id,
            proposer: proposer.clone(),
            target_contract: target_contract.clone(),
            function_name: function_name.clone(),
            args,
            created_at: now,
            voting_ends_at: now + voting_period_secs,
            queued_at: 0,
            votes_for: 0,
            votes_against: 0,
            status: ProposalStatus::Voting,
        };
        save_proposal(&env, &proposal);

        env.events().publish(
            (t_governance(), symbol_short!("proposed")),
            (id, proposer, target_contract, function_name),
        );
        Ok(id)
    }

    /// Registered voter casts a weighted vote for or against a proposal
    /// while voting is open. One vote per address per proposal.
    pub fn vote(
        env: Env,
        voter: Address,
        proposal_id: u64,
        support: bool,
    ) -> Result<(), GovernanceError> {
        voter.require_auth();
        let weight = voter_weight(&env, &voter);
        if weight == 0 {
            return Err(GovernanceError::NotVoter);
        }

        let mut proposal = load_proposal(&env, proposal_id)?;
        if proposal.status != ProposalStatus::Voting {
            return Err(GovernanceError::VotingClosed);
        }
        if env.ledger().timestamp() > proposal.voting_ends_at {
            return Err(GovernanceError::VotingClosed);
        }

        let vote_key = DataKey::Vote(proposal_id, voter.clone());
        if env.storage().persistent().has(&vote_key) {
            return Err(GovernanceError::AlreadyVoted);
        }
        env.storage().persistent().set(&vote_key, &support);
        env.storage()
            .persistent()
            .extend_ttl(&vote_key, TTL_THRESHOLD, TTL_EXTEND);

        if support {
            proposal.votes_for += weight;
        } else {
            proposal.votes_against += weight;
        }
        save_proposal(&env, &proposal);

        env.events().publish(
            (t_governance(), symbol_short!("voted")),
            (proposal_id, voter, support, weight),
        );
        Ok(())
    }

    /// After the voting period ends, anyone can queue a proposal that met
    /// quorum. Starts the timelock clock.
    pub fn queue(env: Env, caller: Address, proposal_id: u64) -> Result<(), GovernanceError> {
        caller.require_auth();
        let mut proposal = load_proposal(&env, proposal_id)?;
        if proposal.status != ProposalStatus::Voting {
            return Err(GovernanceError::AlreadyQueued);
        }
        if env.ledger().timestamp() <= proposal.voting_ends_at {
            return Err(GovernanceError::VotingNotClosed);
        }

        let quorum: u64 = env
            .storage()
            .instance()
            .get(&DataKey::QuorumWeight)
            .ok_or(GovernanceError::NotInitialized)?;
        if proposal.votes_for < quorum || proposal.votes_for <= proposal.votes_against {
            proposal.status = ProposalStatus::Rejected;
            save_proposal(&env, &proposal);
            env.events().publish(
                (t_governance(), symbol_short!("rejected")),
                (proposal_id,),
            );
            return Ok(());
        }

        proposal.status = ProposalStatus::Queued;
        proposal.queued_at = env.ledger().timestamp();
        save_proposal(&env, &proposal);

        env.events()
            .publish((t_governance(), symbol_short!("queued")), (proposal_id,));
        Ok(())
    }

    /// After the timelock delay has elapsed since queuing, anyone can
    /// execute the proposal, invoking `target_contract::function_name(args)`.
    /// A direct-bypass attempt (calling execute before queue/timelock, or on
    /// a rejected/unqueued proposal) is rejected by the status/time checks
    /// below — there is no other path to invoke the target contract through
    /// this contract.
    pub fn execute(env: Env, caller: Address, proposal_id: u64) -> Result<(), GovernanceError> {
        caller.require_auth();
        let mut proposal = load_proposal(&env, proposal_id)?;
        if proposal.status != ProposalStatus::Queued {
            return Err(GovernanceError::NotQueued);
        }

        let timelock_delay_secs: u64 = env
            .storage()
            .instance()
            .get(&DataKey::TimelockDelaySecs)
            .ok_or(GovernanceError::NotInitialized)?;
        if env.ledger().timestamp() < proposal.queued_at + timelock_delay_secs {
            return Err(GovernanceError::TimelockNotElapsed);
        }

        let _: Val = env.invoke_contract(
            &proposal.target_contract,
            &proposal.function_name,
            proposal.args.clone(),
        );

        proposal.status = ProposalStatus::Executed;
        save_proposal(&env, &proposal);

        env.events().publish(
            (t_governance(), symbol_short!("executed")),
            (proposal_id, proposal.target_contract, proposal.function_name),
        );
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    pub fn get_proposal(env: Env, proposal_id: u64) -> Result<Proposal, GovernanceError> {
        load_proposal(&env, proposal_id)
    }

    pub fn get_voter_weight(env: Env, voter: Address) -> u64 {
        voter_weight(&env, &voter)
    }

    pub fn get_admin(env: Env) -> Result<Address, GovernanceError> {
        read_admin(&env)
    }

    pub fn get_quorum_weight(env: Env) -> Result<u64, GovernanceError> {
        env.storage()
            .instance()
            .get(&DataKey::QuorumWeight)
            .ok_or(GovernanceError::NotInitialized)
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn read_admin(env: &Env) -> Result<Address, GovernanceError> {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(GovernanceError::NotInitialized)
}

fn voter_weight(env: &Env, voter: &Address) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::VoterWeight(voter.clone()))
        .unwrap_or(0)
}

fn load_proposal(env: &Env, id: u64) -> Result<Proposal, GovernanceError> {
    env.storage()
        .persistent()
        .get(&DataKey::Proposal(id))
        .ok_or(GovernanceError::ProposalNotFound)
}

fn save_proposal(env: &Env, p: &Proposal) {
    env.storage().persistent().set(&DataKey::Proposal(p.id), p);
    env.storage()
        .persistent()
        .extend_ttl(&DataKey::Proposal(p.id), TTL_THRESHOLD, TTL_EXTEND);
}

#[cfg(test)]
mod test;
