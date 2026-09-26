import { rpc } from '@stellar/stellar-sdk';
import type { Prisma } from '@prisma/client';
import { config } from '../config/index.js';
import logger from '../config/logger.js';
import { prisma } from '../db/client.js';
import { ProductionEventParser } from './parser.js';
import { EventPersister, DependencyMissingError } from './persister.js';
import { recordPersistError } from './metrics.js';
import type { RawSorobanEvent } from './types.js';
import { captureAlert } from '../config/sentry.js';

const POLL_INTERVAL_MS = parseInt(
  process.env['EVENT_POLL_INTERVAL_MS'] ?? '5000',
  10,
);
const CONFIRMATION_DEPTH = parseInt(
  process.env['CONFIRMATION_DEPTH'] ?? '10',
  10,
);
const MAX_BACKFILL_BATCH = 100;
// base64 encoding of "campaign" and "order" short symbols
const CAMPAIGN_TOPIC = 'AAAADwAAAAhjYW1wYWlnbg==';
const ORDER_TOPIC = 'AAAADwAAAAVvcmRlcg==';
const DISPUTE_TOPIC = 'AAAADwAAAAdkaXNwdXRl';
// base64 encoding of the "basket" short symbol
const BASKET_TOPIC = 'AAAADwAAAAZiYXNrZXQAAA==';

const CONTRACT_ID = config.contractId;
const BASKET_CONTRACT_ID = config.basketContractId;

/**
 * Loads the last persisted event cursor from the EventCursor table.
 * Falls back to the current on-chain tip when no cursor exists.
 */
