import { apiRequest } from "@/lib/apiHelper";

export interface ReferralCode {
  code: string;
  referrerWallet: string;
  createdAt: string;
  feeCreditBalance: number;
}

export interface ReferralCohortPerformance {
  onboardedCount: number;
  transactingCount: number;
  rewardVolume: string;
}

export interface ReferralRecord {
  id: string;
  referredWallet: string;
  referralCode: string;
  signedUpAt: string;
  hasTransacted: boolean;
}

export async function getReferralCode(
  walletAddress: string,
): Promise<ReferralCode> {
  return apiRequest<ReferralCode>("/referrals/me", {
    headers: { "x-wallet-address": walletAddress },
  });
}

export async function getCohortPerformance(walletAddress: string): Promise<{
  performance: ReferralCohortPerformance;
  referrals: ReferralRecord[];
}> {
  return apiRequest<{
    performance: ReferralCohortPerformance;
    referrals: ReferralRecord[];
  }>("/referrals/me/cohort", {
    headers: { "x-wallet-address": walletAddress },
  });
}

export async function submitReferralCode(
  referralCode: string,
  walletAddress: string,
): Promise<{ linked: boolean; referral?: ReferralRecord }> {
  return apiRequest<{ linked: boolean; referral?: ReferralRecord }>(
    "/referrals/signup",
    {
      method: "POST",
      headers: { "x-wallet-address": walletAddress },
      body: { referralCode },
    },
  );
}
