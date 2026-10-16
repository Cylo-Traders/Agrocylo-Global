/**
 * Exposes indexer readiness and freshness metadata.
 * Supports health checks and UI display of indexing progress.
 */

import { prisma } from "../db/client.js";
import logger from "../config/logger.js";

export interface IndexerReadiness {
  /** Whether the indexer is currently operational. */
  isReady: boolean;
  /** Last ledger processed by the indexer. */
  lastProcessedLedger: number;
  /** Timestamp of the last processed event. */
  lastProcessedTime: Date | null;
  /** Approximate age of the last processed event in seconds. */
  freshnessSeconds: number;
  /** Whether the indexer is considered "fresh" (≤ maxLagSeconds). */
  isFresh: boolean;
  /** Maximum acceptable lag in seconds for "fresh" status. */
  maxLagSeconds: number;
  /** Persisted backfill cursor position. */
  cursor: {
    ledger: number;
    eventIndex: number;
  } | null;
}

/**
 * Get indexer readiness status and freshness metrics.
 * Used by health checks, API readiness endpoints, and UI progress display.
 */
export async function getIndexerReadiness(
  contractId: string,
  maxLagSeconds: number = 300,
): Promise<IndexerReadiness> {
  try {
    const cursor = await prisma.eventCursor.findUnique({
      where: { contractId },
    });

    if (!cursor) {
      return {
        isReady: false,
        lastProcessedLedger: 0,
        lastProcessedTime: null,
        freshnessSeconds: -1,
        isFresh: false,
        maxLagSeconds,
        cursor: null,
      };
    }

    const lastTx = await prisma.transaction.findFirst({
      where: { ledger: { gte: cursor.ledger - 10 } },
      orderBy: { processedAt: "desc" },
      take: 1,
    });

    const lastProcessedTime = lastTx?.processedAt ?? null;
    const now = new Date();
    const freshnessSeconds = lastProcessedTime
      ? Math.floor((now.getTime() - lastProcessedTime.getTime()) / 1000)
      : -1;
    const isFresh = freshnessSeconds >= 0 && freshnessSeconds <= maxLagSeconds;

    return {
      isReady: cursor.ledger > 0,
      lastProcessedLedger: cursor.ledger,
      lastProcessedTime,
      freshnessSeconds: Math.max(0, freshnessSeconds),
      isFresh,
      maxLagSeconds,
      cursor: { ledger: cursor.ledger, eventIndex: cursor.eventIndex },
    };
  } catch (err) {
    logger.error("getIndexerReadiness failed", {
      error: err instanceof Error ? err.message : String(err),
      contractId,
    });
    return {
      isReady: false,
      lastProcessedLedger: 0,
      lastProcessedTime: null,
      freshnessSeconds: -1,
      isFresh: false,
      maxLagSeconds,
      cursor: null,
    };
  }
}
