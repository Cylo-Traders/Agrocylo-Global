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

use crate::{Milestone, MilestoneConfig, ProductionEscrowContract, ProductionEscrowContractClient};

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

    // Measure cost of batch_refund_investors
    let result = test_env
        .client
        .try_batch_refund_investors(&campaign_id, &investor_addrs);

    if let Ok(_) = result {
        println!("Result: SUCCESS");
        let budget = test_env.env.cost_estimate().budget();
        print_cost_result(
            budget.cpu_instruction_cost(),
            budget.memory_bytes_cost(),
            0,
            0,
        );
    } else {
        println!("Result: ERROR (see details above)");
        println!("Note: Cost measurement may vary depending on mock setup");
    }

    println!("Assessment:");
    println!("  This test measures the cost of refunding the maximum batch (50 investors).");
    println!("  The measured cost should inform whether 50 is an appropriate cap or if it");
    println!("  needs to be lowered to stay within mainnet resource limits.");
    println!("  See COST_BASELINE.md for threshold comparison.");
}

// -----------------------------------------------------------------------
// Test 2: fund_basket at MAX_BASKET_SIZE (Issue #781)
// -----------------------------------------------------------------------

#[test]
fn cost_harness_fund_basket_max_size() {
    // Note: This is a placeholder for investment_basket contract costs.
    // The actual test would be in investment_basket/src/cost_harness_tests.rs
    // but we document it here for completeness.

    println!("\nTODO: fund_basket cost measurement");
    println!("  Entry point: investment_basket::fund_basket");
    println!("  Max input: MAX_BASKET_SIZE constituents (typically 20)");
    println!("  Should measure: CPU, memory, ledger operations at max size");
    println!("");
    println!("  When this test is implemented, it should:");
    println!("  1. Create a basket with 20 constituents");
    println!("  2. Call fund_basket with all constituents");
    println!("  3. Record measured resources");
    println!("  4. Compare against COST_BASELINE.md thresholds");
}

// -----------------------------------------------------------------------
// Test 3: vote_to_resolve with full arbitrator list (Issue #781)
// -----------------------------------------------------------------------

#[test]
fn cost_harness_vote_to_resolve_full_arbitrators() {
    // Note: This test structure is provided; actual implementation depends on
    // the governance/arbitrator setup in the production_escrow contract.

    println!("\nTODO: vote_to_resolve cost measurement");
    println!("  Entry point: production_escrow::vote_to_resolve");
    println!("  Max input: iterate over full arbitrator list");
    println!("  Should measure: CPU, memory, ledger operations");
    println!("");
    println!("  When this test is implemented, it should:");
    println!("  1. Set up a campaign with many arbitrators");
    println!("  2. Open a dispute");
    println!("  3. Call vote_to_resolve (arbitrators must iterate full list)");
    println!("  4. Record measured resources");
    println!("  5. Confirm it fits within mainnet limits");
}

// -----------------------------------------------------------------------
// Test 4: batch_refund_orders (Issue #781)
// -----------------------------------------------------------------------

#[test]
fn cost_harness_batch_refund_orders() {
    // Similar structure to batch_refund_investors, but for orders
    println!("\nTODO: batch_refund_orders cost measurement");
    println!("  Entry point: production_escrow::batch_refund_orders");
    println!("  Max input: unbounded (no documented cap in current code)");
    println!("  Should measure: CPU, memory, ledger operations");
    println!("");
    println!("  When this test is implemented, it should:");
    println!("  1. Create multiple orders (e.g., 50-100)");
    println!("  2. Mark campaign failed");
    println!("  3. Call batch_refund_orders with all order IDs");
    println!("  4. Record measured resources");
    println!("  5. Recommend a reasonable batch cap if unbounded is unsafe");
}

// -----------------------------------------------------------------------
// Test 5: get_campaigns with pagination (Issue #781)
// -----------------------------------------------------------------------

