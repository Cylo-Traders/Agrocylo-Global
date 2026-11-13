# Soroban Contract Instance-TTL Keeper & Archival Recovery Runbook (Issue #1290)

This runbook documents the repository-supported keeper (`scripts/instance-ttl-keeper.sh`), cadence math, funded submitter ownership, restart behavior, alerting taxonomy, and archival/restore recovery procedures across all five Agrocylo Soroban contracts (`production_escrow`, marketplace `escrow`, `governance`, `registry`, and `investment_basket`).

---

## 1. Instance Storage Maintenance vs. Persistent-Entry Retention

Soroban separates contract state into two distinct storage tiers with independent TTL lifecycles:

| Tier | What Lives Here | Maintenance Mechanism | Restoration If Archived |
|---|---|---|---|
| **Instance Storage** (`env.storage().instance()`) | Contract WASM reference, `Admin`, `GovernanceContract`, `Guardian`, `Paused`, `SupportedTokens`, `FeeCollector`, `FeeRateBps`, `SchemaVersion`, `CampaignCount`, `OrderCount`, `MaxActiveCampaigns`, `ActiveCampaignCount`, `TokenCampaignCap` | Automatically extended to `INSTANCE_TTL_EXTEND = 100,000` ledgers (~5.79 days at 5s/ledger) whenever remaining TTL `<= INSTANCE_TTL_THRESHOLD = 50,000` ledgers (~2.89 days) on state-changing calls, **plus** unconditionally extended to `100,000` ledgers by the scheduled keeper calling permissionless `bump_instance_ttl()`. | `stellar contract restore --id <CONTRACT_ID>` (or `./scripts/instance-ttl-keeper.sh --restore-archived`) followed by `bump_instance_ttl`. |
| **Persistent Storage** (`env.storage().persistent()`) | Per-record keys: `DataKey::Campaign(id)`, `DataKey::Contributions(id)`, `DataKey::Claimed(campaign_id, investor)`, `DataKey::Order(id)`, `DataKey::SplitOrder(id)`, `DataKey::Dispute(id)`, `DataKey::Farmer(addr)` | Extended to `TTL_EXTEND = 100,000` ledgers on write/access when remaining TTL `<= TTL_THRESHOLD = 1,000` ledgers. **`bump_instance_ttl()` does NOT extend persistent per-record keys.** | Must be restored per ledger key (`stellar contract restore --id <CONTRACT_ID> --key-xdr <BASE64_KEY>`) before a transaction can read or mutate an archived campaign, order, or claim record. |

> **Important Correction to Earlier TTL Claims:**
> `extend_ttl(threshold, extend_to)` sets `live_until_ledger_seq = current_ledger + extend_to` **only when** `remaining_ttl <= threshold`. It does **not** add `100,000` ledgers cumulatively per call, and an untouched instance or persistent entry will **not** survive `1,000,000` ledgers on its own (~57.9 days). At 5s/ledger, `100,000` ledgers is **~5.79 days** (`500,000` seconds). Quiet contracts therefore require scheduled keeper execution at least once every `<= 2.5` days (`<= 43,200` ledgers).

---

## 2. Explicit Keeper Configuration & Cadence

All parameters in `scripts/instance-ttl-keeper.sh` are explicitly configurable via CLI flags or environment variables:

| Parameter / Env Var | CLI Flag | Default | Rationale |
|---|---|---|---|
| `NETWORK` | `--network` | `testnet` | Target network (`testnet`, `mainnet`, `local`). |
| `SOROBAN_RPC_URL` | `--rpc-url` | Network default | Soroban JSON-RPC endpoint. |
| `MANIFEST_PATH` | `--manifest` | `deployments/deployed-addresses.<network>.json` | Reads all five contract IDs (`production_escrow`, `escrow`, `governance`, `registry`, `investment_basket`). |
| `KEEPER_SUBMITTER_IDENTITY` | `--submitter` | `keeper-submitter` | Named Stellar CLI identity alias. **Raw `S...` secret keys are rejected** to prevent credential leakage in process tables or logs. |
| `KEEPER_OPERATOR` | `--operator` | `@agrocylo-ops (Platform SRE On-Call)` | Accountable operator tagged in every warning/critical alert. |
| `KEEPER_CADENCE_SECS` | `--cadence-secs` | `43200` (12 hours) | At ~5s/ledger, 12 hours is ~8,640 ledgers — providing >11 keeper attempts within each `100,000`-ledger window and >4 attempts after crossing `TTL_WARN_THRESHOLD_LEDGERS` (`50,000`). |
| `TTL_WARN_THRESHOLD_LEDGERS` | `--warn-threshold` | `50000` (~2.89 days) | Keeper invokes `bump_instance_ttl` whenever remaining TTL `<= 50,000` ledgers. |
| `TTL_CRITICAL_THRESHOLD_LEDGERS` | `--critical-threshold` | `15000` (~20.8 hours) | Emits `CRITICAL` `approaching_archival` alert to `KEEPER_OPERATOR`. |
| `MIN_SUBMITTER_BALANCE_STROOPS` | `--min-balance-stroops` | `50000000` (5 XLM) | Emits `WARNING` `low_submitter_balance` alert before fee exhaustion can block keeper submissions. |

