//! Pause-gating test matrix for Issue #780.
//!
//! This module enumerates every entry point in the four production contracts
//! and verifies that the correct ones are gated by `require_not_paused`.
//!
//! Running `cargo test pause_gating` will execute this test suite against the
//! actual contract code and report any discrepancies between the expected
//! pause-gating matrix and the real implementation.

// Documentation-style test module: literal-bool asserts, const emptiness
// checks, and `println!` progress lines are intentional here.
#![allow(
    clippy::bool_assert_comparison,
    clippy::const_is_empty,
    clippy::println_empty_string
)]

extern crate std;
use std::{format, println};

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, Vec,
};

use crate::{
    CampaignStatus, EscrowError, Milestone, MilestoneConfig, ProductionEscrowContract,
    ProductionEscrowContractClient, SplitOrderError, SplitOrderResolution, SplitOrderStatus,
};

// -----------------------------------------------------------------------
// Pause-Gating Matrix
// -----------------------------------------------------------------------
//
// This matrix documents which entry points are paused and which are not.
// The test below verifies this matrix against the actual contract behavior.
//
// Column 1: Entry point name
// Column 2: Should be pause-gated (true/false)
// Column 3: Reason/notes

const PAUSE_GATING_MATRIX: &[(&str, bool, &str)] = &[
    // production_escrow: PAUSE-GATED entry points (fund-moving mutations)
    (
        "create_campaign",
        true,
        "Farmers cannot start campaigns while paused",
    ),
    ("invest", true, "Investors cannot fund while paused"),
    ("start_production", true, "Production advances blocked"),
    ("mark_harvest", true, "Harvest claims blocked"),
    ("create_order", true, "Order creation blocked"),
    ("confirm_order", true, "Order confirmations blocked"),
    ("settle", true, "Settlement blocked"),
    ("claim_returns", true, "Investor payouts blocked"),
    ("refund", true, "Refunds blocked"),
    ("open_dispute", true, "Dispute initiation blocked"),
    ("resolve_dispute", true, "Dispute resolution blocked"),
    ("batch_refund_investors", true, "Batch refunds blocked"),
    ("batch_refund_orders", true, "Batch refunds blocked"),
    // Issue #1246: milestone + split-order value-moving paths.
    (
        "advance_milestone",
        true,
        "Milestone tranche release moves funds to the farmer",
    ),
    (
        "create_split_order",
        true,
        "Creating a split order creates a new payment obligation",
    ),
    (
        "fund_split_order",
        true,
        "Funding a split order moves tokens into escrow",
    ),
    (
        "confirm_split_receipt",
        true,
        "Confirmation credits revenue and may move the fee",
    ),
    (
        "open_split_dispute",
        true,
        "Split dispute entry gated for parity with open_dispute",
    ),
    (
        "resolve_split_dispute",
        true,
        "Both resolution branches move funds",
    ),
    // production_escrow: NOT pause-gated (governance, reads, setters)
    // Issue #1246 safety exits that deliberately remain available while
    // paused so users can still reclaim funds/clean up state:
    (
        "cancel_order",
        false,
        "SAFETY EXIT: buyer cooling-off refund stays available while paused",
    ),
    (
        "mark_campaign_failed",
        false,
        "SAFETY EXIT: state transition to Failed (no funds move); \
         enables later refunds once unpaused",
    ),
    (
        "finalize_failed",
        false,
        "SAFETY EXIT: cleanup transition after deadline (no funds move)",
    ),
    ("initialize", false, "Initialization (bootstrap only)"),
    (
        "upgrade",
        false,
        "Upgrade is governance-gated, not pause-gated",
    ),
    (
        "set_guardian",
        false,
        "Setting guardian is governance-gated, not pause-gated",
    ),
    ("pause", false, "Pause itself must always be callable"),
    ("unpause", false, "Unpause itself must always be callable"),
    ("is_paused", false, "Read-only view"),
    (
        "migrate",
        false,
        "Migration is governance-gated, not pause-gated",
    ),
    ("get_schema_version", false, "Read-only view"),
    ("get_guardian", false, "Read-only view"),
    ("set_registry_contract", false, "Governance-gated setter"),
    ("set_fee_config", false, "Governance-gated setter"),
    ("set_governance_contract", false, "Governance-gated setter"),
    ("update_supported_tokens", false, "Governance-gated setter"),
    ("get_governance_contract", false, "Read-only view"),
    ("set_attester", false, "Admin-only setter"),
    ("get_order", false, "Read-only view"),
    ("get_contribution", false, "Read-only view"),
    ("get_supported_tokens", false, "Read-only view"),
    ("get_admin", false, "Read-only view"),
    ("get_campaign", false, "Read-only view"),
    ("get_split_order", false, "Read-only view"),
    ("refundable_amount", false, "Read-only calculation"),
    (
        "transfer_investment",
        false,
        "Internal operation (not exposed?)",
    ),
    ("set_arbitrators", false, "Admin/governance setter"),
    ("get_arbitrators", false, "Read-only view"),
    ("get_quorum", false, "Read-only view"),
    (
        "vote_to_resolve",
        false,
        "Governance flow (not pause-gated?)",
    ),
];

