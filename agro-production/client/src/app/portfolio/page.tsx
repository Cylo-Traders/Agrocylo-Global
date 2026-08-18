"use client";

import { useState, useEffect } from "react";
import { PriceChart } from "@/components/PriceChart";

interface CampaignInvestment {
  id: string;
  campaignName: string;
  amountInvested: number;
  currentValue: number;
  roi: number;
  status: "active" | "settled";
  investedAt: string;
}

interface PortfolioSummary {
  totalInvested: number;
  totalReturned: number;
  overallROI: number;
}

export default function PortfolioPage() {
  const [investments, setInvestments] = useState<CampaignInvestment[]>([]);
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPortfolio();
  }, []);

  const fetchPortfolio = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/investor/portfolio");
      if (!response.ok) throw new Error("Failed to fetch portfolio");
      
      const data = await response.json();
      setInvestments(data.investments);
      setSummary(data.summary);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
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

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="text-red-800 font-semibold">Error</h3>
          <p className="text-red-600">{error}</p>
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

  if (!summary || investments.length === 0) {
    return (
      <div className="container mx-auto p-6">
        <h1 className="text-3xl font-bold mb-6">Investment Portfolio</h1>
        <div className="text-center py-12 text-gray-500">
          No investments yet. Start investing in campaigns to build your portfolio.
        </div>
      </div>
    );
  }

  const chartData = [
    { label: "Invested", value: summary.totalInvested },
    { label: "Returned", value: summary.totalReturned },
  ];

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Investment Portfolio</h1>

      <div className="grid gap-6 md:grid-cols-3 mb-8">
        <div className="bg-white border rounded-lg p-6 shadow-sm">
          <h3 className="text-sm text-gray-600 mb-2">Total Invested</h3>
          <p className="text-2xl font-bold">${summary.totalInvested.toFixed(2)}</p>
        </div>
        <div className="bg-white border rounded-lg p-6 shadow-sm">
          <h3 className="text-sm text-gray-600 mb-2">Total Returned</h3>
          <p className="text-2xl font-bold">${summary.totalReturned.toFixed(2)}</p>
        </div>
        <div className="bg-white border rounded-lg p-6 shadow-sm">
          <h3 className="text-sm text-gray-600 mb-2">Overall ROI</h3>
          <p className={`text-2xl font-bold ${summary.overallROI >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {summary.overallROI >= 0 ? '+' : ''}{summary.overallROI.toFixed(2)}%
          </p>
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
          {investments.map((investment) => (
            <div
              key={investment.id}
              className="border rounded-lg p-4 hover:bg-gray-50 transition"
            >
              <div className="flex justify-between items-start mb-2">
                <h3 className="font-semibold">{investment.campaignName}</h3>
                <span
                  className={`px-2 py-1 rounded text-xs font-medium ${
                    investment.status === "active"
                      ? "bg-green-100 text-green-800"
                      : "bg-gray-100 text-gray-800"
                  }`}
                >
                  {investment.status}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-gray-600">Invested</p>
                  <p className="font-semibold">${investment.amountInvested.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-gray-600">Current Value</p>
                  <p className="font-semibold">${investment.currentValue.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-gray-600">ROI</p>
                  <p className={`font-semibold ${investment.roi >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {investment.roi >= 0 ? '+' : ''}{investment.roi.toFixed(2)}%
                  </p>
                </div>
                <div>
                  <p className="text-gray-600">Date</p>
                  <p className="font-semibold">
                    {new Date(investment.investedAt).toLocaleDateString()}
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
