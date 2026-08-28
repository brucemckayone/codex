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
 * Cached session data structure stored in KV.
 *
 * Mirrors the canonical `SessionData` / `UserData` shapes from
 * @codex/shared-types — auth-row only, no profile fields. Code needing
 * `username` / `bio` / `socialLinks` MUST fetch them from identity-api
 * (`getProfile()`); they are NOT cached alongside the session.
 *
 * History: the cache previously included those profile fields with a comment
 * justifying it as "SSR profile rendering perf." That created the silent-
 * undefined bug iter-004 F4 caught — the canonical Hono `Variables.user`
 * never claimed those fields would be populated, so handlers reading them
 * got undefined at runtime. Aligning the cache with the canonical wire shape
 * is the structural fix.
 *
 * `name: string | null` mirrors the DB column (BetterAuth allows pre-profile
 * accounts).
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
    name: string | null;
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
 * Retrieve session from KV cache.
 *
 * ONE read, against BetterAuth's own key (the bare token). BetterAuth's
 * `secondaryStorage` is the SINGLE OWNER of session entries in
 * AUTH_SESSION_KV — see `createKVSecondaryStorage` — and this middleware is a
 * read-only consumer of them (Codex-kgrdp.7).
 *
 * The `session:${token}` fallback this used to probe second is gone: nothing
 * writes that key any more, so it was a guaranteed miss costing an extra KV
 * read on every cache miss.
 */
async function getSessionFromCache(
  kv: KVNamespace,
  sessionToken: string,
  obs?: ObservabilityClient
): Promise<CachedSessionData | null> {
  try {
    const cached = await kv.get(sessionToken, 'json');
    return isCachedSessionData(cached) ? cached : null;
  } catch (error) {
    obs?.error('[SessionMiddleware] Failed to read session from KV', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
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
            // Present but expired. Deliberately NOT deleted: this middleware is
            // a read-only consumer of BetterAuth's key space, and BetterAuth
            // already set the entry's expirationTtl from the same expiresAt, so
            // KV reaps it on its own. Requests in the meantime fall through to
            // the DB and are rejected there.
            obs?.warn('[SessionMiddleware] Expired session found in cache', {
              userId: cachedSession.user.id,
              expiresAt: cachedSession.session.expiresAt,
            });
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

          // NOT cached here. BetterAuth's `secondaryStorage` owns session
          // entries in AUTH_SESSION_KV and writes them from inside the auth
          // worker's own request, where the put is awaited. The write-back
          // that used to sit here was fire-and-forget without `waitUntil`, so
          // workerd cancelled it with the request context — and when it did
          // land it overwrote BetterAuth's own entry with a NARROWER 8-field
          // user projection, which BetterAuth then read back. A cache miss
          // here simply costs the DB query it just made (Codex-kgrdp.7).
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
