"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchPriceIndex,
  priceIndexView,
  type PriceIndexFetchState,
} from "@/services/priceIndexService";

const initialState: PriceIndexFetchState = {
  loading: true,
  error: null,
  response: null,
};

export function PriceIndexWidget() {
  const [state, setState] = useState<PriceIndexFetchState>(initialState);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => {
    setState({ loading: true, error: null, response: null });
    setReloadKey((key) => key + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchPriceIndex({ signal: controller.signal })
      .then((response) => {
        if (!controller.signal.aborted) {
          setState({ loading: false, error: null, response });
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          loading: false,
          error: err instanceof Error ? err.message : "Price index unavailable",
          response: null,
        });
      });
    return () => controller.abort();
  }, [reloadKey]);

  const view = priceIndexView(state);
  const table = view.status === "ready" || view.status === "stale" ? (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" aria-label="Regional crop price index">
        <thead className="border-b border-border text-left text-muted">
          <tr>
            <th scope="col" className="pb-2 font-medium">Crop</th>
            <th scope="col" className="pb-2 font-medium">Region</th>
            <th scope="col" className="pb-2 text-right font-medium">Avg. Price (XLM/token)</th>
            <th scope="col" className="pb-2 text-right font-medium">Listings</th>
          </tr>
        </thead>
        <tbody>
          {view.data.map((entry) => (
            <tr key={`${entry.crop}:${entry.region}`} className="border-b border-border last:border-0">
              <td className="py-2 font-medium text-foreground">{entry.crop}</td>
              <td className="py-2 text-muted">{entry.region}</td>
              <td className="py-2 text-right text-foreground">{entry.averagePrice.toLocaleString()}</td>
              <td className="py-2 text-right text-muted">{entry.sampleCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted">
        Computed {new Date(view.meta.computedAt).toLocaleString()} from active marketplace listings.
      </p>
    </div>
  ) : null;

  return (
    <section aria-labelledby="price-index-heading" className="rounded-xl border border-border bg-surface p-5">
      <h2 id="price-index-heading" className="text-base font-semibold text-foreground mb-3">
        Regional Price Index
      </h2>
      {view.status === "loading" && (
        <p className="text-sm text-muted animate-pulse" role="status">Loading price data…</p>
      )}
      {view.status === "error" && (
        <div role="alert" className="space-y-2 text-sm text-red-600">
          <p>{view.message}</p>
          <button type="button" onClick={reload} className="underline hover:text-red-800">
            Try again
          </button>
        </div>
      )}
      {view.status === "empty" && (
        <p className="text-sm text-muted" role="status">
          No marketplace price data available yet. The index updates hourly as listings are published.
        </p>
      )}
      {view.status === "stale" && (
        <p className="mb-2 text-sm text-amber-700" role="status">
          Showing last computed marketplace data from{" "}
          {new Date(view.meta.computedAt).toLocaleString()}; the index may be out of date.
        </p>
      )}
      {table}
    </section>
  );
}

export default PriceIndexWidget;
