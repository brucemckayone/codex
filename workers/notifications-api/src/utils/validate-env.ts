/**
 * Environment Validation Middleware
 *
 * Validates required environment variables once per worker instance.
 * Runs on first request, result cached in closure.
 */

import type { HonoEnv } from '@codex/shared-types';
import type { MiddlewareHandler } from 'hono';

/**
 * Creates middleware that validates environment variables.
 * Validates once per worker instance (not per request).
 *
 * Required:
 * - DATABASE_URL: PostgreSQL connection string
 * - RATE_LIMIT_KV: KV namespace for rate limiting
 *
 * Optional (with defaults):
 * - ENVIRONMENT: Defaults to 'development'
 * - WEB_APP_URL: Defaults to 'http://localhost:3000'
 * - API_URL: Defaults to 'http://localhost:8787'
 */
export function createEnvValidationMiddleware(): MiddlewareHandler<HonoEnv> {
  let validated = false;

  return async (c, next) => {
    if (!validated) {
      const env = c.env;

      // Required variables
      const required = ['DATABASE_URL'];
      const missing = required.filter((key) => !env[key as keyof typeof env]);

      if (missing.length > 0) {
        console.error(
          `[notifications-api] Missing required environment variables: ${missing.join(', ')}`
        );
        return c.json(
          {
            error: {
              code: 'CONFIGURATION_ERROR',
              message: 'Service misconfigured',
              status: 500,
            },
          },
          500
        );
      }

      // Required KV bindings
      if (!env.RATE_LIMIT_KV) {
        console.error(
          '[notifications-api] Missing required KV binding: RATE_LIMIT_KV'
        );
        return c.json(
          {
            error: {
              code: 'CONFIGURATION_ERROR',
              message: 'Service misconfigured',
              status: 500,
            },
          },
          500
        );
      }

      // Optional variables - log warnings if missing
      const optional = ['ENVIRONMENT', 'WEB_APP_URL', 'API_URL'];
      const missingOptional = optional.filter(
        (key) => !env[key as keyof typeof env]
      );

      if (missingOptional.length > 0) {
        console.warn(
          `[notifications-api] Missing optional environment variables (using defaults): ${missingOptional.join(', ')}`
        );
      }

      validated = true;
    }

    await next();
  };
}
