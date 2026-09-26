"use client";

/**
 * Investment Basket page (#693)
 *
 * Lets an investor discover, create, and review diversified baskets of
 * campaign investments. Basket positions are surfaced here and in
 * portfolio/page.tsx alongside direct campaign investments.
 *
 * Data: GET /investor/basket through the typed basketService (#1050).
 * Amounts are exact XLM strings converted from stroops with BigInt
 * arithmetic; distinct states: loading, empty, unauthorized, offline,
 * server error.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchInvestorBasket } from "@/services/basketService";
import { isApiError, isNetworkError } from "@/lib/apiClient";

type BasketPageState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "unauthorized" }
  | { kind: "offline" }
  | { kind: "error"; message: string }
  | { kind: "ready"; basket: NonNullable<Awaited<ReturnType<typeof fetchInvestorBasket>>> };

export default function BasketPage() {
  const [state, setState] = useState<BasketPageState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;

    fetchInvestorBasket()
      .then((basket) => {
        if (cancelled) return;
        setState(basket ? { kind: "ready", basket } : { kind: "empty" });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (isApiError(err) && err.status === 401) setState({ kind: "unauthorized" });
        else if (isNetworkError(err)) setState({ kind: "offline" });
        else
          setState({
            kind: "error",
            message: err instanceof Error ? err.message : "An error occurred",
          });
      });

    return () => {
      cancelled = true;
    };
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

      {state.kind === "loading" && (
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-gray-200" />
          ))}
        </div>
      )}

      {state.kind === "unauthorized" && (
        <div
          role="alert"
          className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800"
        >
          <p className="text-lg font-medium">Connect your wallet to view your basket.</p>
          <p className="text-sm mt-1">Your basket is tied to your connected wallet address.</p>
        </div>
      )}

      {state.kind === "offline" && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700"
        >
          <p>You appear to be offline. Check your connection and try again.</p>
        </div>
      )}

      {state.kind === "error" && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700"
        >
          {state.message}
        </div>
      )}

      {state.kind === "empty" && (
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

      {state.kind === "ready" && state.basket.positions.length > 0 && (
        <>
          <section
            aria-label="Basket summary"
            className="grid grid-cols-2 gap-4"
          >
            <div className="rounded-xl border border-border bg-surface p-5">
              <p className="text-xs text-muted uppercase tracking-wide">Total Allocated</p>
              <p className="mt-1 text-2xl font-bold text-foreground">
                {state.basket.totalAllocated} XLM
              </p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-5">
              <p className="text-xs text-muted uppercase tracking-wide">Returned So Far</p>
              <p className="mt-1 text-2xl font-bold text-foreground">
                {state.basket.totalReturned} XLM
              </p>
            </div>
          </section>

          <section aria-label="Basket positions">
            <h2 className="text-base font-semibold text-foreground mb-3">
              Positions ({state.basket.positions.length})
            </h2>
            <div className="space-y-3">
              {state.basket.positions.map((pos) => (
                <div
                  key={pos.campaignId}
                  className="flex items-center justify-between rounded-xl border border-border bg-surface p-4"
                >
                  <div className="min-w-0">
                    <span className="font-medium text-foreground truncate block">
                      {pos.campaignName || `Position ${pos.campaignId.slice(0, 8)}…`}
                    </span>
                    <p className="text-xs text-muted mt-0.5">
                      Weight: {pos.weight}% · Allocated: {pos.allocatedAmount} XLM
                    </p>
                  </div>
                  <div className="text-right shrink-0 ml-4">
                    <p className="font-medium text-foreground">{pos.currentValue} XLM</p>
                    {pos.claimed && (
                      <p className="text-xs mt-0.5 text-primary-600">Claimed</p>
                    )}
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
