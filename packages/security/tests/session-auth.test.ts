import { COOKIES } from '@codex/constants';
import {
  createMockKVNamespace,
  createMockSession,
  createMockUser,
} from '@codex/test-utils';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type CachedSessionData,
  optionalAuth,
  requireAuth,
  type SessionAuthRow,
  type UserAuthRow,
} from '../src/session-auth';

// Define environment type for test Hono app with user and session
type TestEnv = {
  Variables: {
    user?: UserAuthRow;
    session?: SessionAuthRow;
  };
};

// Create mock database using vi.hoisted() to ensure it's available in vi.mock factory
// This pattern is required because vi.mock() calls are hoisted to the top of the file
const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    query: {
      sessions: {
        findFirst: vi.fn(),
      },
    },
  },
}));

// Mock @codex/database
vi.mock('@codex/database', () => {
  return {
    dbHttp: mockDb,
    createDbClient: vi.fn(() => mockDb),
    schema: {
      sessions: {},
      users: {},
    },
  };
});

// Mock drizzle-orm with all required exports
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
  and: vi.fn((...args) => ({ and: args })),
  gt: vi.fn((a, b) => ({ gt: [a, b] })),
  relations: vi.fn(() => ({})),
  sql: vi.fn(),
  isNull: vi.fn((a) => ({ isNull: a })),
}));

