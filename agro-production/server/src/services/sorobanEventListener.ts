import { rpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import logger from '../config/logger.js';
import { prisma } from '../db/client.js';
import { config } from '../config/index.js';

interface ContractConfig {
  id: string;
  label: string;
  topicFilters: string[][];
}

interface ParsedEvent {
  contractId: string;
  contractLabel: string;
  action: string;
  data: unknown;
  ledger: number;
  txHash: string;
}

/** Per-contract polling state including replay-safe cursor and backoff tracking. */
interface ContractState {
  ledger: number;
  failureCount: number;
  /** Epoch ms after which the next poll attempt is allowed; 0 = no backoff active. */
  backoffUntil: number;
}

export const server = new rpc.Server(config.rpcUrl);

// Topic base64 encoding for "order" and "campaign" symbols.
const ORDER_TOPIC = 'AAAADwAAAAVvcmRlcg==';
const CAMPAIGN_TOPIC = 'AAAADwAAAAhjYW1wYWlnbg==';
const DISPUTE_TOPIC = 'AAAADwAAAAdkaXNwdXRl';

function buildContracts(): ContractConfig[] {
  const contracts: ContractConfig[] = [];

  if (config.escrowContractId) {
    contracts.push({
      id: config.escrowContractId,
      label: 'EscrowContract',
      topicFilters: [
        [ORDER_TOPIC, '*'],
      ],
    });
  }

  if (config.productionEscrowContractId) {
    contracts.push({
      id: config.productionEscrowContractId,
      label: 'ProductionEscrowContract',
      topicFilters: [
        [ORDER_TOPIC, '*'],
        [CAMPAIGN_TOPIC, '*'],
        [DISPUTE_TOPIC, '*'],
      ],
    });
  }

  return contracts;
}

function parseEvent(event: rpc.Api.EventResponse, label: string): ParsedEvent | null {
  try {
    const topics = event.topic.map((t: string) =>
      scValToNative(xdr.ScVal.fromXDR(t, 'base64')),
    );
    const action = String(topics[1]);
    const data = scValToNative(xdr.ScVal.fromXDR(event.value, 'base64'));
    return {
      contractId: event.contractId,
      contractLabel: label,
      action,
      data,
      ledger: event.ledger,
      txHash: event.txHash,
    };
  } catch (err) {
    logger.error(`Failed to parse event from ${label}:`, err);
    return null;
  }
}

async function persistEvent(parsed: ParsedEvent): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      // Idempotent insert: skip if already persisted
      const existing = await tx.transaction.findFirst({
        where: { txHash: parsed.txHash, eventType: parsed.action },
      });
      if (existing) return;

      await tx.transaction.create({
        data: {
          eventType: parsed.action,
          status: 'indexed',
          payload: parsed.data as Record<string, unknown>,
          ledger: parsed.ledger,
          eventIndex: 0,
          txHash: parsed.txHash,
        },
      });

      // Persist replay-safe cursor within the same transaction
      await tx.eventCursor.upsert({
        where: { contractId: parsed.contractId },
        create: {
          contractId: parsed.contractId,
          ledger: parsed.ledger,
          eventIndex: 0,
        },
        update: {
          ledger: parsed.ledger,
          eventIndex: 0,
        },
      });
    });
  } catch (err) {
    logger.error(`Could not persist event (tx: ${parsed.txHash}):`, err);
    // Non-fatal: continue and let the next poll retry
    throw err;
  }
}

async function loadCursor(contractId: string): Promise<number> {
  const cursor = await prisma.eventCursor.findUnique({
    where: { contractId },
  });
  if (cursor) {
    logger.info(`Soroban listener: resuming ${contractId} from cursor`, {
      ledger: cursor.ledger,
    });
    return cursor.ledger;
  }
  const latest = await server.getLatestLedger();
  logger.info(`Soroban listener: no cursor for ${contractId}, starting from latest`, {
    ledger: latest.sequence,
  });
  return latest.sequence;
}

