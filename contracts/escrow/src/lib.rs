#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, Env, Symbol};

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    pub fn hello(env: Env, to: Symbol) -> (Symbol, Symbol) {
        let _ = env;
        (symbol_short!("Hello"), to)
    }
}

mod test;
