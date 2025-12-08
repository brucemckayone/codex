/**
 * BetterAuth Configuration
 *
 * Centralized configuration for BetterAuth authentication system.
 * Creates and configures the auth instance with email/password support,
 * session management, and database integration.
 */

import { createDbClient, schema } from '@codex/database';
import { betterAuth, type User } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import type { AuthBindings } from './types';

export interface AuthConfigOptions {
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

    session: {
      expiresIn: 60 * 60 * 24, // 24 hours
      updateAge: 60 * 60 * 24, // Update session every 24 hours
      cookieName: 'codex-session',
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5, // 5 minutes (short-lived)
      },
    },
    logger: {
      level: 'debug',
      logger: (level: string, message: string, ...args: any[]) => {
        console.log(`[${level.toUpperCase()}]`, message, ...args);
      },
      disabled: false,
    },
    emailVerification: {
      sendVerificationEmail: async (
        {
          user,
          url,
          token,
        }: {
          user: User;
          url: string;
          token: string;
        },
        request
      ) => {
        console.log(
          `Sending verification email to ${user.email} with url: ${url} and token: ${token}`
        );

        // Store token in KV for E2E tests (development/test only)
        // Use env from closure, not from request object
        if (
          env.AUTH_SESSION_KV &&
          (env.ENVIRONMENT === 'development' || env.ENVIRONMENT === 'test')
        ) {
          try {
            // Store with email as key, auto-expire after 5 minutes
            await env.AUTH_SESSION_KV.put(
              `verification:${user.email}`,
              token,
              { expirationTtl: 300 } // 5 minutes
            );
            console.log(
              `[TEST] Stored verification token for ${user.email} in KV`
            );
          } catch (error) {
            console.error(
              '[TEST] Failed to store verification token in KV:',
              error
            );
          }
        }
      },
      autoSignInAfterVerification: true,
      sendOnSignUp: true,
      async onEmailVerification(user, request) {
        console.log(`Email verified for user ${user.email}`);
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      async sendResetPassword(data, request) {
        // TODO: Implement email sending via notification service
        console.log(`Sending reset password email to ${data.user.email}`);
      },
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
