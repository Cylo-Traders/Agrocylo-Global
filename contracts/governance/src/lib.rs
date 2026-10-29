use soroban_sdk::{contract, contractimpl, Address, Env, Vec, Map, symbol_short};

#[contract]
pub struct Governance;

#[contractimpl]
impl Governance {
    pub fn initialize(env: Env, voters: Vec<(Address, u64)>, quorum: u64) {
        if voters.is_empty() {
            panic!("Governance: electorate cannot be empty");
        }
        let mut total_weight = 0u64;
        for (voter, weight) in voters.iter() {
            env.storage().instance().set(&voter, &weight);
            total_weight = total_weight.checked_add(weight).expect("Governance: weight overflow");
        }
        if total_weight < quorum {
            panic!("Governance: insufficient total weight for quorum");
        }
        env.storage().instance().set(&symbol_short!("total"), &total_weight);
        env.storage().instance().set(&symbol_short!("quorum"), &quorum);
    }

    pub fn get_total_weight(env: Env) -> u64 {
        env.storage().instance().get(&symbol_short!("total")).unwrap_or(0)
    }
}
