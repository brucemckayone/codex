/**
 * Environment Variable Validation
 *
 * Validates required environment variables at worker initialization.
 * Fails fast if critical vars are missing to prevent runtime errors.
 */

import type { Bindings } from '@codex/shared-types';
import type { Context } from 'hono';
import type { StripeWebhookEnv } from '../types';

/**
 * Validates required environment variables
 * @throws {Error} If any required variables are missing
 */
export function validateEnvironment(env: Bindings): void {
  // Determine which database URL is required based on DB_METHOD
  const dbMethod = env.DB_METHOD || 'PRODUCTION';
  const missing: string[] = [];

  // Check database URL based on method
  if (dbMethod === 'LOCAL_PROXY') {
    if (!(env as any).DATABASE_URL_LOCAL_PROXY) {
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
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET_BOOKING',
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
      '  - STRIPE_SECRET_KEY: Stripe API secret key',
      '  - STRIPE_WEBHOOK_SECRET_BOOKING: Stripe webhook signing secret for checkout events',
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
    'STRIPE_WEBHOOK_SECRET_PAYMENT',
    'STRIPE_WEBHOOK_SECRET_SUBSCRIPTION',
    'STRIPE_WEBHOOK_SECRET_CUSTOMER',
    'STRIPE_WEBHOOK_SECRET_CONNECT',
    'STRIPE_WEBHOOK_SECRET_DISPUTE',
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

  return async (c: Context<StripeWebhookEnv>, next: () => Promise<void>) => {
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
