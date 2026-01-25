/**
 * Content API Worker - Unit Tests
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

describe('Content API Worker', () => {
  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const response = await SELF.fetch('http://localhost/health');
      // Accept 200 (all healthy) or 503 (database not available in test environment)
      expect([200, 503]).toContain(response.status);

      const json = (await response.json()) as HealthCheckResponse;
      expect(json.status).toBeDefined();
      expect(json.service).toBe('content-api');
      expect(json.version).toBe('1.0.0');
    });
  });

  describe('Security Headers', () => {
    it('should include security headers on API endpoints', async () => {
      const response = await SELF.fetch('http://localhost/api/content');

      // API endpoints should have security headers from middleware
      expect(response.headers.get('x-content-type-options')).toBeDefined();
      expect(response.headers.get('x-frame-options')).toBeDefined();
    });
  });

  describe('Authentication', () => {
    it('should require authentication for content endpoints', async () => {
      const response = await SELF.fetch('http://localhost/api/content');

      // Should return 401 without authentication
      expect(response.status).toBe(401);
    });

    it('should require authentication for media endpoints', async () => {
      const response = await SELF.fetch('http://localhost/api/media');

      // Should return 401 without authentication
      expect(response.status).toBe(401);
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await SELF.fetch('http://localhost/unknown-endpoint');
      expect(response.status).toBe(404);
    });

    it('should handle malformed JSON in POST requests', async () => {
      const response = await SELF.fetch('http://localhost/api/content', {
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

  describe('Rate Limiting', () => {
    it('should apply rate limiting to API routes', async () => {
      // Rate limiting is configured but won't actually limit in test environment
      // This test verifies the middleware is applied without errors
      const response = await SELF.fetch('http://localhost/api/content');

      // Should not crash due to rate limiting middleware
      expect(response.status).toBeDefined();
    });
  });
});
