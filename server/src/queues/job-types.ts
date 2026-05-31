export interface IndexContractEventsJobData {
  eventType: string;
  eventData: unknown;
  ledger: string;
  eventIndex: number;
  timestamp: string;
}

export interface IndexProductDataJobData {
  productId: string;
  action: "create" | "update" | "delete";
  data?: Record<string, unknown>;
}

export interface AggregateMetricsJobData {
  metricName: string;
  granularity: "hourly" | "daily" | "weekly";
  startDate: string;
  endDate: string;
}

export interface GenerateReportJobData {
  reportType: "sales" | "inventory" | "demand" | "supply";
  parameters: Record<string, unknown>;
}

export interface SendEmailJobData {
  to: string;
  subject: string;
  body: string;
  html?: string;
}

export interface SendPushJobData {
  walletAddress: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface SendWebSocketJobData {
  event: string;
  data: unknown;
  wallets?: string[];
}
