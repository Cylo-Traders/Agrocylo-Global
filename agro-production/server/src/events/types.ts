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
  | "order.confirmed";

export interface RawSorobanEvent {
  id: string;
  type: string;
  ledger: number;
  ledgerClosedAt: string;
  contractId: string;
  topic: string[];  // base64-encoded XDR ScVal[]
  value: string;    // base64-encoded XDR ScVal
}

interface BaseEvent {
  action: EventAction;
  ledger: number;
  eventIndex: number;
  timestamp: Date;
  rawId: string;
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

export type ParsedEvent =
  | CampaignCreatedEvent
  | CampaignInvestedEvent
  | CampaignSettledEvent
  | OrderCreatedEvent
  | OrderConfirmedEvent
  | GenericCampaignEvent;
