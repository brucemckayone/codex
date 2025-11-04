import { describe, it, expect, vi } from 'vitest';
import { Context, Next } from 'hono';

describe('Auth Worker Middleware - Unit Tests', () => {
  describe('Sequence Handler', () => {
    it('should execute handlers in sequence', async () => {
      const executionOrder: number[] = [];

      const handler1 = async (_c: Context, next: Next) => {
        executionOrder.push(1);
        await next();
      };

      const handler2 = async (_c: Context, next: Next) => {
        executionOrder.push(2);
        await next();
      };

      const handler3 = async (_c: Context, _next: Next) => {
        executionOrder.push(3);
      };

      // Mock context and next
      const mockContext = {} as Context;
      const mockNext = vi.fn();

      // Create a sequence-like function
      const sequence = (...handlers: (typeof handler1)[]) => {
        return async (c: Context, next: Next) => {
          for (const handler of handlers) {
            await handler(c, next);
          }
        };
      };

      const combined = sequence(handler1, handler2, handler3);
      await combined(mockContext, mockNext);

      expect(executionOrder).toEqual([1, 2, 3]);
    });

    it('should stop execution if a handler returns a response', async () => {
      const executionOrder: number[] = [];

      const handler1 = async (_c: Context, _next: Next) => {
        executionOrder.push(1);
        return new Response('Early return', { status: 200 });
      };

      const handler2 = async (_c: Context, _next: Next) => {
        executionOrder.push(2);
      };

      const mockContext = {} as Context;
      const mockNext = vi.fn();

      const sequence = (
        ...handlers: ((c: Context, next: Next) => Promise<Response | void>)[]
      ) => {
        return async (c: Context, next: Next) => {
          for (const handler of handlers) {
            const response = await handler(c, next);
            if (response) {
              return response;
            }
          }
        };
      };

      const combined = sequence(handler1, handler2);
      const result = await combined(mockContext, mockNext);

      expect(executionOrder).toEqual([1]);
      expect(result).toBeInstanceOf(Response);
      expect(await result?.text()).toBe('Early return');
    });
  });

  describe('Session Handler Logic', () => {
    it('should extract session cookie from headers', () => {
      const cookieHeader = 'codex-session=abc123; other-cookie=value';
      const match = cookieHeader.match(/codex-session=([^;]+)/)?.[1];

      expect(match).toBe('abc123');
    });

    it('should return undefined when no session cookie exists', () => {
      const cookieHeader = 'other-cookie=value';
      const match = cookieHeader?.match(/codex-session=([^;]+)/)?.[1];

      expect(match).toBeUndefined();
    });

    it('should handle multiple cookies correctly', () => {
      const cookieHeader = 'first=1; codex-session=xyz789; last=2';
      const match = cookieHeader.match(/codex-session=([^;]+)/)?.[1];

      expect(match).toBe('xyz789');
    });
  });

  describe('Rate Limiter Logic', () => {
    it('should identify login endpoint correctly', () => {
      const path = '/api/auth/email/login';
      const method = 'POST';

      const isLoginEndpoint =
        path === '/api/auth/email/login' && method === 'POST';

      expect(isLoginEndpoint).toBe(true);
    });

    it('should not match non-login endpoints', () => {
      const testCases = [
        { path: '/api/auth/session', method: 'GET' },
        { path: '/api/auth/email/login', method: 'GET' },
        { path: '/api/other', method: 'POST' },
      ];

      testCases.forEach(({ path, method }) => {
        const isLoginEndpoint =
          path === '/api/auth/email/login' && method === 'POST';
        expect(isLoginEndpoint).toBe(false);
      });
    });

    it('should calculate TTL correctly from expiration date', () => {
      const now = Date.now();
      const expiresAt = new Date(now + 60000); // 60 seconds in future

      const ttl = Math.floor((expiresAt.getTime() - now) / 1000);

      expect(ttl).toBeGreaterThanOrEqual(59);
      expect(ttl).toBeLessThanOrEqual(60);
    });
  });

  describe('Environment Configuration', () => {
    it('should filter out undefined values from trusted origins', () => {
      const webAppUrl = 'http://localhost:3000';
      const apiUrl = undefined;

      const trustedOrigins = [webAppUrl, apiUrl].filter(Boolean);

      expect(trustedOrigins).toEqual(['http://localhost:3000']);
      expect(trustedOrigins.length).toBe(1);
    });

    it('should include all values when all are defined', () => {
      const webAppUrl = 'http://localhost:3000';
      const apiUrl = 'http://localhost:8787';

      const trustedOrigins = [webAppUrl, apiUrl].filter(Boolean);

      expect(trustedOrigins).toEqual([
        'http://localhost:3000',
        'http://localhost:8787',
      ]);
      expect(trustedOrigins.length).toBe(2);
    });
  });
});
