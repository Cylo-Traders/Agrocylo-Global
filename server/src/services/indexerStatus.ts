import { rpc } from '@stellar/stellar-sdk';
import { config } from '../config/index.js';
import { prisma } from '../config/database.js';
import logger from '../config/logger.js';

const CHECKPOINT_SERVICE_NAME = 'contract-watcher';

export const INDEXER_STALE_LEDGER_THRESHOLD = 120;
export const INDEXER_STALE_SECONDS_THRESHOLD = 300;

export type IndexerHealth = 'disabled' | 'fresh' | 'stalled' | 'unknown';

export interface IndexerStatus {
  enabled: boolean;
  status: IndexerHealth;
  contractIds: string[];
  lastProcessedLedger: number | null;
  latestLedger: number | null;
  ledgerLag: number | null;
  lastProgressAt: string | null;
  secondsSinceProgress: number | null;
}

export async function getIndexerStatus(now: Date = new Date()): Promise<IndexerStatus> {
  const contractIds = [config.contractId, config.governanceContractId].filter(Boolean) as string[];

  if (!config.runContractWatcher) {
    return {
      enabled: false,
      status: 'disabled',
      contractIds,
      lastProcessedLedger: null,
      latestLedger: null,
      ledgerLag: null,
      lastProgressAt: null,
      secondsSinceProgress: null,
    };
  }

  let checkpoint: { lastLedger: number; updatedAt: Date } | null = null;
  try {
    checkpoint = await prisma.contractWatcherCheckpoint.findUnique({
      where: { service: CHECKPOINT_SERVICE_NAME },
    });
  } catch (err) {
    logger.error('[IndexerStatus] Failed to load watcher checkpoint', err);
  }

  let latestLedger: number | null = null;
  try {
    const server = new rpc.Server(config.rpcUrl);
    latestLedger = (await server.getLatestLedger()).sequence;
  } catch (err) {
    logger.warn('[IndexerStatus] Failed to fetch latest ledger from RPC', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const lastProcessedLedger = checkpoint?.lastLedger ?? null;
  const lastProgressAt = checkpoint ? checkpoint.updatedAt.toISOString() : null;
  const secondsSinceProgress = checkpoint
    ? Math.max(0, Math.floor((now.getTime() - checkpoint.updatedAt.getTime()) / 1000))
    : null;
  const ledgerLag =
    latestLedger !== null && lastProcessedLedger !== null
      ? Math.max(0, latestLedger - lastProcessedLedger)
      : null;

  let status: IndexerHealth;
  if (lastProcessedLedger === null) {
    status = 'stalled';
  } else {
    const lagStale = ledgerLag !== null && ledgerLag > INDEXER_STALE_LEDGER_THRESHOLD;
    const timeStale =
      secondsSinceProgress !== null && secondsSinceProgress > INDEXER_STALE_SECONDS_THRESHOLD;
    if (lagStale || timeStale) {
      status = 'stalled';
    } else if (ledgerLag === null && secondsSinceProgress === null) {
      status = 'unknown';
    } else {
      status = 'fresh';
    }
  }

  if (status === 'stalled') {
    logger.warn('[IndexerStatus] Contract watcher appears stalled', {
      lastProcessedLedger,
      latestLedger,
      ledgerLag,
      secondsSinceProgress,
    });
  }

  return {
    enabled: true,
    status,
    contractIds,
    lastProcessedLedger,
    latestLedger,
    ledgerLag,
    lastProgressAt,
    secondsSinceProgress,
  };
}
