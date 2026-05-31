import type { ParsedEvent } from "./types.js";
import logger from "../config/logger.js";

/**
 * Transaction Patterns Documentation
 * ====================================
 *
 * All database writes in EventPersister use Prisma interactive transactions
 * (`prisma.$transaction(async (tx) => { ... })`).
 *
 * Isolation Level:
 * - Prisma uses READ COMMITTED by default on PostgreSQL.
 * - Each transaction sees only committed data from other transactions.
 * - This prevents dirty reads but allows non-repeatable reads.
 *
 * Consistency Guarantees:
 * - Two-phase idempotency check: once before the transaction (preflight)
 *   and once inside the transaction (in-tx check). This prevents duplicate
 *   writes even under concurrent replays of the same ledger event.
 * - All domain model mutations (campaign, order, investment) happen inside
 *   a single transaction together with the transaction record insert.
 *   Either all succeed or all roll back.
 *
 * Concurrency Safety:
 * - The `transaction` table has a unique constraint on (ledger, eventIndex).
 *   If two concurrent workers try to persist the same event, one will fail
 *   with a unique constraint violation. The caller should retry on conflict.
 * - Status transitions (e.g. FUNDING → FUNDED) are safe under concurrency
 *   because they are idempotent — writing the same status twice has no effect.
 */

type TransactionClient = {
  transaction: {
    findUnique: (args: unknown) => Promise<{ id: string } | null>;
    create: (args: unknown) => Promise<unknown>;
  };
};

/**
 * Checks if an event has already been persisted.
 * Safe to call both inside and outside a transaction.
 */
export async function hasPersistedEvent(
  client: TransactionClient,
  ledger: number,
  eventIndex: number,
): Promise<boolean> {
  const existing = await client.transaction.findUnique({
    where: { ledger_eventIndex: { ledger, eventIndex } },
  });
  return Boolean(existing);
}

/**
 * Inside a transaction, checks for duplicates and logs if found.
 * Returns true if the event should be skipped.
 */
export async function skipDuplicateInTransaction(
  tx: TransactionClient,
  event: ParsedEvent,
): Promise<boolean> {
  const alreadyProcessed = await hasPersistedEvent(tx, event.ledger, event.eventIndex);
  if (alreadyProcessed) {
    logDuplicateSkip(event, "persist.tx");
    return true;
  }
  return false;
}

/**
 * Logs a duplicate skip at debug level.
 */
export function logDuplicateSkip(event: ParsedEvent, stage: string): void {
  logger.debug("EventPersister: skipping duplicate", {
    action: event.action,
    ledger: event.ledger,
    eventIndex: event.eventIndex,
    stage,
  });
}

/**
 * Builds the standard transaction record payload for any event.
 */
export function buildTransactionPayload(
  event: ParsedEvent,
  campaignId: string | null,
) {
  return {
    campaignId,
    eventType: event.action,
    payload: event as unknown as Record<string, unknown>,
    ledger: event.ledger,
    eventIndex: event.eventIndex,
  };
}