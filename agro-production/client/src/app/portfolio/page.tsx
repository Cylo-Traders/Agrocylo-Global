"use client";

/**
 * Investor Portfolio page (Issue #1051)
 *
 * Data: GET /investor/portfolio through the typed portfolioService —
 * wallet-scoped via the authenticated ApiClient (no address in the URL).
 *
 * Units: the protocol is XLM-denominated; amounts are exact XLM strings
 * converted from stroops with BigInt arithmetic and rendered as "N XLM".
 * There is no fiat conversion anywhere in the protocol.
 */

import { useCallback, useEffect, useState } from "react";
import { PriceChart } from "@/components/PriceChart";
import {
  fetchInvestorPortfolio,
  type PortfolioSummary,
} from "@/services/portfolioService";
import { isApiError, isNetworkError } from "@/lib/apiClient";

type PortfolioPageState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "unauthorized" }
  | { kind: "offline" }
  | { kind: "error"; message: string }
  | { kind: "ready"; portfolio: PortfolioSummary };

export default function PortfolioPage() {
  const [state, setState] = useState<PortfolioPageState>({ kind: "loading" });

  const fetchPortfolio = useCallback(() => {
    setState({ kind: "loading" });
    fetchInvestorPortfolio()
      .then((portfolio) =>
        setState(
          portfolio.positions.length > 0
            ? { kind: "ready", portfolio }
            : { kind: "empty" },
        ),
      )
      .catch((err: unknown) => {
        if (isApiError(err) && err.status === 401) setState({ kind: "unauthorized" });
        else if (isNetworkError(err)) setState({ kind: "offline" });
        else
          setState({
            kind: "error",
            message: err instanceof Error ? err.message : "An error occurred",
          });
      });
  }, []);

  useEffect(() => {
    fetchPortfolio();
  }, [fetchPortfolio]);

  if (state.kind === "loading") {
    return (
      <div className="container mx-auto p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="h-32 bg-gray-200 rounded"></div>
            <div className="h-32 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (state.kind === "unauthorized") {
    return (
      <div className="container mx-auto p-6">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <h3 className="text-amber-800 font-semibold">Wallet connection required</h3>
          <p className="text-amber-700 text-sm mt-1">
            Connect your wallet to view your portfolio. Your data is tied to your
            wallet address.
          </p>
        </div>
      </div>
    );
  }

  if (state.kind === "offline") {
    return (
      <div className="container mx-auto p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="text-red-800 font-semibold">You appear to be offline</h3>
          <p className="text-red-600 text-sm mt-1">
            Check your connection and try again.
          </p>
          <button
            onClick={fetchPortfolio}
            className="mt-2 text-red-600 underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="container mx-auto p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="text-red-800 font-semibold">Error</h3>
          <p className="text-red-600">{state.message}</p>
          <button
            onClick={fetchPortfolio}
            className="mt-2 text-red-600 underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (state.kind === "empty") {
    return (
      <div className="container mx-auto p-6">
        <h1 className="text-3xl font-bold mb-6">Investment Portfolio</h1>
        <div className="text-center py-12 text-gray-500">
          No investments yet. Start investing in campaigns to build your portfolio.
        </div>
      </div>
    );
  }

  const { portfolio } = state;

  // Chart input is display-only (PriceChart takes numeric prices); the exact
  // figures above always render from the string view model.
  const numeric = (xlm: string) => Number(xlm.replace(/,/g, ""));
  const chartData = [
    { timestamp: "Invested", price: numeric(portfolio.totalInvested) },
    { timestamp: "Returned", price: numeric(portfolio.totalReturned) },
  ];

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Investment Portfolio</h1>

      <div className="grid gap-6 md:grid-cols-3 mb-8">
        <div className="bg-white border rounded-lg p-6 shadow-sm">
          <h3 className="text-sm text-gray-600 mb-2">Total Invested</h3>
          <p className="text-2xl font-bold">{portfolio.totalInvested} XLM</p>
        </div>
        <div className="bg-white border rounded-lg p-6 shadow-sm">
          <h3 className="text-sm text-gray-600 mb-2">Total Returned</h3>
          <p className="text-2xl font-bold">{portfolio.totalReturned} XLM</p>
        </div>
        <div className="bg-white border rounded-lg p-6 shadow-sm">
          <h3 className="text-sm text-gray-600 mb-2">Positions</h3>
          <p className="text-2xl font-bold">{portfolio.positions.length}</p>
        </div>
      </div>

      <div className="bg-white border rounded-lg p-6 shadow-sm mb-8">
        <h2 className="text-xl font-semibold mb-4">Cumulative Value</h2>
        <PriceChart data={chartData} />
      </div>

      {/* Investment basket positions (#693) */}
      <div className="bg-white border rounded-lg p-6 shadow-sm mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Investment Basket</h2>
          <a
            href="/basket"
            className="text-sm text-primary-600 hover:underline"
            aria-label="Manage investment basket"
          >
            Manage basket →
          </a>
        </div>
        <p className="text-sm text-gray-500">
          View and manage your diversified basket investments from the{" "}
          <a href="/basket" className="text-primary-600 hover:underline">
            Investment Basket
          </a>{" "}
          page.
        </p>
      </div>

      <div className="bg-white border rounded-lg p-6 shadow-sm">
        <h2 className="text-xl font-semibold mb-4">Campaign Investments</h2>
        <div className="space-y-4">
          {portfolio.positions.map((position) => (
            <div
              key={position.id}
              className="border rounded-lg p-4 hover:bg-gray-50 transition"
            >
              <div className="flex justify-between items-start mb-2">
                <h3 className="font-semibold">{position.campaignName}</h3>
                <span className="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-800">
                  {position.status}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-gray-600">Invested</p>
                  <p className="font-semibold">{position.amountInvested} XLM</p>
                </div>
                <div>
                  <p className="text-gray-600">Date</p>
                  <p className="font-semibold">
                    {new Date(position.investedAt).toLocaleDateString()}
                  </p>
                </div>
                <div>
                  <p className="text-gray-600">Ledger</p>
                  <p className="font-semibold">
                    {position.id.slice(0, 8)}…
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
