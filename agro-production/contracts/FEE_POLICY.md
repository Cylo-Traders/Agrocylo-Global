# Order and Platform Fee Policy

This document defines the fee structure, timing, and refund policy for orders in the Agrocylo production escrow contract.

## Fee Structure

### Order Fees
- **Fee Rate:** Configurable by admin (default: 2% of order amount, expressed in basis points; e.g., 200 bps = 2%)
- **Fee Collector:** Configured at contract initialization; receives fees from completed orders
- **Calculation:** `fee = (order_amount * fee_rate_bps) / 10_000`
- **Rounding:** Fees are calculated with integer arithmetic; dust (remainder) is discarded

### Examples
- Order: 1,000 tokens at 2% fee = 20 tokens fee (980 net to farmer)
- Order: 100 tokens at 2% fee = 2 tokens fee (98 net to farmer)
- Order: 1 token at 2% fee = 0 tokens fee (1 net to farmer) — no fee if < 1 token

## Fee Lifecycle

### 1. Order Creation
When a buyer creates an order:
1. Buyer transfers `order_amount` to the escrow contract
2. The contract calculates the fee: `fee = (order_amount * fee_rate_bps) / 10_000`
3. **Both fee and net amount are escrowed together** — neither is transferred to the collector immediately
4. Event: `order:created` with `(order_id, buyer, campaign_id, order_amount)`

### 2. Order Confirmation (Successful Delivery)
When a buyer confirms receipt (`confirm_order`):
1. The full `order_amount` counts toward campaign revenue
2. Farmer receives the net amount: `order_amount - fee`
3. Fee collector receives the fee amount
4. Order transitions to `Confirmed` state
5. Event: `order:confirmed` with `(order_id, buyer, campaign_id)`
6. Event: `order:fee_collected` with `(order_id, fee_amount)` if fee > 0

### 3. Order Expiry and Refund (Undelivered Order)
When an order expires (pending for >96 hours) and is refunded:
1. Buyer receives **full refund**: `order_amount` (both net and fee)
2. Fee collector receives **nothing** — fee is forfeited
3. Order transitions to `Confirmed` state (reused as terminal marker)
4. Campaign revenue is **unchanged** (never credited)
5. Event: `order:batch_ref` with `(count, total_refunded)` for batch refunds
6. Event: `order:fee_refunded` with `(order_id, fee_amount)` if fee > 0

### 4. Dispute Resolution
For orders involved in campaign disputes:
- **FullPayoutToInvestors resolution:** Order is not directly affected; fees already collected (if confirmed)
- **RefundInvestors resolution:** If order was confirmed, no refund is issued (order fully consumed)
- **Partial resolution:** Order fees already collected; no retroactive fee refund

## Configuration

### Initialization
```
initialize(env, admin, supported_tokens, fee_collector, fee_rate_bps)
```
- `fee_collector`: Address receiving fees (typically platform address)
- `fee_rate_bps`: Fee rate in basis points (0–10000); 0 = no fees

### Update Fee Configuration
```
set_fee_config(env, admin, fee_collector, fee_rate_bps)
```
- Only callable by admin
- Does not affect orders already created (immutable per-order)

## Notes

### Why Refund Fees on Expiry?
Expired orders represent undelivered goods. The buyer should not lose a fee for a service not rendered. The fee incentivizes rapid order confirmation; if a buyer never confirms, they get a full refund.

### Why Escrow Fees?
Escrowing fees ensures:
1. **Atomicity:** If the order is created, both net and fee are available for the appropriate terminal action
2. **Auditability:** The ledger shows funds were held as escrow, not immediately taken
3. **Reversibility:** If an order is refunded, the fee is also refunded without requiring a retroactive query

### Dust Handling
If an order amount is very small (e.g., 1 token at 2%), the fee may round to 0.
In such cases:
- No fee is collected
- Buyer receives full refund if order expires
- Farmer receives full net if order confirms

No separate dust account is maintained; rounding is a natural consequence of integer division.

### Fee Collector Immutability
Fees are held in escrow at order creation time. Changing the fee collector address does not affect orders already created—their fees go to the original collector when confirmed. This prevents mid-stream fund misrouting.

---

## Backwards Compatibility

This policy is new and applies to all orders created after contract upgrade.
Orders created under the old zero-fee policy should be migrated or grandfathered under explicit rules (outside scope of this document).
