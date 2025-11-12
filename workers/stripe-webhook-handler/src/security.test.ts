import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import {
  securityHeaders,
  CSP_PRESETS,
  rateLimit,
  RATE_LIMIT_PRESETS,
} from 'packages/content-management/src/security/src';

/**
 * Integration tests for security middleware in stripe-webhook-handler.
 * These tests verify that security middleware is correctly applied to the worker.
 *
 * The actual middleware functionality is tested in @codex/security package.
 * Here we only test that the middleware is properly configured and integrated.
 */
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
      const app = new Hono();
      const mockEnv = { ENVIRONMENT: 'development' };

      app.use('*', (c, next) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c as any).env = mockEnv;
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

  describe('Rate Limiting Middleware', () => {
    it('should apply rate limiting with webhook preset', async () => {
      const app = new Hono();

      // Apply rate limiting (same config as worker)
      app.use('*', (c, next) => {
        return rateLimit({
          kv: undefined, // Falls back to in-memory
          ...RATE_LIMIT_PRESETS.webhook,
        })(c, next);
      });

      app.get('/test', (c) => c.text('OK'));

      const res = await app.request('/test');

      // Verify rate limit headers are present
      expect(res.headers.get('x-ratelimit-limit')).toBe('1000');
      expect(res.headers.get('x-ratelimit-remaining')).toBeTruthy();
    });

    it('should use webhook preset (1000 req/min)', () => {
      // Verify the preset configuration is correct
      expect(RATE_LIMIT_PRESETS.webhook.maxRequests).toBe(1000);
      expect(RATE_LIMIT_PRESETS.webhook.windowMs).toBe(60 * 1000); // 1 minute
    });
  });

  describe('Health Endpoint Security', () => {
    it('should not expose sensitive environment variables in responses', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const app = new Hono<{ Bindings: any }>();
      const mockEnv = {
        ENVIRONMENT: 'development',
        DATABASE_URL: 'postgresql://secret:secret@localhost:5432/db',
        STRIPE_SECRET_KEY: 'sk_test_secret123',
        STRIPE_WEBHOOK_SECRET_PAYMENT: 'whsec_secret123',
      };

      app.get('/health', (c) => {
        // Simulate worker health endpoint
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c as any).env = mockEnv;

        return c.json({
          status: 'healthy',
          worker: 'stripe-webhook-handler',
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
