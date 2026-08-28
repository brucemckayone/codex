/// <reference types="@cloudflare/workers-types" />

import { COOKIES } from '@codex/constants';
import { createDbClient, type DbEnvVars, schema } from '@codex/database';
import { ObservabilityClient } from '@codex/observability';

const fallbackObs = new ObservabilityClient('session-auth');

import { and, eq, gt } from 'drizzle-orm';
import type { Context, Next } from 'hono';
import { extractSessionCookie } from './session-cookie';

/**
 * Auth-row shape: the session record as joined from the database during
 * authentication. Internal to @codex/security — populated by the Hono
 * middleware then projected to the canonical `SessionData` from
 * @codex/shared-types via `c.set('session', ...)`.
 *
 * This is NOT the same as the wire/Variables `SessionData` — that lives in
 * @codex/shared-types and is the single source of truth for what handlers see
 * on `ctx.session`. Renaming here (vs the old `SessionData`) prevents the
 * cross-package divergence trap where two same-named types describe different
 * shapes — see iter-004 F4 proof test for the historical bug.
 */
export interface SessionAuthRow {
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
 * Auth-row shape: the user record as joined alongside the session. Internal
 * to @codex/security. See `SessionAuthRow` for why this isn't named `UserData`.
 *
 * Note: `name` is `string | null` — BetterAuth allows accounts before profile
 * completion, so the column is nullable. The canonical wire `UserData` from
 * @codex/shared-types reflects the same.
 */
export interface UserAuthRow {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  image: string | null;
  role: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

/**
 * Cached session data structure stored in KV.
 * Uses the auth-row shapes since this is internal to the security package's
 * cache layer (not the canonical wire shape consumers see on `ctx.session`).
 */
export interface CachedSessionData {
  session: SessionAuthRow;
  user: UserAuthRow;
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
   * KV namespace holding the BetterAuth-owned session cache (optional).
   * Read-only from here — see `getSessionFromCache` for the ownership rule.
   * If not provided (and `env.AUTH_SESSION_KV` is absent), sessions are
   * queried from the database on every request.
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

    // SECURITY: A soft-deleted account must never authenticate, even with a
    // session row that is otherwise valid and unexpired. Account deletion
    // (Codex-eb00a.11) sets users.deletedAt and invalidates the current
    // session's KV entry; this gate closes the DB-fallback path for that
    // session and for any other still-cached sessions once their KV lapses.
    if (user.deletedAt) {
      return null;
    }

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
 * Retrieve a session from the shared AUTH_SESSION_KV cache.
 *
 * OWNERSHIP: BetterAuth's `secondaryStorage` adapter — `createKVSecondaryStorage`
 * from this package, wired in `workers/auth/src/auth-config.ts` — is the ONLY
 * writer of session entries in this namespace. It stores them under the bare
 * session token as `{ session, user }`, with a KV TTL equal to the session's
 * remaining lifetime, and deletes them on sign-out / revocation. This
 * middleware is a read-only consumer of those entries.
 *
 * History (Codex-kgrdp.7): this module used to be a second writer, keyed
 * `session:${token}`, and probed that key BEFORE the bare token. A census of
 * AUTH_SESSION_KV in production on 2026-08-26 found 8 keys and zero with a
 * `session:` prefix, so the prefixed probe was a guaranteed miss that doubled
 * the KV reads on every session validation. Reconciled to one namespace, one
 * writer, one read.
 *
 * @param kv - KV namespace
 * @param sessionToken - Session token (the cache key BetterAuth writes)
 * @param obs - Optional observability client for structured logging
 * @returns Cached session data or null if not found
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
    // SECURITY: Cache read failure must not break authentication — fall
    // through to the database. Log through the module fallback when no
    // request-scoped client is present so a degraded KV never fails silently.
    (obs ?? fallbackObs).error('Failed to read session from KV', {
      error: error instanceof Error ? error.message : 'Unknown error',
      // SECURITY: Don't log the session token
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
 * - Reads (never writes) the BetterAuth-owned session cache in
 *   AUTH_SESSION_KV for performance, with database fallback
 * - Gracefully handles cache failures (degrades to DB-only)
 * - Gracefully handles database errors (proceeds without auth)
 * - Never exposes sensitive data in errors
 *
 * USAGE:
 * ```typescript
 * app.use('*', optionalAuth({ kv: c.env.AUTH_SESSION_KV }));
 *
 * // Later in route handlers:
 * const user = c.get('user'); // UserAuthRow | undefined
 * const session = c.get('session'); // SessionAuthRow | undefined
 * ```
 *
 * @param config - Session authentication configuration
 * @returns Hono middleware function
 */
export function optionalAuth(config?: SessionAuthConfig) {
  const cookieName = config?.cookieName || COOKIES.SESSION_NAME;
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
          // SECURITY: An expired cached session must not authenticate — fall
          // through to the database, which re-checks against current state.
          //
          // We deliberately do NOT delete the entry: BetterAuth owns this
          // namespace and set the entry's KV TTL from the same expiry, so KV
          // reaps it on its own within the expiration lag. Deleting here would
          // make this read-only consumer a writer again (Codex-kgrdp.7) and
          // spend a KV write on the auth hot path to no effect.
          (obs ?? fallbackObs).warn('Expired session found in cache', {
            userId: cachedSession.user.id,
            expiresAt: cachedSession.session.expiresAt,
          });
        }
      }
    }

    // Cache miss or no KV - query database
    if (enableLogging) {
      obs?.debug('[session-auth] Querying database for token', {
        tokenPrefix: `${sessionToken.substring(0, 10)}...`,
      });
    }
    const sessionData = await querySessionFromDatabase(
      sessionToken,
      c.env as DbEnvVars,
      obs
    );
    if (enableLogging) {
      obs?.debug('[session-auth] Database query result', {
        found: sessionData !== null,
        userId: sessionData?.user.id,
        role: sessionData?.user.role,
      });
    }

    if (sessionData) {
      // Valid session from database - set context
      c.set('session', sessionData.session);
      c.set('user', sessionData.user);

      // No cache write-back: BetterAuth's secondaryStorage is the single
      // owner of session entries in AUTH_SESSION_KV (see getSessionFromCache).
      // It populates the entry inside the auth worker's own request, where the
      // write is awaited; the fire-and-forget write this middleware used to do
      // was cancelled with the request context and never landed.

      if (enableLogging) {
        (obs ?? fallbackObs).info('Session authenticated', {
          userId: sessionData.user.id,
          cache: kv ? 'miss' : 'unavailable',
        });
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
 *   const user = c.get('user'); // UserAuthRow (guaranteed)
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