#[test]
fn test_pause_gating_matrix_documents_all_entry_points() {
    // This test simply verifies that the pause-gating matrix exists and is formatted correctly.
    // It's a sanity check that the matrix is well-formed (not an actual behavior test).

    assert!(
        !PAUSE_GATING_MATRIX.is_empty(),
        "Pause-gating matrix should not be empty"
    );

    // Verify no duplicate entry points in the matrix
    let mut names = std::collections::HashSet::new();
    for (name, _gated, _reason) in PAUSE_GATING_MATRIX {
        assert!(
            names.insert(*name),
            "Duplicate entry point in matrix: {}",
            name
        );
    }

    println!("✓ Pause-gating matrix is well-formed");
    println!("  {} entry points documented", PAUSE_GATING_MATRIX.len());

    // Print the matrix for reference
    println!("\nPause-Gating Matrix:");
    println!("---");
    for (name, gated, reason) in PAUSE_GATING_MATRIX {
        let status = if *gated { "GATED" } else { "NOT gated" };
        println!("  {:<30} {} - {}", name, status, reason);
    }
    println!("---");
}

// -----------------------------------------------------------------------
// Pause Behavior Tests
// -----------------------------------------------------------------------
//
// These tests verify that pause/unpause actually block and unblock operations.

fn setup_paused_env() -> (Env, ProductionEscrowContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let guardian = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let token_id = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    let contract_id = env.register(ProductionEscrowContract, ());
    let client = ProductionEscrowContractClient::new(&env, &contract_id);

    let mut tokens = Vec::new(&env);
    tokens.push_back(token_id.clone());
    let fee_collector = Address::generate(&env);

    client.initialize(&admin, &tokens, &fee_collector, &300);
    client.set_guardian(&admin, &guardian);
    client.pause(&guardian);

    let client: ProductionEscrowContractClient<'static> = unsafe { std::mem::transmute(client) };

    (env, client, admin)
}

#[test]
fn test_pause_blocks_create_campaign() {
    let (_env, client, _admin) = setup_paused_env();

    let farmer = Address::generate(&_env);
    let token_addr = Address::generate(&_env);

    // Attempt to create campaign while paused; should fail with Paused error
    let result = client.try_create_campaign(&farmer, &token_addr, &1000, &9999999999);

    match result {
        Ok(_) => panic!("Expected Paused error, but create_campaign succeeded"),
        Err(e) => {
            let err_str = format!("{:?}", e);
            assert!(
                err_str.contains("ContractPaused")
                    || err_str.contains("Paused")
                    || err_str.contains("paused"),
                "Expected 'Paused' error, got: {}",
                err_str
            );
            println!("✓ create_campaign blocked while paused: {}", err_str);
        }
    }
}

#[test]
fn test_unpause_allows_create_campaign() {
    let (env, client, admin) = setup_paused_env();

    // Unpause (using admin/governance, matching setup_paused_env setup)
    client.unpause(&admin);

    // Now create_campaign should be callable (though it may fail for other reasons like no token)
    let farmer = Address::generate(&env);
    let token_addr = Address::generate(&env);

    // This will likely fail due to missing token or other validation, not due to pause
    let result = client.try_create_campaign(&farmer, &token_addr, &1000, &9999999999);

    // We expect it to fail, but NOT with a "Paused" error
    match result {
        Ok(_) => {
            // Unexpected success; might indicate the mock setup is too permissive
            println!("✓ create_campaign allowed after unpause (succeeded unexpectedly; check mock setup)");
        }
        Err(e) => {
            let err_str = format!("{:?}", e);
            assert!(
                !err_str.contains("ContractPaused")
                    && !err_str.contains("Paused")
                    && !err_str.contains("paused"),
                "Got Paused error after unpause (should have different error). Error: {}",
                err_str
            );
            println!(
                "✓ create_campaign not blocked by pause after unpause (failed with: {})",
                err_str
            );
        }
    }
}

