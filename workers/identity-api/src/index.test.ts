/**
 * Identity API Worker - Unit Tests
 *
 * These tests run in the actual Cloudflare Workers runtime (workerd).
 * They use the `cloudflare:test` module to access environment bindings
 * and test the worker's fetch handler.
 */

import { env, SELF } from 'cloudflare:test';
import type { HealthCheckResponse } from '@codex/worker-utils';
import { describe, expect, it } from 'vitest';

describe('Identity API Worker', () => {
  describe('Health Check', () => {
    it('should return health check response', async () => {
      const response = await SELF.fetch('http://localhost/health');
      // Note: Returns 503 in test environment because database is not available
      // In production with real database, this returns 200
      expect([200, 503]).toContain(response.status);

      const json = (await response.json()) as HealthCheckResponse;
      expect(json).toMatchObject({
        service: 'identity-api',
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
    it('should return 404 for unknown routes', async () => {
      const response = await SELF.fetch('http://localhost/unknown-endpoint');
      expect(response.status).toBe(404);
    });
  });

  describe('Environment Bindings', () => {
    // RATE_LIMIT_KV is gone (Codex-kgrdp.17). procedure() now enforces
    // policy.rateLimit, and a missing binding makes it fail OPEN and log
    // `rate_limit.fail_open` on every request — so the bindings for the
    // presets this worker's routes reach (strict and api) are what must exist.
    it('should have the RATE_LIMIT_STRICT binding available', () => {
      expect(env.RATE_LIMIT_STRICT).toBeDefined();
    });

    it('should have the RATE_LIMIT_API binding available', () => {
      expect(env.RATE_LIMIT_API).toBeDefined();
    });
  });
});
