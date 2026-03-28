"use client";

import React, { useEffect, useState, useMemo } from "react";
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, Text } from "@/components/ui";
import { fetchPriceChartData, calculateMovingAverage } from "@/services/priceService";
import type { PriceChartData, PriceChartProps } from "@/types/price";

/**
 * PriceChart component for visualizing historical price data
 * Features:
 * - 7-day average line
 * - 30-day trend visualization
 * - Volume overlay
 * - Responsive design
 * - No-data scenario handling
 */
export function PriceChart({
  productId,
  productName,
  currency,
  unit,
  className = "",
}: PriceChartProps) {
  const [chartData, setChartData] = useState<PriceChartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchPriceChartData(productId, productName, currency, unit);
        if (!cancelled) {
          setChartData(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load price data");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadData();
    return () => {
      cancelled = true;
    };
  }, [productId, productName, currency, unit]);

  // Calculate 7-day moving average for the chart
  const chartDataWithMovingAverage = useMemo(() => {
    if (!chartData) return [];

    const prices = chartData.dataPoints.map(dp => dp.price);
    const movingAverages = calculateMovingAverage(prices, 7);

    return chartData.dataPoints.map((dp, index) => ({
      ...dp,
      date: new Date(dp.date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      movingAverage: movingAverages[index],
    }));
  }, [chartData]);

  // Format currency for display
  const formatCurrency = (value: number) => {
    return `${currency} ${value.toFixed(2)}`;
  };

  // Format volume for display
  const formatVolume = (value: number) => {
    if (value >= 1000) {
      return `${(value / 1000).toFixed(1)}k`;
    }
    return value.toString();
  };

  // Custom tooltip component
  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey: string; value: number }>; label?: string }) => {
    if (!active || !payload || !payload.length) return null;

    const priceData = payload.find((p) => p.dataKey === "price");
    const volumeData = payload.find((p) => p.dataKey === "volume");
    const maData = payload.find((p) => p.dataKey === "movingAverage");

    return (
      <div className="bg-background border border-border rounded-lg p-3 shadow-lg">
        <Text variant="body" className="font-medium mb-2">
          {label}
        </Text>
        {priceData && (
          <div className="flex items-center gap-2 mb-1">
            <div className="w-3 h-3 rounded-full bg-primary" />
            <Text variant="body" className="text-sm">
              Price: {formatCurrency(priceData.value)}
            </Text>
          </div>
        )}
        {maData && !isNaN(maData.value) && (
          <div className="flex items-center gap-2 mb-1">
            <div className="w-3 h-3 rounded-full bg-warning" />
            <Text variant="body" className="text-sm">
              7-day Avg: {formatCurrency(maData.value)}
            </Text>
          </div>
        )}
        {volumeData && (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-success" />
            <Text variant="body" className="text-sm">
              Volume: {formatVolume(volumeData.value)} {unit}
            </Text>
          </div>
        )}
      </div>
    );
  };

  // Loading state
  if (loading) {
    return (
      <Card variant="elevated" padding="md" className={className}>
        <CardHeader>
          <CardTitle className="text-base">Price History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center">
            <div className="space-y-3 w-full">
              <div className="h-4 bg-border/30 rounded w-1/3 mx-auto" />
              <div className="h-48 bg-border/30 rounded" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card variant="elevated" padding="md" className={className}>
        <CardHeader>
          <CardTitle className="text-base">Price History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center">
            <Text variant="body" className="text-error">
              {error}
            </Text>
          </div>
        </CardContent>
      </Card>
    );
  }

  // No data state
  if (!chartData || chartData.dataPoints.length === 0) {
    return (
      <Card variant="elevated" padding="md" className={className}>
        <CardHeader>
          <CardTitle className="text-base">Price History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center">
            <div className="text-center">
              <Text variant="body" muted>
                No price data available
              </Text>
              <Text variant="body" muted className="text-sm mt-1">
                Historical prices will appear here once data is available
              </Text>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card variant="elevated" padding="md" className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Price History</CardTitle>
          <div className="flex items-center gap-4">
            {chartData.sevenDayAverage !== null && (
              <div className="text-right">
                <Text variant="body" muted className="text-xs">
                  7-day Avg
                </Text>
                <Text variant="body" className="font-medium">
                  {formatCurrency(chartData.sevenDayAverage)}
                </Text>
              </div>
            )}
            {chartData.thirtyDayTrend !== null && (
              <div className="text-right">
                <Text variant="body" muted className="text-xs">
                  30-day Trend
                </Text>
                <Text
                  variant="body"
                  className={`font-medium ${
                    chartData.thirtyDayTrend >= 0 ? "text-success" : "text-error"
                  }`}
                >
                  {chartData.thirtyDayTrend >= 0 ? "+" : ""}
                  {chartData.thirtyDayTrend.toFixed(2)}%
                </Text>
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartDataWithMovingAverage}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={{ stroke: "hsl(var(--border))" }}
              />
              <YAxis
                yAxisId="price"
                tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={{ stroke: "hsl(var(--border))" }}
                tickFormatter={(value) => `${value}`}
                domain={["auto", "auto"]}
              />
              <YAxis
                yAxisId="volume"
                orientation="right"
                tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={{ stroke: "hsl(var(--border))" }}
                tickFormatter={(value) => formatVolume(value)}
                domain={[0, "auto"]}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ paddingTop: "20px" }}
                formatter={(value) => (
                  <span className="text-sm text-foreground">{value}</span>
                )}
              />
              <Bar
                yAxisId="volume"
                dataKey="volume"
                name="Volume"
                fill="hsl(var(--success))"
                fillOpacity={0.3}
                radius={[4, 4, 0, 0]}
              />
              <Line
                yAxisId="price"
                type="monotone"
                dataKey="price"
                name="Price"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: "hsl(var(--primary))" }}
              />
              <Line
                yAxisId="price"
                type="monotone"
                dataKey="movingAverage"
                name="7-day Avg"
                stroke="hsl(var(--warning))"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
                activeDot={{ r: 4, fill: "hsl(var(--warning))" }}
              />
              {chartData.sevenDayAverage !== null && (
                <ReferenceLine
                  yAxisId="price"
                  y={chartData.sevenDayAverage}
                  stroke="hsl(var(--warning))"
                  strokeDasharray="3 3"
                  strokeOpacity={0.5}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
