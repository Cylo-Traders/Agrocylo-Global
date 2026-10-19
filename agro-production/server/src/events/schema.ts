/**
 * Event schema versioning and validation.
 * Documents canonical versioned event schemas for campaign/investment lifecycle.
 */

export const EVENT_SCHEMA_VERSION = "1.0.0";

export const CANONICAL_EVENTS = {
  "campaign.created": {
    version: "1.0.0",
    fields: ["campaignId", "farmer", "token", "targetAmount", "deadline"],
    description: "Campaign created with funding target and deadline",
  },
  "campaign.invested": {
    version: "1.0.0",
    fields: ["campaignId", "investor", "amount", "totalRaised"],
    description: "Investor funded campaign",
  },
  "campaign.produce": {
    version: "1.0.0",
    fields: ["campaignId"],
    description: "Farmer transitioned campaign to production",
  },
  "campaign.harvest": {
    version: "1.0.0",
    fields: ["campaignId"],
    description: "Farmer harvested crop",
  },
  "campaign.settled": {
    version: "1.0.0",
    fields: ["campaignId", "totalRevenue"],
    description: "Campaign revenue distributed to investors",
  },
  "campaign.failed": {
    version: "1.0.0",
    fields: ["campaignId"],
    description: "Campaign failed, refunds triggered",
  },
  "campaign.disputed": {
    version: "1.0.0",
    fields: ["campaignId"],
    description: "Campaign disputed, no further actions allowed",
  },
  "campaign.claimed": {
    version: "1.0.0",
    fields: ["campaignId"],
    description: "Investor claimed campaign proceeds",
  },
  "campaign.refunded": {
    version: "1.0.0",
    fields: ["campaignId"],
    description: "Investor refunded after campaign failure",
  },
  "campaign.tranche": {
    version: "1.0.0",
    fields: ["campaignId"],
    description: "Campaign tranche milestone reached",
  },
  "order.created": {
    version: "1.0.0",
    fields: ["orderId", "buyer", "campaignId", "amount"],
    description: "Buyer placed an order against a campaign",
  },
  "order.confirmed": {
    version: "1.0.0",
    fields: ["orderId", "buyer", "campaignId"],
    description: "Buyer confirmed receipt of an order",
  },
  "dispute.opened": {
    version: "1.0.0",
    fields: ["disputeId", "campaignId", "initiatorAddress", "respondentAddress"],
    description: "A dispute was opened against a campaign or order",
  },
  "dispute.evidence_submitted": {
    version: "1.0.0",
    fields: ["disputeId", "submitterAddress", "evidenceUrl", "evidenceHash"],
    description: "Evidence was submitted for an open dispute",
  },
  "dispute.resolved": {
    version: "1.0.0",
    fields: ["disputeId", "resolutionOutcome"],
    description: "A dispute was resolved",
  },
  "dispute.dismissed": {
    version: "1.0.0",
    fields: ["disputeId"],
    description: "A dispute was dismissed",
  },
  "basket.created": {
    version: "1.0.0",
    fields: ["schemaVersion", "basketId", "constituentsCount"],
    description: "A basket was created",
  },
  "basket.deposit": {
    version: "1.0.0",
    fields: ["schemaVersion", "basketId", "depositor", "amount"],
    description: "A deposit was made into a basket",
  },
  "basket.funded": {
    version: "1.0.0",
    fields: ["schemaVersion", "basketId", "totalDeposit"],
    description: "A basket reached its funding window close",
  },
  "basket.fw_close": {
    version: "1.0.0",
    fields: ["schemaVersion", "basketId", "fundingDeadline", "minDeposit"],
    description: "A basket's funding window closed",
  },
  "basket.withdrawn": {
    version: "1.0.0",
    fields: ["schemaVersion", "basketId", "depositor", "depositAmount"],
    description: "A depositor withdrew from a basket",
  },
  "basket.claimed": {
    version: "1.0.0",
    fields: ["schemaVersion", "basketId", "depositor", "payout"],
    description: "A depositor claimed their basket payout",
  },
} as const;

export type VersionedEventType = keyof typeof CANONICAL_EVENTS;

/** Validates that an event has the canonical fields for its type. */
export function validateEventSchema(
  action: string,
  data: unknown[],
): { valid: true; version: string } | { valid: false; reason: string } {
  const schema = CANONICAL_EVENTS[action as VersionedEventType];
  if (!schema) {
    return { valid: false, reason: `Unknown event type: ${action}` };
  }

  if (!Array.isArray(data)) {
    return { valid: false, reason: "Event data must be an array" };
  }

  const expectedCount = schema.fields.length;
  if (data.length < expectedCount) {
    return {
      valid: false,
      reason: `Event ${action} expects ${expectedCount} fields, got ${data.length}`,
    };
  }

  return { valid: true, version: schema.version };
}
