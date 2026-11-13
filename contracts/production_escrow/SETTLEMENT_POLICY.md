# Settlement Policy for Production Escrow Contract

> **Last verified against commit:** `25d942522b76e4252752249142326a757d3d78d6`
> **Issue References:** #454 (self-reported harvest risk), #455 (order finalization), #456 (TTL policy), #457 (overflow handling), #1300 (documentation-to-code reconciliation)

This document specifies the **implemented** settlement and fund-release behavior in `contracts/production_escrow/src/lib.rs` (`production-escrow-v2`) and clearly distinguishes live on-chain logic from aspirational / follow-up items.

---

### The Problem with Unilateral Self-Reported Harvest Release

Unilateral farmer-only fund release on harvest claims presents a critical governance and auditability risk:

1. **No Independent Verification**: A farmer acting alone could claim harvest completion without independent production evidence.
2. **Economic Incentive Misalignment**: Farmers would be incentivized to falsely claim harvest to access tranche funds before actual completion.
3. **Investor Vulnerability**: Investors would have no independent check before tranche funds leave escrow.

---

### Implemented On-Chain Behavior (`contracts/production_escrow/src/lib.rs`)

#### 1. **Funding Threshold (`invest`)**
- Investors deposit via `invest(env, investor, campaign_id, amount)` before `campaign.deadline`.
- When `total_raised == target_amount`, the campaign automatically transitions `Funding` → `Funded`.
- Overfunding beyond `target_amount` is rejected with `EscrowError::CampaignOverfunded`.

#### 2. **Production Start & Tranche Release (`start_production`)**
- `start_production(env, farmer, campaign_id)` requires `farmer.require_auth()` while `campaign.status == CampaignStatus::Funded`.
- Releases the initial production tranche: `TRANCHE_START_BPS = 3_000` (**30%** of `total_raised`) to `campaign.farmer` via `release_tranche_internal`, and transitions `Funded` → `InProduction`.
- *(Aspirational / Not Implemented On-Chain)*: Automatic time-lock transition (`PRODUCTION_WAIT_SECS`) is **not** implemented in `lib.rs`; production start always requires an explicit `start_production` call.

#### 3. **Harvest Confirmation & Tranche Release (`mark_harvest` — LIVE)**
- **Status**: `mark_harvest(env, farmer, attester_caller, campaign_id)` is **live and active** (it is **not** deprecated or frozen).
- **Dual Authorization**: Requires **both** `farmer.require_auth()` and `attester_caller.require_auth()`, verifying `attester_caller == DataKey::Attester`. A farmer cannot unilaterally self-attest harvest.
- **Tranche Release**: Releases `TRANCHE_HARVEST_BPS = 4_000` (**40%** of `total_raised`) subject to the cumulative tranche cap `MAX_TRANCHE_BPS = 7_000` (**70%** maximum across `start_production`, `advance_milestone`, and `mark_harvest`, guaranteeing at least **30%** of `total_raised` remains escrowed for investor protection).
- **State Transition**: Transitions the campaign from `InProduction` → `Harvested`.
- **Milestone Alternative (`advance_milestone`)**: When `DataKey::MilestoneConfigs(campaign_id)` is configured by admin, `advance_milestone(env, caller, attester_caller, campaign_id)` requires both a qualifying buyer (confirmed order volume ≥ 1% of `target_amount`) or admin-as-oracle **and** the independent `attester_caller` co-signature, subject to the same **70%** `MAX_TRANCHE_BPS` cumulative cap.

#### 4. **Settlement Transition (`settle`)**
- `settle(env, caller, campaign_id)` requires `caller.require_auth()` where `caller` is either `campaign.farmer` or `DataKey::Admin`, and requires `campaign.status == CampaignStatus::Harvested`.
- Transitions the campaign from `Harvested` → `Settled`. No funds are transferred during `settle`; funds remain in escrow for individual investor claims.
- Late order confirmations after `Settled` are rejected with `EscrowError::CampaignNotHarvested` (Issue #455).
- *(Follow-up / Aspirational)*: Enforcing a mandatory on-chain post-harvest dispute window (`DISPUTE_WINDOW_SECS`) or requiring a separate governance proposal for `settle` is not currently enforced by `settle()` in `lib.rs`.

#### 5. **Investor Claims (`claim_returns`)**
- Once `campaign.status == CampaignStatus::Settled`, each investor calls `claim_returns(env, investor, campaign_id)`.
- Pool calculation: `pool = total_raised + total_revenue - tranche_released`.
- Proportional payout: `payout = (pool * contribution) / total_raised`.
- Double-claim prevention: `DataKey::Claimed(campaign_id, investor)` is set to `true` with persistent TTL extension.
- **Rounding Dust**: Integer-division remainder from `(pool * contribution) / total_raised` remains in the contract balance (it is not automatically swept to `FeeCollector` during `claim_returns`).

---

### Failure and Dispute Resolution (`lib.rs`)

1. **Funding Deadline Expiry (`finalize_failed`)**: Anyone can call `finalize_failed(env, campaign_id)` once `timestamp > campaign.deadline` while in `Funding`, transitioning to `Failed`.
2. **Explicit Failure (`mark_campaign_failed`)**:
   - From `Funded`: callable by `campaign.farmer` or `admin`.
   - From `InProduction` or `Harvested`: callable **only** by `admin` (farmer cannot unilaterally fail after tranches are released).
3. **Disputes (`open_dispute`, `resolve_dispute`, `vote_to_resolve`)**:
   - Any investor (with `Contribution > 0`) or `admin` can call `open_dispute` on a non-terminal campaign, transitioning it to `Disputed`.
   - Admin (`resolve_dispute`) or a quorum of configured arbitrators (`vote_to_resolve`) resolves the dispute with:
     - `DisputeResolution::RefundInvestors` → `CampaignStatus::Failed`
     - `DisputeResolution::FullPayoutToInvestors` → `CampaignStatus::Settled`
     - `DisputeResolution::Partial(farmer_bps)` → pays `farmer_bps` of remaining pool to `campaign.farmer` and transitions to `CampaignStatus::Settled`.

---

### Implemented Constants (`contracts/production_escrow/src/lib.rs`)

| Constant | Value in `lib.rs` | Purpose |
|----------|-------------------|---------|
| `TRANCHE_START_BPS` | `3_000` (30%) | Released to farmer on `start_production` |
| `TRANCHE_HARVEST_BPS` | `4_000` (40%) | Released to farmer on `mark_harvest` (with attester co-signature) |
| `MAX_TRANCHE_BPS` | `7_000` (70%) | Hard cap on cumulative tranche releases across start, milestones, and harvest |
| `TTL_THRESHOLD` | `1_000` ledgers | Persistent storage TTL extension threshold |
| `TTL_EXTEND` | `100_000` ledgers | Persistent storage TTL extension amount |
| `INSTANCE_TTL_THRESHOLD` | `1_000` ledgers | Instance storage TTL extension threshold |
| `INSTANCE_TTL_EXTEND` | `100_000` ledgers | Instance storage TTL extension amount |
| `ORDER_EXPIRY_SECS` | `345_600` (96 hours) | Inactivity window before pending orders can be refunded via `batch_refund_orders` |
| `CANCEL_WINDOW_SECS` | `1_800` (30 minutes) | Buyer cooling-off window for `cancel_order` (Issue #653) |
