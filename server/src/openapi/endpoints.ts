/**
 * Core OpenAPI endpoint definitions for all API routes.
 *
 * This file defines all mounted endpoints with their schemas, authentication,
 * and documentation. Endpoints are organized by route module and registered
 * with the OpenAPI registry at server startup.
 */

import type { OpenAPIEndpoint } from './registry.js';
import { registry } from './registry.js';

// ──────────────────────────────────────────────────────────────────────────
// Authentication Endpoints
// ──────────────────────────────────────────────────────────────────────────

export const authEndpoints: OpenAPIEndpoint[] = [
  {
    method: 'POST',
    path: '/auth/challenge',
    summary: 'Get signing challenge for wallet authentication',
    description: 'Initiates wallet authentication by returning a challenge message to sign',
    tags: ['auth'],
    authentication: 'None',
    statusCode: 200,
  },
  {
    method: 'POST',
    path: '/auth/verify',
    summary: 'Verify signed challenge and issue auth token',
    description: 'Verifies a signed challenge and returns a JWT token for subsequent requests',
    tags: ['auth'],
    authentication: 'None',
    statusCode: 200,
  },
];

// ──────────────────────────────────────────────────────────────────────────
// Product Endpoints
// ──────────────────────────────────────────────────────────────────────────

export const productEndpoints: OpenAPIEndpoint[] = [
  {
    method: 'GET',
    path: '/products',
    summary: 'List all products with optional filtering',
    description:
      'Retrieve paginated product listings with filters for farmer, category, and search',
    tags: ['products'],
    authentication: 'None',
    parameters: [
      { name: 'farmer', in: 'query', description: 'Filter by farmer wallet address' },
      { name: 'category', in: 'query', description: 'Filter by product category' },
      {
        name: 'page',
        in: 'query',
        schema: { type: 'integer' },
        description: 'Page number (default: 1)',
      },
      {
        name: 'limit',
        in: 'query',
        schema: { type: 'integer' },
        description: 'Items per page (default: 20, max: 100)',
      },
    ],
    statusCode: 200,
  },
  {
    method: 'POST',
    path: '/products',
    summary: 'Create new product listing',
    description: 'Create a new product listing (must be authenticated as farmer)',
    tags: ['products'],
    authentication: 'Bearer',
    statusCode: 201,
  },
  {
    method: 'GET',
    path: '/products/:id',
    summary: 'Get product details',
    description: 'Retrieve detailed information about a specific product',
    tags: ['products'],
    authentication: 'None',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
    ],
    statusCode: 200,
  },
  {
    method: 'PATCH',
    path: '/products/:id',
    summary: 'Update product listing',
    description: 'Update a product listing (only the farmer owner can update)',
    tags: ['products'],
    authentication: 'Bearer',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
    ],
    statusCode: 200,
  },
  {
    method: 'POST',
    path: '/products/:product_id/image',
    summary: 'Upload product image',
    description: 'Upload an image for a product listing (multipart/form-data)',
    tags: ['products'],
    authentication: 'Bearer',
    statusCode: 200,
  },
];

// ──────────────────────────────────────────────────────────────────────────
// Cart Endpoints
// ──────────────────────────────────────────────────────────────────────────

export const cartEndpoints: OpenAPIEndpoint[] = [
  {
    method: 'GET',
    path: '/cart',
    summary: 'Get active cart for authenticated user',
    description: 'Retrieve the current shopping cart',
    tags: ['orders'],
    authentication: 'Bearer',
    statusCode: 200,
  },
  {
    method: 'POST',
    path: '/cart/items',
    summary: 'Add item to cart',
    description: 'Add a product to the shopping cart',
    tags: ['orders'],
    authentication: 'Bearer',
    statusCode: 200,
  },
  {
    method: 'DELETE',
    path: '/cart/items/:id',
    summary: 'Remove item from cart',
    description: 'Remove a product from the shopping cart',
    tags: ['orders'],
    authentication: 'Bearer',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
    ],
    statusCode: 200,
  },
  {
    method: 'POST',
    path: '/cart/checkout',
    summary: 'Checkout cart and create orders',
    description: 'Convert cart items into orders with escrow payment',
    tags: ['orders'],
    authentication: 'Bearer',
    statusCode: 200,
  },
];

// ──────────────────────────────────────────────────────────────────────────
// Order Endpoints
// ──────────────────────────────────────────────────────────────────────────

