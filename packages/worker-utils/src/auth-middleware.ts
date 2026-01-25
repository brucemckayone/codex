/**
 * Authentication Middleware
 *
 * Session validation middleware for Cloudflare Workers.
 * Validates session cookies, queries database, and caches sessions in KV.
 *
 * This middleware sets `c.set('user', ...)` and `c.set('session', ...)` in the context.
 * Use with `enableGlobalAuth: true` in createWorker() or apply manually.
 */

/// <reference types="@cloudflare/workers-types" />

import { COOKIES } from '@codex/constants';
import { createDbClient } from '@codex/database';
import { sessions } from '@codex/database/schema';
import type { ObservabilityClient } from '@codex/observability';
import type { HonoEnv } from '@codex/shared-types';
import { and, eq, gt } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';

/**
 * Cached session data structure stored in KV
 */
interface CachedSessionData {
  session: {
    id: string;
    userId: string;
    token: string;
    expiresAt: string;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: string;
    updatedAt: string;
  };
  user: {
    id: string;
    email: string;
    name: string;
    emailVerified: boolean;
    image: string | null;
    role: string;
    createdAt: string;
    updatedAt: string;
  };
}

/**
 * Type guard for cached session data
 */
function isCachedSessionData(value: unknown): value is CachedSessionData {
  if (!value || typeof value !== 'object') return false;
  const data = value as { session?: unknown; user?: unknown };
  return Boolean(data.session && data.user);
}

/**
 * Retrieve session from KV cache
 */
