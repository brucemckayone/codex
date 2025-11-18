import type { HonoEnv } from '@codex/shared-types';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createAuthenticatedHandler,
  formatValidationError,
  withErrorHandling,
} from '../route-helpers';

describe('Route Helpers', () => {
  describe('formatValidationError', () => {
    it('should format Zod validation errors correctly', () => {
      const schema = z.object({
        name: z.string().min(1),
        age: z.number().min(0),
      });

      const result = schema.safeParse({ name: '', age: -1 });
      if (!result.success) {
        const formatted = formatValidationError(result.error);

        expect(formatted).toEqual({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
            details: expect.arrayContaining([
              expect.objectContaining({
                path: 'name',
                message: expect.any(String),
              }),
              expect.objectContaining({
                path: 'age',
                message: expect.any(String),
              }),
            ]),
          },
        });
      }
    });

    it('should format nested validation errors', () => {
      const schema = z.object({
        user: z.object({
          email: z.string().email(),
        }),
      });

      const result = schema.safeParse({ user: { email: 'invalid' } });
      if (!result.success) {
        const formatted = formatValidationError(result.error);

        expect(formatted.error.details).toContainEqual(
          expect.objectContaining({
            path: 'user.email',
          })
        );
      }
    });
  });

  describe('createAuthenticatedHandler', () => {
    let app: Hono<HonoEnv>;

    beforeEach(() => {
      app = new Hono<HonoEnv>();
    });

    describe('authentication', () => {
      it('should reject request without user', async () => {
        app.get(
          '/',
          createAuthenticatedHandler({
            schema: {},
            handler: async () => ({ ok: true }),
          })
        );

        const res = await app.request('/');
        expect(res.status).toBe(401);
        await expect(res.json()).resolves.toMatchObject({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        });
      });

      it('should allow request with authenticated user', async () => {
        app.use('*', async (c, next) => {
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

        app.get(
          '/',
          createAuthenticatedHandler({
            schema: {},
            handler: async () => ({ ok: true }),
          })
        );

        const res = await app.request('/');
        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({
          data: { ok: true },
        });
      });
    });

    describe('params validation', () => {
      beforeEach(() => {
        app.use('*', async (c, next) => {
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
      });

      it('should validate params schema', async () => {
        const idSchema = z.object({
          id: z.string().uuid(),
        });

        app.get(
          '/:id',
          createAuthenticatedHandler({
            schema: {
              params: idSchema,
            },
            handler: async (_c, ctx) => ({
              id: ctx.validated.params.id,
            }),
          })
        );

        const validId = '123e4567-e89b-12d3-a456-426614174000';
        const res = await app.request(`/${validId}`);

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({
          data: { id: validId },
        });
      });

      it('should reject invalid params', async () => {
        const idSchema = z.object({
          id: z.string().uuid(),
        });

        app.get(
          '/:id',
          createAuthenticatedHandler({
            schema: {
              params: idSchema,
            },
            handler: async (_c, ctx) => ({
              id: ctx.validated.params.id,
            }),
          })
        );

        const res = await app.request('/invalid-uuid');
        expect(res.status).toBe(400);
        await expect(res.json()).resolves.toMatchObject({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
          },
        });
      });
    });

    describe('query validation', () => {
      beforeEach(() => {
        app.use('*', async (c, next) => {
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
      });

      it('should validate query parameters', async () => {
        const querySchema = z.object({
          page: z.coerce.number().min(1),
          limit: z.coerce.number().min(1).max(100),
        });

        app.get(
          '/',
          createAuthenticatedHandler({
            schema: {
              query: querySchema,
            },
            handler: async (_c, ctx) => ({
              page: ctx.validated.query.page,
              limit: ctx.validated.query.limit,
            }),
          })
        );

        const res = await app.request('/?page=2&limit=20');
        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({
          data: { page: 2, limit: 20 },
        });
      });

      it('should coerce query string values', async () => {
        const querySchema = z.object({
          page: z.coerce.number().min(1),
        });

        app.get(
          '/',
          createAuthenticatedHandler({
            schema: {
              query: querySchema,
            },
            handler: async (_c, ctx) => ({
              page: ctx.validated.query.page,
              type: typeof ctx.validated.query.page,
            }),
          })
        );

        const res = await app.request('/?page=5');
        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({
          data: { page: 5, type: 'number' },
        });
      });
    });

    describe('body validation', () => {
      beforeEach(() => {
        app.use('*', async (c, next) => {
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
      });

      it('should validate request body when body schema provided', async () => {
        const bodySchema = z.object({
          title: z.string().min(1),
          content: z.string(),
        });

        app.post(
          '/',
          createAuthenticatedHandler({
            schema: {
              body: bodySchema,
            },
            handler: async (_c, ctx) => ({
              title: ctx.validated.body.title,
              content: ctx.validated.body.content,
            }),
            successStatus: 201,
          })
        );

        const res = await app.request('/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: 'Test Title',
            content: 'Test Content',
          }),
        });

        expect(res.status).toBe(201);
        await expect(res.json()).resolves.toEqual({
          data: {
            title: 'Test Title',
            content: 'Test Content',
          },
        });
      });

      it('should reject invalid JSON body', async () => {
        const bodySchema = z.object({
          title: z.string(),
        });

        app.post(
          '/',
          createAuthenticatedHandler({
            schema: {
              body: bodySchema,
            },
            handler: async () => ({ ok: true }),
          })
        );

        const res = await app.request('/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: 'invalid json',
        });

        expect(res.status).toBe(400);
        await expect(res.json()).resolves.toMatchObject({
          error: {
            code: 'INVALID_JSON',
            message: 'Request body must be valid JSON',
          },
        });
      });

      it('should reject invalid body data', async () => {
        const bodySchema = z.object({
          email: z.string().email(),
          age: z.number().min(0),
        });

        app.post(
          '/',
          createAuthenticatedHandler({
            schema: {
              body: bodySchema,
            },
            handler: async () => ({ ok: true }),
          })
        );

        const res = await app.request('/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: 'not-an-email',
            age: -5,
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

      it('should not parse body when no body schema provided', async () => {
        app.get(
          '/',
          createAuthenticatedHandler({
            schema: {},
            handler: async () => ({ ok: true }),
          })
        );

        // GET request with body should still work (body ignored)
        const res = await app.request('/');
        expect(res.status).toBe(200);
      });
    });

    describe('combined validation', () => {
      beforeEach(() => {
        app.use('*', async (c, next) => {
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
      });

      it('should validate params, query, and body together', async () => {
        app.patch(
          '/:id',
          createAuthenticatedHandler({
            schema: {
              params: z.object({ id: z.string().uuid() }),
              query: z.object({ notify: z.coerce.boolean() }),
              body: z.object({ title: z.string() }),
            },
            handler: async (_c, ctx) => ({
              id: ctx.validated.params.id,
              notify: ctx.validated.query.notify,
              title: ctx.validated.body.title,
            }),
          })
        );

        const validId = '123e4567-e89b-12d3-a456-426614174000';
        const res = await app.request(`/${validId}?notify=true`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ title: 'Updated Title' }),
        });

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({
          data: {
            id: validId,
            notify: true,
            title: 'Updated Title',
          },
        });
      });
    });

    describe('success status', () => {
      beforeEach(() => {
        app.use('*', async (c, next) => {
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
      });

      it('should return 200 by default', async () => {
        app.get(
          '/',
          createAuthenticatedHandler({
            schema: {},
            handler: async () => ({ ok: true }),
          })
        );

        const res = await app.request('/');
        expect(res.status).toBe(200);
      });

      it('should return 201 for creation', async () => {
        app.post(
          '/',
          createAuthenticatedHandler({
            schema: {},
            handler: async () => ({ id: '123' }),
            successStatus: 201,
          })
        );

        const res = await app.request('/', { method: 'POST' });
        expect(res.status).toBe(201);
      });

      it('should return 204 No Content', async () => {
        app.delete(
          '/:id',
          createAuthenticatedHandler({
            schema: {
              params: z.object({ id: z.string() }),
            },
            handler: async () => null,
            successStatus: 204,
          })
        );

        const res = await app.request('/123', { method: 'DELETE' });
        expect(res.status).toBe(204);
        expect(await res.text()).toBe('');
      });
    });

    describe('enriched context', () => {
      beforeEach(() => {
        app.use('*', async (c, next) => {
          c.set('user', {
            id: 'user-1',
            email: 'test@example.com',
            name: 'Test User',
            role: 'creator',
            emailVerified: true,
            createdAt: new Date(),
          });
          c.set('requestId', 'req-123');
          c.set('clientIP', '192.168.1.1');
          await next();
        });
      });

      it('should provide enriched context when enabled', async () => {
        // biome-ignore lint/suspicious/noExplicitAny: Test needs to capture dynamic context for assertion
        let capturedContext: any;

        app.post(
          '/',
          createAuthenticatedHandler({
            schema: {
              body: z.object({ title: z.string() }),
            },
            useEnrichedContext: true,
            handler: async (_c, ctx) => {
              capturedContext = ctx;
              return { ok: true };
            },
          })
        );

        const res = await app.request('/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'TestBot/1.0',
          },
          body: JSON.stringify({ title: 'Test' }),
        });

        expect(res.status).toBe(200);
        expect(capturedContext).toMatchObject({
          requestId: 'req-123',
          clientIP: '192.168.1.1',
          userAgent: 'TestBot/1.0',
          permissions: expect.arrayContaining(['user', 'creator']),
          validated: {
            body: { title: 'Test' },
          },
        });
      });

      it('should generate request metadata when not in context', async () => {
        // Create fresh app to avoid beforeEach middleware
        const freshApp = new Hono<HonoEnv>();

        freshApp.use('*', async (c, next) => {
          c.set('user', {
            id: 'user-1',
            email: 'test@example.com',
            name: 'Test User',
            role: 'user',
            emailVerified: true,
            createdAt: new Date(),
          });
          // No requestId or clientIP set
          await next();
        });

        // biome-ignore lint/suspicious/noExplicitAny: Test needs to capture dynamic context for assertion
        let capturedContext: any;

        freshApp.get(
          '/',
          createAuthenticatedHandler({
            schema: {},
            useEnrichedContext: true,
            handler: async (_c, ctx) => {
              capturedContext = ctx;
              return { ok: true };
            },
          })
        );

        const res = await freshApp.request('/');
        expect(res.status).toBe(200);

        // Should have generated values
        expect(capturedContext.requestId).toBeDefined();
        expect(capturedContext.requestId).toMatch(/^[a-f0-9-]{36}$/);
        expect(capturedContext.clientIP).toBe('unknown'); // No IP headers
      });

      it('should include user permissions in enriched context', async () => {
        let capturedPermissions: string[] = [];

        app.get(
          '/',
          createAuthenticatedHandler({
            schema: {},
            useEnrichedContext: true,
            handler: async (_c, ctx) => {
              capturedPermissions = ctx.permissions;
              return { ok: true };
            },
          })
        );

        const res = await app.request('/');
        expect(res.status).toBe(200);
        expect(capturedPermissions).toEqual(['user', 'creator']);
      });
    });

    describe('context access', () => {
      beforeEach(() => {
        app.use('*', async (c, next) => {
          c.set('user', {
            id: 'user-1',
            email: 'test@example.com',
            name: 'Test User',
            role: 'user',
            emailVerified: true,
            createdAt: new Date(),
          });
          c.set('session', {
            id: 'session-1',
            userId: 'user-1',
            expiresAt: new Date(),
          });
          // Mock env for testing
          c.env = {
            ENVIRONMENT: 'test',
          } as HonoEnv['Bindings'];
          await next();
        });
      });

      it('should provide user in context', async () => {
        // biome-ignore lint/suspicious/noExplicitAny: Test needs to capture dynamic context for assertion
        let capturedUser: any;

        app.get(
          '/',
          createAuthenticatedHandler({
            schema: {},
            handler: async (_c, ctx) => {
              capturedUser = ctx.user;
              return { ok: true };
            },
          })
        );

        await app.request('/');
        expect(capturedUser).toMatchObject({
          id: 'user-1',
          email: 'test@example.com',
        });
      });

      it('should provide session in context', async () => {
        // biome-ignore lint/suspicious/noExplicitAny: Test needs to capture dynamic context for assertion
        let capturedSession: any;

        app.get(
          '/',
          createAuthenticatedHandler({
            schema: {},
            handler: async (_c, ctx) => {
              capturedSession = ctx.session;
              return { ok: true };
            },
          })
        );

        await app.request('/');
        expect(capturedSession).toMatchObject({
          id: 'session-1',
          userId: 'user-1',
        });
      });

      it('should provide env in context', async () => {
        // biome-ignore lint/suspicious/noExplicitAny: Test needs to capture dynamic context for assertion
        let capturedEnv: any;

        app.get(
          '/',
          createAuthenticatedHandler({
            schema: {},
            handler: async (_c, ctx) => {
              capturedEnv = ctx.env;
              return { ok: true };
            },
          })
        );

        await app.request('/');
        expect(capturedEnv).toBeDefined();
      });
    });
  });

  describe('withErrorHandling', () => {
    let app: Hono<HonoEnv>;

    beforeEach(() => {
      app = new Hono<HonoEnv>();
    });

    it('should catch and format errors', async () => {
      app.get(
        '/',
        withErrorHandling(async () => {
          throw new Error('Something went wrong');
        })
      );

      const res = await app.request('/');
      expect(res.status).toBeGreaterThanOrEqual(400);
      const json = await res.json();
      expect(json).toHaveProperty('error');
    });

    it('should pass through successful responses', async () => {
      app.get(
        '/',
        withErrorHandling(async (c) => {
          return c.json({ data: { ok: true } });
        })
      );

      const res = await app.request('/');
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        data: { ok: true },
      });
    });
  });
});
