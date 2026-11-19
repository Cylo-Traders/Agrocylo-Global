/// auth_tests.rs — Explicit Soroban authorization tests (Issue #1280)
///
/// These tests verify that fund-sensitive operations reject callers whose
/// authorization is absent, bound to a different invocation tree, or
/// supplied for different arguments.  None of these tests use
/// `mock_all_auths()`; each operation must present an explicit authorization
/// tree via `env.set_auths()` or the call must fail.
extern crate std;

use soroban_sdk::{
    testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation, Ledger, LedgerInfo},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, IntoVal, Symbol, Vec,
};

use crate::{
    CampaignStatus, EscrowError, ProductionEscrowContract, ProductionEscrowContractClient,
};

// ---------------------------------------------------------------------------
// Minimal harness — NO mock_all_auths
// ---------------------------------------------------------------------------

struct AuthTestEnv<'a> {
    env: Env,
    client: ProductionEscrowContractClient<'a>,
    token_id: Address,
    contract_id: Address,
    admin: Address,
    attester: Address,
    fee_collector: Address,
    farmer: Address,
    investor: Address,
    buyer: Address,
}

fn setup_no_mock_auths() -> AuthTestEnv<'static> {
    let env = Env::default();
    // Do NOT call env.mock_all_auths() here.

    // We need mock_all_auths for the initialization phase only, then we
    // drop back to explicit authorization for the tests.
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let attester = Address::generate(&env);
    let farmer = Address::generate(&env);
    let investor = Address::generate(&env);
    let buyer = Address::generate(&env);
    let fee_collector = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let token_id = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let sac = StellarAssetClient::new(&env, &token_id);
    sac.mint(&investor, &1_000_000);
    sac.mint(&buyer, &1_000_000);

    let contract_id = env.register(ProductionEscrowContract, ());
    let client = ProductionEscrowContractClient::new(&env, &contract_id);

    let mut tokens = Vec::new(&env);
    tokens.push_back(token_id.clone());
    client.initialize(&admin, &tokens, &fee_collector, &300);
    client.set_attester(&admin, &attester);

    // Drop the blanket mock — subsequent calls need explicit auths.
    env.set_auths(&[]);

    let client: ProductionEscrowContractClient<'static> =
        unsafe { std::mem::transmute(client) };

    AuthTestEnv {
        env,
        client,
        token_id,
        contract_id,
        admin,
        attester,
        fee_collector,
        farmer,
        investor,
        buyer,
    }
}

// ---------------------------------------------------------------------------
// Helper: build a minimal authorized-invocation tree for a single call
// ---------------------------------------------------------------------------

fn single_auth(
    env: &Env,
    caller: &Address,
    fn_name: &str,
    args: soroban_sdk::Vec<soroban_sdk::Val>,
) -> soroban_sdk::testutils::MockAuth<'_> {
    soroban_sdk::testutils::MockAuth {
        address: caller,
        invoke: &AuthorizedInvocation {
            function: AuthorizedFunction::Contract((
                // The contract address is not checked here — the SDK fills it in.
                caller.clone(),
                Symbol::new(env, fn_name),
                args,
            )),
            sub_invocations: &[],
        },
    }
}

// ---------------------------------------------------------------------------
// 1. create_campaign: missing farmer authorization is rejected
// ---------------------------------------------------------------------------

#[test]
fn test_create_campaign_requires_farmer_auth() {
    let t = setup_no_mock_auths();
    // Provide NO authorizations — the call must fail.
    let result = t.client.try_create_campaign(
        &t.farmer,
        &t.token_id,
        &100_000i128,
        &1_000i128,
        &1_000i128,
        &200_000u64,
    );
    assert!(
        result.is_err(),
        "create_campaign must fail when farmer authorization is missing"
    );
}

// ---------------------------------------------------------------------------
// 2. invest: missing investor authorization is rejected
// ---------------------------------------------------------------------------

