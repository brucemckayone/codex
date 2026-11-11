/**
 * Stripe Webhook Handler - Unit Tests
 *
 * These tests run in the actual Cloudflare Workers runtime (workerd).
 * They use the `cloudflare:test` module to access environment bindings
 * and test the worker's fetch handler.
 */

import {
  createExecutionContext,
  env,
  SELF,
  waitOnExecutionContext,
} from 'cloudflare:test';
import type { HealthCheckResponse } from '@codex/worker-utils';
import { describe, expect, it } from 'vitest';
import worker from './index';

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
  //
  // The worker's env check runs on every request, before routing, and CI's
  // ecom-api test env has no payment, subscription or connect webhook secret
  // (generate-worker-dev-vars.sh writes only the booking one). Through SELF,
  // CI answered 500 to both requests. So these requests go to the worker's
  // own fetch with placeholder secrets, and get the same answer everywhere.
  describe('Retired customer webhook route', () => {
    const webhookEnv = {
      ...env,
      STRIPE_WEBHOOK_SECRET_PAYMENT: 'whsec_test_payment_placeholder',
      STRIPE_WEBHOOK_SECRET_SUBSCRIPTION: 'whsec_test_subscription_placeholder',
      STRIPE_WEBHOOK_SECRET_CONNECT: 'whsec_test_connect_placeholder',
    } as typeof env;

    async function postUnsigned(path: string): Promise<Response> {
      const ctx = createExecutionContext();
      const response = await worker.fetch(
        new Request(`http://localhost${path}`, { method: 'POST', body: '{}' }),
        webhookEnv,
        ctx
      );
      await waitOnExecutionContext(ctx);
      return response;
    }

    it('is not served', async () => {
      const live = await postUnsigned('/webhooks/stripe/subscription');
      expect(live.status).toBe(400);

      const retired = await postUnsigned('/webhooks/stripe/customer');
      expect(retired.status).toBe(404);
    });
  });
});
