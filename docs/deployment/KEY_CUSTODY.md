# Key Custody & Multisig Configuration

**Issue #779** — Admin and Guardian Multisig Enforcement

This document describes how to configure and maintain the multisig accounts that control production contracts on mainnet.

## Overview

Two roles have elevated privileges in the production contracts:

1. **admin** — Bootstraps all contracts during initialization, sets governance, can pause contracts (paired with guardian)
2. **guardian** — Can call `pause` instantly to halt contract operations in emergencies

Both **must** be multisig-configured Stellar accounts on mainnet to prevent a single compromised key from controlling funds or blocking emergency response.

## Why Multisig?

From `SETTLEMENT_POLICY.md`:

> Fund release and dispute resolution require "2-of-3 admin signers" committee oversight. Neither a single admin nor guardian should unilaterally control release of investor funds.

Soroban's `require_auth()` already honors Stellar account signing thresholds automatically — if an account is configured with a 2-of-3 multisig threshold, `require_auth()` fails unless at least 2 signers authorize the operation. The contracts do not need M-of-N logic in code; properly configured account thresholds suffice.

## Multisig Configuration

### 2-of-3 Committee Model (Recommended)

The recommended setup for both `admin` and `guardian`:

- **3 signers** (committee members, holding keys separately)
- **Operation weight** required to authorize transactions: **2**
- **Master account weight** (if retained): **1** (or **0** if master key is discarded)
- **Signer thresholds:**
  - Low threshold (transaction default): **1** (optional, for information operations)
  - Medium threshold (for setters like `set_guardian`): **2** (requires 2-of-3 signers)
  - High threshold (for upgrades, if applicable): **2** (same as medium)

### Setup Instructions

For each role (admin and guardian), create a 2-of-3 multisig Stellar account:

#### Prerequisites
- 3 separate Stellar keypairs (e.g., held by 3 different team members)
- Public keys for each signer: Signer A, Signer B, Signer C
- A Stellar account to become the multisig (e.g., the "admin" account)

#### Step 1: Create the Base Account
```bash
# Use soroban CLI or Horizon to create a new account with minimum balance
soroban account create --account admin-base-account

# Get public key
ADMIN_PUBKEY=$(soroban account info --account admin-base-account | grep "Account ID" | awk '{print $NF}')
```

#### Step 2: Configure Multisig Thresholds
```bash
# Set thresholds (low=1, medium=2, high=2)
# This allows low-privilege reads with 1 signer, but fund-moving operations need 2

soroban transaction set-options \
  --source admin-base-account \
  --set-low-threshold 1 \
  --set-medium-threshold 2 \
  --set-high-threshold 2 \
  --sign signer-a-secret
```

#### Step 3: Add Signers
For each signer, add them to the account with weight 1:

```bash
soroban transaction add-signer \
  --source admin-base-account \
  --signer SIGNER_A_PUBKEY \
  --weight 1 \
  --sign signer-a-secret

soroban transaction add-signer \
  --source admin-base-account \
  --signer SIGNER_B_PUBKEY \
  --weight 1 \
  --sign signer-a-secret

soroban transaction add-signer \
  --source admin-base-account \
  --signer SIGNER_C_PUBKEY \
  --weight 1 \
  --sign signer-a-secret
```

#### Step 4: (Optional) Demote Master Key
If you want to ensure no single person (not even the master key holder) can act alone:

```bash
soroban transaction set-options \
  --source admin-base-account \
  --set-master-weight 0 \
  --sign signer-a-secret
```

**Warning:** Once the master key weight is set to 0, it cannot be changed again (it can only be restored by reaching 2-of-3 consensus). Only do this if all 3 signers are confirmed operational and separated physically/geographically.

#### Step 5: Verify Configuration
```bash
soroban account info --account $ADMIN_PUBKEY

# Expected output shows:
# Signers: [Signer A (weight 1), Signer B (weight 1), Signer C (weight 1)]
# Low threshold: 1
# Med threshold: 2
# High threshold: 2
```

## Pre-Deployment Verification (Issue #1283)

Before any mainnet build, install, deploy, or manifest write occurs, `scripts/deploy-contracts.sh --network mainnet` performs a **read-only, fail-closed** check of the effective signing policy for `ADMIN`, `GUARDIAN`, and (if set) `ATTESTER`:

```bash
./scripts/deploy-contracts.sh --network mainnet
```

The script **never** requests or accepts `ADMIN_SECRET` or `GUARDIAN_SECRET`. Instead, it inspects public role addresses:
1. Requires explicit `ADMIN` and `GUARDIAN` public addresses (never defaults `ADMIN` to `DEPLOYER` on mainnet, and rejects `ADMIN == DEPLOYER`).
2. For classic Stellar accounts (`G...`), fetches the public Horizon account record (`$HORIZON_URL/accounts/<address>`) and verifies:
   - At least **2 active signers** with `weight > 0` (`active_signers >= 2`).
   - `med_threshold >= 2` and `high_threshold >= 2`.
   - **No single signer can satisfy the threshold alone**: `max_signer_weight < med_threshold` and `max_signer_weight < high_threshold`.
   - The account is not deadlocked: `total_signer_weight >= med_threshold` and `total_signer_weight >= high_threshold`.
