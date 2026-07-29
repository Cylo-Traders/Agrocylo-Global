"use client";

/**
 * Investment Basket page (#693)
 *
 * Lets an investor discover, create, and review diversified baskets of
 * campaign investments. Basket positions are surfaced here and in
 * portfolio/page.tsx alongside direct campaign investments.
 */

import { useEffect, useState } from "react";
import Link from "next/link";

interface BasketPosition {
  campaignId: string;
  campaignName: string;
  allocatedAmount: number;
  currentValue: number;
  weight: number; // 0–100 percentage of basket
}

interface BasketSummary {
  totalAllocated: number;
  totalCurrentValue: number;
  positions: BasketPosition[];
}

export default function BasketPage() {
  const [basket, setBasket] = useState<BasketSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/investor/basket")
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to fetch basket");
        const data: BasketSummary = await res.json();
        setBasket(data);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "An error occurred"),
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="container mx-auto max-w-3xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">My Investment Basket</h1>
          <p className="text-muted text-sm mt-1">
            Diversify across multiple farming campaigns in a single basket.
          </p>
        </div>
        <Link
          href="/campaigns"
          className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-surface transition-colors"
        >
          ← Browse Campaigns
        </Link>
      </div>

      {loading && (
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-gray-200" />
          ))}
        </div>
      )}

      {!loading && error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {!loading && !error && (!basket || basket.positions.length === 0) && (
        <div className="rounded-xl border border-border p-10 text-center text-muted space-y-3">
          <p className="text-lg">Your basket is empty.</p>
          <p className="text-sm">
            Browse campaigns and add them to your basket to invest across multiple
            agricultural projects at once.
          </p>
          <Link
            href="/campaigns"
            className="inline-block mt-2 rounded-lg bg-primary-600 px-5 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
          >
            Browse Campaigns
          </Link>
        </div>
      )}

      {!loading && !error && basket && basket.positions.length > 0 && (
        <>
          <section
            aria-label="Basket summary"
            className="grid grid-cols-2 gap-4"
          >
            <div className="rounded-xl border border-border bg-surface p-5">
              <p className="text-xs text-muted uppercase tracking-wide">Total Allocated</p>
              <p className="mt-1 text-2xl font-bold text-foreground">
                {basket.totalAllocated.toLocaleString()} XLM
              </p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-5">
              <p className="text-xs text-muted uppercase tracking-wide">Current Value</p>
              <p className="mt-1 text-2xl font-bold text-foreground">
                {basket.totalCurrentValue.toLocaleString()} XLM
              </p>
            </div>
          </section>

          <section aria-label="Basket positions">
            <h2 className="text-base font-semibold text-foreground mb-3">
              Positions ({basket.positions.length})
            </h2>
            <div className="space-y-3">
              {basket.positions.map((pos) => (
                <div
                  key={pos.campaignId}
                  className="flex items-center justify-between rounded-xl border border-border bg-surface p-4"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/campaigns/${pos.campaignId}`}
                      className="font-medium text-foreground hover:underline truncate block"
                    >
                      {pos.campaignName || `Campaign ${pos.campaignId.slice(0, 8)}…`}
                    </Link>
                    <p className="text-xs text-muted mt-0.5">
                      Weight: {pos.weight}% · Allocated: {pos.allocatedAmount.toLocaleString()} XLM
                    </p>
                  </div>
                  <div className="text-right shrink-0 ml-4">
                    <p className="font-medium text-foreground">
                      {pos.currentValue.toLocaleString()} XLM
                    </p>
                    <p
                      className={`text-xs mt-0.5 ${
                        pos.currentValue >= pos.allocatedAmount
                          ? "text-primary-600"
                          : "text-red-500"
                      }`}
                    >
                      {pos.currentValue >= pos.allocatedAmount ? "+" : ""}
                      {(
                        ((pos.currentValue - pos.allocatedAmount) /
                          pos.allocatedAmount) *
                        100
                      ).toFixed(1)}
                      %
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
