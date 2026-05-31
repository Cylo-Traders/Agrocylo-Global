import type { DemandData, BuyerIntent, HeatMapPoint, DemandTrendPoint } from "@/types/demand";
import { apiRequest } from "@/lib/apiHelper";

export async function getDemandData(): Promise<DemandData> {
  return apiRequest<DemandData>("/market/demand");
}

export async function getBuyerIntents(): Promise<BuyerIntent[]> {
  return apiRequest<BuyerIntent[]>("/market/buyer-intents");
}

export async function getDemandHeatMap(): Promise<HeatMapPoint[]> {
  return apiRequest<HeatMapPoint[]>("/market/heatmap");
}

export async function getDemandTrend(days = 30): Promise<DemandTrendPoint[]> {
  return apiRequest<DemandTrendPoint[]>(`/market/trend?days=${days}`);
}
