'use client'

import React, { useState, useEffect } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'

export interface PriceDataPoint {
  timestamp: Date | string
  price: number
  volume?: number
}

interface PriceChartProps {
  data: PriceDataPoint[]
  title?: string
  currency?: string
  isLoading?: boolean
}

const PriceChart: React.FC<PriceChartProps> = ({
  data,
  title = 'Price Trend',
  currency = 'USD',
  isLoading = false,
}) => {
  const [displayData, setDisplayData] = useState<PriceDataPoint[]>(data)
  const [timeRange, setTimeRange] = useState<'1d' | '7d' | '30d' | '1y'>('7d')

  useEffect(() => {
    setDisplayData(data)
  }, [data])

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gray-200 rounded w-1/3"></div>
          <div className="h-48 bg-gray-200 rounded"></div>
        </div>
      </div>
    )
  }

  if (displayData.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6 text-center text-gray-500">
        No price data available
      </div>
    )
  }

  const prices = displayData.map((d) => d.price)
  const minPrice = Math.min(...prices)
  const maxPrice = Math.max(...prices)
  const firstPrice = prices[0]
  const lastPrice = prices[prices.length - 1]
  const change = lastPrice - firstPrice
  const changePercent = ((change / firstPrice) * 100).toFixed(2)
  const isPositive = change >= 0

  const chartHeight = 200
  const range = maxPrice - minPrice || 1
  const padding = range * 0.1

  // Normalize prices to chart height
  const normalizedData = displayData.map((d, i) => ({
    ...d,
    normalizedPrice:
      ((d.price - (minPrice - padding)) / (range + padding * 2)) * chartHeight,
    x: (i / (displayData.length - 1 || 1)) * 100,
  }))

  // Create SVG path
  const pathData = normalizedData
    .map(
      (d, i) =>
        `${i === 0 ? 'M' : 'L'} ${d.x}% ${chartHeight - d.normalizedPrice}`
    )
    .join(' ')

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{title}</h2>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-3xl font-bold text-gray-900">
              {lastPrice.toFixed(2)} {currency}
            </span>
            <div
              className={`flex items-center gap-1 text-lg font-semibold ${
                isPositive ? 'text-green-600' : 'text-red-600'
              }`}
            >
              {isPositive ? (
                <TrendingUp className="w-5 h-5" />
              ) : (
                <TrendingDown className="w-5 h-5" />
              )}
              {Math.abs(Number(changePercent))}%
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {(['1d', '7d', '30d', '1y'] as const).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                timeRange === range
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      {/* SVG Chart */}
      <svg
        width="100%"
        height={chartHeight + 20}
        className="mb-4"
        viewBox={`0 0 100 ${chartHeight + 20}`}
        preserveAspectRatio="none"
      >
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <line
            key={`grid-${v}`}
            x1="0"
            y1={((1 - v) * chartHeight) + 10}
            x2="100"
            y2={((1 - v) * chartHeight) + 10}
            stroke="#e5e7eb"
            strokeWidth="0.5"
          />
        ))}

        {/* Price line */}
        <path
          d={pathData}
          fill="none"
          stroke="#2563eb"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />

        {/* Fill under line */}
        <path
          d={`${pathData} L 100 ${chartHeight} L 0 ${chartHeight} Z`}
          fill="url(#gradient)"
          opacity="0.1"
        />

        <defs>
          <linearGradient id="gradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#2563eb" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>

      {/* Price range info */}
      <div className="flex justify-between text-sm text-gray-600 border-t pt-4">
        <div>
          <p className="text-xs text-gray-500">24h Low</p>
          <p className="font-semibold text-gray-900">{minPrice.toFixed(2)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500">24h High</p>
          <p className="font-semibold text-gray-900">{maxPrice.toFixed(2)}</p>
        </div>
      </div>
    </div>
  )
}

export default PriceChart
