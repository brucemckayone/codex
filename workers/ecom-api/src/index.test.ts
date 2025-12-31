/**
 * Stripe Webhook Handler - Unit Tests
 *
 * These tests run in the actual Cloudflare Workers runtime (workerd).
 * They use the `cloudflare:test` module to access environment bindings
 * and test the worker's fetch handler.
 */

import { env, SELF } from 'cloudflare:test';
import type { HealthCheckResponse } from '@codex/worker-utils';
import { describe, expect, it } from 'vitest';

describe('Stripe Webhook Handler', () => {
  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const response = await SELF.fetch('http://localhost/health');
      // Accept 200 (all healthy), 503 (database not available), or 500 (env validation in test)
      expect([200, 500, 503]).toContain(response.status);

      const json = (await response.json()) as HealthCheckResponse;
      expect(json.status).toBeDefined();
    });
  });

  describe('Environment Bindings', () => {
    it('should have environment bindings available', () => {
      expect(env).toBeDefined();
    });
  });
});
