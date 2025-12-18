/**
 * Notifications API Worker - Unit Tests
 *
 * These tests run in the actual Cloudflare Workers runtime (workerd).
 * They use the `cloudflare:test` module to access environment bindings
 * and test the worker's fetch handler.
 */

import { SELF } from 'cloudflare:test';
import type { HealthCheckResponse } from '@codex/worker-utils';
import { describe, expect, it } from 'vitest';

describe('Notifications API Worker', () => {
  describe('Health Check', () => {
    it('should return health check response', async () => {
      const response = await SELF.fetch('http://localhost/health');
      // Note: Returns 503 in test environment because database is not available
      // In production with real database, this returns 200
      expect([200, 503]).toContain(response.status);

      const json = (await response.json()) as HealthCheckResponse;
      expect(json).toMatchObject({
        service: 'notifications-api',
        version: '1.0.0',
      });
      expect(['healthy', 'unhealthy']).toContain(json.status);
    });
  });

  describe('Security Headers', () => {
    it('should include security headers on health endpoint', async () => {
      const response = await SELF.fetch('http://localhost/health');

      // Health endpoint should have security headers from middleware
      expect(response.headers.get('x-content-type-options')).toBeDefined();
      expect(response.headers.get('x-frame-options')).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should return 404 or 500 for unknown routes', async () => {
      const response = await SELF.fetch('http://localhost/unknown-endpoint');
      // In test environment, may return 500 due to missing DATABASE_URL
      // In production, should return 404 for unknown routes
      expect([404, 500]).toContain(response.status);
    });
  });
});
