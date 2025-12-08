/**
 * Environment Variable Validation
 *
 * Validates required environment variables at worker initialization.
 * Fails fast if critical vars are missing to prevent runtime errors.
 */

import type { Context } from 'hono';
import type { AuthBindings, AuthEnv } from '../types';

/**
 * Extended bindings type for local proxy support
 */
type ExtendedAuthBindings = AuthBindings & {
  DATABASE_URL_LOCAL_PROXY?: string;
};

/**
 * Validates required environment variables
 * @throws {Error} If any required variables are missing
 */
export function validateEnvironment(env: ExtendedAuthBindings): void {
  // Determine which database URL is required based on DB_METHOD
  const dbMethod = env.DB_METHOD || 'PRODUCTION';
  const missing: string[] = [];

  // Check database URL based on method
  if (dbMethod === 'LOCAL_PROXY') {
    if (!env.DATABASE_URL_LOCAL_PROXY) {
      missing.push('DATABASE_URL_LOCAL_PROXY');
    }
  } else {
    // NEON_BRANCH or PRODUCTION
    if (!env.DATABASE_URL) {
      missing.push('DATABASE_URL');
    }
  }

  // Check other required variables
  const required = [
    'BETTER_AUTH_SECRET',
    'AUTH_SESSION_KV',
    'RATE_LIMIT_KV',
  ] as const;

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
      `  - DATABASE_URL${dbMethod === 'LOCAL_PROXY' ? '_LOCAL_PROXY' : ''}: PostgreSQL connection string (DB_METHOD=${dbMethod})`,
      '  - BETTER_AUTH_SECRET: BetterAuth secret key (min 32 characters)',
      '  - AUTH_SESSION_KV: KV namespace binding for session caching',
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
  const optional: Array<keyof AuthBindings> = [
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

  return async (c: Context<AuthEnv>, next: () => Promise<void>) => {
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