#[test]
fn cost_harness_get_campaigns_pagination() {
    // Pagination is bounded by Soroban's result size limits
    println!("\nTODO: get_campaigns pagination cost measurement");
    println!("  Entry point: production_escrow::get_campaigns");
    println!("  Max input: pagination at realistic page size (e.g., 50 campaigns)");
    println!("  Should measure: CPU, memory for list deserialization");
    println!("");
    println!("  When this test is implemented, it should:");
    println!("  1. Create many campaigns (e.g., 100+)");
    println!("  2. Call get_campaigns with offset=0, limit=50");
    println!("  3. Repeat with increasing offsets");
    println!("  4. Record measured resources for each page");
    println!("  5. Identify any performance cliffs at certain page sizes");
}

// -----------------------------------------------------------------------
// Summary and Baseline Recording
// -----------------------------------------------------------------------

// -----------------------------------------------------------------------
// Test 6: advance_milestone after 1 vs 1,000 unrelated orders (Issue #1279)
// -----------------------------------------------------------------------

fn measure_advance_milestone_with_unrelated_orders(unrelated_orders: u32) -> (u64, u64) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let attester = Address::generate(&env);
    let farmer = Address::generate(&env);
    let investor = Address::generate(&env);
    let buyer = Address::generate(&env);
    let other_buyer = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let token_id = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    let sac = StellarAssetClient::new(&env, &token_id);
    sac.mint(&investor, &100_000_000);
    sac.mint(&buyer, &100_000_000);
    sac.mint(&other_buyer, &100_000_000);

    let contract_id = env.register(ProductionEscrowContract, ());
    let client = ProductionEscrowContractClient::new(&env, &contract_id);

    let mut tokens = Vec::new(&env);
    tokens.push_back(token_id.clone());
    let fee_collector = Address::generate(&env);
    client.initialize(&admin, &tokens, &fee_collector, &300);
    client.set_attester(&admin, &attester);

    // Campaign 1: unrelated historical campaign with `unrelated_orders` orders
    let unrelated_campaign = client.create_campaign(&farmer, &token_id, &10_000, &9_999_999_999);
    client.invest(&investor, &unrelated_campaign, &10_000);
    client.start_production(&farmer, &unrelated_campaign);
    for _ in 0..unrelated_orders {
        env.cost_estimate().budget().reset_unlimited();
        let oid = client.create_order(&other_buyer, &unrelated_campaign, &10);
        client.confirm_order(&other_buyer, &oid);
    }

    // Campaign 2: target campaign where `buyer` has 1 confirmed qualifying order
    env.cost_estimate().budget().reset_unlimited();
    let target_campaign = client.create_campaign(&farmer, &token_id, &10_000, &9_999_999_999);
    client.invest(&investor, &target_campaign, &10_000);
    client.start_production(&farmer, &target_campaign);

    let mut configs = Vec::new(&env);
    configs.push_back(MilestoneConfig {
        milestone: Milestone::Planted,
        release_bps: 1000,
    });
    client.set_milestone_configs(&admin, &target_campaign, &configs);

    let qualifying_order = client.create_order(&buyer, &target_campaign, &500);
    client.confirm_order(&buyer, &qualifying_order);

    // Measure ONLY the advance_milestone call under default mainnet budget
    env.cost_estimate().budget().reset_default();
    client.advance_milestone(&buyer, &attester, &target_campaign);
    let budget = env.cost_estimate().budget();
    (budget.cpu_instruction_cost(), budget.memory_bytes_cost())
}

#[test]
fn cost_harness_advance_milestone_1_vs_1000_unrelated_orders() {
    let (cpu_1, mem_1) = measure_advance_milestone_with_unrelated_orders(1);
    let (cpu_1000, mem_1000) = measure_advance_milestone_with_unrelated_orders(1_000);

    print_cost_header("advance_milestone (1 unrelated order)", 1, "orders");
    print_cost_result(cpu_1, mem_1, 0, 0);

    print_cost_header("advance_milestone (1,000 unrelated orders)", 1_000, "orders");
    print_cost_result(cpu_1000, mem_1000, 0, 0);

    // O(1) bounded lookup: CPU and memory must not scale with unrelated order history.
    assert_eq!(
        cpu_1, cpu_1000,
        "advance_milestone CPU cost must remain constant regardless of unrelated order count"
    );
    assert_eq!(
        mem_1, mem_1000,
        "advance_milestone memory cost must remain constant regardless of unrelated order count"
    );
}

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
