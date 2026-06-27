export type EventAction =
  | "campaign.created"
  | "campaign.invested"
  | "campaign.settled"
  | "campaign.produce"
  | "campaign.harvest"
  | "campaign.failed"
  | "campaign.disputed"
  | "campaign.claimed"
  | "campaign.refunded"
  | "campaign.tranche"
  | "order.created"
  | "order.confirmed"
  | "dispute.opened"
  | "dispute.evidence_submitted"
  | "dispute.resolved"
  | "dispute.dismissed";

export interface RawSorobanEvent {
  id: string;
  type: string;
  ledger: number;
  ledgerClosedAt: string;
  contractId: string;
  /** Hash of the containing Soroban transaction, when supplied by RPC. */
  txHash?: string;
  topic: string[];  // base64-encoded XDR ScVal[]
  value: string;    // base64-encoded XDR ScVal
}

interface BaseEvent {
  action: EventAction;
  ledger: number;
  eventIndex: number;
  timestamp: Date;
  rawId: string;
  /** Preserved so API read models can be tied back to the confirmed ledger tx. */
  txHash?: string;
}

export interface CampaignCreatedEvent extends BaseEvent {
  action: "campaign.created";
  campaignId: string;
  farmer: string;
  token: string;
  targetAmount: string;
  deadline: string;
}

export interface CampaignInvestedEvent extends BaseEvent {
  action: "campaign.invested";
  campaignId: string;
  investor: string;
  amount: string;
  totalRaised: string;
}

export interface CampaignSettledEvent extends BaseEvent {
  action: "campaign.settled";
  campaignId: string;
  totalRevenue: string;
}

export interface OrderCreatedEvent extends BaseEvent {
  action: "order.created";
  orderId: string;
  buyer: string;
  campaignId: string;
  amount: string;
}

export interface OrderConfirmedEvent extends BaseEvent {
  action: "order.confirmed";
  orderId: string;
  buyer: string;
  campaignId: string;
}

export interface GenericCampaignEvent extends BaseEvent {
  action: Exclude<
    EventAction,
    | "campaign.created"
    | "campaign.invested"
    | "campaign.settled"
    | "order.created"
    | "order.confirmed"
  >;
  campaignId: string;
  extra?: unknown[];
}

export interface DisputeOpenedEvent extends BaseEvent {
  action: "dispute.opened";
  disputeId: string;
  campaignId: string;
  orderId?: string;
  initiatorAddress: string;
  respondentAddress: string;
}

export interface DisputeEvidenceSubmittedEvent extends BaseEvent {
  action: "dispute.evidence_submitted";
  disputeId: string;
  submitterAddress: string;
  evidenceUrl: string;
  evidenceHash: string;
}

export interface DisputeResolvedEvent extends BaseEvent {
  action: "dispute.resolved";
  disputeId: string;
  resolutionOutcome: string;
  resolutionNotes?: string;
}

export interface DisputeDismissedEvent extends BaseEvent {
  action: "dispute.dismissed";
  disputeId: string;
  dismissalReason?: string;
}

export type ParsedEvent =
  | CampaignCreatedEvent
  | CampaignInvestedEvent
  | CampaignSettledEvent
  | OrderCreatedEvent
  | OrderConfirmedEvent
  | GenericCampaignEvent
  | DisputeOpenedEvent
  | DisputeEvidenceSubmittedEvent
  | DisputeResolvedEvent
  | DisputeDismissedEvent;
