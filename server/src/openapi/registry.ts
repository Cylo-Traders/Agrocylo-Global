/**
 * OpenAPI Registry — centralized registration of all API endpoints with Zod schemas.
 *
 * Routes register their endpoints here with request/response schemas to enable:
 * - Automatic API documentation generation (/openapi.json)
 * - Swagger UI (/api-docs)
 * - CI checks that verify all mounted routes are documented
 * - Runtime validation of request/response shapes
 */

import type { ZodSchema } from 'zod';

export interface OpenAPIEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';
  path: string;
  summary: string;
  description?: string;
  tags?: string[];
  authentication?: 'Bearer' | 'None';
  requestSchema?: ZodSchema;
  responseSchema?: ZodSchema;
  parameters?: OpenAPIParameter[];
  statusCode?: number;
}

export interface OpenAPIParameter {
  name: string;
  in: 'query' | 'path' | 'header' | 'cookie';
  required?: boolean;
  schema?: { type: string; format?: string; enum?: string[] };
  description?: string;
}

class OpenAPIRegistry {
  private endpoints: Map<string, OpenAPIEndpoint> = new Map();

  register(endpoint: OpenAPIEndpoint): void {
    const key = `${endpoint.method} ${endpoint.path}`;
    this.endpoints.set(key, endpoint);
  }

  registerBatch(endpoints: OpenAPIEndpoint[]): void {
    for (const endpoint of endpoints) {
      this.register(endpoint);
    }
  }

  getEndpoints(): OpenAPIEndpoint[] {
    return Array.from(this.endpoints.values());
  }

  getEndpointsByTag(tag: string): OpenAPIEndpoint[] {
    return this.getEndpoints().filter((e) => e.tags?.includes(tag));
  }

  /**
   * Convert registry to OpenAPI 3.0.3 spec.
   * Note: The resulting spec structure is compatible with OpenAPI 3.0.3,
   * but actual validation against OpenAPI validators requires a real CI run.
   */
  toOpenAPI(): Record<string, unknown> {
    const paths: Record<string, Record<string, unknown>> = {};
    const _schemas: Record<string, unknown> = {};

    for (const endpoint of this.getEndpoints()) {
      if (!paths[endpoint.path]) {
        paths[endpoint.path] = {};
      }

      const methodKey = endpoint.method.toLowerCase();
      const operationId = `${endpoint.method.toLowerCase()}${endpoint.path.replace(/[^a-zA-Z0-9]/g, '_')}`;

      const operation: Record<string, unknown> = {
        summary: endpoint.summary,
        operationId,
        tags: endpoint.tags || ['default'],
      };

      if (endpoint.description) {
        operation.description = endpoint.description;
      }

      if (endpoint.authentication === 'Bearer') {
        operation.security = [{ bearerAuth: [] }];
      }

      if (endpoint.parameters && endpoint.parameters.length > 0) {
        operation.parameters = endpoint.parameters.map((p) => ({
          name: p.name,
          in: p.in,
          required: p.required ?? false,
          schema: p.schema || { type: 'string' },
          description: p.description,
        }));
      }

      if (endpoint.requestSchema) {
        operation.requestBody = {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RequestBody' },
            },
          },
        };
      }

      const statusCode = String(endpoint.statusCode || 200);
      if (endpoint.responseSchema) {
        operation.responses = {
          [statusCode]: {
            description: `Successful response (${statusCode})`,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ResponseBody' },
              },
            },
          },
          default: {
            description: 'Error response (RFC 7807)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ProblemDetail' },
              },
            },
          },
        };
      } else {
        operation.responses = {
          [statusCode]: { description: endpoint.summary },
          default: {
            description: 'Error response (RFC 7807)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ProblemDetail' },
              },
            },
          },
        };
      }

      (paths[endpoint.path] ??= {})[methodKey] = operation;
    }

    return {
      openapi: '3.0.3',
      info: {
        title: 'Agrocylo Backend API',
        description:
          'Decentralized agricultural marketplace with escrow contracts on Stellar Soroban',
        version: '1.0.0',
        contact: {
          name: 'Agrocylo Team',
        },
      },
      servers: [
        {
          url: 'https://api.agrocylo.com',
          description: 'Production API',
        },
        {
          url: 'http://localhost:5000',
          description: 'Local development API',
        },
      ],
      paths,
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Bearer token authentication (wallet signature)',
          },
        },
        schemas: {
          ProblemDetail: {
            type: 'object',
            description: 'RFC 7807 Problem Detail object',
            required: ['type', 'status'],
            properties: {
              type: {
                type: 'string',
                format: 'uri',
                description: 'URI reference to the problem type',
              },
              status: {
                type: 'integer',
                description: 'HTTP status code',
              },
              title: {
                type: 'string',
                description: 'Short, human-readable summary',
              },
              detail: {
                type: 'string',
                description: 'Human-readable explanation specific to this occurrence',
              },
              instance: {
                type: 'string',
                format: 'uri',
                description: 'URI reference to the specific occurrence',
              },
            },
          },
          RequestBody: {
            type: 'object',
            description: 'Request body schema (varies per endpoint)',
          },
          ResponseBody: {
            type: 'object',
            description: 'Response body schema (varies per endpoint)',
          },
        },
      },
      tags: [
        { name: 'products', description: 'Product listings and catalog' },
        { name: 'orders', description: 'Order management and fulfillment' },
        { name: 'campaigns', description: 'Campaign and group buying' },
        { name: 'disputes', description: 'Dispute resolution' },
        { name: 'notifications', description: 'User notifications' },
        { name: 'admin', description: 'Admin-only endpoints' },
        { name: 'auth', description: 'Authentication endpoints' },
        { name: 'default', description: 'Other endpoints' },
      ],
    };
  }
}

export const registry = new OpenAPIRegistry();
