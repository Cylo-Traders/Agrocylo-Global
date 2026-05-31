import type { PriceAlert, PriceAlertCreateInput } from "@/types/priceAlert";
import { apiRequest } from "@/lib/apiHelper";

export const priceAlertService = {
  async getAlerts(filters?: {
    status?: "active" | "inactive";
    category?: string;
  }): Promise<PriceAlert[]> {
    const query = new URLSearchParams();
    if (filters?.status) query.append("status", filters.status);
    if (filters?.category) query.append("category", filters.category);

    return apiRequest<PriceAlert[]>(`/price-alerts?${query.toString()}`);
  },

  async createAlert(alert: PriceAlertCreateInput): Promise<PriceAlert> {
    return apiRequest<PriceAlert>("/price-alerts", {
      method: "POST",
      body: alert,
    });
  },

  async updateAlert(
    id: string,
    updates: Partial<PriceAlertCreateInput>
  ): Promise<PriceAlert> {
    return apiRequest<PriceAlert>(`/price-alerts/${id}`, {
      method: "PATCH",
      body: updates,
    });
  },

  async deleteAlert(id: string): Promise<void> {
    await apiRequest<void>(`/price-alerts/${id}`, {
      method: "DELETE",
    });
  },

  async toggleAlert(id: string, enabled: boolean): Promise<PriceAlert> {
    return this.updateAlert(id, { enabled });
  },

  async getPriceHistory(
    productId: string,
    days: 7 | 30 | 90 = 30
  ): Promise<Array<{ timestamp: number; price: number }>> {
    return apiRequest<Array<{ timestamp: number; price: number }>>(
      `/price-history/${productId}?days=${days}`
    );
  },

  async getPriceComparison(
    productId: string,
    regions?: string[]
  ): Promise<
    Array<{
      region: string;
      price: number;
      timestamp: number;
    }>
  > {
    const query = new URLSearchParams();
    if (regions) {
      regions.forEach((r) => query.append("regions", r));
    }
    return apiRequest<
      Array<{
        region: string;
        price: number;
        timestamp: number;
      }>
    >(`/price-comparison/${productId}?${query.toString()}`);
  },
};
