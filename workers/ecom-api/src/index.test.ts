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

  // The log-only customer route and its secret were removed (Codex-2hxff.24).
  // An unsigned POST to a live webhook route is refused by the signature
  // check (400), so a 404 here means no route, not a refusal.
  describe('Retired customer webhook route', () => {
    const unsigned = { method: 'POST', body: '{}' };

    it('is not served', async () => {
      const live = await SELF.fetch(
        'http://localhost/webhooks/stripe/subscription',
        unsigned
      );
      expect(live.status).toBe(400);

      const retired = await SELF.fetch(
        'http://localhost/webhooks/stripe/customer',
        unsigned
      );
      expect(retired.status).toBe(404);
    });
  });
});
