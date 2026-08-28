import {
  CSP_PRESETS,
  RATE_LIMIT_PRESETS,
  securityHeaders,
} from '@codex/security';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

/**
 * Integration tests for security middleware in ecom-api.
 * These tests verify that security middleware is correctly applied to the worker.
 *
 * The actual middleware functionality is tested in @codex/security package.
 * Here we only test that the middleware is properly configured and integrated.
 */

// Test environment bindings type
type TestEnv = {
  ENVIRONMENT?: string;
  DATABASE_URL?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET_PAYMENT?: string;
};
describe('Stripe Webhook Handler - Security Integration', () => {
  describe('Security Headers Middleware', () => {
    it('should apply security headers middleware to all routes', async () => {
      const app = new Hono();

      // Mock environment
      const mockEnv = { ENVIRONMENT: 'development' };

      // Apply security headers (same config as worker)
      app.use('*', (c, next) => {
        // Simulate worker environment binding
        c.env = mockEnv;
        return securityHeaders({
          environment: mockEnv.ENVIRONMENT || 'development',
          csp: CSP_PRESETS.api,
        })(c, next);
      });

      app.get('/test', (c) => c.text('OK'));

      const res = await app.request('/test');

      // Verify middleware is applied
      expect(res.status).toBe(200);
      expect(res.headers.get('x-frame-options')).toBeTruthy();
      expect(res.headers.get('content-security-policy')).toBeTruthy();
    });

    it('should use API CSP preset for restrictive policy', async () => {
      const app = new Hono<{ Bindings: TestEnv }>();
      const mockEnv: TestEnv = { ENVIRONMENT: 'development' };

      app.use('*', (c, next) => {
        c.env = mockEnv;
        return securityHeaders({
          environment: mockEnv.ENVIRONMENT || 'development',
          csp: CSP_PRESETS.api,
        })(c, next);
      });

      app.get('/test', (c) => c.text('OK'));

      const res = await app.request('/test');
      const csp = res.headers.get('content-security-policy') || '';

      // API preset should be very restrictive
      expect(csp).toContain("default-src 'none'");
    });
  });

  describe('Rate Limiting', () => {
    // This worker deliberately mounts NO rate-limit middleware any more
    // (Codex-kgrdp.17). The Stripe webhook is authenticated by its HMAC
    // signature, so a per-IP cap adds no security and can only reject a
    // legitimate retry burst — which is why the `webhook` preset was deleted
    // rather than re-pointed at the new substrate. Its mutation routes are
    // capped by the `strict` preset they declare, enforced by procedure()
    // (see routes/__tests__/rate-limits.test.ts).
    it('does not offer a webhook preset to re-mount on /webhooks/*', () => {
      expect(RATE_LIMIT_PRESETS).not.toHaveProperty('webhook');
    });
  });

  describe('Health Endpoint Security', () => {
    it('should not expose sensitive environment variables in responses', async () => {
      const app = new Hono<{ Bindings: TestEnv }>();
      const mockEnv: TestEnv = {
        ENVIRONMENT: 'development',
        DATABASE_URL: 'postgresql://secret:secret@localhost:5432/db',
        STRIPE_SECRET_KEY: 'sk_test_secret123',
        STRIPE_WEBHOOK_SECRET_PAYMENT: 'whsec_secret123',
      };

      app.get('/health', (c) => {
        // Simulate worker health endpoint
        c.env = mockEnv;

        return c.json({
          status: 'healthy',
          worker: 'ecom-api',
          environment: c.env.ENVIRONMENT || 'development',
          timestamp: new Date().toISOString(),
          // ❌ BAD: These should NOT be included
          // config: c.env,
          // DATABASE_URL: c.env.DATABASE_URL,
        });
      });

      const res = await app.request('/health');
      const body = await res.json();

      // Verify sensitive data is NOT exposed
      expect(body).not.toHaveProperty('DATABASE_URL');
      expect(body).not.toHaveProperty('STRIPE_SECRET_KEY');
      expect(body).not.toHaveProperty('config');
      expect(body).toHaveProperty('status');
      expect(body).toHaveProperty('timestamp');
    });
  });

  describe('CSP Presets', () => {
    it('should have API preset configured', () => {
      expect(CSP_PRESETS.api).toBeDefined();
      expect(CSP_PRESETS.api.defaultSrc).toContain("'none'");
    });

    it('should have Stripe preset available for future use', () => {
      expect(CSP_PRESETS.stripe).toBeDefined();
      expect(CSP_PRESETS.stripe.scriptSrc).toContain('https://js.stripe.com');
    });
  });
});
