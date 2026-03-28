/**
 * Price data service for fetching historical price data
 * Currently uses mock data - will be replaced with indexer integration
 */

import type { PriceDataPoint, PriceChartData } from "@/types/price";

/**
 * Generate mock price data for a product
 * This simulates historical price data with realistic patterns
 */
function generateMockPriceData(
  productId: string,
  productName: string,
  currency: string,
  unit: string
): PriceChartData {
  const dataPoints: PriceDataPoint[] = [];
  const now = new Date();
  const basePrice = getBasePriceForProduct(productName);
  
  // Generate 30 days of historical data
  for (let i = 29; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    
    // Add some realistic price variation
    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    
    // Simulate price trends with some randomness
    const trendFactor = 1 + (Math.sin(i / 10) * 0.1); // Cyclical trend
    const randomFactor = 0.95 + Math.random() * 0.1; // ±5% random variation
    const weekendFactor = isWeekend ? 0.98 : 1.0; // Slightly lower on weekends
    
    const price = basePrice * trendFactor * randomFactor * weekendFactor;
    
    // Generate volume data (higher on weekdays, varies by product)
    const baseVolume = getBaseVolumeForProduct(productName);
    const volumeVariation = 0.7 + Math.random() * 0.6; // ±30% variation
    const weekdayFactor = isWeekend ? 0.6 : 1.0;
    const volume = Math.round(baseVolume * volumeVariation * weekdayFactor);
    
    dataPoints.push({
      date: date.toISOString().split('T')[0],
      price: Math.round(price * 100) / 100, // Round to 2 decimal places
      volume,
    });
  }
  
  // Calculate 7-day average (last 7 data points)
  const last7Days = dataPoints.slice(-7);
  const sevenDayAverage = last7Days.length > 0
    ? Math.round((last7Days.reduce((sum, dp) => sum + dp.price, 0) / last7Days.length) * 100) / 100
    : null;
  
  // Calculate 30-day trend (percentage change from first to last)
  const thirtyDayTrend = dataPoints.length >= 2
    ? Math.round(((dataPoints[dataPoints.length - 1].price - dataPoints[0].price) / dataPoints[0].price) * 10000) / 100
    : null;
  
  return {
    productId,
    productName,
    currency,
    unit,
    dataPoints,
    sevenDayAverage,
    thirtyDayTrend,
  };
}

/**
 * Get base price for a product based on its name
 */
function getBasePriceForProduct(productName: string): number {
  const name = productName.toLowerCase();
  
  // Different base prices for different product types
  if (name.includes('tomato')) return 2.50;
  if (name.includes('potato')) return 1.80;
  if (name.includes('onion')) return 1.50;
  if (name.includes('carrot')) return 2.00;
  if (name.includes('cabbage')) return 1.20;
  if (name.includes('maize') || name.includes('corn')) return 1.00;
  if (name.includes('rice')) return 2.50;
  if (name.includes('bean')) return 3.00;
  if (name.includes('apple')) return 3.50;
  if (name.includes('orange')) return 2.80;
  if (name.includes('banana')) return 1.50;
  if (name.includes('mango')) return 4.00;
  if (name.includes('chicken')) return 8.00;
  if (name.includes('fish')) return 10.00;
  if (name.includes('meat') || name.includes('beef')) return 12.00;
  
  // Default price
  return 2.00;
}

/**
 * Get base volume for a product based on its name
 */
function getBaseVolumeForProduct(productName: string): number {
  const name = productName.toLowerCase();
  
  // Different base volumes for different product types
  if (name.includes('tomato')) return 150;
  if (name.includes('potato')) return 200;
  if (name.includes('onion')) return 180;
  if (name.includes('carrot')) return 120;
  if (name.includes('cabbage')) return 100;
  if (name.includes('maize') || name.includes('corn')) return 250;
  if (name.includes('rice')) return 300;
  if (name.includes('bean')) return 80;
  if (name.includes('apple')) return 90;
  if (name.includes('orange')) return 110;
  if (name.includes('banana')) return 200;
  if (name.includes('mango')) return 70;
  if (name.includes('chicken')) return 50;
  if (name.includes('fish')) return 40;
  if (name.includes('meat') || name.includes('beef')) return 30;
  
  // Default volume
  return 100;
}

/**
 * Fetch price chart data for a product
 * @param productId - The product ID
 * @param productName - The product name
 * @param currency - The currency code
 * @param unit - The unit of measurement
 * @returns Promise<PriceChartData>
 */
export async function fetchPriceChartData(
  productId: string,
  productName: string,
  currency: string,
  unit: string
): Promise<PriceChartData> {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // In the future, this will fetch from an indexer
  // For now, return mock data
  return generateMockPriceData(productId, productName, currency, unit);
}

/**
 * Calculate moving average for a series of prices
 * @param prices - Array of price values
 * @param windowSize - Size of the moving window
 * @returns Array of moving average values
 */
export function calculateMovingAverage(prices: number[], windowSize: number): number[] {
  const result: number[] = [];
  
  for (let i = 0; i < prices.length; i++) {
    if (i < windowSize - 1) {
      result.push(NaN); // Not enough data points yet
    } else {
      const window = prices.slice(i - windowSize + 1, i + 1);
      const average = window.reduce((sum, val) => sum + val, 0) / windowSize;
      result.push(Math.round(average * 100) / 100);
    }
  }
  
  return result;
}