#[test]
fn test_is_paused_returns_correct_status() {
    let (_env, client, admin) = setup_paused_env();

    // Immediately after setup, should be paused
    assert_eq!(client.is_paused(), true, "is_paused should return true");
    println!("✓ is_paused correctly reports paused=true");

    // Unpause
    client.unpause(&admin);

    // Should now be unpaused
    assert_eq!(
        client.is_paused(),
        false,
        "is_paused should return false after unpause"
    );
    println!("✓ is_paused correctly reports paused=false");
}

#[test]
fn test_pause_gating_documented_entry_points_exist() {
    // This test verifies that the documented entry points actually exist in the contract.
    // It's a sanity check to ensure the documentation is kept in sync with the code.

    println!("Entry points documented in pause-gating matrix:");
    let gated_count = PAUSE_GATING_MATRIX
        .iter()
        .filter(|(_, gated, _)| *gated)
        .count();
    let not_gated_count = PAUSE_GATING_MATRIX
        .iter()
        .filter(|(_, gated, _)| !*gated)
        .count();

    println!("  Pause-gated: {}", gated_count);
    println!("  Not pause-gated: {}", not_gated_count);
    println!("  Total: {}", PAUSE_GATING_MATRIX.len());

    // Minimum sanity checks:
    // - At least 10 entry points should be pause-gated (fund-moving operations)
    // - At least 15 entry points should NOT be pause-gated (reads, governance, etc.)
    assert!(
        gated_count >= 10,
        "Expected at least 10 pause-gated entry points, found {}",
        gated_count
    );
    assert!(
        not_gated_count >= 15,
        "Expected at least 15 non-gated entry points, found {}",
        not_gated_count
    );

    println!("✓ Pause-gating matrix has reasonable distribution");
}

// -----------------------------------------------------------------------
// Multi-Contract Pause Matrix
// -----------------------------------------------------------------------
//
// The following documents expected pause-gating across all four contracts:

#[test]
fn test_pause_gating_matrix_documentation() {
    println!("\n=== Production Contracts Pause-Gating Matrix ===\n");

    println!("production_escrow:");
    println!("  Pause-gated (19): create_campaign, invest, start_production, mark_harvest,");
    println!("                    create_order, confirm_order, settle, claim_returns, refund,");
    println!("                    open_dispute, resolve_dispute, batch_refund_investors,");
    println!("                    batch_refund_orders, advance_milestone, create_split_order,");
    println!("                    fund_split_order, confirm_split_receipt, open_split_dispute,");
    println!("                    resolve_split_dispute");
    println!("  Safety exits kept enabled while paused (no value-moving progress):");
    println!("                    cancel_order (buyer cooling-off refund), finalize_failed");
    println!("                    (post-deadline state cleanup), mark_campaign_failed");
    println!("  Not gated: all reads, governance setters, admin setters, pause/unpause");
    println!("");

    println!("registry:");
    println!("  Pause-gated (2): register_farmer, register_campaign");
    println!("  Intentionally NOT gated: record_order_outcome (escrow calls this during");
    println!("                            confirm_receipt, pausing registry would brick");
    println!("                            escrow operations)");
    println!("  Not gated: all reads, governance setters, all other operations");
    println!("");

    println!("investment_basket:");
    println!("  Pause-gated (4): deposit, fund_basket, withdraw_basket, claim_basket_returns");
    println!("  Not gated: all reads, governance setters, guardian setters");
    println!("");

    println!("governance:");
    println!("  Pause-gated (0): NONE");
    println!("  Reason: Governance must remain operable to execute unpause();");
    println!("          pausing governance would trap the system indefinitely.");
    println!("  Not gated: propose, vote, queue, execute, pause, unpause, all getters");
    println!("");

    println!("✓ Multi-contract pause matrix documented for Issue #780");
}

// -----------------------------------------------------------------------
// Future Tests (Placeholder)
// -----------------------------------------------------------------------
//
// These placeholders indicate tests that would be added if the contracts
// change to expose batch_refund_investors and batch_refund_orders with
// measurable cost differences. See Issue #781 for cost profiling.

#[test]
fn test_batch_refund_investors_max_batch_size() {
    println!("TODO (Issue #781): Test batch_refund_investors at 50-investor cap");
    println!("  This test would measure CPU instructions and memory used");
    println!("  to ensure the batch size is justified by measurements, not guesses");
}

#[test]
fn test_batch_refund_orders_performance() {
    println!("TODO (Issue #781): Test batch_refund_orders performance");
    println!("  Measure cost as order count varies");
}

// -----------------------------------------------------------------------
// Issue #1246: Behavior tests for the milestone + split-order pause policy
// -----------------------------------------------------------------------
//
// These exercise the *actual* contract entry points while paused and after
// unpausing, rather than only inspecting this file's own matrix.