describe('Session Authentication Middleware', () => {
  let app: Hono<TestEnv>;
  let mockKV: ReturnType<typeof createMockKVNamespace>;
  const mockSessionToken = 'session_abc123xyz';

  // Create mock data using shared factories
  const mockUser = createMockUser({
    id: 'user_1',
    email: 'test@example.com',
    name: 'Test User',
  });

  const mockSession = createMockSession('user_1', {
    id: 'session_1',
    token: mockSessionToken,
  });

  const mockCachedData: CachedSessionData = {
    session: mockSession,
    user: mockUser,
  };

  beforeEach(() => {
    // Reset app for each test
    app = new Hono<TestEnv>();

    // Reset all mocks
    vi.clearAllMocks();

    // Create fresh mock KV namespace
    mockKV = createMockKVNamespace();
  });

  describe('optionalAuth', () => {
    describe('Valid Session in Cache', () => {
      it('should set user and session from cache', async () => {
        // Mock KV cache hit
        mockKV.get.mockResolvedValue(mockCachedData);

        app.use('*', optionalAuth({ kv: mockKV as unknown as KVNamespace }));
        app.get('/test', (c) => {
          const user = c.get('user');
          const session = c.get('session');
          return c.json({ user, session, source: 'cache' });
        });

        const res = await app.request('/test', {
          method: 'GET',
          headers: {
            cookie: `${COOKIES.SESSION_NAME}=${mockSessionToken}`,
          },
        });

        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          user: UserAuthRow;
          session: SessionAuthRow;
          source: string;
        };
        expect(body.user).toEqual(mockUser);
        expect(body.session).toEqual(mockSession);
        // Codex-kgrdp.7: exactly ONE read, against BetterAuth's bare-token
        // key. The old `session:${token}` probe ran first and always missed.
        expect(mockKV.get).toHaveBeenCalledWith(mockSessionToken, 'json');
        expect(mockKV.get).toHaveBeenCalledTimes(1);
        // Should not query database if cache hit
        expect(mockDb.query.sessions.findFirst).not.toHaveBeenCalled();
      });

      it('should handle custom cookie name', async () => {
        const customCookieName = 'my-custom-session';
        mockKV.get.mockResolvedValue(mockCachedData);

        app.use(
          '*',
          optionalAuth({
            kv: mockKV as unknown as KVNamespace,
            cookieName: customCookieName,
          })
        );
        app.get('/test', (c) => c.json({ success: true }));

        await app.request('/test', {
          headers: {
            cookie: `${customCookieName}=${mockSessionToken}`,
          },
        });

        expect(mockKV.get).toHaveBeenCalledWith(mockSessionToken, 'json');
      });
    });

    describe('Valid Session from Database', () => {
      it('should query database on cache miss without writing the cache', async () => {
        // Mock cache miss
        mockKV.get.mockResolvedValue(null);

        // Mock database query success
        mockDb.query.sessions.findFirst.mockResolvedValue({
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

        app.use('*', optionalAuth({ kv: mockKV as unknown as KVNamespace }));
        app.get('/test', (c) => {
          const user = c.get('user');
          const session = c.get('session');
          return c.json({ user, session, source: 'database' });
        });

        const res = await app.request('/test', {
          headers: {
            cookie: `${COOKIES.SESSION_NAME}=${mockSessionToken}`,
          },
        });

        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          user: UserAuthRow;
          session: SessionAuthRow;
          source: string;
        };
        expect(body.user).toBeDefined();
        expect(body.user.id).toBe('user_1');
        expect(body.session).toBeDefined();

        // Verify database was queried
        expect(mockDb.query.sessions.findFirst).toHaveBeenCalled();

        // Codex-kgrdp.7: this middleware is a read-only consumer of
        // AUTH_SESSION_KV. BetterAuth's secondaryStorage is the single writer,
        // so a DB fallback must NOT write a second key format back.
        expect(mockKV.put).not.toHaveBeenCalled();
      });

      it('should work without KV (database-only mode)', async () => {
        // Mock database query success
        mockDb.query.sessions.findFirst.mockResolvedValue({
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
          const user = c.get('user');
          return c.json({ userId: user?.id });
        });

        const res = await app.request('/test', {
          headers: {
            cookie: `${COOKIES.SESSION_NAME}=${mockSessionToken}`,
          },
        });

        expect(res.status).toBe(200);
        const body = (await res.json()) as { userId?: string };
        expect(body.userId).toBe('user_1');
        expect(mockDb.query.sessions.findFirst).toHaveBeenCalled();
      });

      it('should reject a soft-deleted user even with a valid session row (Codex-eb00a.11)', async () => {
        // Cache miss → DB fallback returns a valid, unexpired session whose
        // user has been soft-deleted (account deletion). The deletedAt gate
        // must treat this as no session so a residual cookie cannot act.
        mockKV.get.mockResolvedValue(null);
        mockDb.query.sessions.findFirst.mockResolvedValue({
          ...mockSession,
          expiresAt: new Date(mockSession.expiresAt),
          createdAt: new Date(mockSession.createdAt),
          updatedAt: new Date(mockSession.updatedAt),
          user: {
            ...mockUser,
            createdAt: new Date(mockUser.createdAt),
            updatedAt: new Date(mockUser.updatedAt),
            deletedAt: new Date(),
          },
        });

        app.use('*', optionalAuth({ kv: mockKV as unknown as KVNamespace }));
        app.get('/test', (c) => {
          const user = c.get('user');
          return c.json({ userId: user?.id ?? null });
        });

        const res = await app.request('/test', {
          headers: {
            cookie: `${COOKIES.SESSION_NAME}=${mockSessionToken}`,
          },
        });

        // optionalAuth is fail-open (200), but there must be NO authed user.
        expect(res.status).toBe(200);
        const body = (await res.json()) as { userId: string | null };
        expect(body.userId).toBeNull();
        expect(mockDb.query.sessions.findFirst).toHaveBeenCalled();
        // A rejected (null) session must never be written to the KV cache.
        expect(mockKV.put).not.toHaveBeenCalled();
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

        mockKV.get.mockResolvedValue(expiredSession);
        mockDb.query.sessions.findFirst.mockResolvedValue(null);

        app.use('*', optionalAuth({ kv: mockKV as unknown as KVNamespace }));
        app.get('/test', (c) => {
          const user = c.get('user');
          return c.json({ hasUser: !!user });
        });

        const res = await app.request('/test', {
          headers: {
            cookie: `${COOKIES.SESSION_NAME}=${mockSessionToken}`,
          },
        });

        expect(res.status).toBe(200);
        const body = (await res.json()) as { hasUser: boolean };
        expect(body.hasUser).toBe(false);

        // Falls through to the database, which rejects it too.
        expect(mockDb.query.sessions.findFirst).toHaveBeenCalled();

        // Codex-kgrdp.7: BetterAuth owns this namespace and gave the entry a
        // TTL equal to the same expiry, so KV reaps it. A read-only consumer
        // must not spend a KV write deleting someone else's key.
        expect(mockKV.delete).not.toHaveBeenCalled();
      });

      it('should reject expired session from database', async () => {
        mockKV.get.mockResolvedValue(null);

        // Database returns null for expired session (handled by query WHERE clause)
        mockDb.query.sessions.findFirst.mockResolvedValue(null);

        app.use('*', optionalAuth({ kv: mockKV as unknown as KVNamespace }));
        app.get('/test', (c) => {
          const user = c.get('user');
          return c.json({ hasUser: !!user });
        });

        const res = await app.request('/test', {
          headers: {
            cookie: `${COOKIES.SESSION_NAME}=${mockSessionToken}`,
          },
        });

        expect(res.status).toBe(200);
        const body = (await res.json()) as { hasUser: boolean };
        expect(body.hasUser).toBe(false);
      });
    });

    describe('No Session Cookie', () => {
      it('should proceed without authentication when no cookie', async () => {
        app.use('*', optionalAuth({ kv: mockKV as unknown as KVNamespace }));
        app.get('/test', (c) => {
          const user = c.get('user');
          return c.json({ hasUser: !!user });
        });

        const res = await app.request('/test', {
          headers: {}, // No cookie header
        });

        expect(res.status).toBe(200);
        const body = (await res.json()) as { hasUser: boolean };
        expect(body.hasUser).toBe(false);

        // Should not query cache or database
        expect(mockKV.get).not.toHaveBeenCalled();
        expect(mockDb.query.sessions.findFirst).not.toHaveBeenCalled();
      });

      it('should handle multiple cookies correctly', async () => {
        mockKV.get.mockResolvedValue(mockCachedData);

        app.use('*', optionalAuth({ kv: mockKV as unknown as KVNamespace }));
        app.get('/test', (c) => c.json({ success: true }));

        await app.request('/test', {
          headers: {
            cookie: `other=value; codex-session=${mockSessionToken}; another=test`,
          },
        });

        expect(mockKV.get).toHaveBeenCalledWith(mockSessionToken, 'json');
      });
    });

    describe('Invalid Session Token', () => {
      it('should handle invalid session token from database', async () => {
        mockKV.get.mockResolvedValue(null);
        mockDb.query.sessions.findFirst.mockResolvedValue(null);

        app.use('*', optionalAuth({ kv: mockKV as unknown as KVNamespace }));
        app.get('/test', (c) => {
          const user = c.get('user');
          return c.json({ hasUser: !!user });
        });

        const res = await app.request('/test', {
          headers: {
            cookie: 'codex-session=invalid_token_xyz',
          },
        });

        expect(res.status).toBe(200);
        const body = (await res.json()) as { hasUser: boolean };
        expect(body.hasUser).toBe(false);
      });
    });

    describe('Error Handling', () => {
      it('should handle database errors gracefully', async () => {
        mockKV.get.mockResolvedValue(null);
        mockDb.query.sessions.findFirst.mockRejectedValue(
          new Error('Database connection failed')
        );

        app.use('*', optionalAuth({ kv: mockKV as unknown as KVNamespace }));
        app.get('/test', (c) => {
          const user = c.get('user');
          return c.json({ hasUser: !!user });
        });

        const res = await app.request('/test', {
          headers: {
            cookie: `${COOKIES.SESSION_NAME}=${mockSessionToken}`,
          },
        });

        // Should proceed without auth (fail open for optional auth)
        expect(res.status).toBe(200);
        const body = (await res.json()) as { hasUser: boolean };
        expect(body.hasUser).toBe(false);
      });

      it('should handle KV read errors gracefully', async () => {
        mockKV.get.mockRejectedValue(new Error('KV unavailable'));
        mockDb.query.sessions.findFirst.mockResolvedValue({
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

        app.use('*', optionalAuth({ kv: mockKV as unknown as KVNamespace }));
        app.get('/test', (c) => {
          const user = c.get('user');
          return c.json({ hasUser: !!user });
        });

        const res = await app.request('/test', {
          headers: {
            cookie: `${COOKIES.SESSION_NAME}=${mockSessionToken}`,
          },
        });

        // Should fall back to database
        expect(res.status).toBe(200);
        const body = (await res.json()) as { hasUser: boolean };
        expect(body.hasUser).toBe(true);
        expect(mockDb.query.sessions.findFirst).toHaveBeenCalled();
      });

      it('should surface a KV read failure through the module logger when no request obs is set', async () => {
        const consoleSpy = vi
          .spyOn(console, 'error')
          .mockImplementation(() => {});
        mockKV.get.mockRejectedValue(new Error('KV unavailable'));
        mockDb.query.sessions.findFirst.mockResolvedValue(null);

        app.use('*', optionalAuth({ kv: mockKV as unknown as KVNamespace }));
        app.get('/test', (c) => c.json({ hasUser: !!c.get('user') }));

        await app.request('/test', {
          headers: {
            cookie: `${COOKIES.SESSION_NAME}=${mockSessionToken}`,
          },
        });

        // A degraded session cache must never fail silently, even on the
        // paths that have no request-scoped ObservabilityClient.
        const logOutput = consoleSpy.mock.calls.flat().join(' ');
        expect(logOutput).toContain('Failed to read session from KV');
        // SECURITY: the token must not appear in the log line.
        expect(logOutput).not.toContain(mockSessionToken);

        consoleSpy.mockRestore();
      });
    });

    // Codex-kgrdp.7 — AUTH_SESSION_KV had two competing session-cache
    // implementations writing different key formats. BetterAuth's
    // secondaryStorage (bare token -> `{ session, user }`) is the single
    // owner; this middleware is a read-only consumer. These tests pin that
    // contract so a second writer cannot creep back in.
    describe('Single session-cache owner (Codex-kgrdp.7)', () => {
      const dbRow = () => ({
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

      it('reads a BetterAuth-written entry and never probes a `session:` key', async () => {
        // Storage seeded the way BetterAuth writes it: bare token key,
        // JSON string body. No `session:`-prefixed entry exists.
        mockKV = createMockKVNamespace({
          initialData: {
            [mockSessionToken]: JSON.stringify(mockCachedData),
          },
        });

        app.use('*', optionalAuth({ kv: mockKV as unknown as KVNamespace }));
        app.get('/test', (c) => c.json({ userId: c.get('user')?.id ?? null }));

        const res = await app.request('/test', {
          headers: {
            cookie: `${COOKIES.SESSION_NAME}=${mockSessionToken}`,
          },
        });

        const body = (await res.json()) as { userId: string | null };
        expect(body.userId).toBe('user_1');
        expect(mockDb.query.sessions.findFirst).not.toHaveBeenCalled();

        const readKeys = mockKV.get.mock.calls.map((call) => call[0]);
        expect(readKeys).toEqual([mockSessionToken]);
        expect(readKeys).not.toContain(`session:${mockSessionToken}`);
      });

      it('never writes or deletes in AUTH_SESSION_KV on any path', async () => {
        // Cache hit
        mockKV.get.mockResolvedValueOnce(mockCachedData);
        app.use('*', optionalAuth({ kv: mockKV as unknown as KVNamespace }));
        app.get('/test', (c) => c.json({ hasUser: !!c.get('user') }));
        const cookie = `${COOKIES.SESSION_NAME}=${mockSessionToken}`;
        await app.request('/test', { headers: { cookie } });

        // Cache miss -> database hit
        mockKV.get.mockResolvedValueOnce(null);
        mockDb.query.sessions.findFirst.mockResolvedValueOnce(dbRow());
        await app.request('/test', { headers: { cookie } });

        // Expired cache entry
        mockKV.get.mockResolvedValueOnce({
          ...mockCachedData,
          session: {
            ...mockSession,
            expiresAt: new Date(Date.now() - 1000).toISOString(),
          },
        });
        mockDb.query.sessions.findFirst.mockResolvedValueOnce(null);
        await app.request('/test', { headers: { cookie } });

        expect(mockKV.get).toHaveBeenCalledTimes(3);
        expect(mockKV.put).not.toHaveBeenCalled();
        expect(mockKV.delete).not.toHaveBeenCalled();
      });
    });

    describe('Logging', () => {
      it('should log authentication when enabled', async () => {
        const consoleSpy = vi
          .spyOn(console, 'info')
          .mockImplementation(() => {});

        // Mock cache miss so logging happens
        mockKV.get.mockResolvedValue(null);

        // Mock database query success
        mockDb.query.sessions.findFirst.mockResolvedValue({
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

        app.use(
          '*',
          optionalAuth({
            kv: mockKV as unknown as KVNamespace,
            enableLogging: true,
          })
        );
        app.get('/test', (c) => c.json({ success: true }));

        await app.request('/test', {
          headers: {
            cookie: `${COOKIES.SESSION_NAME}=${mockSessionToken}`,
          },
        });

        // The fallback ObservabilityClient formats logs as a single dev string
        expect(consoleSpy).toHaveBeenCalledOnce();
        const logOutput = consoleSpy.mock.calls[0]?.[0] as string;
        expect(logOutput).toContain('Session authenticated');
        expect(logOutput).toContain('user_1');

        consoleSpy.mockRestore();
      });

      it('should not log when disabled (default)', async () => {
        const consoleSpy = vi
          .spyOn(console, 'info')
          .mockImplementation(() => {});

        mockKV.get.mockResolvedValue(mockCachedData);

        app.use('*', optionalAuth({ kv: mockKV as unknown as KVNamespace }));
        app.get('/test', (c) => c.json({ success: true }));

        await app.request('/test', {
          headers: {
            cookie: `${COOKIES.SESSION_NAME}=${mockSessionToken}`,
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
        mockKV.get.mockResolvedValue(mockCachedData);

        app.use(
          '/protected/*',
          requireAuth({ kv: mockKV as unknown as KVNamespace })
        );
        app.get('/protected/resource', (c) => {
          const user = c.get('user');
          return c.json({ userId: user?.id });
        });

        const res = await app.request('/protected/resource', {
          headers: {
            cookie: `${COOKIES.SESSION_NAME}=${mockSessionToken}`,
          },
        });

        expect(res.status).toBe(200);
        const body = (await res.json()) as { userId?: string };
        expect(body.userId).toBe('user_1');
      });
    });

    describe('No Session', () => {
      it('should return 401 when no cookie', async () => {
        app.use(
          '/protected/*',
          requireAuth({ kv: mockKV as unknown as KVNamespace })
        );
        app.get('/protected/resource', (c) => c.json({ data: 'secret' }));

        const res = await app.request('/protected/resource', {
          headers: {}, // No cookie
        });

        expect(res.status).toBe(401);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body).toEqual({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        });
      });

      it('should return 401 when session invalid', async () => {
        mockKV.get.mockResolvedValue(null);
        mockDb.query.sessions.findFirst.mockResolvedValue(null);

        app.use(
          '/protected/*',
          requireAuth({ kv: mockKV as unknown as KVNamespace })
        );
        app.get('/protected/resource', (c) => c.json({ data: 'secret' }));

        const res = await app.request('/protected/resource', {
          headers: {
            cookie: 'codex-session=invalid_token',
          },
        });

        expect(res.status).toBe(401);
        const body = (await res.json()) as {
          error: { code: string; message: string };
        };
        expect(body.error.code).toBe('UNAUTHORIZED');
      });

      it('should return 401 when session expired', async () => {
        const expiredSession = {
          ...mockCachedData,
          session: {
            ...mockSession,
            expiresAt: new Date(Date.now() - 1000).toISOString(),
          },
        };

        mockKV.get.mockResolvedValue(expiredSession);

        app.use(
          '/protected/*',
          requireAuth({ kv: mockKV as unknown as KVNamespace })
        );
        app.get('/protected/resource', (c) => c.json({ data: 'secret' }));

        const res = await app.request('/protected/resource', {
          headers: {
            cookie: `${COOKIES.SESSION_NAME}=${mockSessionToken}`,
          },
        });

        expect(res.status).toBe(401);
      });
    });

    describe('Error Handling', () => {
      it('should return 401 on database error (fail closed)', async () => {
        mockKV.get.mockResolvedValue(null);
        mockDb.query.sessions.findFirst.mockRejectedValue(
          new Error('Database error')
        );

        app.use(
          '/protected/*',
          requireAuth({ kv: mockKV as unknown as KVNamespace })
        );
        app.get('/protected/resource', (c) => c.json({ data: 'secret' }));

        const res = await app.request('/protected/resource', {
          headers: {
            cookie: `${COOKIES.SESSION_NAME}=${mockSessionToken}`,
          },
        });

        // SECURITY: Fail closed - deny access on error
        expect(res.status).toBe(401);
      });
    });

    describe('Public vs Protected Routes', () => {
      it('should protect only specified routes', async () => {
        mockKV.get.mockResolvedValue(mockCachedData);

        app.use(
          '/protected/*',
          requireAuth({ kv: mockKV as unknown as KVNamespace })
        );
        app.get('/public', (c) => c.json({ type: 'public' }));
        app.get('/protected/secret', (c) => c.json({ type: 'protected' }));

        // Public route should work without auth
        const publicRes = await app.request('/public');
        expect(publicRes.status).toBe(200);
        const publicBody = (await publicRes.json()) as { type: string };
        expect(publicBody.type).toBe('public');

        // Protected route should require auth
        const protectedRes = await app.request('/protected/secret');
        expect(protectedRes.status).toBe(401);

        // Protected route should work with auth
        const authedRes = await app.request('/protected/secret', {
          headers: {
            cookie: `${COOKIES.SESSION_NAME}=${mockSessionToken}`,
          },
        });
        expect(authedRes.status).toBe(200);
      });
    });
  });

  describe('Session and User Data Types', () => {
    it('should preserve all session fields', async () => {
      mockKV.get.mockResolvedValue(mockCachedData);

      app.use('*', optionalAuth({ kv: mockKV as unknown as KVNamespace }));
      app.get('/test', (c) => {
        const session = c.get('session');
        return c.json({ session });
      });

      const res = await app.request('/test', {
        headers: {
          cookie: `codex-session=${mockSessionToken}`,
        },
      });

      const body = (await res.json()) as { session: SessionAuthRow };
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
      mockKV.get.mockResolvedValue(mockCachedData);

      app.use('*', optionalAuth({ kv: mockKV as unknown as KVNamespace }));
      app.get('/test', (c) => {
        const user = c.get('user');
        return c.json({ user });
      });

      const res = await app.request('/test', {
        headers: {
          cookie: `codex-session=${mockSessionToken}`,
        },
      });

      const body = (await res.json()) as { user: UserAuthRow };
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
