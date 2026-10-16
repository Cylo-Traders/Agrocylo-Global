import { apiRequest } from "@/lib/apiHelper";
import {
  PriceIndexResponseSchema,
  PriceIndexEntry,
  validateResponse,
} from "@/lib/apiSchemas";

export interface PriceIndexFilters {
  crop?: string;
  region?: string;
  signal?: AbortSignal;
}

export async function fetchPriceIndex(
  filters: PriceIndexFilters = {},
): Promise<PriceIndexEntry[]> {
  const params = new URLSearchParams();
  if (filters.crop) params.append("crop", filters.crop);
  if (filters.region) params.append("region", filters.region);

  const queryString = params.toString();
  const path = queryString
    ? `/api/v1/analytics/price-index?${queryString}`
    : "/api/v1/analytics/price-index";

  const response = await apiRequest(path, { signal: filters.signal });
  return validateResponse(PriceIndexResponseSchema, response).data;
}
