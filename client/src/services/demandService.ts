import { DemandData, BuyerIntent, HeatMapPoint } from "@/types/demand";

const MOCK_INTENTS: BuyerIntent[] = [
  {
    id: "1",
    buyer_name: "GrainCorp",
    product_name: "Maize",
    category: "Grains",
    quantity: "500",
    unit: "bag",
    location: {
      region: "North Central",
      coordinates: [9.082, 7.533],
    },
    created_at: new Date().toISOString(),
  },
  {
    id: "2",
    buyer_name: "AgroExport Ltd",
    product_name: "Cassava",
    category: "Tubers",
    quantity: "1200",
    unit: "kg",
    location: {
      region: "South West",
      coordinates: [7.3775, 3.947],
    },
    created_at: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: "3",
    buyer_name: "FreshFoods",
    product_name: "Tomatoes",
    category: "Vegetables",
    quantity: "300",
    unit: "crate",
    location: {
      region: "North West",
      coordinates: [10.5105, 7.4165],
    },
    created_at: new Date(Date.now() - 172800000).toISOString(),
  },
];

const MOCK_HEATMAP: HeatMapPoint[] = [
  { coordinates: [9.082, 7.533], intensity: 0.8, label: "Abuja" },
  { coordinates: [6.5244, 3.3792], intensity: 0.9, label: "Lagos" },
  { coordinates: [12.0022, 8.592], intensity: 0.6, label: "Kano" },
  { coordinates: [4.8156, 7.0498], intensity: 0.7, label: "Port Harcourt" },
];

export async function getDemandData(): Promise<DemandData> {
  // Simulate API delay
  await new Promise((resolve) => setTimeout(resolve, 500));

  return {
    volume: {
      total_volume: "25400",
      unit: "kg",
      category_breakdown: {
        Grains: "12000",
        Tubers: "8000",
        Vegetables: "3000",
        Fruits: "1500",
        Livestock: "900",
        Other: "0",
      },
    },
    intents: MOCK_INTENTS,
    heatMap: MOCK_HEATMAP,
  };
}