async function handleEvent(parsed: ParsedEvent): Promise<void> {
  logger.info(
    `[${parsed.contractLabel}] ${parsed.action} @ ledger ${parsed.ledger} (tx: ${parsed.txHash})`,
  );
  logger.debug(`Event data: ${JSON.stringify(parsed.data)}`);
  await persistEvent(parsed);
}

/**
 * Poll a single contract for new events starting at `lastLedger`.
 * Returns the new high-watermark ledger.
 *
 * Throws on RPC-level failures (e.g. network error, rate-limit) so the
 * caller can apply exponential backoff. Per-event parse/persist errors are
 * caught internally and do not abort the batch.
 */
async function pollContract(
  contract: ContractConfig,
  lastLedger: number,
): Promise<number> {
  let highWatermark = lastLedger;

  for (const topicFilter of contract.topicFilters) {
    // RPC errors propagate to the caller — do not catch here.
    const response = await server.getEvents({
      startLedger: lastLedger,
      filters: [
        {
          type: 'contract',
          contractIds: [contract.id],
          topics: [topicFilter],
        },
      ],
    });

    for (const event of response.events) {
      const parsed = parseEvent(event, contract.label);
      if (parsed) {
        try {
          await handleEvent(parsed);
        } catch {
          // Do not advance watermark past a failed persist — retry next poll.
          continue;
        }
      }
      if (event.ledger > highWatermark) {
        highWatermark = event.ledger + 1;
      }
    }
  }

  return highWatermark;
}

/**
 * Compute the next backoff delay with jitter to avoid thundering-herd
 * when multiple contracts fail simultaneously.
 */
function backoffDelayMs(failureCount: number): number {
  const base = Math.min(1_000 * 2 ** failureCount, 60_000);
  return base + Math.random() * 500;
}

/**
 * Start the Soroban event listener.
 *
 * Persists per-contract replay-safe cursors in the database within the same
 * transaction as the event record, ensuring no events are skipped on restart.
 * On RPC failure the affected contract backs off exponentially (up to ~60 s)
 * while other contracts continue polling normally. Polling resumes
 * automatically once the RPC endpoint recovers.
 */
export async function startSorobanEventListener(): Promise<ReturnType<typeof setInterval> | null> {
  const contracts = buildContracts();

  if (contracts.length === 0) {
    logger.warn(
      'No contract IDs configured (ESCROW_CONTRACT_ID / PRODUCTION_ESCROW_CONTRACT_ID). ' +
      'Event listener will not start.',
    );
    return null;
  }

  logger.info(
    `Soroban Event Listener starting — watching ${contracts.length} contract(s): ` +
    contracts.map((c) => c.label).join(', '),
  );

  // Load persisted cursors for each contract
  const states = new Map<string, ContractState>();
  for (const contract of contracts) {
    const ledger = await loadCursor(contract.id);
    states.set(contract.id, { ledger, failureCount: 0, backoffUntil: 0 });
  }

  const interval = setInterval(async () => {
    for (const contract of contracts) {
      const state = states.get(contract.id)!;

      // Skip if still in backoff window
      if (state.backoffUntil > Date.now()) {
        logger.debug(`Soroban listener: ${contract.label} is backing off, skipping poll`, {
          backoffRemainingMs: state.backoffUntil - Date.now(),
        });
        continue;
      }

      try {
        const newWatermark = await pollContract(contract, state.ledger);
        // Successful poll: reset backoff
        if (state.failureCount > 0) {
          logger.info(`Soroban listener: ${contract.label} recovered after ${state.failureCount} failure(s)`);
        }
        state.ledger = newWatermark;
        state.failureCount = 0;
        state.backoffUntil = 0;
      } catch (err) {
        state.failureCount += 1;
        const delay = backoffDelayMs(state.failureCount);
        state.backoffUntil = Date.now() + delay;
        logger.warn(
          `Soroban listener: ${contract.label} poll failed (attempt ${state.failureCount}), ` +
          `backing off for ${Math.round(delay)}ms`,
          { error: err instanceof Error ? err.message : String(err) },
        );
      }
    }
  }, 5_000);

  return interval;
}
