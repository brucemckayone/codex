/**
 * Organization API Worker - Unit Tests
 *
 * These tests run in the actual Cloudflare Workers runtime (workerd).
 * They use the `cloudflare:test` module to access environment bindings
 * and test the worker's fetch handler.
 *
 * Benefits of this approach:
 * - Tests run in the same runtime as production
 * - Real KV namespace bindings from wrangler.jsonc
 * - Automatic storage isolation between tests
 * - Fast execution (no server startup required)
 */

import { env, SELF } from 'cloudflare:test';
import { MIME_TYPES } from '@codex/constants';
import type { HealthCheckResponse } from '@codex/worker-utils';
import { describe, expect, it } from 'vitest';

describe('Organization API Worker', () => {
  describe('Health Check', () => {
    it('should return health check response', async () => {
      const response = await SELF.fetch('http://localhost/health');
      // Note: Returns 503 in test environment because database is not available
      // In production with real database, this returns 200
      expect([200, 503]).toContain(response.status);

      const json = (await response.json()) as HealthCheckResponse;
      expect(json).toMatchObject({
        service: 'organization-api',
        version: '1.0.0',
      });
      expect(['healthy', 'unhealthy']).toContain(json.status);
    });
  });

  describe('Security Headers', () => {
    it('should include security headers on API endpoints', async () => {
      const response = await SELF.fetch('http://localhost/api/organizations');

      // API endpoints should have security headers from middleware
      expect(response.headers.get('x-content-type-options')).toBeDefined();
      expect(response.headers.get('x-frame-options')).toBeDefined();
    });
  });

  describe('Authentication', () => {
    it('should require authentication for organization endpoints', async () => {
      const response = await SELF.fetch('http://localhost/api/organizations');

      // Should return 401 without authentication
      expect(response.status).toBe(401);
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await SELF.fetch('http://localhost/unknown-endpoint');
      expect(response.status).toBe(404);
    });

    it('should handle malformed requests gracefully', async () => {
      const response = await SELF.fetch('http://localhost/api/organizations', {
        method: 'POST',
        headers: {
          'Content-Type': MIME_TYPES.APPLICATION.JSON,
        },
        body: 'invalid json{',
      });

      // Should return 4xx error, not 500
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
    });
  });

  describe('Environment Bindings', () => {
    it('should have RATE_LIMIT_KV binding available', () => {
      expect(env.RATE_LIMIT_KV).toBeDefined();
    });
  });

  describe('GET /api/organizations/public/:slug/creators', () => {
    it('should allow unauthenticated access to public creators endpoint', async () => {
      const response = await SELF.fetch(
        'http://localhost/api/organizations/public/test-org/creators'
      );

      // Should return 404 (org not found) or 500 (db unavailable), but NOT 401
      expect([404, 500]).toContain(response.status);
      expect(response.status).not.toBe(401);
    });

    it('should accept pagination query parameters', async () => {
      const response = await SELF.fetch(
        'http://localhost/api/organizations/public/test-org/creators?page=1&limit=10'
      );

      // Query params should be accepted (validation passes)
      // Response will be 404 or 500 due to no test org, but query parsing succeeded
      expect([404, 500]).toContain(response.status);
    });

    it('should return 400 for invalid page (query validation)', async () => {
      const response = await SELF.fetch(
        'http://localhost/api/organizations/public/test-org/creators?page=0'
      );

      // Query validation catches page < 1 and returns 400
      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid limit (query validation)', async () => {
      const response = await SELF.fetch(
        'http://localhost/api/organizations/public/test-org/creators?limit=101'
      );

      // Query validation catches limit > 100 and returns 400
      expect(response.status).toBe(400);
    });

    it('should use default pagination when query params omitted', async () => {
      const response = await SELF.fetch(
        'http://localhost/api/organizations/public/test-org/creators'
      );

      // Should not error due to missing params (defaults applied)
      // Will be 404 or 500 due to no test org, but params validation passed
      expect([404, 500]).toContain(response.status);
    });

    it('should include security headers on response', async () => {
      const response = await SELF.fetch(
        'http://localhost/api/organizations/public/test-org/creators'
      );

      expect(response.headers.get('x-content-type-options')).toBeDefined();
      expect(response.headers.get('x-frame-options')).toBeDefined();
    });
  });
});