3. For Soroban contract-account authorities (`C...`), requires explicit `ALLOW_CONTRACT_ROLE_AUTH=true` and verifies on-chain via read-only `get_quorum` that the contract enforces `quorum >= 2`.

**Environment Setup (Public Addresses Only):**
```bash
export DEPLOYER="mainnet-deployer"
export ADMIN="G..."              # Public address of 2-of-3 admin multisig account
export GUARDIAN="G..."           # Public address of 2-of-3 guardian multisig account
export FEE_COLLECTOR="G..."
export SUPPORTED_TOKENS="C...,C..."
export HORIZON_URL="https://horizon.stellar.org"
export SOROBAN_RPC_URL="https://soroban.stellar.org"

./scripts/deploy-contracts.sh --network mainnet
```

If verification fails:
- The script exits with non-zero status and prints the error
- Deployment does not proceed
- Correct the account configuration and retry

## Signer Key Rotation

Rotating signers without dropping below the required threshold requires careful sequencing:

### Scenario: Replace Signer A (compromised or key holder departure)

1. **Prepare new keypair** for the replacement signer (New Signer A')
   - Generate: `soroban keys generate --name new-signer-a`

2. **Add New Signer A'** (while you still have 2-of-3 consensus with existing signers A, B, C):
   ```bash
   soroban transaction add-signer \
     --source $ADMIN_ACCOUNT \
     --signer NEW_SIGNER_A_PUBKEY \
     --weight 1 \
     --sign signer-a-secret \
     --sign signer-b-secret
   ```
   Now the account has 4 signers: A, B, C, A' (any 2 of these 4 suffice).

3. **Remove old Signer A** (now safe because you have A' + B + C, any 2 of which work):
   ```bash
   soroban transaction remove-signer \
     --source $ADMIN_ACCOUNT \
     --signer SIGNER_A_PUBKEY \
     --sign new-signer-a-secret \
     --sign signer-b-secret
   ```
   Now the account has 3 signers: B, C, A' (2-of-3 still required).

4. **Verify** the new configuration:
   ```bash
   soroban account info --account $ADMIN_ACCOUNT
   # Should show signers: [Signer B, Signer C, New Signer A'] with weights 1 each
   ```

### General Pattern

Never remove a signer until a replacement is already added. This ensures the account always maintains at least N signers before going down to N-1.

## Committee Operating Procedures

### Authorization
- Any operation that moves funds or changes contract configuration must be signed by at least 2 committee members
- Coordinate via secure out-of-band channel (not Slack/email) to gather signatures
- Signers should verify the proposed operation themselves before signing

### Emergency Pause
- Guardian can call `pause()` instantly (no governance timelock)
- This is the only privileged operation guardian holds exclusively
- Admin cannot pause (only guardian); admin cannot unpause (only governance)
- If guardian key is compromised, the account is still protected by multisig (attacker needs 2 keys)

### Disputes & Parameter Changes
- All other privileged operations go through governance proposal/voting
- Governance itself is also protected by the same multisig model (see `governance::initialize`)
- No single signer can unilaterally execute a proposal

## Disaster Recovery

### Signer Loses Key
1. That signer and one other committee member collaborate to add a new key for the affected signer
2. Once new key is added, old key is removed (following rotation procedure above)

### All Signers Unavailable
If all 3 signers are simultaneously compromised or unavailable:
- The multisig account is locked (no operations possible)
- Funds in the contracts are frozen (they can still be refunded while paused, but no new operations)
- This is a governance/ops decision to recover from (possibly involving community consensus)

**Prevention:** Keep keys geographically separated, use different key storage mechanisms (e.g., one on hardware wallet, one on secure server, one in cold storage).

## Testnet vs. Mainnet

### Testnet
- Multisig is not enforced (optional for testing purposes)
- Use single-signer accounts for developer testing
- But deploy-contracts.sh skips verification on testnet, so you can rehearse rotation procedures safely

### Mainnet
- `deploy-contracts.sh --network mainnet` **requires** multisig on both admin and guardian
- Deployment fails if either account is single-signer
- Once deployed, governance proposals and emergency pause operations must be authorized by 2+ committee members

## Verification Checklist

Before mainnet deployment, confirm:

- [ ] Admin and guardian accounts created
- [ ] Both accounts have exactly 2+ signers (not 1)
- [ ] Medium threshold set to 2 (or verify appropriate values match your committee model)
- [ ] Each signer key is held by a different person/device
- [ ] Rotation procedures have been rehearsed on testnet
- [ ] All 3 signers have confirmed receipt of their keys
- [ ] Out-of-band coordination channel established for emergency pause authorization
- [ ] GitHub issues/runbooks document the signers (names, backup contacts)

## References

- **Soroban Docs**: https://developers.stellar.org/learn/fundamentals/stellar-data-structures#multisig
- **Stellar Horizon API**: https://developers.stellar.org/api
- **Issue #780**: Incident runbook & pause procedures
- **SETTLEMENT_POLICY.md**: Business requirements for multisig dispute resolution
