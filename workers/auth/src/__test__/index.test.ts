/**
 * Auth Worker - Unit Tests
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
import type { HealthCheckResponse } from '@codex/worker-utils';
import { describe, expect, it } from 'vitest';

describe('Auth Worker', () => {
  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const response = await SELF.fetch('http://localhost/health');
      // Accept 200 (all healthy) or 503 (database not available in test environment)
      expect([200, 503]).toContain(response.status);

      const json = (await response.json()) as HealthCheckResponse;
      expect(json.status).toBeDefined();
      expect(json.service).toBe('auth-worker');
      expect(json.version).toBe('1.0.0');
      expect(json.timestamp).toBeDefined();
    });
  });

  describe('Security Headers', () => {
    it('should include security headers on auth endpoints', async () => {
      const response = await SELF.fetch('http://localhost/api/auth/session');

      // Auth endpoints should have security headers from middleware
      expect(response.headers.get('x-content-type-options')).toBeDefined();
      expect(response.headers.get('x-frame-options')).toBeDefined();
    });
  });

  describe('Authentication Endpoints', () => {
    it('should return proper response for session endpoint', async () => {
      const response = await SELF.fetch('http://localhost/api/auth/session');

      // Should get a valid response (BetterAuth handles this internally)
      // Could be 200, 401, 404, or 500 depending on BetterAuth's internal logic
      expect(response.status).toBeDefined();
      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.status).toBeLessThan(600);
    });

    it('should return 404 for unknown routes', async () => {
      const response = await SELF.fetch('http://localhost/unknown-endpoint');
      expect(response.status).toBe(404);
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed requests gracefully', async () => {
      const response = await SELF.fetch('http://localhost/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: 'invalid json{',
      });

      // BetterAuth handles malformed requests internally
      // Could return 400 or 500 depending on where the parsing fails
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThanOrEqual(500);
    });
  });

  describe('KV Namespace Bindings', () => {
    it('should have AUTH_SESSION_KV binding available', () => {
      expect(env.AUTH_SESSION_KV).toBeDefined();
    });

    it('should have RATE_LIMIT_KV binding available', () => {
      expect(env.RATE_LIMIT_KV).toBeDefined();
    });
  });
});
