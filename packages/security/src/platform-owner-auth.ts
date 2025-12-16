/// <reference types="@cloudflare/workers-types" />

import type { Context, Next } from 'hono';
import { requireAuth, type SessionAuthConfig } from './session-auth';

/**
 * Platform Owner Authentication Middleware
 *
 * Requires valid session AND user.role === 'platform_owner'.
 * Uses requireAuth internally for session validation.
 *
 * SECURITY FEATURES:
 * - All security features from requireAuth
 * - Returns 403 Forbidden if user role is not 'platform_owner'
 * - Fails closed (denies access) on role check failure
 *
 * USAGE:
 * ```typescript
 * // Protect admin routes
 * app.use('/api/admin/*', requirePlatformOwner());
 *
 * // User is guaranteed to be platform owner in protected routes
 * app.get('/api/admin/analytics', (c) => {
 *   const user = c.get('user'); // UserData with role = 'platform_owner'
 *   return c.json({ analytics: [...] });
 * });
 * ```
 *
 * @param config - Session authentication configuration
 * @returns Hono middleware function
 */
export function requirePlatformOwner(config?: SessionAuthConfig) {
  const requireAuthMiddleware = requireAuth(config);

  return async (c: Context, next: Next) => {
    // Run requireAuth first - this will return 401 if not authenticated
    const authResponse = await requireAuthMiddleware(c, async () => {
      // Intentionally empty: role verification happens below
    });

    // If requireAuth returned early (401), return that response
    if (authResponse) {
      return authResponse;
    }

    // Check if user has platform_owner role
    const user = c.get('user');

    if (!user || user.role !== 'platform_owner') {
      // SECURITY: Return 403 Forbidden - user is authenticated but not authorized
      return c.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'Platform owner access required',
          },
        },
        403
      );
    }

    // User is authenticated AND is a platform owner - proceed
    return next();
  };
}
