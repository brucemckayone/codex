/**
 * BetterAuth Configuration
 *
 * Centralized configuration for BetterAuth authentication system.
 * Creates and configures the auth instance with email/password support,
 * session management, and database integration.
 */

import { dbHttp, schema } from '@codex/database';
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

  return betterAuth({
    database: drizzleAdapter(dbHttp, {
      provider: 'pg',
      schema: {
        ...schema,
        // Map BetterAuth expected names to our schema
        user: schema.users,
        session: schema.sessions,
        verification: schema.verificationTokens,
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
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendVerificationEmail: async ({
        user,
        url,
      }: {
        user: User;
        url: string;
      }) => {
        // TODO: Implement email sending via notification service
        console.log(
          `Sending verification email to ${user.email} with url: ${url}`
        );
      },
      sendResetPasswordEmail: async ({
        user,
        url,
      }: {
        user: User;
        url: string;
      }) => {
        // TODO: Implement email sending via notification service
        console.log(
          `Sending password reset email to ${user.email} with url: ${url}`
        );
      },
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
    trustedOrigins: [env.WEB_APP_URL, env.API_URL].filter(
      (url): url is string => Boolean(url)
    ),
  });
}
