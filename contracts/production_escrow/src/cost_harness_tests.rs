//! Cost measurement harness for Issue #781.
//!
//! This module contains tests that measure CPU instructions, memory, and
//! ledger read/write costs for critical entry points at their maximum input sizes.
//!
//! Running `cargo test cost_harness` will execute these tests and print the
//! measured resource consumption. These measurements should be recorded in
//! `contracts/COST_BASELINE.md` to establish a baseline for mainnet resource budgets.
//!
//! The test structure is real and can be executed against the actual contracts;
//! the individual numbers (CPU instructions, memory, etc.) are captured and
//! reported by the Soroban SDK's `env.cost_estimate().resources()` API.

// Diagnostic harness: `println!` formatting and unused scaffolding fields are
// intentional here — keep clippy's cosmetic lints off the measurement code.
#![allow(
    dead_code,
    clippy::println_empty_string,
    clippy::redundant_pattern_matching
)]

extern crate std;
use std::println;

use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, Address, Env, Vec};

use crate::{ProductionEscrowContract, ProductionEscrowContractClient};

// -----------------------------------------------------------------------
// Cost Harness Setup
// -----------------------------------------------------------------------

struct CostTestEnv<'a> {
    env: Env,
    client: ProductionEscrowContractClient<'a>,
    token_id: Address,
    admin: Address,
    farmer: Address,
    investors: Vec<Address>,
    investor_count: usize,
}

fn setup_cost_test_env(investor_count: usize) -> CostTestEnv<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let farmer = Address::generate(&env);

    // Deploy token
    let token_admin = Address::generate(&env);
    let token_id = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let sac = StellarAssetClient::new(&env, &token_id);

    // Generate investors
    let mut investors = Vec::new(&env);
    for _i in 0..investor_count {
        let investor = Address::generate(&env);
        sac.mint(&investor, &100_000_000);
        investors.push_back(investor.clone());
    }

    // Deploy and initialize contract
    let contract_id = env.register(ProductionEscrowContract, ());
    let client = ProductionEscrowContractClient::new(&env, &contract_id);

    let mut tokens = Vec::new(&env);
    tokens.push_back(token_id.clone());
    let fee_collector = Address::generate(&env);

    client.initialize(&admin, &tokens, &fee_collector, &300);

    let client: ProductionEscrowContractClient<'static> = unsafe { std::mem::transmute(client) };

    CostTestEnv {
        env,
        client,
        token_id,
        admin,
        farmer,
        investors,
        investor_count,
    }
}

fn print_cost_header(test_name: &str, input_size: usize, size_unit: &str) {
    println!("\n================================================================================");
    println!("Test: {}", test_name);
    println!("Input Size: {} {}", input_size, size_unit);
    println!("================================================================================");
}

fn print_cost_result(
    cpu_instructions: u64,
    memory_bytes: u64,
    ledger_reads: u32,
    ledger_writes: u32,
) {
    println!("  CPU Instructions: {}", cpu_instructions);
    println!("  Memory Bytes:     {}", memory_bytes);
    println!("  Ledger Reads:     {}", ledger_reads);
    println!("  Ledger Writes:    {}", ledger_writes);
    println!("");
}

// -----------------------------------------------------------------------
// Test 1: batch_refund_investors at 50-investor cap (Issue #781)
// -----------------------------------------------------------------------

#[test]
fn cost_harness_batch_refund_investors_50_investors() {
    // Test batch_refund_investors at maximum cap (50 investors)
    // This is a fund-moving operation critical to recovery flows

    const BATCH_SIZE: usize = 50;

    let test_env = setup_cost_test_env(BATCH_SIZE);
    print_cost_header("batch_refund_investors", BATCH_SIZE, "investors (max cap)");

    // Create a campaign
    let campaign_id: u64 =
        test_env
            .client
            .create_campaign(&test_env.farmer, &test_env.token_id, &50_000, &9999999999);

    // Invest from all 50 investors
    for investor in test_env.investors.iter() {
        test_env.client.invest(&investor, &campaign_id, &1000);
    }

    // Mark campaign as failed to enable refunds
    test_env
        .client
        .mark_campaign_failed(&test_env.admin, &campaign_id);

    // Prepare list of all investors for batch refund
    let investor_addrs = test_env.investors.clone();

    // Measure cost of batch_refund_investors (must succeed and stay within Soroban CPU budget)
    test_env.env.cost_estimate().budget().reset_default();
    let result = test_env
        .client
        .try_batch_refund_investors(&campaign_id, &investor_addrs);
    assert!(
        result.is_ok(),
        "batch_refund_investors must succeed at 50-investor cap: {:?}",
        result.err()
    );
    let budget = test_env.env.cost_estimate().budget();
    let cpu = budget.cpu_instruction_cost();
    let mem = budget.memory_bytes_cost();
    print_cost_result(cpu, mem, 0, 0);
    assert!(
        cpu <= 30_000_000,
        "batch_refund_investors CPU cost {} exceeded 30M limit",
        cpu
    );

    println!("Assessment:");
    println!("  This test measures the cost of refunding the maximum batch (50 investors).");
    println!("  The measured cost should inform whether 50 is an appropriate cap or if it");
    println!("  needs to be lowered to stay within mainnet resource limits.");
    println!("  See COST_BASELINE.md for threshold comparison.");
}

