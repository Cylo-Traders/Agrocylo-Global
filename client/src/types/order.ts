export type OrderStatus = "Pending" | "Completed" | "Refunded";

export interface Order {
  id: number;
  buyer: string;
  farmer: string;
  amount: string;
  timestamp: number;
  status: OrderStatus;
}