import { prisma } from '../db/client.js';
import type { TransactionStatus } from '../schemas/transaction.js';

export interface ReconciliationResult {
  dbStatus: TransactionStatus;
  reconciledStatus: TransactionStatus;
  confirmedInLedger: boolean;
  indexedByWatcher: boolean;
  latestIndexedLedger: number | null;
}

const STATIC: readonly TransactionStatus[] = ['indexed', 'failed'];

export async function reconcileTransaction(
  txHash: string,
  currentStatus: TransactionStatus,
): Promise<ReconciliationResult> {
  let latestIndexedLedger: number | null = null;

  const cursor = await prisma.eventCursor.findFirst({
    orderBy: { updatedAt: 'desc' },
  });
  if (cursor) {
    latestIndexedLedger = cursor.ledger;
  }

  const indexedTx = await prisma.transaction.findFirst({
    where: { txHash, status: 'indexed' },
    select: { id: true, ledger: true },
  });

  const confirmedInLedger = indexedTx !== null;
  const indexedByWatcher = indexedTx !== null && indexedTx.ledger > 0;

  let reconciledStatus: TransactionStatus;

  if (STATIC.includes(currentStatus)) {
    reconciledStatus = currentStatus;
  } else if (indexedByWatcher) {
    reconciledStatus = 'indexed';
  } else if (confirmedInLedger) {
    reconciledStatus = 'confirmed';
  } else {
    reconciledStatus = currentStatus;
  }

  return {
    dbStatus: currentStatus,
    reconciledStatus,
    confirmedInLedger,
    indexedByWatcher,
    latestIndexedLedger,
  };
}