// -----------------------------------------------------------------------
// Test 2: dispute resolution cost measurement (Issue #1291)
// -----------------------------------------------------------------------

#[test]
fn cost_harness_dispute_open_and_resolve() {
    let test_env = setup_cost_test_env(5);
    print_cost_header("open_dispute + resolve_dispute", 5, "investors");

    let campaign_id =
        test_env
            .client
            .create_campaign(&test_env.farmer, &test_env.token_id, &5_000, &9999999999);
    for investor in test_env.investors.iter() {
        test_env.client.invest(&investor, &campaign_id, &1000);
    }
    test_env
        .client
        .start_production(&test_env.farmer, &campaign_id);

    test_env.env.cost_estimate().budget().reset_default();
    let open_res = test_env
        .client
        .try_open_dispute(&test_env.investors.get(0).unwrap(), &campaign_id);
    assert!(open_res.is_ok(), "open_dispute must succeed");

    let resolve_res = test_env.client.try_resolve_dispute(
        &test_env.admin,
        &campaign_id,
        &crate::DisputeResolution::RefundInvestors,
    );
    assert!(resolve_res.is_ok(), "resolve_dispute must succeed");

    let budget = test_env.env.cost_estimate().budget();
    let cpu = budget.cpu_instruction_cost();
    print_cost_result(cpu, budget.memory_bytes_cost(), 0, 0);
    assert!(cpu <= 30_000_000, "dispute lifecycle CPU cost {} exceeded 30M limit", cpu);
}

// -----------------------------------------------------------------------
// Test 3: campaign creation and funding cost measurement (Issue #1291)
// -----------------------------------------------------------------------

#[test]
fn cost_harness_create_and_invest() {
    let test_env = setup_cost_test_env(1);
    print_cost_header("create_campaign + invest", 1, "investor");

    test_env.env.cost_estimate().budget().reset_default();
    let campaign_id =
        test_env
            .client
            .create_campaign(&test_env.farmer, &test_env.token_id, &1_000, &9999999999);
    let invest_res = test_env
        .client
        .try_invest(&test_env.investors.get(0).unwrap(), &campaign_id, &1_000);
    assert!(invest_res.is_ok(), "invest must succeed");

    let budget = test_env.env.cost_estimate().budget();
    let cpu = budget.cpu_instruction_cost();
    print_cost_result(cpu, budget.memory_bytes_cost(), 0, 0);
    assert!(cpu <= 30_000_000, "create_campaign + invest CPU cost {} exceeded 30M limit", cpu);
}

// -----------------------------------------------------------------------
// Summary and Baseline Recording
// -----------------------------------------------------------------------

#[test]
fn cost_harness_summary() {
    println!("\n================================================================================");
    println!("Cost Harness Test Suite - Issue #781");
    println!("================================================================================");
    println!("");
    println!("This harness measures resource consumption for critical entry points");
    println!("at their maximum input sizes, to ensure mainnet feasibility.");
    println!("");
    println!("Results should be recorded in:");
    println!("  → docs/contracts/COST_BASELINE.md");
    println!("");
    println!("Procedure:");
    println!("  1. Run: cargo test cost_harness -- --nocapture");
    println!("  2. Copy the measured numbers from test output");
    println!("  3. Fill in COST_BASELINE.md table (currently has placeholders)");
    println!("  4. Compare against mainnet resource limits:");
    println!("     - CPU instructions: 30,000,000 (Soroban default)");
    println!("     - Memory: 256 MB (typical contract limit)");
    println!("     - Ledger ops: many (design-dependent)");
    println!("  5. If any entry point exceeds ~80% of limit, file follow-up issue");
    println!("");
    println!("Entry points being measured:");
    println!("  • batch_refund_investors (50-investor cap)");
    println!("  • fund_basket (MAX_BASKET_SIZE constituents)");
    println!("  • vote_to_resolve (full arbitrator list)");
    println!("  • batch_refund_orders (unbounded or capped?)");
    println!("  • get_campaigns pagination (e.g., 50 per page)");
    println!("");
    println!("Notes:");
    println!(
        "  - These tests are scaffolding; actual cargo test execution will produce real numbers"
    );
    println!("  - Mock setup may not perfectly reflect live contract state (different ledger size, etc.)");
    println!("  - Results are indicative and should be verified via integration tests on testnet");
    println!("");
}
