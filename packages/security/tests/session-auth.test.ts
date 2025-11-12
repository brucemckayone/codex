import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import {
  optionalAuth,
  requireAuth,
  type SessionData,
  type UserData,
  type CachedSessionData,
} from '../src/session-auth';

// Mock @codex/database
vi.mock('@codex/database', () => {
  const mockDbHttp = {
    query: {
      sessions: {
        findFirst: vi.fn(),
      },
    },
  };

  return {
    dbHttp: mockDbHttp,
    schema: {
      sessions: {},
      users: {},
    },
  };
});

// Mock drizzle-orm
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
  and: vi.fn((...args) => ({ and: args })),
  gt: vi.fn((a, b) => ({ gt: [a, b] })),
}));

// Import mocked database after mocks are set up
import { dbHttp } from '@codex/database';

describe('Session Authentication Middleware', () => {
  let app: Hono;
  let mockKV: KVNamespace;
  const mockSessionToken = 'session_abc123xyz';

  // Mock session and user data
  const mockSession: SessionData = {
    id: 'session_1',
    userId: 'user_1',
    token: mockSessionToken,
    expiresAt: new Date(Date.now() + 86400000).toISOString(), // 24 hours from now
    ipAddress: '203.0.113.42',
    userAgent: 'Mozilla/5.0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockUser: UserData = {
    id: 'user_1',
    email: 'test@example.com',
    name: 'Test User',
    emailVerified: true,
    image: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockCachedData: CachedSessionData = {
    session: mockSession,
    user: mockUser,
  };

  beforeEach(() => {
    // Reset app for each test
    app = new Hono();

    // Reset all mocks
    vi.clearAllMocks();

    // Create mock KV namespace
    mockKV = {
      get: vi.fn(),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      list: vi.fn(),
      getWithMetadata: vi.fn(),
    } as unknown as KVNamespace;
  });

  describe('optionalAuth', () => {
    describe('Valid Session in Cache', () => {
      it('should set user and session from cache', async () => {
        // Mock KV cache hit
        (mockKV.get as ReturnType<typeof vi.fn>).mockResolvedValue(
          mockCachedData
        );

        app.use('*', optionalAuth({ kv: mockKV }));
        app.get('/test', (c) => {
          const user = (c.get as any)('user');
          const session = (c.get as any)('session');
          return c.json({ user, session, source: 'cache' });
        });

        const res = await app.request('/test', {
          method: 'GET',
          headers: {
            cookie: `codex-session=${mockSessionToken}`,
          },
        });

        expect(res.status).toBe(200);
        const body = (await res.json()) as any;
        expect((body as any).user).toEqual(mockUser);
        expect((body as any).session).toEqual(mockSession);
        expect(mockKV.get).toHaveBeenCalledWith(
          `session:${mockSessionToken}`,
          'json'
        );
        // Should not query database if cache hit
        expect(dbHttp.query.sessions.findFirst).not.toHaveBeenCalled();
      });

      it('should handle custom cookie name', async () => {
        const customCookieName = 'my-custom-session';
        (mockKV.get as ReturnType<typeof vi.fn>).mockResolvedValue(
          mockCachedData
        );

        app.use(
          '*',
          optionalAuth({ kv: mockKV, cookieName: customCookieName })
        );
        app.get('/test', (c) => c.json({ success: true }));

        await app.request('/test', {
          headers: {
            cookie: `${customCookieName}=${mockSessionToken}`,
          },
        });

        expect(mockKV.get).toHaveBeenCalledWith(
          `session:${mockSessionToken}`,
          'json'
        );
      });
    });

    describe('Valid Session from Database', () => {
      it('should query database on cache miss and cache result', async () => {
        // Mock cache miss
        (mockKV.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        // Mock database query success
        (
          dbHttp.query.sessions.findFirst as ReturnType<typeof vi.fn>
        ).mockResolvedValue({
          ...mockSession,
          expiresAt: new Date(mockSession.expiresAt),
          createdAt: new Date(mockSession.createdAt),
          updatedAt: new Date(mockSession.updatedAt),
          user: {
            ...mockUser,
            createdAt: new Date(mockUser.createdAt),
            updatedAt: new Date(mockUser.updatedAt),
          },
        });

        app.use('*', optionalAuth({ kv: mockKV }));
        app.get('/test', (c) => {
          const user = (c.get as any)('user');
          const session = (c.get as any)('session');
          return c.json({ user, session, source: 'database' });
        });

        const res = await app.request('/test', {
          headers: {
            cookie: `codex-session=${mockSessionToken}`,
          },
        });

        expect(res.status).toBe(200);
        const body = (await res.json()) as any;
        expect((body as any).user).toBeDefined();
        expect((body as any).user.id).toBe('user_1');
        expect((body as any).session).toBeDefined();

        // Verify database was queried
        expect(dbHttp.query.sessions.findFirst).toHaveBeenCalled();

        // Verify result was cached
        expect(mockKV.put).toHaveBeenCalled();
        const putCall = (mockKV.put as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(putCall[0]).toBe(`session:${mockSessionToken}`);
        expect(putCall[2]).toHaveProperty('expirationTtl');
      });

      it('should work without KV (database-only mode)', async () => {
        // Mock database query success
        (
          dbHttp.query.sessions.findFirst as ReturnType<typeof vi.fn>
        ).mockResolvedValue({
          ...mockSession,
          expiresAt: new Date(mockSession.expiresAt),
          createdAt: new Date(mockSession.createdAt),
          updatedAt: new Date(mockSession.updatedAt),
          user: {
            ...mockUser,
            createdAt: new Date(mockUser.createdAt),
            updatedAt: new Date(mockUser.updatedAt),
          },
        });

        // No KV config provided
        app.use('*', optionalAuth());
        app.get('/test', (c) => {
          const user = (c.get as any)('user');
          return c.json({ userId: user?.id });
        });

        const res = await app.request('/test', {
          headers: {
            cookie: `codex-session=${mockSessionToken}`,
          },
        });

        expect(res.status).toBe(200);
        const body = (await res.json()) as any;
        expect((body as any).userId).toBe('user_1');
        expect(dbHttp.query.sessions.findFirst).toHaveBeenCalled();
      });
    });

    describe('Expired Session Handling', () => {
      it('should reject expired session from cache', async () => {
        const expiredSession = {
          ...mockCachedData,
          session: {
            ...mockSession,
            expiresAt: new Date(Date.now() - 1000).toISOString(), // Expired
          },
        };

        (mockKV.get as ReturnType<typeof vi.fn>).mockResolvedValue(
          expiredSession
        );
        (
          dbHttp.query.sessions.findFirst as ReturnType<typeof vi.fn>
        ).mockResolvedValue(null);

        app.use('*', optionalAuth({ kv: mockKV }));
        app.get('/test', (c) => {
          const user = (c.get as any)('user');
          return c.json({ hasUser: !!user });
        });

        const res = await app.request('/test', {
          headers: {
            cookie: `codex-session=${mockSessionToken}`,
          },
        });

        expect(res.status).toBe(200);
        const body = (await res.json()) as any;
        expect((body as any).hasUser).toBe(false);

        // Should delete expired session from cache
        expect(mockKV.delete).toHaveBeenCalledWith(
          `session:${mockSessionToken}`
        );
      });

      it('should reject expired session from database', async () => {
        (mockKV.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        // Database returns null for expired session (handled by query WHERE clause)
        (
          dbHttp.query.sessions.findFirst as ReturnType<typeof vi.fn>
        ).mockResolvedValue(null);

        app.use('*', optionalAuth({ kv: mockKV }));
        app.get('/test', (c) => {
          const user = (c.get as any)('user');
          return c.json({ hasUser: !!user });
        });

        const res = await app.request('/test', {
          headers: {
            cookie: `codex-session=${mockSessionToken}`,
          },
        });

        expect(res.status).toBe(200);
        const body = (await res.json()) as any;
        expect((body as any).hasUser).toBe(false);
      });
    });

    describe('No Session Cookie', () => {
      it('should proceed without authentication when no cookie', async () => {
        app.use('*', optionalAuth({ kv: mockKV }));
        app.get('/test', (c) => {
          const user = (c.get as any)('user');
          return c.json({ hasUser: !!user });
        });

        const res = await app.request('/test', {
          headers: {}, // No cookie header
        });

        expect(res.status).toBe(200);
        const body = (await res.json()) as any;
        expect((body as any).hasUser).toBe(false);

        // Should not query cache or database
        expect(mockKV.get).not.toHaveBeenCalled();
        expect(dbHttp.query.sessions.findFirst).not.toHaveBeenCalled();
      });

      it('should handle multiple cookies correctly', async () => {
        (mockKV.get as ReturnType<typeof vi.fn>).mockResolvedValue(
          mockCachedData
        );

        app.use('*', optionalAuth({ kv: mockKV }));
        app.get('/test', (c) => c.json({ success: true }));

        await app.request('/test', {
          headers: {
            cookie: `other=value; codex-session=${mockSessionToken}; another=test`,
          },
        });

        expect(mockKV.get).toHaveBeenCalledWith(
          `session:${mockSessionToken}`,
          'json'
        );
      });
    });

    describe('Invalid Session Token', () => {
      it('should handle invalid session token from database', async () => {
        (mockKV.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        (
          dbHttp.query.sessions.findFirst as ReturnType<typeof vi.fn>
        ).mockResolvedValue(null);

        app.use('*', optionalAuth({ kv: mockKV }));
        app.get('/test', (c) => {
          const user = (c.get as any)('user');
          return c.json({ hasUser: !!user });
        });

        const res = await app.request('/test', {
          headers: {
            cookie: 'codex-session=invalid_token_xyz',
          },
        });

        expect(res.status).toBe(200);
        const body = (await res.json()) as any;
        expect((body as any).hasUser).toBe(false);
      });
    });

    describe('Error Handling', () => {
      it('should handle database errors gracefully', async () => {
        (mockKV.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        (
          dbHttp.query.sessions.findFirst as ReturnType<typeof vi.fn>
        ).mockRejectedValue(new Error('Database connection failed'));

        app.use('*', optionalAuth({ kv: mockKV }));
        app.get('/test', (c) => {
          const user = (c.get as any)('user');
          return c.json({ hasUser: !!user });
        });

        const res = await app.request('/test', {
          headers: {
            cookie: `codex-session=${mockSessionToken}`,
          },
        });

        // Should proceed without auth (fail open for optional auth)
        expect(res.status).toBe(200);
        const body = (await res.json()) as any;
        expect((body as any).hasUser).toBe(false);
      });

      it('should handle KV read errors gracefully', async () => {
        (mockKV.get as ReturnType<typeof vi.fn>).mockRejectedValue(
          new Error('KV unavailable')
        );
        (
          dbHttp.query.sessions.findFirst as ReturnType<typeof vi.fn>
        ).mockResolvedValue({
          ...mockSession,
          expiresAt: new Date(mockSession.expiresAt),
          createdAt: new Date(mockSession.createdAt),
          updatedAt: new Date(mockSession.updatedAt),
          user: {
            ...mockUser,
            createdAt: new Date(mockUser.createdAt),
            updatedAt: new Date(mockUser.updatedAt),
          },
        });

        app.use('*', optionalAuth({ kv: mockKV }));
        app.get('/test', (c) => {
          const user = (c.get as any)('user');
          return c.json({ hasUser: !!user });
        });

        const res = await app.request('/test', {
          headers: {
            cookie: `codex-session=${mockSessionToken}`,
          },
        });

        // Should fall back to database
        expect(res.status).toBe(200);
        const body = (await res.json()) as any;
        expect((body as any).hasUser).toBe(true);
        expect(dbHttp.query.sessions.findFirst).toHaveBeenCalled();
      });

      it('should handle KV write errors gracefully', async () => {
        (mockKV.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        (mockKV.put as ReturnType<typeof vi.fn>).mockRejectedValue(
          new Error('KV write failed')
        );
        (
          dbHttp.query.sessions.findFirst as ReturnType<typeof vi.fn>
        ).mockResolvedValue({
          ...mockSession,
          expiresAt: new Date(mockSession.expiresAt),
          createdAt: new Date(mockSession.createdAt),
          updatedAt: new Date(mockSession.updatedAt),
          user: {
            ...mockUser,
            createdAt: new Date(mockUser.createdAt),
            updatedAt: new Date(mockUser.updatedAt),
          },
        });

        app.use('*', optionalAuth({ kv: mockKV }));
        app.get('/test', (c) => {
          const user = (c.get as any)('user');
          return c.json({ hasUser: !!user });
        });

        const res = await app.request('/test', {
          headers: {
            cookie: `codex-session=${mockSessionToken}`,
          },
        });

        // Should still authenticate from database (ignore cache write error)
        expect(res.status).toBe(200);
        const body = (await res.json()) as any;
        expect((body as any).hasUser).toBe(true);
      });
    });

    describe('Logging', () => {
      it('should log authentication when enabled', async () => {
        const consoleSpy = vi
          .spyOn(console, 'info')
          .mockImplementation(() => {});

        // Mock cache miss so logging happens
        (mockKV.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        // Mock database query success
        (
          dbHttp.query.sessions.findFirst as ReturnType<typeof vi.fn>
        ).mockResolvedValue({
          ...mockSession,
          expiresAt: new Date(mockSession.expiresAt),
          createdAt: new Date(mockSession.createdAt),
          updatedAt: new Date(mockSession.updatedAt),
          user: {
            ...mockUser,
            createdAt: new Date(mockUser.createdAt),
            updatedAt: new Date(mockUser.updatedAt),
          },
        });

        app.use('*', optionalAuth({ kv: mockKV, enableLogging: true }));
        app.get('/test', (c) => c.json({ success: true }));

        await app.request('/test', {
          headers: {
            cookie: `codex-session=${mockSessionToken}`,
          },
        });

        expect(consoleSpy).toHaveBeenCalledWith(
          'Session authenticated',
          expect.objectContaining({
            userId: 'user_1',
          })
        );

        consoleSpy.mockRestore();
      });

      it('should not log when disabled (default)', async () => {
        const consoleSpy = vi
          .spyOn(console, 'info')
          .mockImplementation(() => {});

        (mockKV.get as ReturnType<typeof vi.fn>).mockResolvedValue(
          mockCachedData
        );

        app.use('*', optionalAuth({ kv: mockKV }));
        app.get('/test', (c) => c.json({ success: true }));

        await app.request('/test', {
          headers: {
            cookie: `codex-session=${mockSessionToken}`,
          },
        });

        expect(consoleSpy).not.toHaveBeenCalled();

        consoleSpy.mockRestore();
      });
    });
  });

  describe('requireAuth', () => {
    describe('Valid Session', () => {
      it('should allow access with valid session', async () => {
        (mockKV.get as ReturnType<typeof vi.fn>).mockResolvedValue(
          mockCachedData
        );

        app.use('/protected/*', requireAuth({ kv: mockKV }));
        app.get('/protected/resource', (c) => {
          const user = (c.get as any)('user');
          return c.json({ userId: user.id });
        });

        const res = await app.request('/protected/resource', {
          headers: {
            cookie: `codex-session=${mockSessionToken}`,
          },
        });

        expect(res.status).toBe(200);
        const body = (await res.json()) as any;
        expect((body as any).userId).toBe('user_1');
      });
    });

    describe('No Session', () => {
      it('should return 401 when no cookie', async () => {
        app.use('/protected/*', requireAuth({ kv: mockKV }));
        app.get('/protected/resource', (c) => c.json({ data: 'secret' }));

        const res = await app.request('/protected/resource', {
          headers: {}, // No cookie
        });

        expect(res.status).toBe(401);
        const body = (await res.json()) as any;
        expect(body).toEqual({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        });
      });

      it('should return 401 when session invalid', async () => {
        (mockKV.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        (
          dbHttp.query.sessions.findFirst as ReturnType<typeof vi.fn>
        ).mockResolvedValue(null);

        app.use('/protected/*', requireAuth({ kv: mockKV }));
        app.get('/protected/resource', (c) => c.json({ data: 'secret' }));

        const res = await app.request('/protected/resource', {
          headers: {
            cookie: 'codex-session=invalid_token',
          },
        });

        expect(res.status).toBe(401);
        const body = (await res.json()) as any;
        expect((body as any).error.code).toBe('UNAUTHORIZED');
      });

      it('should return 401 when session expired', async () => {
        const expiredSession = {
          ...mockCachedData,
          session: {
            ...mockSession,
            expiresAt: new Date(Date.now() - 1000).toISOString(),
          },
        };

        (mockKV.get as ReturnType<typeof vi.fn>).mockResolvedValue(
          expiredSession
        );

        app.use('/protected/*', requireAuth({ kv: mockKV }));
        app.get('/protected/resource', (c) => c.json({ data: 'secret' }));

        const res = await app.request('/protected/resource', {
          headers: {
            cookie: `codex-session=${mockSessionToken}`,
          },
        });

        expect(res.status).toBe(401);
      });
    });

    describe('Error Handling', () => {
      it('should return 401 on database error (fail closed)', async () => {
        (mockKV.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        (
          dbHttp.query.sessions.findFirst as ReturnType<typeof vi.fn>
        ).mockRejectedValue(new Error('Database error'));

        app.use('/protected/*', requireAuth({ kv: mockKV }));
        app.get('/protected/resource', (c) => c.json({ data: 'secret' }));

        const res = await app.request('/protected/resource', {
          headers: {
            cookie: `codex-session=${mockSessionToken}`,
          },
        });

        // SECURITY: Fail closed - deny access on error
        expect(res.status).toBe(401);
      });
    });

    describe('Public vs Protected Routes', () => {
      it('should protect only specified routes', async () => {
        (mockKV.get as ReturnType<typeof vi.fn>).mockResolvedValue(
          mockCachedData
        );

        app.use('/protected/*', requireAuth({ kv: mockKV }));
        app.get('/public', (c) => c.json({ type: 'public' }));
        app.get('/protected/secret', (c) => c.json({ type: 'protected' }));

        // Public route should work without auth
        const publicRes = await app.request('/public');
        expect(publicRes.status).toBe(200);
        const publicBody = (await publicRes.json()) as any;
        expect((publicBody as any).type).toBe('public');

        // Protected route should require auth
        const protectedRes = await app.request('/protected/secret');
        expect(protectedRes.status).toBe(401);

        // Protected route should work with auth
        const authedRes = await app.request('/protected/secret', {
          headers: {
            cookie: `codex-session=${mockSessionToken}`,
          },
        });
        expect(authedRes.status).toBe(200);
      });
    });
  });

  describe('Session and User Data Types', () => {
    it('should preserve all session fields', async () => {
      (mockKV.get as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockCachedData
      );

      app.use('*', optionalAuth({ kv: mockKV }));
      app.get('/test', (c) => {
        const session = (c.get as any)('session');
        return c.json({ session });
      });

      const res = await app.request('/test', {
        headers: {
          cookie: `codex-session=${mockSessionToken}`,
        },
      });

      const body = (await res.json()) as any;
      expect(body.session).toHaveProperty('id');
      expect(body.session).toHaveProperty('userId');
      expect(body.session).toHaveProperty('token');
      expect(body.session).toHaveProperty('expiresAt');
      expect(body.session).toHaveProperty('ipAddress');
      expect(body.session).toHaveProperty('userAgent');
      expect(body.session).toHaveProperty('createdAt');
      expect(body.session).toHaveProperty('updatedAt');
    });

    it('should preserve all user fields', async () => {
      (mockKV.get as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockCachedData
      );

      app.use('*', optionalAuth({ kv: mockKV }));
      app.get('/test', (c) => {
        const user = (c.get as any)('user');
        return c.json({ user });
      });

      const res = await app.request('/test', {
        headers: {
          cookie: `codex-session=${mockSessionToken}`,
        },
      });

      const body = (await res.json()) as any;
      expect(body.user).toHaveProperty('id');
      expect(body.user).toHaveProperty('email');
      expect(body.user).toHaveProperty('name');
      expect(body.user).toHaveProperty('emailVerified');
      expect(body.user).toHaveProperty('image');
      expect(body.user).toHaveProperty('createdAt');
      expect(body.user).toHaveProperty('updatedAt');
    });
  });
});