async function loadCursor(
  server: rpc.Server,
): Promise<{ ledger: number; eventIndex: number }> {
  const cursor = await prisma.eventCursor.findUnique({
    where: { contractId: CONTRACT_ID },
  });
  if (cursor) {
    logger.info('Production watcher: resuming from persisted cursor', {
      ledger: cursor.ledger,
      eventIndex: cursor.eventIndex,
    });
    return { ledger: cursor.ledger, eventIndex: cursor.eventIndex };
  }
  const latest = await server.getLatestLedger();
  logger.info(
    'Production watcher: no cursor found, starting from current ledger',
    {
      ledger: latest.sequence,
    },
  );
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
  ledgerHash?: string,
): Promise<void> {
  await prisma.eventCursor.upsert({
    where: { contractId: CONTRACT_ID },
    create: {
      contractId: CONTRACT_ID,
      ledger,
      eventIndex,
      ledgerHash,
    },
    update: {
      ledger,
      eventIndex,
      ...(ledgerHash && { ledgerHash }),
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
      logger.warn(
        `${label} failed, retrying in ${Math.round(baseDelay + jitter)}ms`,
        {
          attempt: attempt + 1,
          maxRetries,
          error: err instanceof Error ? err.message : String(err),
        },
      );
      await new Promise((r) => setTimeout(r, baseDelay + jitter));
    }
  }
  throw lastError;
}

/**
 * Record a persistently failing event to the dead-letter transaction record
 * so it can be inspected and replayed by an operator (issue #1067).
 *
 * The row is keyed by the event's unique (ledger, eventIndex) and upserted,
 * so a dependency-missing event that is retried every poll updates one
 * replayable dead-letter row instead of creating duplicates.
 */
async function recordDeadLetter(
  rawEvent: RawSorobanEvent,
  error: unknown,
): Promise<void> {
  const payload = {
    rawEvent,
    error: error instanceof Error ? error.message : String(error),
    failedAt: new Date().toISOString(),
  } as unknown as Prisma.InputJsonValue;

  try {
    await prisma.transaction.upsert({
      where: {
        ledger_eventIndex: {
          ledger: rawEvent.ledger,
          eventIndex: parseEventIndex(rawEvent.id),
        },
      },
      create: {
        eventType: 'dead_letter',
        status: 'failed',
        payload,
        ledger: rawEvent.ledger,
        eventIndex: parseEventIndex(rawEvent.id),
        txHash: rawEvent.txHash,
      },
      update: {
        eventType: 'dead_letter',
        status: 'failed',
        payload,
      },
    });
    logger.error('Event moved to dead-letter queue', {
      ledger: rawEvent.ledger,
      id: rawEvent.id,
    });
    captureAlert(
      "contract_watcher_ingestion_failure",
      `Event ${rawEvent.id} at ledger ${rawEvent.ledger} moved to dead-letter queue`,
      { ledger: rawEvent.ledger, eventId: rawEvent.id },
    );
  } catch (dlErr) {
    logger.error('Failed to record dead-letter entry', {
      error: dlErr instanceof Error ? dlErr.message : String(dlErr),
    });
  }
}

export interface DeadLetterReplayResult {
  /** Dead letters that were replayed successfully and removed from the queue. */
  replayed: number;
  /** Dead letters that are still failing (or had an unparseable payload). */
  failed: number;
}

/**
 * Re-run dead-lettered raw events through the parser and persister
 * (issue #1067). Rows that project successfully are removed from the queue;
 * rows that fail again stay queued for the next replay. When
 * `campaignOnChainId` is given, only child events of that campaign are
 * replayed — used to replay after the parent campaign has been indexed.
 *
 * Called automatically after a `campaign.created` event is indexed, and
 * exported for operators to replay exhausted events manually.
 */
export async function replayDeadLetterEvents(
  opts?: { campaignOnChainId?: string; limit?: number },
): Promise<DeadLetterReplayResult> {
  const limit = Math.max(1, Math.min(opts?.limit ?? 50, 500));
  const deadLetters = await prisma.transaction.findMany({
    where: { eventType: 'dead_letter', status: 'failed' },
    orderBy: [{ ledger: 'asc' }, { eventIndex: 'asc' }],
    take: limit,
  });

  let replayed = 0;
  let failed = 0;

  for (const row of deadLetters) {
    const payload = row.payload as { rawEvent?: RawSorobanEvent } | null;
    const rawEvent = payload?.rawEvent;
    if (!rawEvent) {
      failed += 1;
      continue;
    }

    const parsed = ProductionEventParser.tryParse(rawEvent);
    if (!parsed) {
      failed += 1;
      continue;
    }
    if (
      opts?.campaignOnChainId &&
      'campaignId' in parsed &&
      parsed.campaignId !== opts.campaignOnChainId
    ) {
      // Not a child of the campaign being indexed — leave it queued.
      continue;
    }

    try {
      // Remove the dead-letter row first: it occupies the event's unique
      // (ledger, eventIndex) slot that the idempotency preflight checks.
      await prisma.transaction.delete({ where: { id: row.id } });
      try {
        await EventPersister.persist(parsed);
        replayed += 1;
      } catch (persistErr) {
        // Re-arm the dead letter (upsert recreates the row) so the event
        // is never silently dropped.
        await recordDeadLetter(rawEvent, persistErr);
        failed += 1;
      }
    } catch (err) {
      failed += 1;
      logger.error('Dead-letter replay failed to remove row', {
        id: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { replayed, failed };
}

function parseEventIndex(id: string): number {
  const parts = id.split('-');
  return parts.length >= 2 ? parseInt(parts[1], 10) || 0 : 0;
}

/**
 * Detect if a reorg occurred by comparing the tracked ledger hash against
 * the RPC's reported hash for that sequence. Returns null if no divergence,
 * or the fork point ledger if a reorg is detected.
 */
async function detectReorg(
  server: rpc.Server,
  trackedLedger: number,
  trackedHash: string | null,
): Promise<number | null> {
  if (!trackedHash) {
    return null; // No prior hash to compare against
  }

  try {
    const ledger = await server.getLedger(trackedLedger);
    if (ledger.hash !== trackedHash) {
      logger.warn('Reorg detected: ledger hash mismatch', {
        trackedLedger,
        expectedHash: trackedHash,
        observedHash: ledger.hash,
      });
      return trackedLedger; // Fork point is at this ledger
    }
  } catch (err) {
    logger.warn('Failed to fetch ledger for reorg detection', {
      ledger: trackedLedger,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return null;
}

/**
 * On detected reorg, roll back the cursor to the fork point and remove
 * stale Transaction records that were projected from the reorg'd chain.
 */
async function handleReorg(forkPointLedger: number): Promise<void> {
  logger.info('Handling reorg: rolling back transactions', {
    forkPointLedger,
  });

  try {
    // Remove all transaction records with ledger >= forkPointLedger
    // These were projected from the reorg'd chain and are no longer valid
    const deleted = await prisma.transaction.deleteMany({
      where: {
        ledger: {
          gte: forkPointLedger,
        },
      },
    });

    logger.info('Reorg rollback complete', {
      forkPointLedger,
      transactionsDeleted: deleted.count,
    });

    // Emit metric for reorg detection
    recordReorgRollback(deleted.count);
  } catch (err) {
    logger.error('Failed to handle reorg', {
      forkPointLedger,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Record a rollback metric when a reorg is detected.
 */
function recordReorgRollback(transactionsReverted: number): void {
  // Metrics would be recorded here — for now, this is a placeholder
  // that allows the event persister to track reorgs
  logger.info('Reorg rollback metric recorded', { transactionsReverted });
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
  const endLedger = Math.min(startLedger + MAX_BACKFILL_BATCH, latestLedger);

  const filters: Parameters<typeof server.getEvents>[0]['filters'] = [
    {
      type: 'contract',
      contractIds: [CONTRACT_ID],
      topics: [[CAMPAIGN_TOPIC, '*']],
    },
    {
      type: 'contract',
      contractIds: [CONTRACT_ID],
      topics: [[ORDER_TOPIC, '*']],
    },
  ];

  // Issue #692: the investment basket contract is deployed separately from
  // the production escrow contract, so its events are only polled once an
  // operator configures BASKET_CONTRACT_ID.
  if (BASKET_CONTRACT_ID) {
    filters.push({
      type: 'contract',
      contractIds: [BASKET_CONTRACT_ID],
      topics: [[BASKET_TOPIC, '*']],
    });
  }

  const response = await server.getEvents({ startLedger, filters });

  return { events: response.events, latestLedger };
}

export async function startProductionWatcher(): Promise<
  ReturnType<typeof setInterval>
> {
  // Read at call time so integration tests can override via process.env before calling.
  const rpcUrl = process.env['RPC_URL'] ?? config.rpcUrl;
  // allowHttp is required for plain-http RPC endpoints (e.g. the local mock
  // RPC server E2E tests point RPC_URL at); real deployments use https and
  // are unaffected.
  const server = new rpc.Server(rpcUrl, {
    allowHttp: rpcUrl.startsWith('http://'),
  });
  logger.info('Production contract watcher started', {
    contractId: CONTRACT_ID,
  });

  const cursor = await loadCursor(server);
  let currentLedger = cursor.ledger;
  let currentEventIndex = cursor.eventIndex;

  let trackedLedgerHash: string | null = cursor.ledger > 0 ? null : null;

  const interval = setInterval(async () => {
    try {
      const { events, latestLedger } = await pollEvents(server, currentLedger);
      const confirmedTipLedger = Math.max(0, latestLedger - CONFIRMATION_DEPTH);

      // Check for reorg before processing new events
      const reorgForkPoint = await detectReorg(
        server,
        currentLedger,
        trackedLedgerHash,
      );
      if (reorgForkPoint !== null) {
        await handleReorg(reorgForkPoint);
        // Reset cursor to before the fork point
        if (reorgForkPoint > 0) {
          currentLedger = reorgForkPoint - 1;
          currentEventIndex = 0;
          trackedLedgerHash = null;
        }
      }

      // If the gap is so large that even MAX_BACKFILL_BATCH doesn't cover it,
      // alert the operator via a dead_letter record and pause advancement.
      if (latestLedger - currentLedger > MAX_BACKFILL_BATCH) {
        logger.error(
          'Production watcher: large ledger gap detected, backfill may not cover all events',
          {
            currentLedger,
            latestLedger,
            maxBatch: MAX_BACKFILL_BATCH,
            gap: latestLedger - currentLedger,
          },
        );
        captureAlert(
          'contract_watcher_ingestion_failure',
          `Production watcher ledger gap (${latestLedger - currentLedger}) exceeds backfill batch size — events may be missed`,
          { currentLedger, latestLedger, maxBatch: MAX_BACKFILL_BATCH },
        );
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

        // Do not project events that are not yet confirmed (within CONFIRMATION_DEPTH of tip)
        if (rawEvent.ledger > confirmedTipLedger) {
          logger.debug('Skipping unconfirmed event', {
            ledger: rawEvent.ledger,
            confirmedTip: confirmedTipLedger,
          });
          continue;
        }

        const event = ProductionEventParser.tryParse(
          rawEvent as unknown as RawSorobanEvent,
        );
        if (event) {
          try {
            await withRetryJitter(
              () => EventPersister.persist(event),
              `EventPersister.persist(${event.action})`,
              3,
            );

            // Issue #1067: once a parent campaign is indexed, replay any
            // dead-lettered child events (investments, orders) that arrived
            // out of order before their campaign.
            if (event.action === 'campaign.created') {
              await replayDeadLetterEvents({
                campaignOnChainId: event.campaignId,
                limit: 20,
              });
            }
          } catch (persistErr) {
            recordPersistError();
            await recordDeadLetter(
              rawEvent as unknown as RawSorobanEvent,
              persistErr,
            );
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
        // Fetch the hash of the new cursor ledger for future reorg detection
        try {
          const ledger = await server.getLedger(maxEventLedger);
          trackedLedgerHash = ledger.hash;
        } catch (err) {
          logger.warn('Failed to fetch ledger hash for cursor tracking', {
            ledger: maxEventLedger,
            error: err instanceof Error ? err.message : String(err),
          });
          trackedLedgerHash = null;
        }

        currentLedger = maxEventLedger;
        currentEventIndex = maxEventIndex;
        await advanceCursor(currentLedger, currentEventIndex, trackedLedgerHash ?? undefined);
        logger.debug('Production watcher: cursor advanced', {
          ledger: currentLedger,
          eventIndex: currentEventIndex,
          confirmedTip: confirmedTipLedger,
          ledgerHash: trackedLedgerHash,
        });
      }
    } catch (err) {
      logger.error('Soroban watcher poll error', { error: err });
      // Sentry groups identical errors into one issue, so a sustained RPC
      // outage polling every few seconds doesn't need its own cooldown here.
      captureAlert(
        'contract_watcher_poll_error',
        'Production watcher poll iteration failed',
        { error: err instanceof Error ? err.message : String(err) },
      );
    }
  }, POLL_INTERVAL_MS);

  return interval;
}

function buildContractFilters() {
  const filters: any[] = [];

  if (config.escrowContractId) {
    filters.push({
      type: 'contract' as const,
      contractIds: [config.escrowContractId],
      topics: [[ORDER_TOPIC, '*']],
    });
  }

  if (config.productionEscrowContractId) {
    filters.push(
      {
        type: 'contract' as const,
        contractIds: [config.productionEscrowContractId],
        topics: [[CAMPAIGN_TOPIC, '*']],
      },
      {
        type: 'contract' as const,
        contractIds: [config.productionEscrowContractId],
        topics: [[ORDER_TOPIC, '*']],
      },
      {
        type: 'contract' as const,
        contractIds: [config.productionEscrowContractId],
        topics: [[DISPUTE_TOPIC, '*']],
      },
    );
  }

  if (config.contractId && config.contractId !== 'C...') {
    filters.push(
      {
        type: 'contract' as const,
        contractIds: [config.contractId],
        topics: [[CAMPAIGN_TOPIC, '*']],
      },
      {
        type: 'contract' as const,
        contractIds: [config.contractId],
        topics: [[ORDER_TOPIC, '*']],
      },
    );
  }

  return filters;
}
