# Event System Reference

This document describes all Soroban contract events emitted by the Agrocylo production escrow contract, how they are indexed, and the consistency guarantees the system provides.

## Architecture Overview

Events flow through three layers:

1. **Watcher** (`src/events/watcher.ts`) — polls the Soroban RPC every 5 seconds for new contract events starting from a persisted ledger checkpoint.
2. **Parser** (`src/events/parser.ts`) — decodes base64 XDR topics and value into typed `ParsedEvent` objects.
3. **Persister** (`src/events/persister.ts`) — writes parsed events to the PostgreSQL database and updates domain models (campaigns, investments, orders).

---

## Event Identification

Every raw Soroban event carries an `id` in `"<ledger>-<index>"` format (e.g. `"12345678-3"`).

| Field        | Source                          | Description                              |
|--------------|---------------------------------|------------------------------------------|
| `ledger`     | `raw.ledger`                    | Ledger sequence number the event landed in |
| `eventIndex` | second segment of `raw.id`      | Position within the ledger               |
| `timestamp`  | `raw.ledgerClosedAt`            | ISO 8601 close time of the ledger        |
| `rawId`      | `raw.id`                        | Full original event ID                   |

The `(ledger, eventIndex)` pair is the **deduplication key** stored in the `Transaction` table.

---

## Event Types and Payloads

All events share a base shape:

```ts
interface BaseEvent {
  action: EventAction;   // e.g. "campaign.created"
  ledger: number;
  eventIndex: number;
  timestamp: Date;
  rawId: string;
}
```

Topics are encoded as `[namespace, verb, ...]` in base64 XDR. The indexer reconstructs `action = "${namespace}.${verb}"`.

### campaign.created

Emitted when a farmer initialises a new production campaign on-chain.

| Field          | Type     | Description                                   |
|----------------|----------|-----------------------------------------------|
| `campaignId`   | `string` | On-chain campaign identifier                  |
| `farmer`       | `string` | Farmer wallet address                         |
| `token`        | `string` | Payment token contract address                |
| `targetAmount` | `string` | Funding target (smallest token unit as string)|
| `deadline`     | `string` | Unix timestamp (seconds) for funding deadline |

**Side effects**: upserts the farmer `User`, upserts the `Campaign` with status `FUNDING`, records a `Transaction`.

---

### campaign.invested

Emitted each time an investor funds a campaign.

| Field        | Type     | Description                                 |
|--------------|----------|---------------------------------------------|
| `campaignId` | `string` | On-chain campaign identifier                |
| `investor`   | `string` | Investor wallet address                     |
| `amount`     | `string` | Amount invested in this transaction         |
| `totalRaised`| `string` | Cumulative amount raised after this event   |

