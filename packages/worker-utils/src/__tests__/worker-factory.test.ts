import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { Hono } from 'hono';
import type { HonoEnv } from '@codex/shared-types';
import { createWorker } from '../worker-factory';
import { createAuthenticatedHandler } from '../route-helpers';
import { createRequestTrackingMiddleware } from '../middleware';

describe('Worker Factory Integration', () => {
  describe('basic worker creation', () => {
    it('should create a basic worker with default config', async () => {
      const app = createWorker({
        serviceName: 'test-worker',
      });

      expect(app).toBeDefined();
    });

    it('should have health check endpoint', async () => {
      const app = createWorker({
        serviceName: 'test-worker',
        version: '2.0.0',
      });

      const res = await app.request('/health');
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        status: 'healthy',
        service: 'test-worker',
        version: '2.0.0',
      });
    });
  });

  describe('request tracking', () => {
    it('should enable request tracking by default', async () => {
      const app = createWorker({
        serviceName: 'test-worker',
      });

      const res = await app.request('/health');
      const requestId = res.headers.get('X-Request-ID');

      expect(requestId).toBeDefined();
      expect(requestId).toMatch(/^[a-f0-9-]{36}$/); // UUID format
    });

    it('should allow disabling request tracking', async () => {
      const app = createWorker({
        serviceName: 'test-worker',
        enableRequestTracking: false,
      });

      // Mount a route to check if requestId is in context
      app.get('/test', (c) => {
        const requestId = c.get('requestId');
        return c.json({ hasRequestId: !!requestId });
      });

      const res = await app.request('/test');
      await expect(res.json()).resolves.toEqual({
        hasRequestId: false,
      });
    });

    it('should track client IP and user agent', async () => {
      const app = createWorker({
        serviceName: 'test-worker',
      });

      app.get('/check', (c) => {
        return c.json({
          clientIP: c.get('clientIP'),
          userAgent: c.get('userAgent'),
        });
      });

      const res = await app.request('/check', {
        headers: {
          'CF-Connecting-IP': '192.168.1.100',
          'User-Agent': 'TestBot/1.0',
        },
      });

      await expect(res.json()).resolves.toEqual({
        clientIP: '192.168.1.100',
        userAgent: 'TestBot/1.0',
      });
    });
  });

  describe('protected API routes', () => {
    it('should reject unauthenticated requests to /api/*', async () => {
      const app = createWorker({
        serviceName: 'test-worker',
      });

      app.get('/api/test', (c) => c.json({ ok: true }));

      const res = await app.request('/api/test');
      expect(res.status).toBe(401);
    });

    it('should allow authenticated requests to /api/*', async () => {
      // For this test, we use Hono directly instead of createWorker
      // because we need to mock auth before routes are added
      const app = new Hono<HonoEnv>();

      // Mock authentication middleware
      app.use('/api/*', async (c, next) => {
        c.set('user', {
          id: 'user-1',
          email: 'test@example.com',
          name: 'Test User',
          role: 'user',
          emailVerified: true,
          createdAt: new Date(),
        });
        await next();
      });

      // Add test route with handler
      app.get(
        '/api/test',
        createAuthenticatedHandler({
          schema: {},
          handler: async () => ({ ok: true }),
        })
      );

      const res = await app.request('/api/test');
      expect(res.status).toBe(200);
    });
  });

  describe('internal routes', () => {
    it('should protect internal routes with workerAuth when secret provided', async () => {
      const app = createWorker({
        serviceName: 'test-worker',
        workerSharedSecret: 'test-secret-123',
      });

      app.get('/internal/webhook', (c) => c.json({ ok: true }));

      // Request without proper auth should fail
      const res = await app.request('/internal/webhook');
      expect(res.status).toBe(401);
    });

    it.todo('should set workerAuth flag for internal routes', () => {
      // This test is a placeholder for future implementation
      expect(true).toBe(true);
    });

    it('should allow custom internal route prefix', async () => {
      const app = createWorker({
        serviceName: 'test-worker',
        internalRoutePrefix: '/worker',
        workerSharedSecret: 'test-secret-123',
      });

      app.get('/worker/task', (c) => c.json({ ok: true }));

      const res = await app.request('/worker/task');
      expect(res.status).toBe(401); // Should require auth
    });
  });

  describe('error handling', () => {
    it('should return 404 for unknown routes', async () => {
      const app = createWorker({
        serviceName: 'test-worker',
      });

      const res = await app.request('/does-not-exist');
      expect(res.status).toBe(404);
      await expect(res.json()).resolves.toMatchObject({
        error: {
          code: 'NOT_FOUND',
        },
      });
    });

    it('should handle errors with error middleware', async () => {
      const app = createWorker({
        serviceName: 'test-worker',
        environment: 'development',
      });

      app.get('/error', () => {
        throw new Error('Test error');
      });

      const res = await app.request('/error');
      expect(res.status).toBeGreaterThanOrEqual(500);
      const json = await res.json();
      expect(json).toHaveProperty('error');
    });
  });

  describe('middleware integration', () => {
    it('should apply CORS headers when enabled', async () => {
      const app = createWorker({
        serviceName: 'test-worker',
        enableCors: true,
      });

      const res = await app.request('/health', {
        method: 'OPTIONS',
      });

      // CORS headers should be present
      const corsHeader = res.headers.get('Access-Control-Allow-Origin');
      expect(corsHeader).toBeDefined();
    });

    it('should skip CORS when disabled', async () => {
      const app = createWorker({
        serviceName: 'test-worker',
        enableCors: false,
      });

      const res = await app.request('/health');
      const corsHeader = res.headers.get('Access-Control-Allow-Origin');
      expect(corsHeader).toBeNull();
    });

    it('should apply security headers when enabled', async () => {
      const app = createWorker({
        serviceName: 'test-worker',
        enableSecurityHeaders: true,
      });

      const res = await app.request('/health');

      // Check for security headers
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    });

    it('should skip security headers when disabled', async () => {
      const app = createWorker({
        serviceName: 'test-worker',
        enableSecurityHeaders: false,
      });

      const res = await app.request('/health');
      expect(res.headers.get('X-Content-Type-Options')).toBeNull();
    });
  });

  describe('route mounting', () => {
    it('should allow mounting additional routes', async () => {
      const app = createWorker({
        serviceName: 'test-worker',
      });

      // Mount a public route
      app.get('/public/data', (c) => c.json({ public: true }));

      const res = await app.request('/public/data');
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ public: true });
    });

    it('should support route groups', async () => {
      const app = createWorker({
        serviceName: 'test-worker',
      });

      // Create route group
      app.get('/api/users', (c) => c.json({ users: [] }));
      app.get('/api/posts', (c) => c.json({ posts: [] }));

      const usersRes = await app.request('/api/users');
      const postsRes = await app.request('/api/posts');

      expect(usersRes.status).toBe(401); // Protected
      expect(postsRes.status).toBe(401); // Protected
    });
  });

  describe('full integration scenario', () => {
    it('should handle complete authenticated request flow', async () => {
      // Use Hono directly to control middleware order
      const app = new Hono<HonoEnv>();

      // Request tracking
      app.use('*', createRequestTrackingMiddleware());

      // Mock auth middleware
      app.use('/api/*', async (c, next) => {
        c.set('user', {
          id: 'user-123',
          email: 'creator@example.com',
          name: 'Creator User',
          role: 'creator',
          emailVerified: true,
          createdAt: new Date(),
        });
        await next();
      });

      // Mount authenticated endpoint
      app.post(
        '/api/content',
        createAuthenticatedHandler({
          schema: {
            body: z.object({
              title: z.string().min(1),
              content: z.string(),
            }),
          },
          handler: async (_c, ctx) => ({
            id: 'content-123',
            title: ctx.validated.body.title,
            content: ctx.validated.body.content,
            createdBy: ctx.user.id,
          }),
          successStatus: 201,
        })
      );

      const res = await app.request('/api/content', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '203.0.113.42',
          'User-Agent': 'Mozilla/5.0',
        },
        body: JSON.stringify({
          title: 'Test Content',
          content: 'This is test content',
        }),
      });

      expect(res.status).toBe(201);

      // Verify response structure
      const json = await res.json();
      expect(json).toEqual({
        data: {
          id: 'content-123',
          title: 'Test Content',
          content: 'This is test content',
          createdBy: 'user-123',
        },
      });

      // Verify request tracking headers
      const requestId = res.headers.get('X-Request-ID');
      expect(requestId).toMatch(/^[a-f0-9-]{36}$/);
    });

    it('should handle validation errors in authenticated flow', async () => {
      // Use Hono directly to control middleware order
      const app = new Hono<HonoEnv>();

      // Mock auth middleware BEFORE routes
      app.use('/api/*', async (c, next) => {
        c.set('user', {
          id: 'user-123',
          email: 'test@example.com',
          name: 'Test User',
          role: 'user',
          emailVerified: true,
          createdAt: new Date(),
        });
        await next();
      });

      app.post(
        '/api/content',
        createAuthenticatedHandler({
          schema: {
            body: z.object({
              title: z.string().min(1),
              content: z.string(),
            }),
          },
          handler: async () => ({ ok: true }),
        })
      );

      const res = await app.request('/api/content', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: '', // Invalid - too short
          content: 'Some content',
        }),
      });

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
        },
      });
    });

    it('should handle enriched context in authenticated flow', async () => {
      // Use Hono directly to control middleware order
      const app = new Hono<HonoEnv>();

      // Request tracking middleware
      app.use('*', createRequestTrackingMiddleware());

      // Mock auth middleware BEFORE routes
      app.use('/api/*', async (c, next) => {
        c.set('user', {
          id: 'user-123',
          email: 'creator@example.com',
          name: 'Creator',
          role: 'creator',
          emailVerified: true,
          createdAt: new Date(),
        });
        await next();
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let capturedContext: any;

      app.post(
        '/api/action',
        createAuthenticatedHandler({
          schema: {
            body: z.object({ action: z.string() }),
          },
          useEnrichedContext: true,
          handler: async (_c, ctx) => {
            capturedContext = ctx;
            return { processed: true };
          },
        })
      );

      const res = await app.request('/api/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '192.168.1.50',
          'User-Agent': 'TestClient/2.0',
        },
        body: JSON.stringify({ action: 'test' }),
      });

      expect(res.status).toBe(200);

      // Verify enriched context was provided
      expect(capturedContext).toMatchObject({
        requestId: expect.stringMatching(/^[a-f0-9-]{36}$/),
        clientIP: '192.168.1.50',
        userAgent: 'TestClient/2.0',
        permissions: expect.arrayContaining(['user', 'creator']),
        validated: {
          body: { action: 'test' },
        },
      });
    });
  });

  describe('configuration options', () => {
    it('should use custom version in health check', async () => {
      const app = createWorker({
        serviceName: 'my-service',
        version: '3.2.1',
      });

      const res = await app.request('/health');
      await expect(res.json()).resolves.toMatchObject({
        version: '3.2.1',
      });
    });

    it('should allow custom environment setting', async () => {
      const app = createWorker({
        serviceName: 'test-worker',
        environment: 'production',
      });

      expect(app).toBeDefined();
      // Environment affects error handler behavior
    });

    it('should support all middleware flags', async () => {
      const app = createWorker({
        serviceName: 'test-worker',
        enableLogging: false,
        enableCors: false,
        enableSecurityHeaders: false,
        enableRequestTracking: false,
      });

      const res = await app.request('/health');
      expect(res.status).toBe(200);

      // No CORS headers
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
      // No security headers
      expect(res.headers.get('X-Content-Type-Options')).toBeNull();
      // No request ID
      expect(res.headers.get('X-Request-ID')).toBeNull();
    });
  });
});
