# Resource Cost Baseline for Production Contracts

**Issue #781** — Cost profiling for mainnet feasibility

This document establishes baseline resource consumption (CPU instructions, memory, ledger operations) for critical entry points across the four production contracts. These measurements ensure that no entry point exceeds mainnet resource limits and that batch operation caps are justified by actual measurements, not assumptions.

## Overview

Soroban enforces resource limits per transaction:

| Resource | Mainnet Limit | Soft Threshold (80%) |
|----------|---------------|---------------------|
| CPU Instructions | 30,000,000 | 24,000,000 |
| Memory Bytes | 256 MB | 204 MB |
| Ledger Read Bytes | Contract-dependent | ~80% of limit |
| Ledger Write Bytes | Contract-dependent | ~80% of limit |

Any entry point measured above the soft threshold should either:
1. Have its input batch size reduced (e.g., 50 → 40 investors for `batch_refund_investors`)
2. Undergo optimization to reduce resource consumption
3. Be documented with a clear justification if it truly requires that much

## How to Measure

Run the cost-harness test suite:

```bash
cd contracts/production_escrow
cargo test cost_harness -- --nocapture
# or for all cost tests across all contracts:
cd contracts
find . -name "cost_harness_tests.rs" -exec cargo test cost_harness -- --nocapture \;
```

The tests output measured resources in the format:

```
CPU Instructions: 1234567
Memory Bytes:     12345
Ledger Reads:     50
Ledger Writes:    30
```

Copy these numbers into the appropriate row in the table below.

## Baseline Measurements

**IMPORTANT:** The numbers below are placeholders. They must be filled in by a maintainer running the actual cost-harness tests via `cargo test`. Do not deploy to mainnet with these placeholder values — they are meaningless and exist only to document the expected table structure.

### production_escrow

*(Measured against `soroban-sdk 22.0.11` / `soroban-env-host 22.1.3`)*

| Entry Point | Max Input | CPU Instructions | Memory Bytes | Ledger Reads | Ledger Writes | % of Limit | Status |
|-------------|-----------|------------------|--------------|--------------|---------------|-----------|--------|
| `create_campaign` | 1 campaign | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | TBD | Not yet measured |
| `invest` | 1 investment | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | TBD | Not yet measured |
| `claim_returns` | 1 investor | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | TBD | Not yet measured |
| `batch_refund_investors` | 50 investors (max cap) | 20,987,890 | 6,357,010 | 0 (mock) | 0 (mock) | 69.9% | Measured |
| `batch_refund_orders` | All orders (unbounded?) | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | TBD | Needs cap review |
| `vote_to_resolve` | Full arbitrator list | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | TBD | Not yet measured |

### registry

| Entry Point | Max Input | CPU Instructions | Memory Bytes | Ledger Reads | Ledger Writes | % of Limit | Status |
|-------------|-----------|------------------|--------------|--------------|---------------|-----------|--------|
| `register_farmer` | 1 farmer | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | TBD | Not yet measured |
| `get_farmers` | Pagination (50 per page) | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | TBD | Not yet measured |
| `get_campaigns` | Pagination (50 per page) | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | TBD | Not yet measured |

### investment_basket

| Entry Point | Max Input | CPU Instructions | Memory Bytes | Ledger Reads | Ledger Writes | % of Limit | Status |
|-------------|-----------|------------------|--------------|--------------|---------------|-----------|--------|
| `deposit` | 1 deposit | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | TBD | Not yet measured |
| `fund_basket` | MAX_BASKET_SIZE = 20 constituents | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | TBD | Not yet measured |
| `withdraw_basket` | 1 withdrawal | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | TBD | Not yet measured |
| `claim_basket_returns` | 1 investor | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | TBD | Not yet measured |

### governance

| Entry Point | Max Input | CPU Instructions | Memory Bytes | Ledger Reads | Ledger Writes | % of Limit | Status |
|-------------|-----------|------------------|--------------|--------------|---------------|-----------|--------|
| `propose` | 1 proposal | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | TBD | Not yet measured |
| `vote` | 1 vote | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | TBD | Not yet measured |
| `queue` | 1 proposal (after voting) | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | TBD | Not yet measured |
| `execute` | 1 proposal (after timelock) | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | <TO BE FILLED IN BY MAINTAINER RUNNING THE COST HARNESS> | TBD | Not yet measured |

## Analysis & Decisions

Once measurements are filled in, this section should document:

### Batch Size Justification

For entry points with capped batch sizes (e.g., `batch_refund_investors` at 50), explain:

- **Measured cost at cap:** [e.g., 18,500,000 CPU instructions]
- **% of mainnet limit:** [e.g., 62%]
- **Justification:** [e.g., "Safe margin for network congestion; leaves headroom for contract state growth"]
- **Alternative:** [e.g., "Could reduce to 40 if cost becomes an issue in future; verified feasible at 50"]

### Pagination Thresholds

For paginated queries (e.g., `get_campaigns` with limit parameter):

- **Measured at 50 items:** [cost]
- **Measured at 100 items:** [cost]
- **Recommendation:** [e.g., "Recommend max 50 per page to stay under 15,000,000 CPU instructions"]

### Resource-Heavy Operations

For operations approaching the soft threshold (80% of limit):

- **Entry point:** [name]
- **Current cost:** [X CPU instructions, Y% of limit]
- **Issue filed:** [#NNN] (if optimization needed)
- **Status:** [Acceptable | Under review | Needs optimization]

## CI Integration

A CI workflow job should:

1. Run the cost-harness test suite as part of the test matrix
2. Parse the output and extract measured CPU/memory for each entry point
3. Fail the job if any entry point exceeds the soft threshold (80%)
4. Print a summary table showing % of limit for each entry point

**Example CI job:**

```yaml
cost-baseline:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions-rs/toolchain@v1
      with:
        toolchain: 1.89.0
        target: wasm32v1-none
    - name: Run cost harness
      run: cd contracts && cargo test cost_harness -- --nocapture > cost-results.txt
    - name: Check against thresholds
      run: |
        # Parse cost-results.txt and verify no entry point exceeds 80% of mainnet limits
        # Example threshold: 80% of 30M = 24M CPU instructions
        if grep "CPU Instructions.*2[4-9][0-9][0-9][0-9][0-9][0-9][0-9]" cost-results.txt; then
          echo "ERROR: CPU usage exceeds soft threshold (24M instructions)"
          exit 1
        fi
        # ... similar checks for memory, ledger ops ...
    - name: Upload results
      uses: actions/upload-artifact@v3
      if: always()
      with:
        name: cost-baseline-results
        path: contracts/cost-results.txt
```

## Future Optimizations

Once measurements are in place, file optimization issues if needed:

- [ ] Issue #NNN: `batch_refund_investors` exceeds 24M CPU at 50-investor cap
- [ ] Issue #NNN: `fund_basket` at MAX_BASKET_SIZE=20 is approaching threshold
- [ ] Issue #NNN: `vote_to_resolve` scales poorly with arbitrator count
- [ ] Issue #NNN: Pagination cost jumps at 100+ items (needs index optimization?)

## References

- **Issue #781:** Resource cost profiling (this document)
- **Cost Harness Tests:** `contracts/*/src/cost_harness_tests.rs`
- **Soroban Resource Estimation:** https://developers.stellar.org/learn/smart-contracts/resource-estimation
- **Mainnet Resource Limits:** https://developers.stellar.org/learn/smart-contracts/resource-limits
