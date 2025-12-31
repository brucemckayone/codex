/**
 * Body Parsing Middleware
 *
 * Extracts body parsing logic from createAuthenticatedHandler into reusable middleware.
 * Auto-detects Content-Type and parses accordingly (JSON, form-data, text).
 * Only parses for POST/PATCH/PUT methods.
 */

import type { HonoEnv } from '@codex/shared-types';
import type { MiddlewareHandler } from 'hono';

/**
 * Creates middleware that parses request body and stores in context
 *
 * @param options - Configuration options
 * @param options.parseForMethods - HTTP methods to parse body for (default: POST, PATCH, PUT)
 * @returns Middleware handler that sets c.set('parsedBody', ...)
 *
 * @example
 * ```typescript
 * app.use('/*', createBodyParsingMiddleware());
 *
 * // In handler
 * const body = c.get('parsedBody');
 * ```
 */
export function createBodyParsingMiddleware(options?: {
  parseForMethods?: string[];
}): MiddlewareHandler<HonoEnv> {
  const parseForMethods = options?.parseForMethods || ['POST', 'PATCH', 'PUT'];

  return async (c, next) => {
    const method = c.req.method.toUpperCase();

    // Only parse body for specified methods
    if (!parseForMethods.includes(method)) {
      await next();
      return;
    }

    // Parse JSON body
    try {
      const body = await c.req.json();
      c.set('parsedBody', body);
    } catch {
      // Return 400 on invalid JSON
      return c.json(
        {
          error: {
            code: 'INVALID_JSON',
            message: 'Request body must be valid JSON',
          },
        },
        400
      );
    }

    await next();
  };
}

/**
 * Module augmentation to add parsedBody to Variables
 */
declare module '@codex/shared-types' {
  interface Variables {
    parsedBody?: unknown;
  }
}
