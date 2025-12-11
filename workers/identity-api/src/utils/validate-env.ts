/**
 * Environment Variable Validation
 *
 * Validates required environment variables at worker initialization.
 * Fails fast if critical vars are missing to prevent runtime errors.
 */

import type { Bindings, HonoEnv } from '@codex/shared-types';
import type { Context } from 'hono';

/**
 * Validates required environment variables
 * @throws {Error} If any required variables are missing
 */
function validateEnvironment(env: Bindings): void {
  // Required environment variables - worker fails without these
  const required = ['DATABASE_URL', 'RATE_LIMIT_KV'] as const;

  const missing: string[] = [];

  for (const key of required) {
    if (!env[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    const errorMessage = [
      `❌ Missing required environment variables: ${missing.join(', ')}`,
      '',
      'Required variables:',
      '  - DATABASE_URL: PostgreSQL connection string',
      '  - RATE_LIMIT_KV: KV namespace binding for rate limiting',
      '',
      'Solutions:',
      '  • Local dev: Create .dev.vars file (see .dev.vars.example)',
      '  • Test env: Create .dev.vars.test file',
      '  • Production: Set via wrangler CLI: wrangler secret put <VAR_NAME> --env production',
      '',
    ].join('\n');

    throw new Error(errorMessage);
  }

  // Optional variables - warn if missing but don't fail
  const optional: Array<keyof Bindings> = [
    'ENVIRONMENT',
    'WEB_APP_URL',
    'API_URL',
  ];

  for (const key of optional) {
    if (!env[key]) {
      console.warn(`⚠️  Optional env var missing: ${key}`);
    }
  }

  console.log('✅ Environment validation passed');
}

/**
 * Creates middleware that validates environment variables once per worker instance
 * @returns Hono middleware function
 */
export function createEnvValidationMiddleware() {
  let validated = false;

  return async (c: Context<HonoEnv>, next: () => Promise<void>) => {
    if (!validated) {
      try {
        validateEnvironment(c.env);
        validated = true;
      } catch (error) {
        // Log error and return 500 - worker cannot function without required vars
        console.error(error);
        return c.json(
          {
            error: {
              code: 'CONFIGURATION_ERROR',
              message:
                'Worker misconfigured - missing required environment variables',
              details: error instanceof Error ? error.message : 'Unknown error',
            },
          },
          500
        );
      }
    }
    await next();
  };
}
