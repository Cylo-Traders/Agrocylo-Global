/**
 * Price data types for historical price chart visualization
 */

export interface PriceDataPoint {
  date: string; // ISO date string
  price: number;
  volume: number;
}

export interface PriceChartData {
  productId: string;
  productName: string;
  currency: string;
  unit: string;
  dataPoints: PriceDataPoint[];
  sevenDayAverage: number | null;
  thirtyDayTrend: number | null; // percentage change
}

export interface PriceChartProps {
  productId: string;
  productName: string;
  currency: string;
  unit: string;
  className?: string;
}
