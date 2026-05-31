import type { PriceChartData } from "@/types/price";
import { apiRequest } from "@/lib/apiHelper";

export async function fetchPriceChartData(
  productId: string,
  productName: string,
  currency: string,
  unit: string
): Promise<PriceChartData> {
  const params = new URLSearchParams({ product_name: productName, currency, unit });
  return apiRequest<PriceChartData>(`/prices/${productId}/chart?${params}`);
}

export function calculateMovingAverage(prices: number[], windowSize: number): number[] {
  const result: number[] = [];

  for (let i = 0; i < prices.length; i++) {
    if (i < windowSize - 1) {
      result.push(NaN);
    } else {
      const window = prices.slice(i - windowSize + 1, i + 1);
      const average = window.reduce((sum, val) => sum + val, 0) / windowSize;
      result.push(Math.round(average * 100) / 100);
    }
  }

  return result;
}