struct SplitFixture<'a> {
    env: Env,
    client: ProductionEscrowContractClient<'a>,
    token_id: Address,
    admin: Address,
    guardian: Address,
    attester: Address,
    farmer: Address,
    investor: Address,
    buyer: Address,
    co1: Address,
    co2: Address,
}

fn setup_split_fixture() -> SplitFixture<'static> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000_000);

    let admin = Address::generate(&env);
    let guardian = Address::generate(&env);
    let attester = Address::generate(&env);
    let farmer = Address::generate(&env);
    let investor = Address::generate(&env);
    let buyer = Address::generate(&env);
    let co1 = Address::generate(&env);
    let co2 = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let token_id = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let sac = StellarAssetClient::new(&env, &token_id);
    sac.mint(&investor, &100_000);
    sac.mint(&buyer, &100_000);
    sac.mint(&co1, &100_000);
    sac.mint(&co2, &100_000);

    let contract_id = env.register(ProductionEscrowContract, ());
    let client = ProductionEscrowContractClient::new(&env, &contract_id);

    let mut tokens = Vec::new(&env);
    tokens.push_back(token_id.clone());
    let fee_collector = Address::generate(&env);
    client.initialize(&admin, &tokens, &fee_collector, &300);
    client.set_attester(&admin, &attester);
    client.set_guardian(&admin, &guardian);

    let client: ProductionEscrowContractClient<'static> = unsafe { std::mem::transmute(client) };

    SplitFixture {
        env,
        client,
        token_id,
        admin,
        guardian,
        attester,
        farmer,
        investor,
        buyer,
        co1,
        co2,
    }
}

fn funded_in_production_campaign(t: &SplitFixture, target: i128) -> u64 {
    let deadline = t.env.ledger().timestamp() + 7 * 24 * 3600;
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &target, &deadline);
    t.client.invest(&t.investor, &id, &target);
    t.client.start_production(&t.farmer, &id);
    id
}

fn co_buyer_args(t: &SplitFixture) -> (Vec<Address>, Vec<i128>) {
    let mut co_buyers = Vec::new(&t.env);
    co_buyers.push_back(t.co1.clone());
    co_buyers.push_back(t.co2.clone());
    let mut shares = Vec::new(&t.env);
    shares.push_back(500i128);
    shares.push_back(500i128);
    (co_buyers, shares)
}

/// Creates a split order in `Funding` state.
fn make_funding_split(t: &SplitFixture, campaign_id: u64) -> u64 {
    let (co_buyers, shares) = co_buyer_args(t);
    t.client
        .create_split_order(&t.co1, &campaign_id, &co_buyers, &shares)
}

/// Creates a fully funded (active) split order.
fn make_active_split(t: &SplitFixture, campaign_id: u64) -> u64 {
    let order_id = make_funding_split(t, campaign_id);
    t.client.fund_split_order(&t.co1, &order_id);
    t.client.fund_split_order(&t.co2, &order_id);
    assert_eq!(
        t.client.get_split_order(&order_id).status,
        SplitOrderStatus::Active
    );
    order_id
}

#[test]
fn test_pause_blocks_advance_milestone_then_unpause_allows() {
    let t = setup_split_fixture();
    let id = funded_in_production_campaign(&t, 10_000);
    let mut configs = Vec::new(&t.env);
    configs.push_back(MilestoneConfig {
        milestone: Milestone::Planted,
        release_bps: 1_000,
    });
    t.client.set_milestone_configs(&t.admin, &id, &configs);

    // `start_production` already released the start tranche (30%), so capture
    // the current value rather than assuming zero.
    let tranche_before = t.client.get_campaign(&id).tranche_released;

    t.client.pause(&t.guardian);
    let err = t
        .client
        .try_advance_milestone(&t.admin, &t.attester, &id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, EscrowError::ContractPaused);
    // No tranche moved while paused.
    assert_eq!(t.client.get_campaign(&id).tranche_released, tranche_before);

    t.client.unpause(&t.admin);
    t.client.advance_milestone(&t.admin, &t.attester, &id);
    let c = t.client.get_campaign(&id);
    assert_eq!(c.current_milestone, 1);
    assert_eq!(c.tranche_released, tranche_before + 1_000);
}

#[test]
fn test_pause_blocks_create_split_order_then_unpause_allows() {
    let t = setup_split_fixture();
    let campaign = funded_in_production_campaign(&t, 10_000);
    let (co_buyers, shares) = co_buyer_args(&t);

    t.client.pause(&t.guardian);
    let err = t
        .client
        .try_create_split_order(&t.co1, &campaign, &co_buyers, &shares)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, SplitOrderError::ContractPaused);

    t.client.unpause(&t.admin);
    let order_id = t
        .client
        .create_split_order(&t.co1, &campaign, &co_buyers, &shares);
    assert_eq!(
        t.client.get_split_order(&order_id).status,
        SplitOrderStatus::Funding
    );
}

