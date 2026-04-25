import type { ProductCategory, ProductUnit, ProductCurrency } from "./product";

export type BarterStatus = "pending" | "accepted" | "rejected" | "expired" | "cancelled";

export interface BarterOfferItem {
  product_name: string;
  category: ProductCategory;
  quantity: string;
  unit: ProductUnit;
}

export interface BarterOffer {
  id: string;
  proposer_wallet: string;
  recipient_wallet: string;
  offer_items: BarterOfferItem[];
  request_items: BarterOfferItem[];
  expiry_date: string;
  collateral_amount: string | null;
  collateral_currency: ProductCurrency | null;
  status: BarterStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface BarterOfferInput {
  recipient_wallet: string;
  offer_items: BarterOfferItem[];
  request_items: BarterOfferItem[];
  expiry_hours: number;
  collateral_amount: string | null;
  collateral_currency: ProductCurrency | null;
  notes: string | null;
}
