export type CampaignStatus =
  | "FUNDING"
  | "FUNDED"
  | "IN_PRODUCTION"
  | "HARVESTED"
  | "SETTLED"
  | "FAILED"
  | "DISPUTED";

export type OrderStatus = "PENDING" | "CONFIRMED";

export type OrderLifecycle = "draft" | "submitted" | "confirmed" | "failed";

export interface Campaign {
  id: string;
  onChainId: string;
  farmerAddress: string;
  tokenAddress: string;
  targetAmount: string;
  totalRaised: string;
  totalRevenue: string;
  trancheReleased: string;
  deadline: string;
  status: CampaignStatus;
  createdAt: string;
  updatedAt: string;
  _count?: {
    investments: number;
    orders: number;
  };
}

export interface Investment {
  id: string;
  campaignId: string;
  investorAddress: string;
  amount: string;
  ledger: number;
  txHash?: string | null;
  createdAt: string;
}

export interface Order {
  id: string;
  onChainId: string;
  campaignId: string;
  buyerAddress: string;
  amount: string;
  status: OrderStatus;
  ledger: number;
  txHash?: string | null;
  createdAt: string;
  updatedAt: string;
  campaign?: {
    farmerAddress: string;
    tokenAddress: string;
    onChainId: string;
  };
}

export interface CampaignDetail extends Campaign {
  investments: Investment[];
  orders: Order[];
}

export interface CampaignListResponse {
  data: Campaign[];
  meta: {
    total: number;
    page: number;
    limit: number;
  };
}

export const PRODUCT_CATEGORIES = [
  "GRAINS",
  "VEGETABLES",
  "FRUITS",
  "LIVESTOCK",
  "DAIRY",
  "OTHER",
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export const PRODUCT_CATEGORY_LABELS: Record<ProductCategory, string> = {
  GRAINS: "Grains",
  VEGETABLES: "Vegetables",
  FRUITS: "Fruits",
  LIVESTOCK: "Livestock",
  DAIRY: "Dairy",
  OTHER: "Other",
};

const LEGACY_CATEGORY_ALIASES: Record<string, ProductCategory> = {
  grains: "GRAINS",
  vegetables: "VEGETABLES",
  fruits: "FRUITS",
  livestock: "LIVESTOCK",
  meat: "LIVESTOCK",
  poultry: "LIVESTOCK",
  dairy: "DAIRY",
  other: "OTHER",
};

export function parseProductCategory(value: string | null | undefined): ProductCategory | "" {
  if (!value) return "";
  const trimmed = value.trim();
  const upper = trimmed.toUpperCase();
  if ((PRODUCT_CATEGORIES as readonly string[]).includes(upper)) {
    return upper as ProductCategory;
  }
  const alias = LEGACY_CATEGORY_ALIASES[trimmed.toLowerCase()];
  return alias ?? "";
}

export function formatProductCategory(category: string): string {
  const canonical = parseProductCategory(category);
  return canonical ? PRODUCT_CATEGORY_LABELS[canonical] : category;
}

export interface Product {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  pricePerUnit: string;
  amountUnit: "stroops";
  currency: ProductCurrency;
  campaignId: string | null;
  category: ProductCategory;
  unit: string;
  createdAt: string;
  updatedAt: string;
  quantity: number;
  location: string | null;
  farmerAddress: string;
  isActive: boolean;
  isSellable: boolean;
}

export type ProductCurrency = "XLM" | "USDC";

export interface ProductFilters {
  category?: string;
  location?: string;
  minPrice?: string;
  maxPrice?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface ProductDetail extends Product {
  campaign: {
    id: string;
    onChainId: string;
    farmerAddress: string;
    status: CampaignStatus;
  } | null;
}

export interface ProductListResponse {
  data: Product[];
  meta: {
    total: number;
    page: number;
    limit: number;
    serviceVersion?: string;
    readiness?: "ready" | "degraded";
  };
}
