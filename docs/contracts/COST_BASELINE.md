# Contract Cost Baseline

This baseline is enforced by `contracts/production_escrow/src/cost_harness_tests.rs`. Each test invokes the named entrypoint against a funded campaign and asserts that the measured CPU and memory stay within the ceilings below.

Run the harness with:

```sh
cargo test -p production_escrow cost_ -- --nocapture
```

| Entrypoint | CPU instructions (max) | Memory bytes (max) |
| --- | ---: | ---: |
| `initialize` | 100_000_000 | 40_000_000 |
| `create_campaign` | 100_000_000 | 40_000_000 |
| `invest` | 100_000_000 | 40_000_000 |
| `start_production` | 100_000_000 | 40_000_000 |
| `mark_harvest` | 100_000_000 | 40_000_000 |
| `advance_milestone` | 100_000_000 | 40_000_000 |
| `settle` | 100_000_000 | 40_000_000 |
| `refund` | 100_000_000 | 40_000_000 |
| `claim_returns` | 100_000_000 | 40_000_000 |
| `mark_campaign_failed` | 100_000_000 | 40_000_000 |
| `batch_refund_investors` | 100_000_000 | 40_000_000 |
| `transfer_investment` | 100_000_000 | 40_000_000 |
| `open_dispute` | 100_000_000 | 40_000_000 |
| `resolve_dispute` | 100_000_000 | 40_000_000 |

## Batch refund

`batch_refund_investors` is bounded by the caller-supplied investor vector. The contract iterates over the vector once and refunds each investor; the resource cost therefore scales with the vector length. The harness measures a two-investor batch. The vector is not unbounded: the caller must fit the list into the transaction's resource limits.