export const orderEndpoints: OpenAPIEndpoint[] = [
  {
    method: 'GET',
    path: '/orders',
    summary: 'List orders for authenticated user',
    description: 'Retrieve paginated list of orders for the authenticated wallet',
    tags: ['orders'],
    authentication: 'Bearer',
    parameters: [
      { name: 'page', in: 'query', schema: { type: 'integer' } },
      { name: 'limit', in: 'query', schema: { type: 'integer' } },
      { name: 'status', in: 'query', description: 'Filter by order status' },
    ],
    statusCode: 200,
  },
  {
    method: 'GET',
    path: '/orders/:id',
    summary: 'Get order details',
    description: 'Retrieve detailed information about a specific order',
    tags: ['orders'],
    authentication: 'Bearer',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
    ],
    statusCode: 200,
  },
  {
    method: 'POST',
    path: '/orders/:id/confirm-delivery',
    summary: 'Confirm order delivery',
    description: 'Mark an order as delivered (buyer action)',
    tags: ['orders'],
    authentication: 'Bearer',
    statusCode: 200,
  },
];

// ──────────────────────────────────────────────────────────────────────────
// Notification Endpoints
// ──────────────────────────────────────────────────────────────────────────

export const notificationEndpoints: OpenAPIEndpoint[] = [
  {
    method: 'GET',
    path: '/notifications',
    summary: 'List user notifications',
    description: 'Retrieve paginated notifications for the authenticated user',
    tags: ['notifications'],
    authentication: 'Bearer',
    parameters: [
      { name: 'unread_only', in: 'query', schema: { type: 'boolean' } },
      { name: 'limit', in: 'query', schema: { type: 'integer' } },
    ],
    statusCode: 200,
  },
  {
    method: 'PATCH',
    path: '/notifications/:id/read',
    summary: 'Mark notification as read',
    description: 'Mark a single notification as read',
    tags: ['notifications'],
    authentication: 'Bearer',
    statusCode: 204,
  },
];

// ──────────────────────────────────────────────────────────────────────────
// Dispute Endpoints
// ──────────────────────────────────────────────────────────────────────────

export const disputeEndpoints: OpenAPIEndpoint[] = [
  {
    method: 'GET',
    path: '/disputes',
    summary: 'List disputes',
    description: 'Retrieve paginated list of disputes (admin or involved party)',
    tags: ['disputes'],
    authentication: 'Bearer',
    statusCode: 200,
  },
  {
    method: 'POST',
    path: '/disputes',
    summary: 'Create dispute',
    description: 'Raise a dispute on an order (buyer or seller)',
    tags: ['disputes'],
    authentication: 'Bearer',
    statusCode: 201,
  },
  {
    method: 'GET',
    path: '/disputes/:id',
    summary: 'Get dispute details',
    description: 'Retrieve details of a specific dispute',
    tags: ['disputes'],
    authentication: 'Bearer',
    statusCode: 200,
  },
];

// ──────────────────────────────────────────────────────────────────────────
// Admin Endpoints (including Reconciliation from #796)
// ──────────────────────────────────────────────────────────────────────────

export const adminEndpoints: OpenAPIEndpoint[] = [
  {
    method: 'POST',
    path: '/admin/reconciliation/run',
    summary: 'Trigger manual reconciliation run',
    description: 'Manually trigger a reconciliation check between chain state and DB (admin only)',
    tags: ['admin'],
    authentication: 'Bearer',
    statusCode: 200,
  },
  {
    method: 'GET',
    path: '/admin/reconciliation/alerts',
    summary: 'List reconciliation alerts',
    description: 'Retrieve paginated reconciliation alerts and drift findings (admin only)',
    tags: ['admin'],
    authentication: 'Bearer',
    parameters: [
      { name: 'page', in: 'query', schema: { type: 'integer' } },
      { name: 'limit', in: 'query', schema: { type: 'integer' } },
      { name: 'resolved', in: 'query', schema: { type: 'boolean' } },
      { name: 'driftType', in: 'query' },
    ],
    statusCode: 200,
  },
  {
    method: 'GET',
    path: '/admin/reconciliation/summary',
    summary: 'Get reconciliation summary',
    description: 'Retrieve summary statistics about reconciliation alerts (admin only)',
    tags: ['admin'],
    authentication: 'Bearer',
    statusCode: 200,
  },
  {
    method: 'POST',
    path: '/admin/reconciliation/alerts/:id/resolve',
    summary: 'Resolve reconciliation alert',
    description: 'Mark a reconciliation alert as resolved and add notes (admin only)',
    tags: ['admin'],
    authentication: 'Bearer',
    statusCode: 200,
  },
];

// ──────────────────────────────────────────────────────────────────────────
// Register all endpoints
// ──────────────────────────────────────────────────────────────────────────

export function registerAllEndpoints(): void {
  registry.registerBatch(authEndpoints);
  registry.registerBatch(productEndpoints);
  registry.registerBatch(cartEndpoints);
  registry.registerBatch(orderEndpoints);
  registry.registerBatch(notificationEndpoints);
  registry.registerBatch(disputeEndpoints);
  registry.registerBatch(adminEndpoints);
}
