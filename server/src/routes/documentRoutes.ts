/**
 * Documentation routes — serves OpenAPI spec and interactive API documentation.
 *
 * - GET /openapi.json — OpenAPI 3.0.3 specification
 * - GET /api-docs — Swagger UI for interactive API exploration
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { registry } from '../openapi/registry.js';

const router = Router();

/**
 * OpenAPI spec endpoint — serves the complete API specification.
 *
 * This endpoint is used by:
 * - API documentation generators
 * - Code generation tools (OpenAPI Generator, Swagger CodeGen)
 * - Integration testing frameworks
 * - API gateway configurations
 */
router.get('/openapi.json', (_req: Request, res: Response) => {
  const spec = registry.toOpenAPI();
  res.setHeader('Content-Type', 'application/json');
  res.json(spec);
});

/**
 * Swagger UI — interactive API documentation.
 *
 * Browse all endpoints, their schemas, and test requests directly.
 * Hosted at /api-docs with Swagger UI embedded.
 */
router.get('/api-docs', (_req: Request, res: Response) => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Agrocylo API Documentation</title>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@4.15.5/swagger-ui.css">
      </head>
      <body>
        <div id="swagger-ui"></div>
        <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@4.15.5/swagger-ui.bundle.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@4.15.5/swagger-ui-standalone-preset.js"></script>
        <script>
          window.onload = () => {
            window.ui = SwaggerUIBundle({
              url: "/openapi.json",
              dom_id: "#swagger-ui",
              presets: [
                SwaggerUIBundle.presets.apis,
                SwaggerUIStandalonePreset
              ],
              plugins: [
                SwaggerUIBundle.plugins.DownloadUrl
              ],
              layout: "BaseLayout",
            });
          };
        </script>
      </body>
    </html>
  `;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

/**
 * Redoc alternative — another interactive API documentation option.
 * Lighter weight than Swagger UI, good for static hosting.
 */
router.get('/api-docs-redoc', (_req: Request, res: Response) => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Agrocylo API Documentation</title>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link href="https://fonts.googleapis.com/css?family=Montserrat:300,400,700|Roboto:300,400,700" rel="stylesheet">
        <style>
          body {
            margin: 0;
            padding: 0;
          }
        </style>
      </head>
      <body>
        <redoc spec-url="/openapi.json"></redoc>
        <script src="https://cdn.jsdelivr.net/npm/redoc@latest/bundles/redoc.standalone.js"></script>
      </body>
    </html>
  `;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

export default router;
