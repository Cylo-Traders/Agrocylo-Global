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
//!
//! ## Contract upgrades (Issue #757)
//!
//! `propose_upgrade` is a dedicated entrypoint (rather than requiring callers
//! to hand-encode `upgrade` args via the generic `propose`) that tags the
//! resulting proposal `ProposalKind::ContractUpgrade`. `queue`/`execute` use
//! `upgrade_timelock_delay_secs` instead of `timelock_delay_secs` for that
//! kind — deliberately longer, since a bad contract upgrade has materially
//! higher blast radius than a parameter change. Everything else (propose,
//! vote, quorum, queue mechanics) is shared, unmodified machinery — an
//! upgrade is not a second privileged pathway, just a different-shaped
//! proposal flowing through the same propose -> vote -> queue -> execute
//! pipeline. See `docs/CONTRACT_UPGRADES.md` for the full strategy,
//! including the pause/upgrade/migrate/unpause sequencing every target
//! contract's `upgrade` and `migrate` entrypoints are designed around.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, BytesN, Env,
    IntoVal, Symbol, Val, Vec,
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

    NotSelfGoverned = 40,
    AlreadyPaused = 41,
    NotPaused = 42,
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

/// Distinguishes an ordinary parameter-change proposal from a contract
/// upgrade (Issue #757). Only affects which timelock delay `execute` applies
/// — `ContractUpgrade` proposals use the longer `UpgradeTimelockDelaySecs`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProposalKind {
    ParameterChange,
    ContractUpgrade,
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
    pub kind: ProposalKind,
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
    /// Timelock applied to `ProposalKind::ContractUpgrade` proposals instead
    /// of `TimelockDelaySecs` (Issue #757). Deliberately longer, given the
    /// blast radius of a bad upgrade vs. an ordinary parameter change.
    UpgradeTimelockDelaySecs,
    QuorumWeight,
    /// Voting weight assigned to a given address. Zero/absent = not a voter.
    VoterWeight(Address),
    TotalWeight,
    ProposalCount,
    Proposal(u64),
    Vote(u64, Address),
    /// Address allowed to instantly `pause` this contract's own operations
    /// (Issue #757) without going through the full proposal flow. Set only
    /// via governance's own propose -> vote -> queue -> execute cycle
    /// (targeting this contract itself) — never by a raw admin call, so a
    /// compromised admin key can't hand emergency powers to itself.
    Guardian,
    Paused,
    SchemaVersion,
}