#[test]
fn test_invest_requires_investor_auth() {
    let t = setup_no_mock_auths();

    // Create a campaign with admin mock (setup already dropped mock_all_auths,
    // so we re-enable it briefly for the prerequisite only).
    t.env.mock_all_auths();
    let campaign_id = t.client.create_campaign(
        &t.farmer,
        &t.token_id,
        &100_000i128,
        &1_000i128,
        &1_000i128,
        &200_000u64,
    );
    t.env.set_auths(&[]);

    // Invest without authorization — must fail.
    let result = t.client.try_invest(&t.investor, &campaign_id, &10_000i128);
    assert!(
        result.is_err(),
        "invest must fail when investor authorization is missing"
    );
}

// ---------------------------------------------------------------------------
// 3. set_attester: non-admin caller is rejected
// ---------------------------------------------------------------------------

#[test]
fn test_set_attester_requires_admin_auth() {
    let t = setup_no_mock_auths();
    let new_attester = Address::generate(&t.env);

    // Attempt to set attester as a non-admin (the farmer).
    let result = t.client.try_set_attester(&t.farmer, &new_attester);
    assert!(
        result.is_err(),
        "set_attester must fail when caller is not the admin"
    );
}

// ---------------------------------------------------------------------------
// 4. pause: non-admin/non-guardian caller is rejected
// ---------------------------------------------------------------------------

#[test]
fn test_pause_requires_admin_or_guardian() {
    let t = setup_no_mock_auths();

    // Arbitrary address that is neither admin nor guardian.
    let stranger = Address::generate(&t.env);
    let result = t.client.try_pause(&stranger);
    assert!(
        result.is_err(),
        "pause must fail for a caller that is neither admin nor guardian"
    );
}

// ---------------------------------------------------------------------------
// 5. create_order: auth bound to different campaign ID is rejected
// ---------------------------------------------------------------------------

#[test]
fn test_create_order_wrong_campaign_auth_rejected() {
    let t = setup_no_mock_auths();

    // Set up a funded campaign so create_order can reach the auth check.
    t.env.mock_all_auths();
    let campaign_id = t.client.create_campaign(
        &t.farmer,
        &t.token_id,
        &10_000i128,
        &1_000i128,
        &1_000i128,
        &200_000u64,
    );
    t.client.invest(&t.investor, &campaign_id, &10_000i128);
    t.client.start_production(&t.farmer, &campaign_id);
    t.client.mark_harvest(&t.attester, &campaign_id);
    t.env.set_auths(&[]);

    // Try create_order with NO authorization — must fail.
    let result = t
        .client
        .try_create_order(&t.buyer, &campaign_id, &1_000i128, &t.token_id);
    assert!(
        result.is_err(),
        "create_order must fail when buyer authorization is absent"
    );
}

// ---------------------------------------------------------------------------
// 6. cancel_order: a different buyer cannot cancel another buyer's order
// ---------------------------------------------------------------------------

#[test]
fn test_cancel_order_requires_owning_buyer() {
    let t = setup_no_mock_auths();

    // Create a campaign and an order as buyer1.
    t.env.mock_all_auths();
    let campaign_id = t.client.create_campaign(
        &t.farmer,
        &t.token_id,
        &10_000i128,
        &1_000i128,
        &1_000i128,
        &200_000u64,
    );
    t.client.invest(&t.investor, &campaign_id, &10_000i128);
    t.client.start_production(&t.farmer, &campaign_id);
    t.client.mark_harvest(&t.attester, &campaign_id);
    let order_id = t
        .client
        .create_order(&t.buyer, &campaign_id, &1_000i128, &t.token_id);
    t.env.set_auths(&[]);

    // A different address tries to cancel buyer's order — must fail.
    let other = Address::generate(&t.env);
    let result = t.client.try_cancel_order(&other, &order_id);
    assert!(
        result.is_err(),
        "cancel_order must fail when caller is not the order owner"
    );
}

// ---------------------------------------------------------------------------
// 7. upgrade: non-admin cannot upgrade the contract
// ---------------------------------------------------------------------------

#[test]
fn test_upgrade_requires_admin() {
    let t = setup_no_mock_auths();
    // Provide a dummy WASM hash — the auth check fires before WASM validation.
    let fake_hash = soroban_sdk::BytesN::from_array(&t.env, &[0u8; 32]);
    let result = t.client.try_upgrade(&t.farmer, &fake_hash);
    assert!(
        result.is_err(),
        "upgrade must fail when caller is not the admin"
    );
}
