export type CampaignStatus =
  | "FUNDING"
  | "FUNDED"
  | "IN_PRODUCTION"
  | "HARVESTED"
  | "SETTLED"
  | "FAILED"
  | "DISPUTED";

export type OrderStatus = "PENDING" | "CONFIRMED";

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