async function getSessionFromCache(
  kv: KVNamespace,
  sessionToken: string,
  obs?: ObservabilityClient
): Promise<CachedSessionData | null> {
  try {
    const keys = [`session:${sessionToken}`, sessionToken];
    for (const key of keys) {
      const cached = await kv.get(key, 'json');
      if (isCachedSessionData(cached)) {
        return cached;
      }
    }
    return null;
  } catch (error) {
    obs?.error('[SessionMiddleware] Failed to read session from KV', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

/**
 * Cache session data in KV with TTL based on session expiration
 */
async function cacheSessionInKV(
  kv: KVNamespace,
  sessionToken: string,
  data: CachedSessionData,
  obs?: ObservabilityClient
): Promise<void> {
  try {
    const expiresAt = new Date(data.session.expiresAt);
    const ttl = Math.floor((expiresAt.getTime() - Date.now()) / 1000);

    if (ttl > 0) {
      await kv.put(`session:${sessionToken}`, JSON.stringify(data), {
        expirationTtl: ttl,
      });
    }
  } catch (error) {
    obs?.error('[SessionMiddleware] Failed to cache session in KV', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Extract session token from cookie header
 *
 * Tries multiple cookie names in order:
 * 1. codex-session
 * 2. __Secure-codex-session
 * 3. better-auth.session_token
 * 4. __Secure-better-auth.session_token
 */
function extractSessionToken(cookieHeader: string): string | null {
  let match = cookieHeader.match(new RegExp(`${COOKIES.SESSION_NAME}=([^;]+)`));
  if (!match) {
    match = cookieHeader.match(
      new RegExp(`__Secure-${COOKIES.SESSION_NAME}=([^;]+)`)
    );
  }
  if (!match) {
    match = cookieHeader.match(/better-auth\.session_token=([^;]+)/);
  }
  if (!match) {
    match = cookieHeader.match(/__Secure-better-auth\.session_token=([^;]+)/);
  }

  return match?.[1] || null;
}

/**
 * Session middleware options
 */
export interface SessionMiddlewareOptions {
  /**
   * Whether authentication is required
   * - If true: Returns 401 if no valid session
   * - If false: Sets user to undefined if no session (optional auth)
   */
  required?: boolean;

  /**
   * KV namespace for session caching
   * If not provided, sessions are not cached
   */
  cacheKV?: KVNamespace;
}

/**
 * Create session validation middleware
 *
 * Validates session cookie, queries database, and caches in KV.
 * Sets `c.set('user', ...)` and `c.set('session', ...)` in context.
 *
 * @example
 * ```typescript
 * // Required authentication
 * app.use('*', createSessionMiddleware({ required: true }));
 *
 * // Optional authentication
 * app.use('*', createSessionMiddleware({ required: false }));
 *
 * // With KV caching
 * app.use('*', createSessionMiddleware({
 *   required: true,
 *   cacheKV: env.AUTH_SESSION_KV,
 * }));
 * ```
 */
export function createSessionMiddleware(
  options: SessionMiddlewareOptions = {}
): MiddlewareHandler<HonoEnv> {
  const { required = false, cacheKV } = options;

  return async (c: Context<HonoEnv>, next) => {
    const obs = c.get('obs');
    const sessionCookie = c.req.header('cookie');

    // No cookie header - skip auth
    if (!sessionCookie) {
      if (required) {
        return c.json(
          {
            error: {
              code: 'UNAUTHORIZED',
              message: 'Authentication required',
            },
          },
          401
        );
      }
      await next();
      return;
    }

    // Extract session token from cookie
    const rawToken = extractSessionToken(sessionCookie);
    if (!rawToken) {
      if (required) {
        return c.json(
          {
            error: {
              code: 'UNAUTHORIZED',
              message: 'Authentication required',
            },
          },
          401
        );
      }
      await next();
      return;
    }

    try {
      // URL-decode the token (cookies are URL-encoded)
      const fullToken = decodeURIComponent(rawToken);
      // Better Auth tokens may be in format: token.signature
      // Try both the split token (before dot) and full token
      const splitToken = fullToken.split('.')[0] || fullToken;

      // Try cache first (if KV available)
      const kv = cacheKV || (c.env.AUTH_SESSION_KV as KVNamespace | undefined);
      let user = null;

      if (kv) {
        const cachedSession = await getSessionFromCache(kv, splitToken, obs);

        if (cachedSession) {
          // Validate expiration (defense in depth)
          const expiresAt = new Date(cachedSession.session.expiresAt);
          if (expiresAt > new Date()) {
            // Valid cached session - set context
            c.set('session', cachedSession.session);
            c.set('user', cachedSession.user);
            user = cachedSession.user;
            obs?.info('[SessionMiddleware] User authenticated from cache', {
              userId: cachedSession.user.id,
              role: cachedSession.user.role,
            });
          } else {
            // Expired session in cache - clear it
            kv.delete(`session:${splitToken}`).catch(() => {});
          }
        }
      }

      // If still no user, query database
      if (!user) {
        // Create database client with request environment
        const db = createDbClient(c.env);

        // Query session from database - try split token first
        let sessionData = await db.query.sessions.findFirst({
          where: and(
            eq(sessions.token, splitToken),
            gt(sessions.expiresAt, new Date())
          ),
          with: {
            user: true,
          },
        });

        // If not found and tokens differ, try full token
        if (!sessionData && splitToken !== fullToken) {
          sessionData = await db.query.sessions.findFirst({
            where: and(
              eq(sessions.token, fullToken),
              gt(sessions.expiresAt, new Date())
            ),
            with: {
              user: true,
            },
          });
        }

        if (sessionData) {
          // Valid session found - set context
          c.set('session', sessionData);
          c.set('user', sessionData.user);
          user = sessionData.user;
          obs?.info('[SessionMiddleware] User authenticated from database', {
            userId: sessionData.user.id,
            role: sessionData.user.role,
          });

          // Cache it for next time (if KV available)
          if (kv) {
            const cacheData: CachedSessionData = {
              session: {
                id: sessionData.id,
                userId: sessionData.userId,
                token: sessionData.token,
                expiresAt:
                  sessionData.expiresAt instanceof Date
                    ? sessionData.expiresAt.toISOString()
                    : sessionData.expiresAt,
                ipAddress: sessionData.ipAddress ?? null,
                userAgent: sessionData.userAgent ?? null,
                createdAt:
                  sessionData.createdAt instanceof Date
                    ? sessionData.createdAt.toISOString()
                    : sessionData.createdAt,
                updatedAt:
                  sessionData.updatedAt instanceof Date
                    ? sessionData.updatedAt.toISOString()
                    : sessionData.updatedAt,
              },
              user: {
                id: sessionData.user.id,
                email: sessionData.user.email,
                name: sessionData.user.name,
                emailVerified: sessionData.user.emailVerified,
                image: sessionData.user.image ?? null,
                role: sessionData.user.role,
                createdAt:
                  sessionData.user.createdAt instanceof Date
                    ? sessionData.user.createdAt.toISOString()
                    : sessionData.user.createdAt,
                updatedAt:
                  sessionData.user.updatedAt instanceof Date
                    ? sessionData.user.updatedAt.toISOString()
                    : sessionData.user.updatedAt,
              },
            };
            // Fire and forget - don't wait for cache
            cacheSessionInKV(kv, splitToken, cacheData, obs).catch(() => {});
          }
        }
      }

      // Check if auth was successful
      if (!user && required) {
        return c.json(
          {
            error: {
              code: 'UNAUTHORIZED',
              message: 'Authentication required',
            },
          },
          401
        );
      }

      // Proceed to next middleware/handler
      await next();
    } catch (error) {
      obs?.error('[SessionMiddleware] Session validation error', {
        error: error instanceof Error ? error.message : String(error),
      });

      if (required) {
        return c.json(
          {
            error: {
              code: 'UNAUTHORIZED',
              message: 'Authentication failed',
            },
          },
          401
        );
      }

      // For optional auth, continue without user
      await next();
    }
  };
}
