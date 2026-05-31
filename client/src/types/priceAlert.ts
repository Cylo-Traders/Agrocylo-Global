export interface PriceAlert {
  id: string;
  userId: string;
  productId?: string;
  categoryId?: string;
  alertType: "above" | "below" | "percentage";
  thresholdPrice?: number;
  percentageChange?: number;
  region?: string;
  enabled: boolean;
  notifyVia: "email" | "push" | "both";
  createdAt: number;
  updatedAt: number;
  lastNotifiedAt?: number;
  currentPrice?: number;
  priceAtCreation?: number;
}

export interface PriceAlertCreateInput {
  productId?: string;
  categoryId?: string;
  alertType: "above" | "below" | "percentage";
  thresholdPrice?: number;
  percentageChange?: number;
  region?: string;
  notifyVia?: "email" | "push" | "both";
  enabled?: boolean;
}

export interface PriceNotification {
  id: string;
  alertId: string;
  productName: string;
  previousPrice: number;
  currentPrice: number;
  percentageChange: number;
  timestamp: number;
  read: boolean;
}

export interface PriceTrend {
  timestamp: number;
  price: number;
  averagePrice: number;
}
