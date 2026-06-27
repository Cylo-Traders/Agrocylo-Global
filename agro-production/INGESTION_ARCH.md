# Soroban Event Ingestion Architecture

## Overview

This document describes the canonical Soroban event ingestion pipeline and the consolidation of previously competing implementations.

## Canonical Pipeline

**File:** `agro-production/server/src/events/watcher.ts`  
**Export:** `startProductionWatcher()`

The consolidated pipeline is the **only** active ingestion path. It unifies event handling for all configured smart contracts.

## What It Handles

### Contracts Watched
- **Escrow Contract** (if `ESCROW_CONTRACT_ID` is set): Watches for order events
- **Production Escrow Contract** (if `PRODUCTION_ESCROW_CONTRACT_ID` is set): Watches for campaign, order, and dispute events
- **Single Production Contract** (if `PRODUCTION_CONTRACT_ID` is set): Watches for campaign and order events

### Events Processed
- `campaign.*` — Campaign creation, investment, settlement, lifecycle transitions
- `order.*` — Order creation, confirmation
- `dispute.*` — Dispute events (production escrow only)

## How It Works

### 1. Checkpoint Loading
On startup, the watcher loads the last persisted ledger from the database:
- If a previous run persisted events, it resumes from `max(ledger)` in the transaction table
- If no checkpoint exists, it starts from the current on-chain tip
- This prevents re-processing and gaps in the event stream

### 2. Ledger Polling
Every 5 seconds (`POLL_INTERVAL_MS`):
1. Calls Soroban RPC `getEvents()` starting from the last checkpoint
2. Filters by configured contract IDs and event topics
3. Parses each raw event using `ProductionEventParser`
4. Persists parsed events using `EventPersister`

### 3. Parsing
`ProductionEventParser.tryParse()` converts RPC event responses to a normalized format:
- Decodes XDR-encoded topics and values
- Extracts action, data, ledger, and tx hash
- Returns null if parsing fails (logged, not fatal)

### 4. Persistence
`EventPersister.persist()` is the **only** path for writing financial state changes:
- Records the event to the transaction table (idempotent by ledger + eventIndex)
- Updates domain models (Campaign, Order, Investment) based on event type
- Broadcasts WebSocket notifications for real-time updates
- Handles all status transitions (PENDING → FUNDED, CONFIRMED, SETTLED, etc.)

### 5. Checkpoint Advance
After all events in a batch are processed:
- Advances the checkpoint to `highWaterMark + 1`
- The transaction table's `ledger` becomes the checkpoint
- Persisted in the database for recovery after shutdown

### 6. Gap Reconciliation
If the local checkpoint falls behind the on-chain tip by more than `MAX_LEDGER_GAP` (1000 ledgers):
- Logs a warning
- Fast-forwards the checkpoint to `currentLedger - MAX_LEDGER_GAP`
- Prevents unbounded re-processing during prolonged outages
- Trade-off: may skip very old events, but recovers availability

## Deprecated Pipeline

**File:** `agro-production/server/src/services/sorobanEventListener.ts`  
**Status:** DEPRECATED

This pipeline has been removed from the active startup sequence. It remains in the codebase for:
- Historical reference
- Potential data migration tooling

**Do not use this code for new event processing.**

## Data Migration Plan

No data migration is required. The consolidated pipeline uses the same:
- `Transaction` table for checkpoint persistence
- `Campaign`, `Order`, `Investment` models for state
- `EventPersister` for domain updates
- WebSocket broadcast mechanism

### For Deployments

1. Deploy the new code (which only starts `startProductionWatcher`)
2. The watcher will resume from the last checkpoint in the database
3. No downtime or data loss

### Why No Migration Needed

Both pipelines wrote to the same transaction table with the same ledger/eventIndex uniqueness constraint. The consolidated pipeline simply resumes from the existing checkpoint and processes any events that may have been missed during the transition.

## Metrics & Observability

The watcher logs:
- **On startup:** Contract IDs being watched
- **Per poll:** Events processed, checkpoint advanced
- **On error:** RPC failures, parsing failures, persister errors
- **On gap:** Ledger gap detection and fast-forward

Enable debug logging to see detailed event parsing and checkpoint state.

## Key Design Decisions

1. **Single Pipeline:** Easier to maintain, test, and reason about
2. **Persistent Checkpoint:** Enables resumption without re-processing the entire history
3. **Gap Reconciliation:** Trades completeness for availability during extended outages
4. **EventPersister Ownership:** All financial state changes go through the persister, ensuring audit trail and idempotency
5. **Best-Effort Broadcasting:** WebSocket is a notification layer; REST/database is source of truth

## Future Improvements

- Persist retry count per event for better debugging
- Add metrics on ingestion lag (current_ledger - event_ledger)
- Consider per-contract checkpoints to decouple contract availability
- Add failed event replay mechanism (currently logs and moves on)
