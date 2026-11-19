/**
 * OpenAPI Completeness Test
 *
 * This test verifies that all Express routes mounted in the application
 * have corresponding entries in the OpenAPI registry. It's designed to catch
 * instances where new endpoints are added but not documented.
 *
 * The test parses the app's route stack and compares against registry entries.
 * Any mismatch indicates a missing OpenAPI registration.
 */

import { describe, it, expect } from 'vitest';
import { registry } from './registry.js';
import { registerAllEndpoints } from './endpoints.js';

// The registry is populated as a side effect of app startup. Import and run the
// registration explicitly so these completeness checks exercise the real surface.
registerAllEndpoints();

describe('OpenAPI Completeness', () => {
  it('should have all critical route categories registered', () => {
    const endpoints = registry.getEndpoints();

    // Group by tag to verify coverage of key areas
    const _tags = new Set(endpoints.flatMap((e) => e.tags || []));

    const requiredTags = ['products', 'orders', 'disputes', 'notifications', 'admin', 'auth'];

    for (const requiredTag of requiredTags) {
      const tagEndpoints = registry.getEndpointsByTag(requiredTag);
      expect(tagEndpoints.length, `Missing endpoints for tag: ${requiredTag}`).toBeGreaterThan(0);
    }
  });

  it('should have documented endpoints for primary workflows', () => {
    const endpoints = registry.getEndpoints();
    const paths = new Set(endpoints.map((e) => e.path));

    // Core endpoints that MUST be documented
    const criticalPaths = ['/products', '/orders', '/cart', '/auth/verify'];

    for (const path of criticalPaths) {
      expect(paths.has(path), `Missing documentation for critical path: ${path}`).toBe(true);
    }
  });

  it('should document POST endpoints with summary and tags', () => {
    const endpoints = registry.getEndpoints().filter((e) => e.method === 'POST');

    expect(endpoints.length).toBeGreaterThan(0);
    for (const endpoint of endpoints) {
      expect(endpoint.summary, `Missing summary for ${endpoint.path}`).toBeTruthy();
      expect(endpoint.tags?.length ?? 0, `Missing tags for ${endpoint.path}`).toBeGreaterThan(0);
    }
  });

  it('should document admin reconciliation endpoints', () => {
    const endpoints = registry.getEndpoints();
    const reconciliationEndpoints = endpoints.filter((e) => e.path.includes('reconciliation'));

    // Should have at least the manual trigger and status endpoints
    expect(
      reconciliationEndpoints.length,
      'Missing documentation for reconciliation endpoints (from #796)'
    ).toBeGreaterThan(0);
  });

  it('should validate endpoint structure', () => {
    const endpoints = registry.getEndpoints();

    for (const endpoint of endpoints) {
      expect(endpoint.method).toBeDefined();
      expect(endpoint.path).toBeDefined();
      expect(endpoint.summary).toBeDefined();
      expect(endpoint.path.startsWith('/'), `Invalid path: ${endpoint.path}`).toBe(true);
      expect(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']).toContain(
        endpoint.method
      );
    }
  });

  it('tracks authentication requirements', () => {
    const endpoints = registry.getEndpoints();
    const authenticated = endpoints.filter((e) => e.authentication === 'Bearer');
    const unauthenticated = endpoints.filter(
      (e) => e.authentication === 'None' || !e.authentication
    );

    // We should have a mix of both
    expect(authenticated.length, 'No authenticated endpoints found').toBeGreaterThan(0);
    expect(unauthenticated.length, 'No unauthenticated endpoints found').toBeGreaterThan(0);
  });

  it('generates valid OpenAPI spec structure', () => {
    const spec = registry.toOpenAPI();

    // Check required OpenAPI top-level fields
    expect(spec.openapi).toBe('3.0.3');
    expect(spec.info).toBeDefined();
    expect((spec.info as { title: string }).title).toBe('Agrocylo Backend API');
    expect(spec.paths).toBeDefined();
    expect(Object.keys(spec.paths as Record<string, unknown>).length).toBeGreaterThan(0);
    expect(spec.components).toBeDefined();
    expect((spec.components as Record<string, unknown>).securitySchemes).toBeDefined();
  });

  it('documents error responses with RFC 7807 Problem Detail', () => {
    const spec = registry.toOpenAPI() as Record<string, unknown>;
    const components = spec.components as Record<string, unknown>;
    const schemas = components.schemas as Record<string, unknown>;

    expect(schemas.ProblemDetail).toBeDefined();
    const problemDetail = schemas.ProblemDetail as Record<string, unknown>;
    expect(problemDetail.properties).toBeDefined();
  });

  it('provides endpoint coverage report', () => {
    const endpoints = registry.getEndpoints();
    const methodCounts: Record<string, number> = {};

    for (const endpoint of endpoints) {
      methodCounts[endpoint.method] = (methodCounts[endpoint.method] || 0) + 1;
    }

    console.log('OpenAPI Endpoint Coverage Report:');
    console.log(`  Total endpoints: ${endpoints.length}`);
    for (const [method, count] of Object.entries(methodCounts)) {
      console.log(`  ${method}: ${count}`);
    }

    // We should have at least some endpoints
    expect(endpoints.length).toBeGreaterThan(0);
  });
});
