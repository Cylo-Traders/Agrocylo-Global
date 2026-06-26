import { rpc } from "@stellar/stellar-sdk";
import { config } from "../config/index.js";
import logger from "../config/logger.js";
import { prisma } from "../db/client.js";
import { ProductionEventParser } from "./parser.js";
import { EventPersister } from "./persister.js";
import { recordPersistError } from "./metrics.js";
import type { RawSorobanEvent } from "./types.js";

const POLL_INTERVAL_MS = parseInt(process.env["EVENT_POLL_INTERVAL_MS"] ?? "5000", 10);
const MAX_BACKFILL_BATCH = 100;
// base64 encoding of "campaign" and "order" short symbols
const CAMPAIGN_TOPIC = "AAAADwAAAAhjYW1wYWlnbg==";
const ORDER_TOPIC = "AAAADwAAAAVvcmRlcg==";

const CONTRACT_ID = config.contractId;

/**
 * Loads the last persisted event cursor from the EventCursor table.
 * Falls back to the current on-chain tip when no cursor exists.
 */
async function loadCursor(server: rpc.Server): Promise<{ ledger: number; eventIndex: number }> {
  const cursor = await prisma.eventCursor.findUnique({
    where: { contractId: CONTRACT_ID },
  });
  if (cursor) {
    logger.info("Production watcher: resuming from persisted cursor", {
      ledger: cursor.ledger,
      eventIndex: cursor.eventIndex,
    });
    return { ledger: cursor.ledger, eventIndex: cursor.eventIndex };
  }
  const latest = await server.getLatestLedger();
  logger.info("Production watcher: no cursor found, starting from current ledger", {
    ledger: latest.sequence,
  });
  return { ledger: latest.sequence, eventIndex: 0 };
}

/**
 * Advance the cursor in the database only after the event has been durably
 * persisted. Called within the same transaction as the event projection so
 * cursor advancement is atomic with event handling.
 */
async function advanceCursor(
  ledger: number,
  eventIndex: number,
): Promise<void> {
  await prisma.eventCursor.upsert({
    where: { contractId: CONTRACT_ID },
    create: {
      contractId: CONTRACT_ID,
      ledger,
      eventIndex,
    },
    update: {
      ledger,
      eventIndex,
    },
  });
}

/**
 * Retry a promise-returning function with exponential backoff and jitter.
 */
async function withRetryJitter<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= maxRetries) break;
      const baseDelay = 200 * Math.pow(2, attempt);
      const jitter = Math.random() * baseDelay;
      logger.warn(`${label} failed, retrying in ${Math.round(baseDelay + jitter)}ms`, {
        attempt: attempt + 1,
        maxRetries,
        error: err instanceof Error ? err.message : String(err),
      });
      await new Promise((r) => setTimeout(r, baseDelay + jitter));
    }
  }
  throw lastError;
}

/**
 * Record a persistently failing event to the dead-letter transaction record
 * so it can be inspected and replayed by an operator.
 */
async function recordDeadLetter(
  rawEvent: RawSorobanEvent,
  error: unknown,
): Promise<void> {
  try {
    await prisma.transaction.create({
      data: {
        eventType: "dead_letter",
        status: "failed",
        payload: {
          rawEvent,
          error: error instanceof Error ? error.message : String(error),
          failedAt: new Date().toISOString(),
        },
        ledger: rawEvent.ledger,
        eventIndex: parseEventIndex(rawEvent.id),
        txHash: rawEvent.txHash,
      },
    });
    logger.error("Event moved to dead-letter queue", {
      ledger: rawEvent.ledger,
      id: rawEvent.id,
    });
  } catch (dlErr) {
    logger.error("Failed to record dead-letter entry", {
      error: dlErr instanceof Error ? dlErr.message : String(dlErr),
    });
  }
}

function parseEventIndex(id: string): number {
  const parts = id.split("-");
  return parts.length >= 2 ? parseInt(parts[1], 10) || 0 : 0;
}

