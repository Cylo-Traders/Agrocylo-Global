import client from 'prom-client';

/**
 * Prometheus-format metrics (Issue #756), additive to the hand-rolled
 * counters/gauges already emitted by `app.ts`'s `/metrics` route
 * (`api_requests_total`, `ws_clients_connected`, `events_processed_total`).
 * Those stay as-is; this module adds the metric *shapes* that are hard to
 * hand-roll correctly (histograms) plus the reconciliation-drift gauge from
 * Issue 8. `registry.metrics()`'s text output is concatenated onto the
 * existing `/metrics` response — Prometheus's text exposition format
 * tolerates multiple sections in one response body.
 */
export const registry = new client.Registry();

export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds, labeled by method/route/status',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const httpRequestsByRouteTotal = new client.Counter({
  name: 'http_requests_by_route_total',
  help: 'Total HTTP requests, labeled by method/route/status (per-route breakdown of api_requests_total)',
  labelNames: ['method', 'route', 'status'],
  registers: [registry],
});

export const reconciliationDrift = new client.Gauge({
  name: 'reconciliation_drift_count',
  help: 'Number of transactions whose DB status disagreed with the reconciled (ledger/watcher-derived) status as of the last sweep',
  registers: [registry],
});

export function recordHttpRequest(
  method: string,
  route: string,
  status: number,
  durationMs: number,
): void {
  const labels = { method, route, status: String(status) };
  httpRequestsByRouteTotal.inc(labels);
  httpRequestDuration.observe(labels, durationMs / 1000);
}
