export type IndexedEventType =
  | "campaign.created"
  | "campaign.invested"
  | "campaign.settled"
  | "order.created"
  | "order.confirmed";

export interface IndexedEvent {
  sourceEventId: string;
  eventType: IndexedEventType;
  entity: "campaign" | "order";
  action: "created" | "invested" | "settled" | "confirmed";
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
