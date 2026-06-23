import api from "./apiClient";

export async function recordInvestment(campaignId: string, investorAddress: string, amount: bigint): Promise<void> {
  await api.post(`/campaigns/${campaignId}/invest`, {
    investorAddress,
    amount: amount.toString(),
  });
}
