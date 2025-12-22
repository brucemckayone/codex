/**
 * Settings Facade Middleware
 *
 * Automatically creates and cleans up database client and PlatformSettingsFacade
 * for all settings routes. Eliminates boilerplate try/finally cleanup code.
 *
 * Usage:
 *   app.use('/api/organizations/:id/settings/*', withSettingsFacade());
 *
 * Context Variables Set:
 *   - settingsFacade: PlatformSettingsFacade instance
 *   - db: Database client (for advanced use cases)
 */

import { R2Service } from '@codex/cloudflare-clients';
import {
  createPerRequestDbClient,
  type Database,
  type DatabaseWs,
} from '@codex/database';
import { PlatformSettingsFacade } from '@codex/platform-settings';
import type { HonoEnv } from '@codex/shared-types';
import type { MiddlewareHandler } from 'hono';

/**
 * Creates PlatformSettingsFacade middleware with automatic resource cleanup.
 *
 * Lifecycle:
 * 1. Extract organizationId from route params (:id)
 * 2. Create per-request database client (WebSocket for transactions)
 * 3. Instantiate PlatformSettingsFacade with R2 if available
 * 4. Set facade and db in context
 * 5. Execute route handler
 * 6. Cleanup database connection (even if handler throws)
 *
 * @returns Middleware that injects settingsFacade and db into context
 */
export function withSettingsFacade(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    // Extract org ID from route params
    const orgId = c.req.param('id');
    if (!orgId) {
      return c.json(
        {
          error: {
            code: 'INVALID_REQUEST',
            message: 'Organization ID is required in route params',
          },
        },
        400
      );
    }

    // Create per-request database client
    const { db, cleanup } = createPerRequestDbClient(c.env);

    try {
      // Create R2Service if bucket is available
      const r2 = c.env.MEDIA_BUCKET
        ? new R2Service(c.env.MEDIA_BUCKET)
        : undefined;

      // Build public URL base for logos
      // In production, configure via R2 custom domain or CDN
      // For now, we use direct R2 paths that the service will store
      const r2PublicUrlBase = undefined;

      // Instantiate facade
      const facade = new PlatformSettingsFacade({
        db: db as Database | DatabaseWs,
        environment: c.env.ENVIRONMENT || 'development',
        organizationId: orgId,
        r2,
        r2PublicUrlBase,
      });

      // Inject into context for route handlers
      c.set('settingsFacade', facade);
      c.set('db', db);

      // Execute route handler
      await next();
    } finally {
      // Always cleanup database connection
      await cleanup();
    }
  };
}
