/**
 * Canonical campaign status transitions and domain logic.
 * Central place for status enum, allowed transitions, and display metadata.
 */

import type { CampaignStatus as PrismaCampaignStatus } from "@prisma/client";

export const CAMPAIGN_STATUSES = {
  FUNDING: "FUNDING",
  FUNDED: "FUNDED",
  IN_PRODUCTION: "IN_PRODUCTION",
  HARVESTED: "HARVESTED",
  SETTLED: "SETTLED",
  FAILED: "FAILED",
  DISPUTED: "DISPUTED",
} as const;

type CampaignStatusKey = keyof typeof CAMPAIGN_STATUSES;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[CampaignStatusKey];

export const TERMINAL_STATUSES = new Set(["SETTLED", "FAILED", "DISPUTED"]);

const ALLOWED_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  FUNDING: ["FUNDED", "FAILED", "DISPUTED"],
  FUNDED: ["IN_PRODUCTION", "FAILED", "DISPUTED"],
  IN_PRODUCTION: ["HARVESTED", "FAILED", "DISPUTED"],
  HARVESTED: ["SETTLED", "FAILED", "DISPUTED"],
  SETTLED: [],
  FAILED: [],
  DISPUTED: [],
};

/**
 * Validates whether a status transition is allowed.
 * Only indexer events should trigger transitions; API calls should be rejected.
 */
export function isValidTransition(
  currentStatus: CampaignStatus,
  newStatus: CampaignStatus,
): boolean {
  if (currentStatus === newStatus) return true;
  return ALLOWED_TRANSITIONS[currentStatus]?.includes(newStatus) ?? false;
}

/**
 * Maps event action to status update.
 * Returns null if event does not trigger a status change.
 */
export function getStatusFromEventAction(
  action: string,
): CampaignStatus | null {
  switch (action) {
    case "campaign.invested":
      return "FUNDED"; // Caller checks if totalRaised === target
    case "campaign.produce":
      return "IN_PRODUCTION";
    case "campaign.harvest":
      return "HARVESTED";
    case "campaign.settled":
      return "SETTLED";
    case "campaign.failed":
      return "FAILED";
    case "campaign.disputed":
      return "DISPUTED";
    default:
      return null;
  }
}

/** Localized display labels for status values. */
export const LOCALIZED_STATUS_LABELS: Record<CampaignStatus, string> = {
  FUNDING: "Raising Funds",
  FUNDED: "Funded",
  IN_PRODUCTION: "In Production",
  HARVESTED: "Harvested",
  SETTLED: "Settled",
  FAILED: "Failed",
  DISPUTED: "Disputed",
};

/** Get both machine status and localized display metadata. */
export function getStatusMetadata(status: CampaignStatus) {
  return {
    machineStatus: status,
    displayLabel: LOCALIZED_STATUS_LABELS[status],
    isTerminal: TERMINAL_STATUSES.has(status),
  };
}
