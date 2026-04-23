export type ProductCategory =
  | "Vegetables"
  | "Fruits"
  | "Grains"
  | "Tubers"
  | "Livestock"
  | "Other";

export type ProductCurrency = "STRK" | "USDC" | "XLM";

export type ProductUnit = "kg" | "bag" | "crate" | "piece" | "litre" | "dozen";

export interface Product {
  id: string;
  farmer_wallet: string;
  name: string;
  description: string | null;
  category: ProductCategory | null;
  price_per_unit: string; // backend returns numeric as string
  currency: ProductCurrency;
  unit: ProductUnit;
  stock_quantity: string | null; // numeric as string
  image_url: string | null;
  location: string;
  delivery_window: string;
  is_available: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ProductWriteInput {
  name?: string;
  description?: string | null;
  category?: ProductCategory | null;
  price_per_unit?: string;
  currency?: ProductCurrency;
  unit?: ProductUnit;
  stock_quantity?: string | null;
  location?: string;
  delivery_window?: string;
  is_available?: boolean;
}