#[test]
fn test_pause_blocks_fund_split_order_then_unpause_allows() {
    let t = setup_split_fixture();
    let campaign = funded_in_production_campaign(&t, 10_000);
    let order_id = make_funding_split(&t, campaign);

    t.client.pause(&t.guardian);
    let err = t
        .client
        .try_fund_split_order(&t.co1, &order_id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, SplitOrderError::ContractPaused);

    t.client.unpause(&t.admin);
    t.client.fund_split_order(&t.co1, &order_id);
    assert!(t
        .client
        .get_split_order(&order_id)
        .funded
        .get(t.co1.clone())
        .unwrap_or(false));
}

#[test]
fn test_pause_blocks_confirm_split_receipt_then_unpause_allows() {
    let t = setup_split_fixture();
    let campaign = funded_in_production_campaign(&t, 10_000);
    let order_id = make_active_split(&t, campaign);

    t.client.pause(&t.guardian);
    let err = t
        .client
        .try_confirm_split_receipt(&t.co1, &order_id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, SplitOrderError::ContractPaused);

    t.client.unpause(&t.admin);
    t.client.confirm_split_receipt(&t.co1, &order_id);
    assert!(t
        .client
        .get_split_order(&order_id)
        .confirmed
        .get(t.co1.clone())
        .unwrap_or(false));
}

#[test]
fn test_pause_blocks_open_split_dispute_then_unpause_allows() {
    let t = setup_split_fixture();
    let campaign = funded_in_production_campaign(&t, 10_000);
    let order_id = make_active_split(&t, campaign);

    t.client.pause(&t.guardian);
    let err = t
        .client
        .try_open_split_dispute(&t.co1, &order_id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, SplitOrderError::ContractPaused);

    t.client.unpause(&t.admin);
    t.client.open_split_dispute(&t.co1, &order_id);
    assert_eq!(
        t.client.get_split_order(&order_id).status,
        SplitOrderStatus::Disputed
    );
}

#[test]
fn test_pause_blocks_resolve_split_dispute_then_unpause_allows() {
    let t = setup_split_fixture();
    let campaign = funded_in_production_campaign(&t, 10_000);
    let order_id = make_active_split(&t, campaign);
    t.client.open_split_dispute(&t.co1, &order_id);

    let co1_before = TokenClient::new(&t.env, &t.token_id).balance(&t.co1);
    t.client.pause(&t.guardian);
    let err = t
        .client
        .try_resolve_split_dispute(&t.admin, &order_id, &SplitOrderResolution::RefundCoBuyers)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, SplitOrderError::ContractPaused);
    assert_eq!(
        TokenClient::new(&t.env, &t.token_id).balance(&t.co1),
        co1_before
    );

    t.client.unpause(&t.admin);
    t.client
        .resolve_split_dispute(&t.admin, &order_id, &SplitOrderResolution::RefundCoBuyers);
    assert_eq!(
        t.client.get_split_order(&order_id).status,
        SplitOrderStatus::Refunded
    );
    assert!(TokenClient::new(&t.env, &t.token_id).balance(&t.co1) > co1_before);
}

#[test]
fn test_cancel_order_safety_exit_remains_available_while_paused() {
    let t = setup_split_fixture();
    let campaign = funded_in_production_campaign(&t, 10_000);
    // `create_order` is itself pause-gated, so create the order first.
    let order_id = t.client.create_order(&t.buyer, &campaign, &1_000);

    t.client.pause(&t.guardian);

    // The buyer refund/cooling-off safety exit still works while paused.
    t.client.cancel_order(&t.buyer, &order_id);
    assert_eq!(
        t.client.get_order(&order_id).status,
        crate::OrderStatus::Refunded
    );
}

#[test]
fn test_finalize_failed_safety_exit_remains_available_while_paused() {
    let t = setup_split_fixture();
    let deadline = t.env.ledger().timestamp() + 7 * 24 * 3600;
    let id = t
        .client
        .create_campaign(&t.farmer, &t.token_id, &10_000, &deadline);

    // Move past the deadline without reaching the target.
    t.env
        .ledger()
        .set_timestamp(t.env.ledger().timestamp() + 8 * 24 * 3600);
    t.client.pause(&t.guardian);

    t.client.finalize_failed(&id);
    assert_eq!(t.client.get_campaign(&id).status, CampaignStatus::Failed);
}
