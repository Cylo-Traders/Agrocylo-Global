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
