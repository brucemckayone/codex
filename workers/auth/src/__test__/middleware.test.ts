import { BETTERAUTH_RATE_LIMITED_PATHS_SET, COOKIES } from '@codex/constants';
import type { Context, Next } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { getTrustedOrigins } from '../auth-config';

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
        return undefined;
      };

      const mockContext = {} as Context;
      const mockNext = vi.fn();

      const sequence = (
        ...handlers: ((
          c: Context,
          next: Next
        ) => Promise<Response | undefined>)[]
      ) => {
        return async (c: Context, next: Next) => {
          for (const handler of handlers) {
            const response = await handler(c, next);
            if (response) {
              return response;
            }
          }
          return undefined;
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
    it('should extract session token from cookie', () => {
      const cookieHeader = `${COOKIES.SESSION_NAME}=abc123; other-cookie=value`;
      const match = cookieHeader.match(
        new RegExp(`${COOKIES.SESSION_NAME}=([^;]+)`)
      )?.[1];

      expect(match).toBe('abc123');
    });

    it('should return undefined if no matching cookie', () => {
      const cookieHeader = 'other-cookie=value; another=123';
      const match = cookieHeader?.match(
        new RegExp(`${COOKIES.SESSION_NAME}=([^;]+)`)
      )?.[1];

      expect(match).toBeUndefined();
    });

    it('should handle cookie in middle of string', () => {
      const cookieHeader = `first=1; ${COOKIES.SESSION_NAME}=xyz789; last=2`;
      const match = cookieHeader.match(
        new RegExp(`${COOKIES.SESSION_NAME}=([^;]+)`)
      )?.[1];

      expect(match).toBe('xyz789');
    });
  });

  describe('Rate Limiter Logic', () => {
    // The canonical BetterAuth POST endpoints — sourced from
    // `@codex/constants` so this test fails loudly if the path Set is
    // ever truncated or stale literals creep back in.
    // See Codex-ttavz.7 / denoise iter-002 F1.
    it('matches the four canonical BetterAuth POST surfaces', () => {
      const canonical = [
        '/api/auth/sign-up/email',
        '/api/auth/sign-in/email',
        '/api/auth/forget-password',
        '/api/auth/reset-password',
      ];
      for (const path of canonical) {
        const isRateLimited =
          BETTERAUTH_RATE_LIMITED_PATHS_SET.has(path) && true; // POST gating handled in middleware
        expect(isRateLimited, `${path} must be rate-limited`).toBe(true);
      }
    });

    it('does NOT match unrelated or non-POST surfaces', () => {
      const negatives = [
        '/api/auth/session',
        '/api/auth/sign-out',
        '/api/auth/verify-email',
        '/api/other',
        // Stale legacy paths that used to be hard-coded here:
        '/api/auth/email/login',
        '/api/auth/email/register',
        '/api/auth/email/send-reset-password-email',
        '/api/auth/email/reset-password',
      ];
      for (const path of negatives) {
        expect(
          BETTERAUTH_RATE_LIMITED_PATHS_SET.has(path),
          `${path} must NOT be in the rate-limit set`
        ).toBe(false);
      }
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

  describe('getTrustedOrigins (production code path)', () => {
    // Partial env mock — only the fields getTrustedOrigins reads.
    type EnvShape = Parameters<typeof getTrustedOrigins>[0];
    const buildEnv = (overrides: {
      ENVIRONMENT?: string;
      WEB_APP_URL?: string;
      API_URL?: string;
    }): EnvShape => overrides as unknown as EnvShape;

    it('TEST env: includes localhost:42069 (AUTH_URL the E2E fixture sends)', () => {
      const result = getTrustedOrigins(
        buildEnv({
          ENVIRONMENT: 'test',
          WEB_APP_URL: 'http://localhost:8787',
        })
      );
      expect(result).toContain('http://localhost:42069');
    });

    it('TEST env: includes localhost:8787 (apps/web wrangler dev — Playwright browser Origin)', () => {
      const result = getTrustedOrigins(
        buildEnv({
          ENVIRONMENT: 'test',
          WEB_APP_URL: 'http://localhost:8787',
        })
      );
      expect(result).toContain('http://localhost:8787');
    });

    it('DEVELOPMENT env: includes localhost:42069 + lvh.me dev URLs (preserves existing behavior)', () => {
      const result = getTrustedOrigins(
        buildEnv({
          ENVIRONMENT: 'development',
          WEB_APP_URL: 'http://lvh.me:5173',
        })
      );
      expect(result).toContain('http://localhost:42069');
      expect(result).toContain('http://lvh.me:3000');
      expect(result).toContain('http://lvh.me:5173');
      expect(result).toContain('http://*.nip.io');
    });

    it('PRODUCTION env: excludes ALL localhost/lvh.me/nip.io origins (security boundary)', () => {
      const result = getTrustedOrigins(
        buildEnv({
          ENVIRONMENT: 'production',
          WEB_APP_URL: 'https://codex.studio',
          API_URL: 'https://api.codex.studio',
        })
      );
      expect(result).toEqual([
        'https://codex.studio',
        'https://api.codex.studio',
      ]);
      expect(result).not.toContain('http://localhost:42069');
      expect(result).not.toContain('http://localhost:8787');
      expect(result).not.toContain('http://lvh.me:3000');
      expect(result).not.toContain('http://*.nip.io');
    });

    it('STAGING env: excludes ALL localhost/lvh.me/nip.io origins (security boundary)', () => {
      const result = getTrustedOrigins(
        buildEnv({
          ENVIRONMENT: 'staging',
          WEB_APP_URL: 'https://staging.codex.studio',
          API_URL: 'https://staging-api.codex.studio',
        })
      );
      expect(result).toEqual([
        'https://staging.codex.studio',
        'https://staging-api.codex.studio',
      ]);
      expect(result).not.toContain('http://localhost:42069');
    });

    it('TEST env: filters undefined env.WEB_APP_URL / env.API_URL but keeps dev origins', () => {
      const result = getTrustedOrigins(
        buildEnv({
          ENVIRONMENT: 'test',
          WEB_APP_URL: undefined,
          API_URL: undefined,
        })
      );
      // No undefined entries leak into the list
      expect(result.every((u) => typeof u === 'string')).toBe(true);
      // Dev/test origins still present
      expect(result).toContain('http://localhost:42069');
      expect(result).toContain('http://localhost:8787');
    });
  });
});
