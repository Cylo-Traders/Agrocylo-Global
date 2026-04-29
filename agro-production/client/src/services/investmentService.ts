import type { Campaign, Investment } from "@/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

export interface InvestmentWithCampaign extends Investment {
  campaign: Pick<
    Campaign,
    "id" | "onChainId" | "farmerAddress" | "tokenAddress" | "targetAmount" | "totalRaised" | "totalRevenue" | "status" | "deadline"
  >;
}

export async function fetchUserInvestments(
  investorAddress: string,
): Promise<InvestmentWithCampaign[]> {
  const res = await fetch(
    `${API_BASE}/investments?investorAddress=${encodeURIComponent(investorAddress)}`,
  );
  if (!res.ok) throw new Error(`Failed to fetch investments: ${res.status}`);
  return res.json();
}

/** Claimable return = proportional share of totalRevenue minus original contribution */
export function claimableReturn(investment: InvestmentWithCampaign): bigint {
  const { campaign } = investment;
  if (campaign.status !== "SETTLED") return 0n;
  const totalRevenue = BigInt(campaign.totalRevenue || "0");
  const totalRaised = BigInt(campaign.totalRaised || "1");
  const contributed = BigInt(investment.amount || "0");
  if (totalRaised === 0n) return 0n;
  return (totalRevenue * contributed) / totalRaised;
}
