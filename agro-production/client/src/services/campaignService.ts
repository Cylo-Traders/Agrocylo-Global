import type { Campaign, CampaignDetail, CampaignListResponse } from "@/types";
import api from "../lib/apiClient";

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

  return api.get<CampaignListResponse>(`/campaigns?${query}`);
}

export async function fetchCampaign(id: string): Promise<CampaignDetail> {
  return api.get<CampaignDetail>(`/campaigns/${id}`);
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

export interface CreateCampaignRequest {
  farmerAddress: string;
  tokenAddress: string;
  targetAmount: string;
  deadline: string;
}

export interface CampaignCreationPhase {
  phase: "idle" | "building" | "signing" | "submitting" | "confirming" | "registering" | "reconciling" | "success" | "failed";
  error?: string;
  txHash?: string;
  campaignId?: string;
}

/**
 * Create an on-chain campaign and register it off-chain.
 * Returns the campaign ID once it's been indexed.
 */
export async function createCampaign(
  request: CreateCampaignRequest,
  onPhaseChange?: (phase: CampaignCreationPhase) => void,
): Promise<{ success: boolean; campaignId?: string; error?: string; txHash?: string }> {
  try {
    const { buildCreateCampaign } = await import("@/lib/contractService");
    const { signAndSubmitTransaction } = await import("@/lib/signTransaction");

    const targetAmount = BigInt(request.targetAmount);
    const deadline = Math.floor(new Date(request.deadline).getTime() / 1000);

    onPhaseChange?.({ phase: "building" });
    const built = await buildCreateCampaign(request.farmerAddress, request.tokenAddress, targetAmount, deadline);
    if (!built.success || !built.data) {
      throw new Error(built.error ?? "Could not build the campaign creation transaction");
    }

    onPhaseChange?.({ phase: "signing" });
    const submitted = await signAndSubmitTransaction(built.data);
    if (!submitted.success || !submitted.txHash) {
      throw new Error(submitted.error ?? "Campaign transaction was not confirmed on-chain");
    }

    onPhaseChange?.({ phase: "registering", txHash: submitted.txHash });
    const campaign = await api.post<Campaign>("/campaigns", request);

    onPhaseChange?.({ phase: "reconciling", txHash: submitted.txHash });

    return { success: true, campaignId: campaign.id, txHash: submitted.txHash };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    onPhaseChange?.({ phase: "failed", error: errorMsg });
    return { success: false, error: errorMsg };
  }
}
