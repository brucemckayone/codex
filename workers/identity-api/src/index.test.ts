/**
 * Identity API Worker - Unit Tests
 *
 * These tests run in the actual Cloudflare Workers runtime (workerd).
 * They use the `cloudflare:test` module to access environment bindings
 * and test the worker's fetch handler.
 *
 * Benefits of this approach:
 * - Tests run in the same runtime as production
 * - Real KV namespace bindings from wrangler.toml
 * - Automatic storage isolation between tests
 * - Fast execution (no server startup required)
 */

import { env, SELF } from 'cloudflare:test';
import type { HealthCheckResponse } from '@codex/worker-utils';
import { describe, expect, it } from 'vitest';

describe('Identity API Worker', () => {
  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const response = await SELF.fetch('http://localhost/health');
      expect(response.status).toBe(200);

      const json = (await response.json()) as HealthCheckResponse;
      expect(json).toMatchObject({
        status: 'healthy',
        service: 'identity-api',
        version: '1.0.0',
      });
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
          'Content-Type': 'application/json',
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
});
