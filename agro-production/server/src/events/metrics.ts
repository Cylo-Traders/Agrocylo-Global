import type { EventAction } from './types.js';

interface EventMetrics {
  processed: number;
  skipped_duplicates: number;
  parse_errors: number;
  persist_errors: number;
  last_processed_ledger: number;
  last_processed_at: string | null;
  by_action: Partial<Record<EventAction, number>>;
}

const metrics: EventMetrics = {
  processed: 0,
  skipped_duplicates: 0,
  parse_errors: 0,
  persist_errors: 0,
  last_processed_ledger: 0,
  last_processed_at: null,
  by_action: {},
};

export function recordEventProcessed(action: EventAction, ledger: number) {
  metrics.processed += 1;
  metrics.by_action[action] = (metrics.by_action[action] ?? 0) + 1;
  if (ledger > metrics.last_processed_ledger) {
    metrics.last_processed_ledger = ledger;
  }
  metrics.last_processed_at = new Date().toISOString();
}

export function recordEventDuplicate() {
  metrics.skipped_duplicates += 1;
}

export function recordParseError() {
  metrics.parse_errors += 1;
}

export function recordPersistError() {
  metrics.persist_errors += 1;
}

export function getEventMetrics(): EventMetrics {
  return { ...metrics, by_action: { ...metrics.by_action } };
}