/// Current on-chain storage layout version. Bump when a stored `#[contracttype]`
/// gains/loses/reshapes a field, and extend `migrate` to translate existing
/// entries — see `docs/CONTRACT_UPGRADES.md`.
const CURRENT_SCHEMA_VERSION: u32 = 1;

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
        upgrade_timelock_delay_secs: u64,
        quorum_weight: u64,
    ) -> Result<(), GovernanceError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(GovernanceError::AlreadyInitialized);
        }
        admin.require_auth();
        if voting_period_secs == 0 || quorum_weight == 0 {
            return Err(GovernanceError::InvalidConfig);
        }
        // Upgrades must never be *faster* to execute than an ordinary
        // parameter change — the whole point is a wider safety margin.
        if upgrade_timelock_delay_secs < timelock_delay_secs {
            return Err(GovernanceError::InvalidConfig);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::VotingPeriodSecs, &voting_period_secs);
        env.storage()
            .instance()
            .set(&DataKey::TimelockDelaySecs, &timelock_delay_secs);
        env.storage().instance().set(
            &DataKey::UpgradeTimelockDelaySecs,
            &upgrade_timelock_delay_secs,
        );
        env.storage()
            .instance()
            .set(&DataKey::QuorumWeight, &quorum_weight);
        env.storage().instance().set(&DataKey::TotalWeight, &0u64);
        env.storage()
            .instance()
            .set(&DataKey::SchemaVersion, &CURRENT_SCHEMA_VERSION);
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
        Self::create_proposal(
            &env,
            proposer,
            target_contract,
            function_name,
            args,
            ProposalKind::ParameterChange,
        )
    }

    /// Propose a governance-gated contract upgrade (Issue #757):
    /// `target_contract::upgrade(governance_address, new_wasm_hash)`. Tagged
    /// `ProposalKind::ContractUpgrade` so `execute` applies
    /// `upgrade_timelock_delay_secs` instead of the ordinary parameter-change
    /// delay. `target_contract` must implement an `upgrade(caller: Address,
    /// new_wasm_hash: BytesN<32>)` entrypoint gated the same way as this
    /// contract's own governed setters (admin-only bootstrap, this contract's
    /// address only once configured) — see `docs/CONTRACT_UPGRADES.md`.
    pub fn propose_upgrade(
        env: Env,
        proposer: Address,
        target_contract: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<u64, GovernanceError> {
        let func = Symbol::new(&env, "upgrade");
        let mut args: Vec<Val> = Vec::new(&env);
        args.push_back(env.current_contract_address().into_val(&env));
        args.push_back(new_wasm_hash.into_val(&env));
        Self::create_proposal(
            &env,
            proposer,
            target_contract,
            func,
            args,
            ProposalKind::ContractUpgrade,
        )
    }

    fn create_proposal(
        env: &Env,
        proposer: Address,
        target_contract: Address,
        function_name: Symbol,
        args: Vec<Val>,
        kind: ProposalKind,
    ) -> Result<u64, GovernanceError> {
        proposer.require_auth();
        let weight = voter_weight(env, &proposer);
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
            kind,
            created_at: now,
            voting_ends_at: now + voting_period_secs,
            queued_at: 0,
            votes_for: 0,
            votes_against: 0,
            status: ProposalStatus::Voting,
        };
        save_proposal(env, &proposal);

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
            return Err(GovernanceError::QuorumNotMet);
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

        let timelock_key = match proposal.kind {
            ProposalKind::ParameterChange => DataKey::TimelockDelaySecs,
            ProposalKind::ContractUpgrade => DataKey::UpgradeTimelockDelaySecs,
        };
        let timelock_delay_secs: u64 = env
            .storage()
            .instance()
            .get(&timelock_key)
            .ok_or(GovernanceError::NotInitialized)?;
        if env.ledger().timestamp() < proposal.queued_at + timelock_delay_secs {
            return Err(GovernanceError::TimelockNotElapsed);
        }

        if proposal.target_contract == env.current_contract_address() {
            // Soroban disallows a contract invoking itself via
            // `invoke_contract` ("Contract re-entry is not allowed"), so a
            // self-targeted proposal (governance upgrading/pausing/
            // reconfiguring itself) is dispatched as a direct internal call
            // instead of a cross-contract one. Reaching this point already
            // means the full propose -> vote -> queue -> timelock gate
            // passed, so no separate caller-identity check is needed here —
            // that's what distinguishes this from a raw admin bypass.
            Self::execute_self_action(&env, &proposal.function_name, &proposal.args)?;
        } else {
            let _: Val = env.invoke_contract(
                &proposal.target_contract,
                &proposal.function_name,
                proposal.args.clone(),
            );
        }

        proposal.status = ProposalStatus::Executed;
        save_proposal(&env, &proposal);

        env.events().publish(
            (t_governance(), symbol_short!("executed")),
            (proposal_id, proposal.target_contract, proposal.function_name),
        );
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Self-upgrade, guardian, pause (Issue #757)
    // -----------------------------------------------------------------------
    //
    // Governance is the root of authority for every other contract's
    // upgrade path, so *its own* upgrade/guardian/unpause changes can't fall
    // back to a raw admin key the way target contracts' bootstrap does —
    // that would just relocate the single-key risk #680 closed elsewhere
    // back into governance itself. They're only reachable by governance
    // executing a proposal against itself (`propose_upgrade`/`propose` with
    // `target_contract` == `env.current_contract_address()`).
    //
    // Unlike the cross-contract case, that can't be wired via `execute`'s
    // normal `env.invoke_contract` — Soroban disallows a contract invoking
    // itself ("Contract re-entry is not allowed"), independent of auth.
    // `execute` special-cases a self-targeted proposal and dispatches to
    // `execute_self_action` below as a direct internal call instead; there
    // is deliberately no public `#[contractimpl]` entrypoint for
    // `upgrade`/`set_guardian`/`unpause`/`migrate` on governance itself; the
    // only way to reach them is a proposal that has already cleared the
    // full propose -> vote -> queue -> timelock gate.

    fn execute_self_action(
        env: &Env,
        function_name: &Symbol,
        args: &Vec<Val>,
    ) -> Result<(), GovernanceError> {
        // Payload args are `(governance_address, ...)` — the leading address
        // keeps the encoding uniform with the cross-contract case (where
        // it's the callee's expected `admin_caller`/authorized-caller
        // position) even though it's redundant here.
        if *function_name == Symbol::new(env, "upgrade") {
            let new_wasm_hash: BytesN<32> = args
                .get(1)
                .ok_or(GovernanceError::InvalidConfig)?
                .into_val(env);
            env.deployer().update_current_contract_wasm(new_wasm_hash.clone());
            env.events()
                .publish((t_governance(), symbol_short!("upgraded")), (new_wasm_hash,));
            Ok(())
        } else if *function_name == Symbol::new(env, "set_guardian") {
            let guardian: Address = args
                .get(1)
                .ok_or(GovernanceError::InvalidConfig)?
                .into_val(env);
            env.storage().instance().set(&DataKey::Guardian, &guardian);
            Ok(())
        } else if *function_name == Symbol::new(env, "unpause") {
            if !env.storage().instance().get(&DataKey::Paused).unwrap_or(false) {
                return Err(GovernanceError::NotPaused);
            }
            env.storage().instance().set(&DataKey::Paused, &false);
            env.events()
                .publish((t_governance(), symbol_short!("unpausd")), ());
            Ok(())
        } else if *function_name == Symbol::new(env, "migrate") {
            let stored: u32 = env
                .storage()
                .instance()
                .get(&DataKey::SchemaVersion)
                .unwrap_or(0);
            if stored < CURRENT_SCHEMA_VERSION {
                env.storage()
                    .instance()
                    .set(&DataKey::SchemaVersion, &CURRENT_SCHEMA_VERSION);
            }
            Ok(())
        } else {
            Err(GovernanceError::InvalidConfig)
        }
    }

    /// Sets (or clears) the guardian allowed to `pause` instantly. Only
    /// reachable via `execute` against a self-targeted proposal — see module
    /// doc above.
    pub fn propose_set_guardian(
        env: Env,
        proposer: Address,
        guardian: Address,
    ) -> Result<u64, GovernanceError> {
        let func = Symbol::new(&env, "set_guardian");
        let mut args: Vec<Val> = Vec::new(&env);
        args.push_back(env.current_contract_address().into_val(&env));
        args.push_back(guardian.into_val(&env));
        Self::create_proposal(
            &env,
            proposer,
            env.current_contract_address(),
            func,
            args,
            ProposalKind::ParameterChange,
        )
    }

    /// Instant pause, callable *only* by the guardian — no timelock,
    /// matching the "lower-risk interim safeguard for the highest-severity
    /// live incidents" acceptance criterion. Deliberately does *not* gate
    /// `propose`/`vote`/`queue`/`execute`: governance must stay operable
    /// while paused so it remains the only path back to `unpause`, and so it
    /// can still be used to pause/fix every *other* contract.
    pub fn pause(env: Env, caller: Address) -> Result<(), GovernanceError> {
        caller.require_auth();
        let is_guardian = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::Guardian)
            .map(|g| g == caller)
            .unwrap_or(false);
        if !is_guardian {
            return Err(GovernanceError::NotSelfGoverned);
        }
        if env.storage().instance().get(&DataKey::Paused).unwrap_or(false) {
            return Err(GovernanceError::AlreadyPaused);
        }
        env.storage().instance().set(&DataKey::Paused, &true);
        env.events()
            .publish((t_governance(), symbol_short!("paused")), (caller,));
        Ok(())
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage().instance().get(&DataKey::Paused).unwrap_or(false)
    }

    pub fn get_schema_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::SchemaVersion)
            .unwrap_or(0)
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

    pub fn get_upgrade_timelock_delay_secs(env: Env) -> Result<u64, GovernanceError> {
        env.storage()
            .instance()
            .get(&DataKey::UpgradeTimelockDelaySecs)
            .ok_or(GovernanceError::NotInitialized)
    }

    pub fn get_guardian(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Guardian)
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
