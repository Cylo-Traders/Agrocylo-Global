import type { BuyerIntent } from "./demand";

export type IntentResponseStatus =
  | "draft"
  | "pending"
  | "accepted"
  | "rejected"
  | "cancelled"
  | "countered";

export interface IntentResponse {
  id: string;
  intentId: string;
  sellerAddress: string;
  pricePerUnit: number;
  quantityAvailable: number;
  proposedDeliveryDate: string;
  message?: string;
  status: IntentResponseStatus;
  createdAt: string;
  updatedAt: string;
  history?: IntentResponseHistoryItem[];
}

export interface IntentResponseHistoryItem {
  status: IntentResponseStatus;
  pricePerUnit: number;
  quantityAvailable: number;
  proposedDeliveryDate: string;
  message?: string;
  timestamp: string;
}
