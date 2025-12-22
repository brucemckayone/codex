/// <reference types="@cloudflare/workers-types" />

import { createDbClient, type DbEnvVars, schema } from '@codex/database';
import type { ObservabilityClient } from '@codex/observability';
import { and, eq, gt } from 'drizzle-orm';
import type { Context, Next } from 'hono';

/**
 * Session data stored in KV cache and Hono context
 */
export interface SessionData {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date | string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

/**
 * User data stored in KV cache and Hono context
 */
export interface UserData {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  image: string | null;
  role: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

/**
 * Cached session data structure stored in KV
 */
export interface CachedSessionData {
  session: SessionData;
  user: UserData;
}

function isCachedSessionData(value: unknown): value is CachedSessionData {
  if (!value || typeof value !== 'object') return false;
  const data = value as { session?: unknown; user?: unknown };
  return Boolean(data.session && data.user);
}

/**
 * Configuration options for session authentication middleware
 */
export interface SessionAuthConfig {
  /**
   * KV namespace for session caching (optional)
   * If not provided, sessions will be queried from database on every request
   */
  kv?: KVNamespace;

  /**
   * Cookie name for session token (default: 'codex-session')
   */
  cookieName?: string;

  /**
   * Whether to log authentication failures (default: false)
   * When enabled, logs will NOT include sensitive session data
   */
  enableLogging?: boolean;
}

/**
 * Extract session cookie from request headers
 *
 * SECURITY: Uses regex to safely extract cookie value without eval or injection risks
 *
 * BetterAuth Format: The cookie value is `{token}.{signature}` format.
 * We extract only the token part (before the dot) for database queries,
 * as BetterAuth stores just the token in the sessions table.
 *
 * @param cookieHeader - Raw Cookie header value
 * @param cookieName - Name of the session cookie
 * @returns Session token or null if not found
 */
function extractSessionCookie(
  cookieHeader: string | undefined,
  cookieName: string
): string | null {
  if (!cookieHeader) return null;

  const cookieNames = [
    cookieName,
    `__Secure-${cookieName}`,
    'better-auth.session_token',
    '__Secure-better-auth.session_token',
  ];
  let matchedValue: string | null = null;

  for (const name of new Set(cookieNames)) {
    // SECURITY: Escape special regex characters in cookie name
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`${escapedName}=([^;]+)`);
    const match = cookieHeader.match(regex);

    if (match?.[1]) {
      matchedValue = match[1];
      break;
    }
  }

  if (!matchedValue) return null;

  // URL decode the cookie value first
  const decodedValue = decodeURIComponent(matchedValue);

  // BetterAuth uses `{token}.{signature}` format - extract just the token
  // The token part is stored in the database
  const dotIndex = decodedValue.indexOf('.');
  if (dotIndex > 0) {
    return decodedValue.substring(0, dotIndex);
  }

