/**
 * Investor portfolio service (Issue #1051)
 *
 * Connects the portfolio page to the wallet-scoped server contract:
 *   GET {API}/investor/portfolio (Authorization: Bearer via ApiClient)
 *
 * Units contract:
 *   - The server returns Soroban i128 **stroop** strings exactly as indexed
 *     (1 XLM = 10_000_000 stroops); the protocol is XLM-denominated and has
 *     no fiat leg, so nothing here converts to dollars.
 *   - Conversions to XLM use the exact BigInt helpers in `lib/validation`
 *     (formatStroopsForDisplay), never `Number`, so values beyond 2^53
 *     stroops keep full precision.
 */

import api from "../lib/apiClient";
import { formatStroopsForDisplay } from "../lib/validation";

export interface PortfolioPositionDTO {
  id: string;
  campaignId: string;
  investorAddress: string;
  /** Invested amount, i128 stroop string. */
  amount: string;
  ledger: number;
  txHash?: string | null;
  createdAt: string;
  campaign?: {
    id: string;
    onChainId: string;
    farmerAddress: string;
    tokenAddress: string;
    targetAmount: string;
    totalRaised: string;
    totalRevenue: string;
    status: string;
    deadline: string;
  };
}

export interface InvestorPortfolioDTO {
  investorAddress: string;
  positions: PortfolioPositionDTO[];
  totalInvested: string;
  totalReturned: string;
}

/** Documented view model — all monetary values are XLM strings. */
export interface PortfolioPosition {
  id: string;
  campaignId: string;
  campaignName: string;
  /** Invested amount in XLM, 7-dp exact string. */
  amountInvested: string;
  /** Position status (campaign lifecycle), e.g. FUNDING / HARVESTED. */
  status: string;
  investedAt: string;
}

export interface PortfolioSummary {
  investorAddress: string;
  totalInvested: string;
  totalReturned: string;
  positions: PortfolioPosition[];
}

function campaignDisplayName(position: PortfolioPositionDTO): string {
  return position.campaign ? `Campaign ${position.campaign.onChainId}` : `Campaign ${position.campaignId}`;
}

/** Map the server contract to the documented XLM view model. */
export function mapInvestorPortfolio(dto: InvestorPortfolioDTO): PortfolioSummary {
  return {
    investorAddress: dto.investorAddress,
    totalInvested: formatStroopsForDisplay(dto.totalInvested || "0", 7),
    totalReturned: formatStroopsForDisplay(dto.totalReturned || "0", 7),
    positions: dto.positions.map((position) => ({
      id: position.id,
      campaignId: position.campaignId,
      campaignName: campaignDisplayName(position),
      amountInvested: formatStroopsForDisplay(position.amount, 7),
      status: position.campaign?.status ?? "UNKNOWN",
      investedAt: position.createdAt,
    })),
  };
}

/**
 * Fetch the wallet-scoped portfolio. Unauthorized/offline/server failures
 * propagate as ApiError/NetworkError for the page's distinct states.
 */
export async function fetchInvestorPortfolio(): Promise<PortfolioSummary> {
  const dto = await api.get<InvestorPortfolioDTO>("/investor/portfolio");
  return mapInvestorPortfolio(dto);
}
