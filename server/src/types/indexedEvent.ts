export type IndexedEventType =
  | "campaign.created"
  | "campaign.invested"
  | "campaign.settled"
  | "order.created"
  | "order.delivered"
  | "order.confirmed"
  | "order.refunded";

export interface IndexedEvent {
  sourceEventId: string;
  eventType: IndexedEventType;
  entity: "campaign" | "order";
  action: "created" | "invested" | "settled" | "delivered" | "confirmed" | "refunded";
  ledger: number;
  eventIndex: number;
  timestamp: Date;
  txHash?: string;
  campaignIdOnChain?: string;
  orderIdOnChain?: string;
  actorAddress?: string;
  secondaryAddress?: string;
  amount?: string;
  token?: string;
  status?: string;
  payload: unknown;
}