  return decodedValue;
}

/**
 * Query session and user from database
 *
 * SECURITY CHECKS:
 * 1. Validates session exists in database
 * 2. Validates session has not expired (expiresAt > now)
 * 3. Joins with user table to get user data
 * 4. Returns null if session invalid or expired
 *
 * @param sessionToken - Session token from cookie
 * @param env - Database environment variables from request context
 * @param obs - Optional observability client for structured logging
 * @returns Session and user data, or null if invalid
 */
async function querySessionFromDatabase(
  sessionToken: string,
  env: DbEnvVars,
  obs?: ObservabilityClient
): Promise<CachedSessionData | null> {
  try {
    // Create a request-scoped database client using the environment from c.env
    const db = createDbClient(env);

    // SECURITY: Use parameterized query via Drizzle ORM to prevent SQL injection
    const result = await db.query.sessions.findFirst({
      where: and(
        eq(schema.sessions.token, sessionToken),
        gt(schema.sessions.expiresAt, new Date()) // SECURITY: Only valid (non-expired) sessions
      ),
      with: {
        user: true, // Join with users table
      },
    });

    // SECURITY: Validate both session and user exist
    if (!result || !result.user) {
      return null;
    }

    // TypeScript type assertion - we've validated user exists above
    const user = result.user as typeof schema.users.$inferSelect;

    // Transform database result to cached data structure
    const sessionData: CachedSessionData = {
      session: {
        id: result.id,
        userId: result.userId,
        token: result.token,
        expiresAt: result.expiresAt,
        ipAddress: result.ipAddress ?? null,
        userAgent: result.userAgent ?? null,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
      },
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: user.emailVerified,
        image: user.image,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    };

    return sessionData;
  } catch (error) {
    // SECURITY: Log error but don't expose database internals to caller
    obs?.error('Database query error in session authentication', {
      error: error instanceof Error ? error.message : 'Unknown error',
      // SECURITY: Don't log session token
    });
    return null;
  }
}

/**
 * Cache session data in KV with TTL based on session expiration
 *
 * SECURITY:
 * - Uses session expiration time as KV TTL to auto-cleanup
 * - Cache key format: `session:${token}` for namespacing
 *
 * @param kv - KV namespace
 * @param sessionToken - Session token (used as cache key)
 * @param data - Session and user data to cache
 * @param obs - Optional observability client for structured logging
 */
async function cacheSessionInKV(
  kv: KVNamespace,
  sessionToken: string,
  data: CachedSessionData,
  obs?: ObservabilityClient
): Promise<void> {
  try {
    // Calculate TTL in seconds until session expires
    const expiresAt =
      typeof data.session.expiresAt === 'string'
        ? new Date(data.session.expiresAt)
        : data.session.expiresAt;

    const ttl = Math.floor((expiresAt.getTime() - Date.now()) / 1000);

    // SECURITY: Only cache if TTL is positive (session not expired)
    if (ttl > 0) {
      await kv.put(`session:${sessionToken}`, JSON.stringify(data), {
        expirationTtl: ttl,
      });
    }
  } catch (error) {
    // SECURITY: Cache failure should not break authentication flow
    // Log error but continue (graceful degradation to database-only mode)
    obs?.error('Failed to cache session in KV', {
      error: error instanceof Error ? error.message : 'Unknown error',
      // SECURITY: Don't log session token or data
    });
  }
}

/**
 * Retrieve session from KV cache
 *
 * @param kv - KV namespace
 * @param sessionToken - Session token (cache key)
 * @param obs - Optional observability client for structured logging
 * @returns Cached session data or null if not found
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
    // SECURITY: Cache read failure should not break authentication
    obs?.error('Failed to read session from KV', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

/**
 * Optional authentication middleware
 *
 * Sets `session` and `user` on Hono context if valid session exists.
 * Does NOT require authentication - always proceeds to next middleware.
 *
 * SECURITY FEATURES:
 * - Validates session expiration from database
 * - Uses KV cache for performance (with database fallback)
 * - Gracefully handles cache failures (degrades to DB-only)
 * - Gracefully handles database errors (proceeds without auth)
 * - Never exposes sensitive data in errors
 *
 * USAGE:
 * ```typescript
 * app.use('*', optionalAuth({ kv: c.env.AUTH_SESSION_KV }));
 *
 * // Later in route handlers:
 * const user = c.get('user'); // UserData | undefined
 * const session = c.get('session'); // SessionData | undefined
 * ```
 *
 * @param config - Session authentication configuration
 * @returns Hono middleware function
 */
export function optionalAuth(config?: SessionAuthConfig) {
  const cookieName = config?.cookieName || 'codex-session';
  const enableLogging = config?.enableLogging || false;

  return async (c: Context, next: Next) => {
    // Get observability client from context if available
    const obs = c.get('obs');

    // Get KV namespace from config or automatically from context
    // This allows workers to automatically benefit from caching without explicit config
    const kv =
      config?.kv ||
      ((c.env as { AUTH_SESSION_KV?: KVNamespace })?.AUTH_SESSION_KV as
        | KVNamespace
        | undefined);

    // Extract session cookie from request
    const cookieHeader = c.req.header('cookie');
    const sessionToken = extractSessionCookie(cookieHeader, cookieName);

    // No session cookie - proceed without authentication
    if (!sessionToken) {
      return next();
    }

    // Try cache first (if KV available)
    if (kv) {
      const cachedSession = await getSessionFromCache(kv, sessionToken, obs);

      if (cachedSession) {
        // SECURITY: Cache hit - validate expiration client-side too (defense in depth)
        const expiresAt =
          typeof cachedSession.session.expiresAt === 'string'
            ? new Date(cachedSession.session.expiresAt)
            : cachedSession.session.expiresAt;

        if (expiresAt > new Date()) {
          // Valid cached session - set context and proceed
          c.set('session', cachedSession.session);
          c.set('user', cachedSession.user);
          return next();
        } else {
          // SECURITY: Expired session in cache - clear it
          if (enableLogging) {
            obs?.warn('Expired session found in cache', {
              userId: cachedSession.user.id,
              expiresAt: cachedSession.session.expiresAt,
            });
          }
          // Don't await - fire and forget cache cleanup
          try {
            kv.delete(`session:${sessionToken}`).catch((err: unknown) =>
              obs?.error('Failed to delete expired session from cache', {
                error: err instanceof Error ? err.message : String(err),
              })
            );
          } catch {
            // Ignore synchronous errors (e.g., if delete is not a function)
          }
        }
      }
    }

    // Cache miss or no KV - query database
    console.log(
      '[session-auth] Querying database for token:',
      `${sessionToken.substring(0, 10)}...`
    );
    const sessionData = await querySessionFromDatabase(
      sessionToken,
      c.env as DbEnvVars,
      obs
    );
    console.log(
      '[session-auth] Database query result:',
      sessionData
        ? `user=${sessionData.user.id}, role=${sessionData.user.role}`
        : 'null'
    );

    if (sessionData) {
      // Valid session from database - set context
      c.set('session', sessionData.session);
      c.set('user', sessionData.user);

      // Cache it for next time (if KV available)
      if (kv) {
        // Don't await - fire and forget cache write
        cacheSessionInKV(kv, sessionToken, sessionData, obs).catch((err) =>
          obs?.error('Failed to cache session', {
            error: err instanceof Error ? err.message : String(err),
          })
        );
      }

      if (enableLogging) {
        if (obs) {
          obs.info('Session authenticated', {
            userId: sessionData.user.id,
            method: kv ? 'database' : 'database-only',
          });
        } else {
          console.info('Session authenticated', {
            userId: sessionData.user.id,
            method: kv ? 'database' : 'database-only',
          });
        }
      }
    } else {
      // Invalid or expired session
      if (enableLogging) {
        obs?.warn('Invalid session token', {
          // SECURITY: Don't log the actual token
          tokenLength: sessionToken.length,
        });
      }
    }

    // SECURITY: Always proceed to next middleware (fail open for optional auth)
    return next();
  };
}

/**
 * Required authentication middleware
 *
 * Requires valid session - returns 401 if session missing or invalid.
 * Uses optionalAuth internally, then validates user was set.
 *
 * SECURITY FEATURES:
 * - All security features from optionalAuth
 * - Returns 401 with standard error format if auth missing
 * - Fails closed (denies access) on authentication failure
 *
 * USAGE:
 * ```typescript
 * // Protect specific routes
 * app.use('/api/protected/*', requireAuth({ kv: c.env.AUTH_SESSION_KV }));
 *
 * // User is guaranteed to exist in protected routes
 * app.get('/api/protected/profile', (c) => {
 *   const user = c.get('user'); // UserData (guaranteed)
 *   return c.json({ profile: user });
 * });
 * ```
 *
 * @param config - Session authentication configuration
 * @returns Hono middleware function
 */
export function requireAuth(config?: SessionAuthConfig) {
  const optionalAuthMiddleware = optionalAuth(config);

  return async (c: Context, next: Next) => {
    // Run optional auth first
    await optionalAuthMiddleware(c, async () => {
      // No-op - just need to run the authentication logic
    });

    // Check if user was set by optionalAuth
    const user = c.get('user');

    if (!user) {
      // SECURITY: Fail closed - return 401 if no valid session
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

    // User authenticated - proceed to next middleware
    return next();
  };
}
