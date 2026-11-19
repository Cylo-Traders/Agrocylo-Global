# Instance TTL Keeper — Operational Runbook

**Issue**: #1290 — Provide an instance-TTL keeper with expiry monitoring and recovery runbook

**Purpose**: Maintains the Time-To-Live (TTL) of Soroban contract instances, preventing archival and ensuring continuous operational availability on testnet and mainnet.

---

## Overview

Soroban contract instances are automatically archived if their TTL (Time-To-Live) is not extended before expiration. This keeper monitors configured contract instances, tracks remaining TTL, and submits TTL extension transactions before instances approach the threshold.

**Key Features**:
- Automated TTL monitoring and bumping at configurable cadence
- Configurable thresholds for proactive extension
- Balance monitoring with low-balance alerts
- Detailed logging for auditing and troubleshooting
- Recovery runbook for archived instances
- Testnet/mainnet support with network-specific defaults

---

## Configuration

### Environment Setup

1. **Create Submitter Identity**
   ```bash
   # Set up a keypair that will submit TTL bump transactions
   stellar keys add ttl-keeper --sign-with-hash-meta
   ```

2. **Fund Submitter Account**
   - **Testnet**: Use Friendbot to fund (https://laboratory.stellar.org/#account-creator)
   - **Mainnet**: Transfer at least 2 XLM to cover submission fees and balance threshold
   - Each TTL bump costs ~0.00001 XLM in submission fees

3. **Create Configuration File**
   ```bash
   cp deployments/ttl-keeper-config.template.json deployments/ttl-keeper-config.testnet.json
   # Edit the JSON to set:
   # - network: "testnet" or "mainnet"
   # - submitter_identity: name of your stellar keypair
   # - contract_id values from your deployment manifest
   ```

### Configuration Parameters

| Parameter | Default | Purpose |
|-----------|---------|---------|
| `network` | testnet | Target network (testnet, mainnet, local) |
| `submitter_identity` | ttl-keeper | Stellar keypair name that signs bump transactions |
| `ttl_threshold_ledgers` | 50,000 | Bump when remaining TTL falls below this (≈69 hrs) |
| `ttl_extend_ledgers` | 100,000 | Extend TTL by this amount per bump (≈139 hrs) |
| `cadence_seconds` | 300 | Check and potentially bump every N seconds |

**Cadence Recommendations**:
- **Testnet** (`--interval 300`): 5 minutes (aggressive, low cost)
- **Mainnet** (`--interval 1800`): 30 minutes (balances monitoring load with network traffic)

---

## Usage

### One-Time TTL Bump

```bash
./scripts/ttl-keeper.sh \
  --network testnet \
  --identity ttl-keeper \
  --one-shot
```

### Continuous Monitoring (Testnet)

```bash
./scripts/ttl-keeper.sh \
  --network testnet \
  --identity ttl-keeper \
  --interval 300 \
  --log keeper.log
```

### Continuous Monitoring (Mainnet)

```bash
./scripts/ttl-keeper.sh \
  --network mainnet \
  --identity ttl-keeper \
  --interval 1800 \
  --log /var/log/agrocylo/ttl-keeper.log
```

### Dry Run (Verify Configuration Without Submitting)

```bash
./scripts/ttl-keeper.sh \
  --network testnet \
  --identity ttl-keeper \
  --one-shot \
  --dry-run
```

### View Recovery Guide

```bash
./scripts/ttl-keeper.sh --print-recovery
```

---

## Deployment Strategies

### Docker Container (Production)

```dockerfile
FROM stellar/stellar-core:latest

RUN apt-get update && apt-get install -y \
    curl \
    jq \
    && rm -rf /var/lib/apt/lists/*

RUN curl -L https://github.com/stellar/stellar-cli/releases/download/v22.0.0/stellar-cli-22.0.0-x86_64-unknown-linux-gnu.tar.gz \
    | tar xz -C /usr/local/bin/

WORKDIR /app
COPY scripts/ttl-keeper.sh .
COPY deployments/ttl-keeper-config.mainnet.json ./config.json

ENV NETWORK=mainnet
ENV KEEPER_IDENTITY=ttl-keeper-mainnet
ENV SOROBAN_RPC_URL=https://soroban-mainnet.stellar.org
ENV CHECK_INTERVAL_SECS=1800
ENV LOG_FILE=/var/log/ttl-keeper.log

CMD ["./ttl-keeper.sh", "--network", "$NETWORK", "--identity", "$KEEPER_IDENTITY", "--log", "$LOG_FILE"]
```

### Kubernetes CronJob

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: agrocylo-ttl-keeper
  namespace: production
spec:
  schedule: "*/5 * * * *"  # Every 5 minutes
  jobTemplate:
    spec:
      template:
        spec:
          serviceAccountName: ttl-keeper
          containers:
          - name: keeper
            image: agrocylo/ttl-keeper:latest
            env:
            - name: NETWORK
              value: "mainnet"
            - name: KEEPER_IDENTITY
              valueFrom:
                secretKeyRef:
                  name: ttl-keeper-secrets
                  key: identity
            - name: SOROBAN_RPC_URL
              value: "https://soroban-mainnet.stellar.org"
            volumeMounts:
            - name: logs
              mountPath: /var/log
          volumes:
          - name: logs
            persistentVolumeClaim:
              claimName: keeper-logs
          restartPolicy: OnFailure
```

### Systemd Service (Simple Server)

```ini
[Unit]
Description=Agrocylo TTL Keeper
After=network.target
Wants=ttl-keeper.timer

[Service]
Type=simple
User=stellar
Environment="NETWORK=mainnet"
Environment="KEEPER_IDENTITY=ttl-keeper-mainnet"
Environment="SOROBAN_RPC_URL=https://soroban-mainnet.stellar.org"
ExecStart=/usr/local/bin/ttl-keeper.sh --log /var/log/ttl-keeper.log
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```ini
[Unit]
Description=Agrocylo TTL Keeper Timer
Requires=ttl-keeper.service

[Timer]
OnBootSec=5min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
```

---

## Monitoring and Alerting

### Log Patterns

**Successful bump**:
```
[2026-11-19T14:32:15Z] ✓ TTL bumped successfully for production_escrow
```

**Balance alert**:
```
[2026-11-19T14:32:15Z] ALERT: Submitter balance is low (0.5 XLM). Top up before next check cycle.
```

**Submission failure**:
```
[2026-11-19T14:32:15Z] ✗ TTL bump failed for governance: TransactionInvalid
```

### Recommended Alerts

| Condition | Severity | Action |
|-----------|----------|--------|
| Submitter balance < 1 XLM | High | Top up account immediately |
| Failed bump on critical contract (production_escrow, governance) | Critical | Investigate and retry manually |
| 3+ consecutive failed bumps | Warning | Check network connectivity and RPC status |
| Zero successful bumps in 2 hours | Critical | Service may be hung or misconfigured |

### Monitoring Setup (Prometheus Example)

```bash
# Parse logs and expose metrics
while IFS= read -r line; do
  if echo "$line" | grep -q "TTL bumped successfully"; then
    echo "ttl_keeper_bumps_success_total{contract=\"$contract\"} +1"
  elif echo "$line" | grep -q "TTL bump failed"; then
    echo "ttl_keeper_bumps_failed_total{contract=\"$contract\"} +1"
  fi
done < keeper.log > keeper.prom
```

---

## Recovery Procedures

### Detecting Archival

```bash
# Attempt to call a function on the contract
stellar contract invoke \
  --network mainnet \
  --id "CD32EWZUKYGU5LU5AAHM4YEZJVIQ3TBO2YHXGBKPOJVAOJYUWDNVUWU6" \
  --source keeper-key \
  -- get_governance_contract

# If you see "ContractNotFound" or "HostStorageError", the instance is archived.
```

### Testnet Recovery (Complete Redeployment)

If an instance on testnet is archived, the simplest recovery is full redeployment:

```bash
# 1. Redeploy all contracts
./scripts/deploy-contracts.sh --network testnet --force

# 2. Verify fresh TTL was assigned
./scripts/ttl-keeper.sh --network testnet --identity ttl-keeper --one-shot --dry-run

# 3. Resume monitoring
./scripts/ttl-keeper.sh --network testnet --identity ttl-keeper
```

### Mainnet Recovery (Governance-Gated)

Mainnet archival requires governance action:

1. **Governance Proposal to Redeploy**
   - Vote on a proposal to redeploy the archived contract (via governance.propose_upgrade)
   - After timelock elapses, execute the upgrade to a new WASM instance
   - Re-initialize with the same admin/governance addresses

2. **Data Restoration**
   - Persistent storage is **not** automatically restored
   - If the contract stored critical state, it must be re-populated via governance-gated setter calls
   - **This is why backups and state snapshots are critical on mainnet**

3. **Example Governance Proposal**
   ```bash
   stellar contract invoke \
     --network mainnet \
     --id "CAUYF5C7S2NPEKJRWDVADMWR4BZBY3OQWZJ5S6F2XRJEPFGDRWPJY7RN" \
     --source voter \
     -- propose_upgrade \
       "CD32EWZUKYGU5LU5AAHM4YEZJVIQ3TBO2YHXGBKPOJVAOJYUWDNVUWU6" \
       "new_wasm_hash_here"
   ```

---

## Testing

### Test 1: Verify Keeper Runs Without Errors

```bash
./scripts/ttl-keeper.sh --network testnet --identity ttl-keeper --one-shot
# Expected: No errors, logs show successful bump for each contract
```

### Test 2: Verify Balance Alert

```bash
# Create a test keypair with <1 XLM balance
stellar keys add test-low-balance --sign-with-hash-meta
# Fund with exactly 0.5 XLM

./scripts/ttl-keeper.sh \
  --network testnet \
  --identity test-low-balance \
  --one-shot
# Expected: Logs contain "ALERT: Submitter balance is low"
```

### Test 3: Verify Dry-Run Doesn't Submit

```bash
./scripts/ttl-keeper.sh \
  --network testnet \
  --identity ttl-keeper \
  --one-shot \
  --dry-run

# Check logs — should show:
# "DRY RUN: Would invoke bump_instance_ttl on ..."
# but no actual submission to network
```

### Test 4: Verify Configuration Reloading

```bash
# Edit config file to disable a contract
# Edit deployments/ttl-keeper-config.json and set "enabled": false for a contract

./scripts/ttl-keeper.sh \
  --network testnet \
  --identity ttl-keeper \
  --one-shot

# Expected: Keeper skips disabled contract, logs show which contracts were bumped
```

---

## Troubleshooting

| Symptom | Diagnosis | Fix |
|---------|-----------|-----|
| "ContractNotFound" on bump | Instance is archived | See Recovery Procedures above |
| "InsufficientBalance" | Submitter account is under-funded | Top up with stellar payments |
| "InvalidContractId" | Contract ID in config is wrong | Verify against deployment manifest |
| Keeper never exits (stuck) | Long check interval or network hang | Add timeout; restart process |
| "Config file not found" | Deployment manifest missing | Run deploy-contracts.sh first |

---

## Best Practices

1. **Keep Backups**: On mainnet, regularly snapshot all persistent contract state
2. **Monitor Submissions**: Log all TTL bump transactions and costs for auditing
3. **Plan Maintenance**: Schedule keeper restarts during low-traffic windows
4. **Test Recovery**: Regularly practice recovery drills on testnet
5. **Coordinate**: Document keeper identity, cadence, and alert contacts in runbooks
6. **Rotate Keys**: Periodically rotate the submitter keypair for security
7. **Verify Health**: Check keeper logs at least daily; alert on any failures

---

## References

- [Soroban Documentation: Storage TTL](https://soroban.stellar.org/docs/learn/storage#storing-data)
- [Production Escrow TTL Policy](./TTL_POLICY.md) — data key extension details
- [Issue #456](https://github.com/Cylo-Traders/Agrocylo-Global/issues/456) — original TTL policy design
- [Issue #1290](https://github.com/Cylo-Traders/Agrocylo-Global/issues/1290) — keeper specification

---

**Last Updated**: 2026-11-19
**Maintained By**: Agrocylo DevOps Team
