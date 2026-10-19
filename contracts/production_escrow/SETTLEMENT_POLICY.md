# Settlement Policy for Production Escrow Contract

## Issue #454 - Self-Reported Harvest Fund Release Governance

This document establishes the settlement and fund release policy for the production escrow contract.

### The Problem with Self-Reported Harvest Release

Direct farmer-initiated fund release on harvest claims (via `mark_harvest`) presents a critical governance and auditability problem:

1. **No Independent Verification**: Farmers can unilaterally claim harvest completion without independent production evidence.
2. **Economic Incentive Misalignment**: Farmers are incentivized to falsely claim harvest to access funds before actual production completion.
3. **Investor Vulnerability**: Investors have no mechanism to dispute or verify harvest claims before funds are released.
4. **Lack of Auditable Trail**: Fund release is directly tied to self-reported status, making post-mortem audits impossible.

### Current Implementation

The `mark_harvest()` function is **deprecated and frozen**. It remains in the binary for ABI compatibility but should not be called in new integrations. The function releases a harvest tranche (40% of total raised) automatically upon farmer assertion.

### Required Auditable Settlement Framework

All fund release must follow this explicit settlement path, with independent verification at each step:

#### 1. **Funding Threshold**
   - Campaign must reach the minimum funding target (`target_amount`).
   - Automatic transition: `Funding` → `Funded` when target is reached.

#### 2. **Production Evidence**
   - **Option A (Oracle)**: Oracle provider submits verifiable production data on-chain.
   - **Option B (Multisig)**: Designated multisig committee (e.g., 2-of-3 admin signers) attests to production status.
   - **Option C (Time-Lock)**: A configured time-lock period elapses after funding (e.g., 90 days), allowing assumptions of production start.

   The campaign transitions to `InProduction` only upon one of these conditions.

#### 3. **Harvest Confirmation**
   - **Option A (Independent Verifier)**: A designated harvest verifier (not the farmer) submits harvest attestation on-chain.
   - **Option B (Dispute Window)**: After a harvest claim, a dispute window (default: **7 days**) opens. If no disputes are filed by investors or admin, the harvest is confirmed automatically.

   The campaign transitions to `Harvested` upon confirmed harvest.

#### 4. **Settlement Authorization**
   - **Multisig or Governance Approval**: Before funds can be released to investors, a designated multisig (minimum 2 signatories) or governance vote must authorize settlement.
   - **No Unilateral Settlement**: Neither the farmer nor any single party can trigger settlement.

   The campaign transitions to `Settled` upon authorization.

#### 5. **Investor Claims**
   - After settlement, investors can claim their proportional share of the remaining escrow and accrued revenue.
   - Each investor's claim is marked as processed to prevent double-claims.

### Failure and Dispute Resolution

If any verification step fails or a dispute is raised:

1. **Funding Failure**: If deadline passes without reaching the target, the campaign enters `Failed` state and investors can refund their contributions.
2. **Production Dispute**: If production is not attested within the agreed window, the campaign may be marked `Failed`.
3. **Harvest Dispute**: If a dispute is raised within the dispute window, the campaign enters `Disputed` state and awaits admin resolution.

Resolution options:
- **RefundInvestors**: Campaign → `Failed`, investors refund their full contributions.
- **FullPayoutToInvestors**: Campaign → `Settled`, investors claim the full pool (raised + revenue - tranches released).
- **Partial(farmer_bps)**: Campaign → `Settled`, farmer receives `farmer_bps` of the remaining pool, rest goes to investors.

### TTL and Data Retention

All campaign, order, and investment records stored in persistent contract storage must have their TTL extended:
- Upon creation
- Upon each investor/buyer read action (claim, refund, confirm order)
- Upon each mutation (status change, fund release)

See **TTL_POLICY.md** for details.

### Implementation Notes

- **Rounding Dust**: Any remainder from integer division in proportional payouts is discarded (not allocated to anyone). Future versions may dedicate this to a platform fee collector.
- **Order Finalization Requirement**: All orders created for a campaign must be finalized (either Confirmed or Refunded) before settlement is allowed (Issue #455). Late confirmations after settlement are rejected.
- **Arithmetic Overflow Protection**: All monetary operations use checked arithmetic to prevent overflow attacks (Issue #457).

### Parameters (Configurable at Initialization)

- **DISPUTE_WINDOW_SECS**: Duration (in seconds) for investors to file disputes after harvest claim. Default: **7 days** (604,800 seconds).
- **PRODUCTION_WAIT_SECS**: Time-lock duration before production can be assumed without explicit attestation. Default: **90 days** (7,776,000 seconds).
- **TTL_THRESHOLD**: Ledger entry TTL threshold before extension. Default: **1,000 ledgers**.
- **TTL_EXTENSION**: Amount to extend TTL by upon write. Default: **100,000 ledgers**.

### Compliance Checklist

When integrating with this contract:

- [ ] All campaigns go through the full settlement pipeline.
- [ ] Fund release is only triggered after documented authorization.
- [ ] Production status is attested by independent verifier or dispute window.
- [ ] All orders are finalized before settlement.
- [ ] Investor claims are verified against a proportional payout calculation.
- [ ] Disputes are resolved by multisig or governance authority.
- [ ] All persistent storage entries have TTL extensions in place.
- [ ] Arithmetic operations on monetary values use checked functions.

---

**Issue References**: #454 (self-reported harvest risk), #455 (order finalization), #456 (TTL policy), #457 (overflow handling)