---

## 3. Funded Submitter Ownership & Restart Behavior

- **Submitter Ownership**:
  - Because `bump_instance_ttl()` is permissionless (`Requires no auth`), the keeper submitter account holds **zero protocol privileges** — it only pays network inclusion and rent-extension fees in XLM.
  - Provision a dedicated low-privilege hot wallet via `stellar keys generate keeper-submitter --network <network>`, owned and monitored by `@agrocylo-ops (Platform SRE On-Call)`.
  - Maintain at least **25 XLM** on mainnet (`MIN_SUBMITTER_BALANCE_STROOPS=50000000` alerts at 5 XLM).
- **Restart & Idempotency Behavior**:
  - `scripts/instance-ttl-keeper.sh --once` is stateless and idempotent: safe to run under `cron`, Kubernetes `CronJob`, GitHub Actions scheduled workflows, or `systemd` timers (`OnCalendar=*-*-* 00,12:00:00 UTC`).
  - In `--daemon` mode, if the process restarts (node reboot, container reschedule, RPC disconnect), it immediately evaluates all five contract instances on startup before sleeping for `KEEPER_CADENCE_SECS`.

---

## 4. Actionable Alerting Taxonomy

Every alert emitted to `stderr` and optional `ALERT_WEBHOOK_URL` carries `operator="<KEEPER_OPERATOR>"`, `network`, `reason`, `contract`, and `detail`:

1. **`reason="low_submitter_balance"` (`WARNING`)**:
   - Triggered when submitter balance `< MIN_SUBMITTER_BALANCE_STROOPS`.
   - Operator Action: Top up the `keeper-submitter` XLM balance and re-run `./scripts/instance-ttl-keeper.sh --once`.
2. **`reason="approaching_archival"` (`CRITICAL`)**:
   - Triggered when any contract's remaining instance TTL `<= TTL_CRITICAL_THRESHOLD_LEDGERS` (`15,000` ledgers).
   - Operator Action: Immediately run `./scripts/instance-ttl-keeper.sh --network <net> --force-bump --once` and inspect RPC/submitter health.
3. **`reason="failed_submission"` / `reason="failed_restore"` (`CRITICAL`)**:
   - Triggered when `stellar contract invoke ... bump_instance_ttl` or `stellar contract restore` exits nonzero.
   - Operator Action: Fail over to secondary `SOROBAN_RPC_URL`, verify submitter sequence/balance, and re-run `--force-bump`.

---

## 5. Local / Testnet Archival Restore Drill

To rehearse recovery when a quiet contract instance has already expired into the Soroban hot archive (`remaining_ttl == 0`):

```bash
# 1. Execute the automated restore + TTL bump drill across all configured contracts:
./scripts/instance-ttl-keeper.sh \
  --network testnet \
  --manifest deployments/deployed-addresses.testnet.json \
  --submitter keeper-submitter \
  --restore-archived

# 2. Verify the automated regression & restore test suite locally:
bash scripts/test-instance-ttl-keeper-1290.sh
```

What `--restore-archived` performs for each contract:
1. Runs `stellar contract restore --id <CONTRACT_ID> --source-account <KEEPER_SUBMITTER_IDENTITY> --network <NETWORK> --ledgers-to-extend 100000` to unarchive the contract instance entry and WASM code entry.
2. Invokes `bump_instance_ttl` on the restored contract so its live TTL is confirmed at `INSTANCE_TTL_EXTEND` (`100,000` ledgers).
3. If individual persistent entries (`Campaign(id)`, `Order(id)`, `Claimed(campaign_id, investor)`) were also archived during extended downtime, restore their specific `DataKey` XDRs via `stellar contract restore --id <CONTRACT_ID> --key-xdr <BASE64_KEY>` before resuming user claims or settlements.
