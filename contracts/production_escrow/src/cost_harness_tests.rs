use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token,
    Address, Env, Vec,
};

use crate::{ProductionEscrow, ProductionEscrowClient, Resolution};

const MAX_CPU: u64 = 100_000_000;
const MAX_MEM: u64 = 40_000_000;

fn measure<F: FnOnce()>(env: &Env, f: F) -> (u64, u64) {
    env.budget().reset_default();
    f();
    (
        env.budget().cpu_instruction_cost(),
        env.budget().memory_bytes_cost(),
    )
}

fn assert_within(label: &str, cpu: u64, mem: u64) {
    assert!(cpu <= MAX_CPU, "{label} cpu {cpu} > {MAX_CPU}");
    assert!(mem <= MAX_MEM, "{label} mem {mem} > {MAX_MEM}");
}

fn setup(
    env: &Env,
) -> (
    ProductionEscrowClient,
    Address,
    Address,
    Address,
    Address,
    Address,
    Address,
) {
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000);
    let admin = Address::generate(env);
    let farmer = Address::generate(env);
    let investor = Address::generate(env);
    let attester = Address::generate(env);
    let other = Address::generate(env);
    let token = env.register_stellar_asset_contract(admin.clone());
    let contract_id = env.register_contract(None, ProductionEscrow);
    let client = ProductionEscrowClient::new(env, &contract_id);
    client.initialize(&admin, &token, &attester);
    (client, admin, farmer, investor, attester, other, token)
}

fn create_funded_campaign(
    env: &Env,
    client: &ProductionEscrowClient,
    token: &Address,
    farmer: &Address,
    investor: &Address,
    amount: i128,
) -> u64 {
    let asset = token::StellarAssetClient::new(env, token);
    asset.mint(investor, &amount);
    let deadline = env.ledger().timestamp() + 1_000;
    let campaign_id = client.create_campaign(farmer, &amount, &deadline);
    client.invest(investor, &campaign_id, &amount);
    campaign_id
}

#[test]
fn cost_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let attester = Address::generate(&env);
    let token = env.register_stellar_asset_contract(admin.clone());
    let contract_id = env.register_contract(None, ProductionEscrow);
    let client = ProductionEscrowClient::new(&env, &contract_id);
    let (cpu, mem) = measure(&env, || {
        client.initialize(&admin, &token, &attester);
    });
    assert_within("initialize", cpu, mem);
}

#[test]
fn cost_create_campaign() {
    let env = Env::default();
    let (client, _admin, farmer, _investor, _attester, _other, _token) = setup(&env);
    let deadline = env.ledger().timestamp() + 1_000;
    let (cpu, mem) = measure(&env, || {
        client.create_campaign(&farmer, &1_000, &deadline);
    });
    assert_within("create_campaign", cpu, mem);
}

#[test]
fn cost_invest() {
    let env = Env::default();
    let (client, _admin, farmer, investor, _attester, _other, token) = setup(&env);
    let asset = token::StellarAssetClient::new(&env, &token);
    asset.mint(&investor, &1_000);
    let deadline = env.ledger().timestamp() + 1_000;
    let campaign_id = client.create_campaign(&farmer, &1_000, &deadline);
    let (cpu, mem) = measure(&env, || {
        client.invest(&investor, &campaign_id, &1_000);
    });
    assert_within("invest", cpu, mem);
}

#[test]
fn cost_start_production() {
    let env = Env::default();
    let (client, _admin, farmer, investor, _attester, _other, token) = setup(&env);
    let campaign_id = create_funded_campaign(&env, &client, &token, &farmer, &investor, 1_000);
    let (cpu, mem) = measure(&env, || {
        client.start_production(&farmer, &campaign_id);
    });
    assert_within("start_production", cpu, mem);
}

#[test]
fn cost_mark_harvest() {
    let env = Env::default();
    let (client, _admin, farmer, investor, attester, _other, token) = setup(&env);
    let campaign_id = create_funded_campaign(&env, &client, &token, &farmer, &investor, 1_000);
    client.start_production(&farmer, &campaign_id);
    let (cpu, mem) = measure(&env, || {
        client.mark_harvest(&farmer, &attester, &campaign_id);
    });
    assert_within("mark_harvest", cpu, mem);
}

