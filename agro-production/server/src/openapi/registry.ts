import {
  OpenAPIRegistry,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import {
  CampaignIdParamSchema,
  CreateCampaignSchema,
  InvestSchema,
  ListCampaignsQuerySchema,
  ListInvestmentsQuerySchema,
} from "../schemas/campaign.js";
import {
  CampaignImageParamSchema,
  CampaignImageUploadResponseSchema,
} from "../schemas/campaignImage.js";
import {
  HealthResponseSchema,
  LivezResponseSchema,
  ReadyzResponseSchema,
} from "../schemas/health.js";
import {
  ConfirmOrderSchema,
  CreateOrderSchema,
  ListOrdersQuerySchema,
  OrderIdParamSchema,
} from "../schemas/order.js";
import {
  CampaignDetailSchema,
  CampaignListResponseSchema,
  CampaignSchema,
  InvestmentSchema,
  OrderSchema,
  ProblemDetailSchema,
  ValidationErrorSchema,
} from "../schemas/responses.js";
import {
  TransactionIntentCreateSchema,
  TransactionRequestIdParamSchema,
  TransactionStatusResponseSchema,
  TransactionStatusUpdateSchema,
  TransactionReconciliationResponseSchema,
} from "../schemas/transaction.js";
import {
  ProductIdParamSchema,
  ProductListResponseSchema,
  ProductQuerySchema,
  ProductSchema,
} from "../schemas/product.js";

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

// Auth schemas
const ChallengeRequestSchema = z.object({
  walletAddress: z.string().openapi({ description: "Stellar wallet address" }),
});

const ChallengeResponseSchema = z.object({
  nonce: z.string().openapi({ description: "Challenge nonce for signing" }),
  expiresAt: z.string().openapi({ description: "ISO 8601 expiration timestamp" }),
});

const SessionRequestSchema = z.object({
  walletAddress: z.string().openapi({ description: "Stellar wallet address" }),
  nonce: z.string().openapi({ description: "Challenge nonce from /auth/nonce" }),
  signature: z.string().openapi({ description: "Signed nonce (base64)" }),
});

const SessionResponseSchema = z.object({
  sessionToken: z.string().openapi({ description: "JWT session token" }),
  walletAddress: z.string().openapi({ description: "Authenticated wallet address" }),
  expiresAt: z.string().openapi({ description: "ISO 8601 token expiration" }),
});

const RevokeSessionBodySchema = z.object({
  sessionToken: z.string().openapi({ description: "Session token to revoke" }),
});

const problemResponse = {
  description: "RFC 7807 problem detail",
  content: { "application/problem+json": { schema: ProblemDetailSchema } },
};

const validationResponse = {
  description: "Request validation failed",
  content: { "application/problem+json": { schema: ValidationErrorSchema } },
};

registry.registerPath({
  method: "get",
  path: "/api/v1/products",
  tags: ["Products"],
  summary: "List sellable marketplace products",
  request: { query: ProductQuerySchema },
  responses: {
    200: {
      description: "Canonical product summaries",
      content: { "application/json": { schema: ProductListResponseSchema } },
    },
    400: validationResponse,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/products/{id}",
  tags: ["Products"],
  summary: "Get a canonical marketplace product",
  request: { params: ProductIdParamSchema },
  responses: {
    200: {
      description: "Canonical product detail",
      content: { "application/json": { schema: ProductSchema } },
    },
    404: problemResponse,
  },
});

// Authentication endpoints
registry.registerPath({
  method: "get",
  path: "/auth/nonce",
  tags: ["Authentication"],
  summary: "Request a challenge nonce for wallet signing",
  request: {
    query: ChallengeRequestSchema,
  },
  responses: {
    200: {
      description: "Challenge created, ready to sign",
      content: { "application/json": { schema: ChallengeResponseSchema } },
    },
    400: validationResponse,
    429: {
      description: "Rate limit exceeded",
      content: { "application/json": { schema: z.object({ error: z.string() }) } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/session",
  tags: ["Authentication"],
  summary: "Exchange signed nonce for session token",
  request: {
    body: { content: { "application/json": { schema: SessionRequestSchema } } },
  },
  responses: {
    200: {
      description: "Session created",
      content: { "application/json": { schema: SessionResponseSchema } },
    },
    400: validationResponse,
    401: problemResponse,
    429: {
      description: "Rate limit exceeded",
      content: { "application/json": { schema: z.object({ error: z.string() }) } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/revoke",
  tags: ["Authentication"],
  summary: "Revoke a session token",
  request: {
    body: { content: { "application/json": { schema: RevokeSessionBodySchema } } },
  },
  responses: {
    204: { description: "Session revoked" },
    400: validationResponse,
    429: {
      description: "Rate limit exceeded",
      content: { "application/json": { schema: z.object({ error: z.string() }) } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/health",
  tags: ["Health"],
  summary: "Service health check",
  responses: {
    200: {
      description: "Service is running",
      content: { "application/json": { schema: HealthResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/livez",
  tags: ["Health"],
  summary: "Liveness probe",
  responses: {
    200: {
      description: "Service is alive",
      content: { "application/json": { schema: LivezResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/readyz",
  tags: ["Health"],
  summary: "Readiness probe",
  responses: {
    200: {
      description: "Service is ready",
      content: { "application/json": { schema: ReadyzResponseSchema } },
    },
    503: {
      description: "Service is not ready",
      content: { "application/json": { schema: ReadyzResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/campaigns",
  tags: ["Campaigns"],
  summary: "List campaigns",
  request: { query: ListCampaignsQuerySchema },
  responses: {
    200: {
      description: "Paginated campaign list",
      content: { "application/json": { schema: CampaignListResponseSchema } },
    },
    400: validationResponse,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/campaigns/{id}",
  tags: ["Campaigns"],
  summary: "Get campaign by ID",
  request: { params: CampaignIdParamSchema },
  responses: {
    200: {
      description: "Campaign detail",
      content: { "application/json": { schema: CampaignDetailSchema } },
    },
    400: validationResponse,
    404: problemResponse,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/campaigns",
  tags: ["Campaigns"],
  summary: "Create campaign metadata",
  request: { body: { content: { "application/json": { schema: CreateCampaignSchema } } } },
  responses: {
    201: {
      description: "Campaign created",
      content: { "application/json": { schema: CampaignSchema } },
    },
    400: validationResponse,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/campaigns/{id}/investments",
  tags: ["Investments"],
  summary: "List investments for a campaign",
  request: { params: CampaignIdParamSchema },
  responses: {
    200: {
      description: "Investment list",
      content: { "application/json": { schema: z.array(InvestmentSchema) } },
    },
    400: validationResponse,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/investments",
  tags: ["Investments"],
  summary: "List investments for an investor",
  request: { query: ListInvestmentsQuerySchema },
  responses: {
    200: {
      description: "Investment list",
      content: { "application/json": { schema: z.array(InvestmentSchema) } },
    },
    400: validationResponse,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/campaigns/{id}/invest",
  tags: ["Investments"],
  summary: "Record an investment",
  request: {
    params: CampaignIdParamSchema,
    body: { content: { "application/json": { schema: InvestSchema } } },
  },
  responses: {
    201: {
      description: "Investment recorded",
      content: { "application/json": { schema: InvestmentSchema } },
    },
    400: validationResponse,
    404: problemResponse,
    409: problemResponse,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/orders",
  tags: ["Orders"],
  summary: "List orders by buyer or farmer",
  request: { query: ListOrdersQuerySchema },
  responses: {
    200: {
      description: "Order list",
      content: { "application/json": { schema: z.array(OrderSchema) } },
    },
    400: validationResponse,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/orders",
  tags: ["Orders"],
  summary: "Create order",
  request: { body: { content: { "application/json": { schema: CreateOrderSchema } } } },
  responses: {
    201: {
      description: "Order created",
      content: { "application/json": { schema: OrderSchema } },
    },
    400: validationResponse,
    404: problemResponse,
    409: problemResponse,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/orders/{id}",
  tags: ["Orders"],
  summary: "Get order by ID",
  request: { params: OrderIdParamSchema },
  responses: {
    200: {
      description: "Order detail",
      content: { "application/json": { schema: OrderSchema } },
    },
    400: validationResponse,
    404: problemResponse,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/orders/{id}/confirm",
  tags: ["Orders"],
  summary: "Confirm order delivery",
  request: {
    params: OrderIdParamSchema,
    body: { content: { "application/json": { schema: ConfirmOrderSchema } } },
  },
  responses: {
    200: {
      description: "Order confirmed",
      content: { "application/json": { schema: OrderSchema } },
    },
    400: validationResponse,
    403: problemResponse,
    404: problemResponse,
    409: problemResponse,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/transactions",
  tags: ["Transactions"],
  summary: "Submit a transaction intent for tracking",
  request: {
    headers: z.object({
      "x-wallet-address": z.string().openapi({ description: "Initiator Stellar wallet address" }),
    }),
    body: {
      content: { "application/json": { schema: TransactionIntentCreateSchema } },
    },
  },
  responses: {
    201: {
      description: "Transaction intent submitted",
      content: { "application/json": { schema: TransactionStatusResponseSchema } },
    },
    202: {
      description: "Transaction intent accepted (async processing)",
      content: { "application/json": { schema: TransactionStatusResponseSchema } },
    },
    400: validationResponse,
    409: problemResponse,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/transactions",
  tags: ["Transactions"],
  summary: "List transactions for the authenticated wallet",
  request: {
    headers: z.object({
      "x-wallet-address": z.string().openapi({ description: "Initiator Stellar wallet address" }),
    }),
  },
  responses: {
    200: {
      description: "Transaction list",
      content: { "application/json": { schema: z.array(TransactionStatusResponseSchema) } },
    },
    400: validationResponse,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/transactions/{requestId}",
  tags: ["Transactions"],
  summary: "Get transaction status by request ID",
  request: { params: TransactionRequestIdParamSchema },
  responses: {
    200: {
      description: "Transaction status",
      content: { "application/json": { schema: TransactionStatusResponseSchema } },
    },
    400: validationResponse,
    404: problemResponse,
  },
});

registry.registerPath({
  method: "post",
  path: "/campaigns/{campaign_id}/image",
  tags: ["Campaign Images"],
  summary: "Upload campaign image",
  request: {
    params: CampaignImageParamSchema,
    headers: z.object({
      "x-wallet-address": z.string().openapi({ description: "Farmer Stellar wallet" }),
    }),
  },
  responses: {
    200: {
      description: "Image uploaded",
      content: { "application/json": { schema: CampaignImageUploadResponseSchema } },
    },
    400: validationResponse,
    401: problemResponse,
    415: problemResponse,
  },
});

registry.registerPath({
  method: "delete",
  path: "/campaigns/{campaign_id}/image",
  tags: ["Campaign Images"],
  summary: "Delete campaign image",
  request: {
    params: CampaignImageParamSchema,
    headers: z.object({
      "x-wallet-address": z.string().openapi({ description: "Farmer Stellar wallet" }),
    }),
  },
  responses: {
    204: { description: "Image deleted" },
    400: validationResponse,
    401: problemResponse,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/transactions/{requestId}/status",
  tags: ["Transactions"],
  summary: "Update transaction status",
  request: {
    params: TransactionRequestIdParamSchema,
    body: { content: { "application/json": { schema: TransactionStatusUpdateSchema } } },
  },
  responses: {
    200: {
      description: "Transaction status updated",
      content: { "application/json": { schema: TransactionStatusResponseSchema } },
    },
    400: validationResponse,
    403: problemResponse,
    404: problemResponse,
    409: problemResponse,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/transactions/{requestId}/reconcile",
  tags: ["Transactions"],
  summary: "Reconcile transaction against indexer data",
  request: { params: TransactionRequestIdParamSchema },
  responses: {
    200: {
      description: "Reconciliation result",
      content: { "application/json": { schema: TransactionReconciliationResponseSchema } },
    },
    400: validationResponse,
    404: problemResponse,
  },
});