**Side effects**: upserts the investor `User`, updates `Campaign.totalRaised`, sets campaign status to `FUNDED` when `totalRaised` reaches or exceeds `targetAmount` (compared as BigInt — see issue #1068), upserts an `Investment` record (keyed by `campaignId + investorAddress + ledger`), broadcasts `campaign.invested` over WebSocket, records a `Transaction`.

**Overfunding policy**: the contract does not reject contributions beyond the target, so `totalRaised` may exceed `targetAmount`. The indexer marks the campaign `FUNDED` on the first event whose `totalRaised >= targetAmount`; overshoot amounts remain recorded in `Campaign.totalRaised`.

---

### campaign.settled

Emitted when the escrow contract settles a campaign after harvest revenue is distributed.

| Field          | Type     | Description                         |
|----------------|----------|-------------------------------------|
| `campaignId`   | `string` | On-chain campaign identifier        |
| `totalRevenue` | `string` | Total revenue distributed           |

**Side effects**: updates `Campaign.totalRevenue` and status to `SETTLED`, broadcasts `campaign.settled` over WebSocket, records a `Transaction`.

---

### campaign.produce

Emitted when a campaign transitions to the active production phase.

| Field        | Type       | Description                  |
|--------------|------------|------------------------------|
| `campaignId` | `string`   | On-chain campaign identifier |
| `extra`      | `unknown[]`| Additional contract data     |

**Side effects**: sets campaign status to `IN_PRODUCTION`, records a `Transaction`.

---

### campaign.harvest

Emitted when produce is ready for sale.

| Field        | Type       | Description                  |
|--------------|------------|------------------------------|
| `campaignId` | `string`   | On-chain campaign identifier |
| `extra`      | `unknown[]`| Additional contract data     |

**Side effects**: sets campaign status to `HARVESTED`, records a `Transaction`.

---

### campaign.failed

Emitted when a campaign fails (e.g. funding deadline missed, crop failure).

| Field        | Type       | Description                  |
|--------------|------------|------------------------------|
| `campaignId` | `string`   | On-chain campaign identifier |
| `extra`      | `unknown[]`| Additional contract data     |

**Side effects**: sets campaign status to `FAILED`, records a `Transaction`.

---

### campaign.disputed

Emitted when a dispute is raised against a campaign.

| Field        | Type       | Description                  |
|--------------|------------|------------------------------|
| `campaignId` | `string`   | On-chain campaign identifier |
| `extra`      | `unknown[]`| Additional contract data     |

**Side effects**: sets campaign status to `DISPUTED`, records a `Transaction`.

---

### campaign.claimed

Emitted when a farmer claims funds.

| Field        | Type       | Description                  |
|--------------|------------|------------------------------|
| `campaignId` | `string`   | On-chain campaign identifier |
| `extra`      | `unknown[]`| Additional contract data     |

**Side effects**: records a `Transaction` only (no status change — status is already `SETTLED`).

---

### campaign.refunded

Emitted when investors are refunded after a failed campaign.

| Field        | Type       | Description                  |
|--------------|------------|------------------------------|
| `campaignId` | `string`   | On-chain campaign identifier |
| `extra`      | `unknown[]`| Additional contract data     |

**Side effects**: records a `Transaction` only.

---

### campaign.tranche

Emitted on each milestone tranche payment to the farmer.

| Field        | Type       | Description                  |
|--------------|------------|------------------------------|
| `campaignId` | `string`   | On-chain campaign identifier |
| `extra`      | `unknown[]`| Additional contract data     |

**Side effects**: records a `Transaction` only.

---

### order.created

Emitted when a buyer submits a purchase order.

| Field        | Type     | Description                  |
|--------------|----------|------------------------------|
| `orderId`    | `string` | On-chain order identifier    |
| `buyer`      | `string` | Buyer wallet address         |
| `campaignId` | `string` | Campaign being ordered from  |
| `amount`     | `string` | Order amount (token units)   |

**Side effects**: upserts the buyer `User`, upserts the `Order` (keyed by `onChainId`) with status `PENDING`, records a `Transaction`.

---

### order.confirmed

Emitted when a buyer confirms receipt.

| Field        | Type     | Description                  |
|--------------|----------|------------------------------|
| `orderId`    | `string` | On-chain order identifier    |
| `buyer`      | `string` | Buyer wallet address         |
| `campaignId` | `string` | Campaign the order belongs to|

**Side effects**: updates `Order.status` to `CONFIRMED`, increments `Campaign.totalRevenue` by the order amount, records a `Transaction`.

---

## Event Ordering and Consistency Guarantees

- Events are polled in **ledger-sequence order**. The watcher advances its checkpoint (`lastLedger`) only after all events in a batch are processed, ensuring no event is silently skipped.
- Within a ledger, events are delivered in **`eventIndex` order** as returned by the Soroban RPC.
- The checkpoint is stored **in-memory only**; on restart the watcher reloads the last `Transaction.ledger` from the database, so reprocessing at most a handful of already-processed events is possible. All persist operations are idempotent, so reprocessing is safe.
- A **high-water mark** is computed per batch: only if events were seen does `lastLedger` advance to `highWaterMark + 1`, preventing the pointer from jumping forward on empty polls.

---

## Idempotency and Duplicate Handling

Every `EventPersister.persist` call performs a preflight check:

```
SELECT 1 FROM "Transaction" WHERE ledger = $1 AND "eventIndex" = $2
```

If the record exists the event is skipped. For multi-step handlers (e.g. `campaign.invested`), a second identical check runs **inside the database transaction** to close the TOCTOU window under concurrent replays.

Upserts (e.g. `Campaign`, `Investment`, `User`) use `update: {}` so repeated creates are no-ops.

---

## Recovery and Replay Behavior

| Scenario | Behaviour |
|---|---|
| Normal restart | Resumes from the last persisted `Transaction.ledger`. |
| No events ever processed | Falls back to the current on-chain ledger tip (starts fresh). |
| Gap > 1 000 ledgers | Fast-forwards checkpoint to `current - 1000` to prevent replay of stale data. |
| Malformed / unknown event | Logged as a warning via `ProductionEventParser.tryParse`; watcher continues. |
| Persister error | Logged as an error; watcher continues to next event. |
| Database unavailable | Poll fails with an error log; next interval retries automatically. |

The `MAX_LEDGER_GAP = 1000` constant in `watcher.ts` controls the maximum number of ledgers replayed after a long outage. Increase it if full replay is needed; decrease it to limit reprocessing time.

---

## WebSocket Broadcasts

Two events are broadcast in real-time to connected WebSocket clients:

| Action              | Payload fields                                         |
|---------------------|--------------------------------------------------------|
| `campaign.invested` | `campaignId`, `investorAddress`, `amount`, `totalRaised` |
| `campaign.settled`  | `campaignId`, `onChainId`, `totalRevenue`              |

Clients connect to the server's WebSocket endpoint and receive JSON messages of the shape `{ event: "<action>", data: { ... } }`.