#[test]
fn cost_advance_milestone() {
    let env = Env::default();
    let (client, _admin, farmer, investor, attester, _other, token) = setup(&env);
    let campaign_id = create_funded_campaign(&env, &client, &token, &farmer, &investor, 1_000);
    client.start_production(&farmer, &campaign_id);
    let (cpu, mem) = measure(&env, || {
        client.advance_milestone(&farmer, &attester, &campaign_id);
    });
    assert_within("advance_milestone", cpu, mem);
}

#[test]
fn cost_settle() {
    let env = Env::default();
    let (client, _admin, farmer, investor, _attester, _other, token) = setup(&env);
    let campaign_id = create_funded_campaign(&env, &client, &token, &farmer, &investor, 1_000);
    let (cpu, mem) = measure(&env, || {
        client.settle(&farmer, &campaign_id);
    });
    assert_within("settle", cpu, mem);
}

#[test]
fn cost_refund() {
    let env = Env::default();
    let (client, admin, farmer, investor, _attester, _other, token) = setup(&env);
    let campaign_id = create_funded_campaign(&env, &client, &token, &farmer, &investor, 1_000);
    client.mark_campaign_failed(&admin, &campaign_id);
    let (cpu, mem) = measure(&env, || {
        client.refund(&investor, &campaign_id);
    });
    assert_within("refund", cpu, mem);
}

#[test]
fn cost_claim_returns() {
    let env = Env::default();
    let (client, _admin, farmer, investor, _attester, _other, token) = setup(&env);
    let campaign_id = create_funded_campaign(&env, &client, &token, &farmer, &investor, 1_000);
    client.settle(&farmer, &campaign_id);
    let (cpu, mem) = measure(&env, || {
        client.claim_returns(&investor, &campaign_id);
    });
    assert_within("claim_returns", cpu, mem);
}

#[test]
fn cost_mark_campaign_failed() {
    let env = Env::default();
    let (client, admin, farmer, investor, _attester, _other, token) = setup(&env);
    let campaign_id = create_funded_campaign(&env, &client, &token, &farmer, &investor, 1_000);
    let (cpu, mem) = measure(&env, || {
        client.mark_campaign_failed(&admin, &campaign_id);
    });
    assert_within("mark_campaign_failed", cpu, mem);
}

#[test]
fn cost_batch_refund_investors() {
    let env = Env::default();
    let (client, admin, farmer, investor, _attester, other, token) = setup(&env);
    let campaign_id = create_funded_campaign(&env, &client, &token, &farmer, &investor, 1_000);
    let asset = token::StellarAssetClient::new(&env, &token);
    asset.mint(&other, &1_000);
    client.invest(&other, &campaign_id, &1_000);
    client.mark_campaign_failed(&admin, &campaign_id);
    let investors = Vec::from_array(&env, [investor.clone(), other.clone()]);
    let (cpu, mem) = measure(&env, || {
        client.batch_refund_investors(&admin, &campaign_id, &investors);
    });
    assert_within("batch_refund_investors", cpu, mem);
}

#[test]
fn cost_transfer_investment() {
    let env = Env::default();
    let (client, _admin, farmer, investor, _attester, other, token) = setup(&env);
    let campaign_id = create_funded_campaign(&env, &client, &token, &farmer, &investor, 1_000);
    let (cpu, mem) = measure(&env, || {
        client.transfer_investment(&investor, &other, &campaign_id);
    });
    assert_within("transfer_investment", cpu, mem);
}

#[test]
fn cost_open_dispute() {
    let env = Env::default();
    let (client, _admin, farmer, investor, _attester, _other, token) = setup(&env);
    let campaign_id = create_funded_campaign(&env, &client, &token, &farmer, &investor, 1_000);
    let (cpu, mem) = measure(&env, || {
        client.open_dispute(&investor, &campaign_id);
    });
    assert_within("open_dispute", cpu, mem);
}

#[test]
fn cost_resolve_dispute() {
    let env = Env::default();
    let (client, admin, farmer, investor, _attester, _other, token) = setup(&env);
    let campaign_id = create_funded_campaign(&env, &client, &token, &farmer, &investor, 1_000);
    client.open_dispute(&investor, &campaign_id);
    let (cpu, mem) = measure(&env, || {
        client.resolve_dispute(&admin, &campaign_id, &Resolution::RefundInvestors);
    });
    assert_within("resolve_dispute", cpu, mem);
}
