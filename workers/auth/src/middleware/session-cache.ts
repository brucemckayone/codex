/**
 * Session Cache Middleware
 *
 * Caches authenticated sessions in KV to reduce database load.
 * Implements a read-through cache pattern with automatic TTL based on session expiry.
 */

import { Context, Next } from 'hono';
import type { AuthEnv } from '../types';
import type { SessionData, UserData } from '@codex/shared-types';

/**
 * Cached session data structure
 */
interface CachedSessionData {
  session: SessionData;
  user: UserData;
}

/**
 * Session cache middleware
 *
 * Checks KV cache for existing sessions before falling back to database.
 * Automatically caches new sessions with TTL matching session expiry.
 *
 * @returns Hono middleware handler
 */
export function createSessionCacheMiddleware() {
  return async (c: Context<AuthEnv>, next: Next) => {
    const sessionCookie = c.req
      .header('cookie')
      ?.match(/codex-session=([^;]+)/)?.[1];

    if (!sessionCookie) {
      return next();
    }

    const kv = c.env.AUTH_SESSION_KV;
    if (kv) {
      // Try to get cached session
      const cachedSession = await kv.get<CachedSessionData>(
        `session:${sessionCookie}`,
        'json'
      );
      if (cachedSession) {
        c.set('session', cachedSession.session);
        c.set('user', cachedSession.user);
        return next();
      }
    }

    // If not in cache, let BetterAuth handle it
    await next();

    // Cache the session if it was set by BetterAuth
    const session = c.get('session');
    if (session && kv) {
      const user = c.get('user');
      const expiresAt =
        typeof session.expiresAt === 'string'
          ? new Date(session.expiresAt)
          : session.expiresAt;
      const ttl = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
      await kv.put(
        `session:${sessionCookie}`,
        JSON.stringify({ session, user }),
        { expirationTtl: ttl }
      );
    }
  };
}
