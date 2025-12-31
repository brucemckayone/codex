/**
 * Centralized Environment Variable Validation
 *
 * Validates required environment variables at worker initialization.
 * Fails fast if critical vars are missing to prevent runtime errors.
 *
 * Usage:
 *   app.use('*', createEnvValidationMiddleware(['DATABASE_URL', 'STRIPE_SECRET_KEY']));
 */

import type { Bindings, HonoEnv } from '@codex/shared-types';
import type { Context } from 'hono';

/**
 * Extended bindings type for local proxy support
 */
type ExtendedBindings = Bindings & {
  DATABASE_URL_LOCAL_PROXY?: string;
  [key: string]: unknown;
};

export interface EnvValidationConfig {
  /**
   * Required environment variables - worker fails without these
   */
  required: readonly string[];

  /**
   * Optional environment variables - warning logged if missing but doesn't fail
   */
  optional?: readonly string[];

  /**
   * Custom error message for missing vars (default provided)
   */
  errorMessage?: (missing: string[]) => string;
}

/**
 * Validates required environment variables
 * @throws {Error} If any required variables are missing
 */
function validateEnvironment(
  env: ExtendedBindings,
  config: EnvValidationConfig
): void {
  const missing: string[] = [];

  // Check required variables
  for (const key of config.required) {
    // Special handling for DATABASE_URL based on DB_METHOD
    if (key === 'DATABASE_URL') {
      const dbMethod = env.DB_METHOD || 'PRODUCTION';
      if (dbMethod === 'LOCAL_PROXY') {
        if (!env.DATABASE_URL_LOCAL_PROXY) {
          missing.push('DATABASE_URL_LOCAL_PROXY');
        }
      } else {
        if (!env.DATABASE_URL) {
          missing.push('DATABASE_URL');
        }
      }
    } else {
      // Standard check for all other variables
      if (!env[key]) {
        missing.push(key);
      }
    }
  }

  if (missing.length > 0) {
    const errorMessage =
      config.errorMessage?.(missing) ?? createDefaultErrorMessage(missing, env);
    throw new Error(errorMessage);
  }

  // Warn about optional variables
  if (config.optional) {
    for (const key of config.optional) {
      if (!env[key]) {
        console.warn(`⚠️  Optional env var missing: ${key}`);
      }
    }
  }

  console.log('✅ Environment validation passed');
}

/**
 * Creates default error message for missing variables
 */
function createDefaultErrorMessage(
  missing: string[],
  env: ExtendedBindings
): string {
  const dbMethod = env.DB_METHOD || 'PRODUCTION';

  const lines = [
    `❌ Missing required environment variables: ${missing.join(', ')}`,
    '',
    'Required variables:',
  ];

  // Add descriptions for each missing var
  for (const key of missing) {
    if (key === 'DATABASE_URL' || key === 'DATABASE_URL_LOCAL_PROXY') {
      lines.push(
        `  - ${key}: PostgreSQL connection string (DB_METHOD=${dbMethod})`
      );
    } else if (key.startsWith('STRIPE_')) {
      lines.push(
        `  - ${key}: Stripe API ${key.includes('SECRET') ? 'secret key' : 'configuration'}`
      );
    } else if (key.includes('KV')) {
      lines.push(`  - ${key}: KV namespace binding`);
    } else if (key.includes('R2')) {
      lines.push(
        `  - ${key}: R2 ${key.includes('BUCKET') ? 'bucket binding' : 'configuration'}`
      );
    } else {
      lines.push(`  - ${key}: Required configuration`);
    }
  }

  lines.push(
    '',
    'Solutions:',
    '  • Local dev: Create .dev.vars file (see .dev.vars.example)',
    '  • Test env: Create .dev.vars.test file',
    '  • Production: Set via wrangler CLI: wrangler secret put <VAR_NAME> --env production',
    ''
  );

  return lines.join('\n');
}

/**
 * Creates middleware that validates environment variables once per worker instance
 *
 * @param config - Validation configuration with required/optional vars
 * @returns Hono middleware function
 *
 * @example
 * ```typescript
 * // Basic usage
 * app.use('*', createEnvValidationMiddleware({
 *   required: ['DATABASE_URL', 'STRIPE_SECRET_KEY'],
 *   optional: ['ENVIRONMENT', 'WEB_APP_URL']
 * }));
 *
 * // With custom error message
 * app.use('*', createEnvValidationMiddleware({
 *   required: ['DATABASE_URL'],
 *   errorMessage: (missing) => `Missing critical vars: ${missing.join(', ')}`
 * }));
 * ```
 */
export function createEnvValidationMiddleware(config: EnvValidationConfig) {
  let validated = false;

  return async (c: Context<HonoEnv>, next: () => Promise<void>) => {
    if (!validated) {
      try {
        validateEnvironment(c.env, config);
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
