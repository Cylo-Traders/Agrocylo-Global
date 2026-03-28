import { ProductCategory, ProductUnit } from "./product";

export interface BuyerIntent {
  id: string;
  buyer_name: string;
  product_name: string;
  category: ProductCategory | null;
  quantity: string; // numeric as string
  unit: ProductUnit;
  location: {
    region: string;
    coordinates: [number, number]; // [lat, lng]
  };
  created_at: string;
}

export interface DemandVolume {
  total_volume: string; // numeric as string
  unit: ProductUnit;
  category_breakdown: Record<ProductCategory, string>;
}

export interface HeatMapPoint {
  coordinates: [number, number];
  intensity: number; // 0 to 1
  label: string;
}

export interface DemandData {
  volume: DemandVolume;
  intents: BuyerIntent[];
  heatMap: HeatMapPoint[];
}
