import type { Campaign, CampaignDetail, CampaignListResponse } from "@/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

export async function fetchCampaigns(params?: {
  status?: string;
  farmerAddress?: string;
  page?: number;
  limit?: number;
}): Promise<CampaignListResponse> {
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);
  if (params?.farmerAddress) query.set("farmerAddress", params.farmerAddress);
  if (params?.page) query.set("page", String(params.page));
  if (params?.limit) query.set("limit", String(params.limit));

  const res = await fetch(`${API_BASE}/campaigns?${query}`);
  if (!res.ok) throw new Error(`Failed to fetch campaigns: ${res.status}`);
  return res.json();
}

export async function fetchCampaign(id: string): Promise<CampaignDetail> {
  const res = await fetch(`${API_BASE}/campaigns/${id}`);
  if (!res.ok) throw new Error(`Campaign not found: ${res.status}`);
  return res.json();
}

export function fundingProgress(campaign: Pick<Campaign, "totalRaised" | "targetAmount">): number {
  const raised = BigInt(campaign.totalRaised || "0");
  const target = BigInt(campaign.targetAmount || "1");
  if (target === 0n) return 0;
  const pct = Number((raised * 100n) / target);
  return Math.min(pct, 100);
}

export function formatAmount(raw: string): string {
  const n = BigInt(raw || "0");
  const xlm = Number(n) / 1e7;
  return xlm.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
