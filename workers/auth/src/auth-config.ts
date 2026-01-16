/**
 * BetterAuth Configuration
 *
 * Centralized configuration for BetterAuth authentication system.
 * Creates and configures the auth instance with email/password support,
 * session management, and database integration.
 */

import { COOKIES } from '@codex/constants';
import { createDbClient, schema } from '@codex/database';
import { createKVSecondaryStorage } from '@codex/security';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import type { AuthBindings } from './types';

interface AuthConfigOptions {
  env: AuthBindings;
}

/**
 * Create a configured BetterAuth instance
 *
 * @param options - Configuration options
 * @returns Configured BetterAuth instance
 */
export function createAuthInstance(options: AuthConfigOptions) {
  const { env } = options;

  // Create database client with explicit environment
  // This ensures DB_METHOD and DATABASE_URL are available when Better-auth initializes
  const db = createDbClient(env);

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        ...schema,
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verification,
      },
    }),

    // KV-backed secondary storage for session caching
    // This enables unified session caching across all workers
    secondaryStorage: createKVSecondaryStorage(env.AUTH_SESSION_KV),

    session: {
      expiresIn: 60 * 60 * 24, // 24 hours
      updateAge: 60 * 60 * 24, // Update session every 24 hours
      storeSessionInDatabase: true,
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5, // 5 minutes (short-lived)
      },
    },
    logger: {
      level: 'debug',
      disabled: true,
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, token }, _request?: Request) => {
        // Store token in KV for E2E tests (development/test only)
        // Use env from closure, not from request object
        if (
          env.AUTH_SESSION_KV &&
          (env.ENVIRONMENT === 'development' || env.ENVIRONMENT === 'test')
        ) {
          // Store with email as key, auto-expire after 5 minutes
          await env.AUTH_SESSION_KV.put(`verification:${user.email}`, token, {
            expirationTtl: 300, // 5 minutes
          });
        }
      },
      autoSignInAfterVerification: true,
      sendOnSignUp: true,
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: true,
    },
    user: {
      additionalFields: {
        role: {
          type: 'string',
          required: true,
          defaultValue: 'customer',
        },
      },
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.WEB_APP_URL,
    trustedOrigins: [
      env.WEB_APP_URL,
      env.API_URL,
      'http://localhost:42069', // Auth worker's own URL for E2E tests
    ].filter((url): url is string => Boolean(url)),
  });
}
