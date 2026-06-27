# WebSocket Event Contract

This document describes the final, versioned WebSocket event format used for real-time updates in the Agrocylo platform.

## Event Envelope

All WebSocket events conform to the following TypeScript interface:

```typescript
interface WsEventEnvelope<T = unknown> {
  version: "1";
  type: WsEventType;
  payload: T;
  timestamp: string; // ISO 8601 format
}
```

## Event Types

### campaign.created
Emitted when a campaign is created (intent recorded, pending on-chain confirmation).

**Payload:**
```typescript
{
  id: string;              // Campaign UUID
  onChainId: string;       // "pending" until confirmed
  farmerAddress: string;   // Stellar address
  tokenAddress: string;    // Token contract address
  targetAmount: string;    // i128 amount as string
  deadline: DateTime;      // Campaign fundraising deadline
  createdAt: DateTime;
  updatedAt: DateTime;
}
```

### campaign.invested
Emitted when an investor makes a contribution (investment recorded, pending on-chain confirmation).

**Payload:**
```typescript
{
  campaignId: string;       // Campaign UUID
  investorAddress: string;  // Investor Stellar address
  amount: string;           // i128 amount as string
  totalRaised: string;      // Total raised so far
  txHash: string;           // Transaction hash
}
```

### campaign.settled
Emitted when a campaign is settled (revenue finalized on-chain).

**Payload:**
```typescript
{
  campaignId: string;       // Campaign UUID
  onChainId: string;        // On-chain campaign identifier
  totalRevenue: string;     // Total revenue as string
}
```

### order.created
Emitted when an order is created (intent recorded, pending on-chain confirmation).

**Payload:**
```typescript
{
  orderId: string;          // Order on-chain ID
  campaignId: string;       // Campaign UUID
  buyerAddress: string;     // Buyer Stellar address
  farmerAddress: string;    // Farmer Stellar address
  amount: string;           // i128 amount as string
  status: "PENDING";        // Always PENDING for intent
  txHash: string;           // Transaction hash
}
```

### order.confirmed
Emitted when an order is confirmed (confirmed on-chain).

**Payload:**
```typescript
{
  orderId: string;          // Order on-chain ID
  campaignId: string;       // Campaign UUID
  buyerAddress: string;     // Buyer Stellar address
  status: "CONFIRMED";      // Order confirmed status
  txHash: string;           // Transaction hash
}
```

## Broadcasting Behavior

- Events are broadcast to all connected WebSocket clients
- Broadcasting is **best-effort** — disconnected clients are skipped
- Clients that fall behind are subject to a per-client send queue (default: 100 messages)
- Oldest messages are dropped when a client's queue exceeds the limit
- Serialization errors are logged and do not crash the server

## Client Implementation

Clients should:
1. Parse the event envelope and check the `version` field
2. Pattern-match on the `type` field to determine event structure
3. Handle `timestamp` as an ISO 8601 string (may differ from server clock)
4. Treat events as idempotent notifications — use the database/REST API as the source of truth for state
5. Reconnect if the WebSocket connection drops; use REST endpoints to poll for missed updates

## Example

```json
{
  "version": "1",
  "type": "campaign.created",
  "payload": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "onChainId": "pending",
    "farmerAddress": "GAACCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    "tokenAddress": "GBDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
    "targetAmount": "1000000000000",
    "deadline": "2025-12-31T23:59:59Z",
    "createdAt": "2025-06-25T10:30:00Z",
    "updatedAt": "2025-06-25T10:30:00Z"
  },
  "timestamp": "2025-06-25T10:30:00.123Z"
}
```
