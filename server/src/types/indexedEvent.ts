export type IndexedEventType =
  | 'campaign.created'
  | 'campaign.invested'
  | 'campaign.settled'
  | 'order.created'
  | 'order.delivered'
  | 'order.confirmed'
  | 'order.refunded'
  | 'basket.funded'
  | 'basket.skipped';

export interface IndexedEvent {
  sourceEventId: string;
  eventType: IndexedEventType;
  entity: 'campaign' | 'order' | 'basket';
  action:
    | 'created'
    | 'invested'
    | 'settled'
    | 'delivered'
    | 'confirmed'
    | 'refunded'
    | 'funded'
    | 'skipped';
  ledger: number;
  eventIndex: number;
  timestamp: Date;
  txHash?: string;
  campaignIdOnChain?: string;
  orderIdOnChain?: string;
  basketIdOnChain?: string;
  actorAddress?: string;
  secondaryAddress?: string;
  amount?: string;
  token?: string;
  totalInvested?: string;
  totalSkipped?: string;
  schemaVersion?: string;
  status?: string;
  payload: unknown;
}
