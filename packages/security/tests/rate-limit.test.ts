import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { RATE_LIMIT_PRESETS, rateLimit } from '../src/rate-limit';

describe('Rate Limiting Middleware', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
  });

  describe('In-Memory Rate Limiting (without KV)', () => {
    it('should allow requests under the limit', async () => {
      app.use(
        '*',
        rateLimit({
          windowMs: 60000,
          maxRequests: 5,
        })
      );
      app.get('/', (c) => c.text('OK'));

      // Make 5 requests (should all succeed)
      for (let i = 0; i < 5; i++) {
        const res = await app.request('/');
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('OK');
      }
    });

    it('should block requests over the limit', async () => {
      app.use(
        '*',
        rateLimit({
          windowMs: 60000,
          maxRequests: 3,
        })
      );
      app.get('/', (c) => c.text('OK'));

      // Make 4 requests (4th should be rate limited)
      for (let i = 0; i < 4; i++) {
        const res = await app.request('/');

        if (i < 3) {
          expect(res.status).toBe(200);
        } else {
          expect(res.status).toBe(429);
          const body = await res.json();
          expect(body).toHaveProperty('error', 'Too many requests');
          expect(body).toHaveProperty('retryAfter');
        }
      }
    });

    it('should include rate limit headers in response', async () => {
      app.use(
        '*',
        rateLimit({
          windowMs: 60000,
          maxRequests: 10,
        })
      );
      app.get('/', (c) => c.text('OK'));

      const res = await app.request('/');

      expect(res.headers.get('x-ratelimit-limit')).toBe('10');
      expect(res.headers.get('x-ratelimit-remaining')).toBe('9');
      expect(res.headers.get('x-ratelimit-reset')).toBeTruthy();
    });

    it('should decrement remaining count with each request', async () => {
      app.use(
        '*',
        rateLimit({
          windowMs: 60000,
          maxRequests: 5,
        })
      );
      app.get('/', (c) => c.text('OK'));

      for (let i = 0; i < 3; i++) {
        const res = await app.request('/');
        const remaining = parseInt(
          res.headers.get('x-ratelimit-remaining') || '0',
          10
        );
        expect(remaining).toBe(5 - (i + 1));
      }
    });
  });

  describe('Custom Key Generator', () => {
    it('should use custom key generator for rate limiting', async () => {
      app.use(
        '*',
        rateLimit({
          windowMs: 60000,
          maxRequests: 2,
          keyGenerator: (c) => {
            // Rate limit by user ID instead of IP
            return c.req.header('user-id') || 'anonymous';
          },
        })
      );
      app.get('/', (c) => c.text('OK'));

      // User A makes 2 requests (should hit limit)
      const req1 = await app.request('/', { headers: { 'user-id': 'user-a' } });
      const req2 = await app.request('/', { headers: { 'user-id': 'user-a' } });
      const req3 = await app.request('/', { headers: { 'user-id': 'user-a' } });

      expect(req1.status).toBe(200);
      expect(req2.status).toBe(200);
      expect(req3.status).toBe(429);

      // User B should have separate limit
      const reqB1 = await app.request('/', {
        headers: { 'user-id': 'user-b' },
      });
      expect(reqB1.status).toBe(200);
    });
  });

  describe('Skip Function', () => {
    it('should skip rate limiting when skip function returns true', async () => {
      app.use(
        '*',
        rateLimit({
          windowMs: 60000,
          maxRequests: 2,
          skip: (c) => {
            // Skip rate limiting for admin users
            return c.req.header('admin') === 'true';
          },
        })
      );
      app.get('/', (c) => c.text('OK'));

      // Admin user should bypass rate limit
      for (let i = 0; i < 5; i++) {
        const res = await app.request('/', { headers: { admin: 'true' } });
        expect(res.status).toBe(200);
      }

      // Normal user should hit rate limit
      const res1 = await app.request('/');
      const res2 = await app.request('/');
      const res3 = await app.request('/');

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res3.status).toBe(429);
    });
  });

  describe('Custom Handler', () => {
    it('should use custom handler when rate limit is exceeded', async () => {
      app.use(
        '*',
        rateLimit({
          windowMs: 60000,
          maxRequests: 1,
          handler: (c) => {
            return c.json({ custom: 'error', message: 'Slow down!' }, 403);
          },
        })
      );
      app.get('/', (c) => c.text('OK'));

      const res1 = await app.request('/');
      const res2 = await app.request('/');

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(403);

      const body = await res2.json();
      expect(body).toHaveProperty('custom', 'error');
      expect(body).toHaveProperty('message', 'Slow down!');
    });
  });

  describe('Rate Limit Presets', () => {
    it('should apply auth preset (5 req / 15min)', () => {
      expect(RATE_LIMIT_PRESETS.auth.windowMs).toBe(15 * 60 * 1000);
      expect(RATE_LIMIT_PRESETS.auth.maxRequests).toBe(5);
    });

    it('should apply API preset (100 req / 1min)', () => {
      expect(RATE_LIMIT_PRESETS.api.windowMs).toBe(60 * 1000);
      expect(RATE_LIMIT_PRESETS.api.maxRequests).toBe(100);
    });

    it('should apply webhook preset (1000 req / 1min)', () => {
      expect(RATE_LIMIT_PRESETS.webhook.windowMs).toBe(60 * 1000);
      expect(RATE_LIMIT_PRESETS.webhook.maxRequests).toBe(1000);
    });

    it('should apply web preset (300 req / 1min)', () => {
      expect(RATE_LIMIT_PRESETS.web.windowMs).toBe(60 * 1000);
      expect(RATE_LIMIT_PRESETS.web.maxRequests).toBe(300);
    });
  });

  describe('Integration with Routes', () => {
    it('should apply different rate limits to different routes', async () => {
      const strictLimiter = rateLimit({ windowMs: 60000, maxRequests: 1 });
      const lenientLimiter = rateLimit({ windowMs: 60000, maxRequests: 10 });

      app.use('/strict', strictLimiter);
      app.use('/lenient', lenientLimiter);

      app.get('/strict', (c) => c.text('Strict'));
      app.get('/lenient', (c) => c.text('Lenient'));

      // Strict endpoint should rate limit after 1 request
      const strict1 = await app.request('/strict');
      const strict2 = await app.request('/strict');
      expect(strict1.status).toBe(200);
      expect(strict2.status).toBe(429);

      // Lenient endpoint should still allow requests
      const lenient1 = await app.request('/lenient');
      const lenient2 = await app.request('/lenient');
      expect(lenient1.status).toBe(200);
      expect(lenient2.status).toBe(200);
    });

    it('should isolate rate limits between different endpoints', async () => {
      app.use(
        '*',
        rateLimit({
          windowMs: 60000,
          maxRequests: 2,
        })
      );
      app.get('/login', (c) => c.text('Login'));
      app.get('/register', (c) => c.text('Register'));

      // Should rate limit per path (default behavior with IP + path key)
      const login1 = await app.request('/login');
      const login2 = await app.request('/login');
      const login3 = await app.request('/login');

      expect(login1.status).toBe(200);
      expect(login2.status).toBe(200);
      expect(login3.status).toBe(429); // Rate limited

      // Register endpoint should have separate limit
      const register1 = await app.request('/register');
      expect(register1.status).toBe(200);
    });
  });

  describe('Retry-After Header', () => {
    it('should include Retry-After header when rate limited', async () => {
      app.use(
        '*',
        rateLimit({
          windowMs: 60000,
          maxRequests: 1,
        })
      );
      app.get('/', (c) => c.text('OK'));

      await app.request('/'); // First request
      const res2 = await app.request('/'); // Second request should be rate limited

      expect(res2.status).toBe(429);
      expect(res2.headers.get('retry-after')).toBeTruthy();

      const retryAfter = parseInt(res2.headers.get('retry-after') || '0', 10);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(60); // Should be within window
    });
  });
});