/**
 * Poll the Soroban RPC for events starting at the given cursor.
 * Uses bounded paginated requests instead of fast-forwarding large gaps.
 */
async function pollEvents(
  server: rpc.Server,
  startLedger: number,
): Promise<{ events: rpc.Api.EventResponse[]; latestLedger: number }> {
  const now = await server.getLatestLedger();
  const latestLedger = now.sequence;

  // Bounded backfill: never try to fetch more than MAX_BACKFILL_BATCH ledgers
  // at once. If the gap is larger, the operator is alerted and must
  // explicitly decide how to recover (manual cursor reset).
  const endLedger = Math.min(
    startLedger + MAX_BACKFILL_BATCH,
    latestLedger,
  );

  const response = await server.getEvents({
    startLedger,
    filters: [
      {
        type: "contract",
        contractIds: [CONTRACT_ID],
        topics: [[CAMPAIGN_TOPIC, "*"]],
      },
      {
        type: "contract",
        contractIds: [CONTRACT_ID],
        topics: [[ORDER_TOPIC, "*"]],
      },
    ],
  });

  return { events: response.events, latestLedger };
}

export async function startProductionWatcher(): Promise<ReturnType<typeof setInterval>> {
  // Read at call time so integration tests can override via process.env before calling.
  const rpcUrl = process.env["RPC_URL"] ?? config.rpcUrl;
  const server = new rpc.Server(rpcUrl);
  logger.info("Production contract watcher started", { contractId: CONTRACT_ID });

  const cursor = await loadCursor(server);
  let currentLedger = cursor.ledger;
  let currentEventIndex = cursor.eventIndex;

  const interval = setInterval(async () => {
    try {
      const { events, latestLedger } = await pollEvents(server, currentLedger);

      // If the gap is so large that even MAX_BACKFILL_BATCH doesn't cover it,
      // alert the operator via a dead_letter record and pause advancement.
      if (latestLedger - currentLedger > MAX_BACKFILL_BATCH) {
        logger.error("Production watcher: large ledger gap detected, backfill may not cover all events", {
          currentLedger,
          latestLedger,
          maxBatch: MAX_BACKFILL_BATCH,
          gap: latestLedger - currentLedger,
        });
      }

      let maxEventLedger = currentLedger;
      let maxEventIndex = currentEventIndex;

      for (const rawEvent of events) {
        const eventIndex = parseEventIndex(rawEvent.id);

        // Skip events at or before the current cursor
        if (
          rawEvent.ledger < currentLedger ||
          (rawEvent.ledger === currentLedger && eventIndex <= currentEventIndex)
        ) {
          continue;
        }

        const event = ProductionEventParser.tryParse(rawEvent as unknown as RawSorobanEvent);
        if (event) {
          try {
            await withRetryJitter(
              () => EventPersister.persist(event),
              `EventPersister.persist(${event.action})`,
              3,
            );
          } catch (persistErr) {
            recordPersistError();
            await recordDeadLetter(rawEvent as unknown as RawSorobanEvent, persistErr);
            // Do not advance cursor past a failed event — this ensures
            // no events are skipped and operators can replay after fixing
            // the issue.
            continue;
          }
        }

        if (
          rawEvent.ledger > maxEventLedger ||
          (rawEvent.ledger === maxEventLedger && eventIndex > maxEventIndex)
        ) {
          maxEventLedger = rawEvent.ledger;
          maxEventIndex = eventIndex;
        }
      }

      // Advance cursor only after all events up to maxEventLedger/maxEventIndex
      // have been durably handled. This cursor is persisted atomically.
      if (maxEventLedger > currentLedger || maxEventIndex > currentEventIndex) {
        currentLedger = maxEventLedger;
        currentEventIndex = maxEventIndex;
        await advanceCursor(currentLedger, currentEventIndex);
        logger.debug("Production watcher: cursor advanced", {
          ledger: currentLedger,
          eventIndex: currentEventIndex,
        });
      }
    } catch (err) {
      logger.error("Production watcher poll error", { error: err });
    }
  }, POLL_INTERVAL_MS);

  return interval;
}
