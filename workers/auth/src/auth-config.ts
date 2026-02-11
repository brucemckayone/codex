/**
 * BetterAuth Configuration
 *
 * Centralized configuration for BetterAuth authentication system.
 * Creates and configures the auth instance with email/password support,
 * session management, and database integration.
 */

import { AUTH_ROLES, COOKIES, DOMAINS, ENV_NAMES } from '@codex/constants';
import { createDbClient, schema } from '@codex/database';
import { createKVSecondaryStorage } from '@codex/security';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sendVerificationEmail } from './email';
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
      cookieName: COOKIES.SESSION_NAME,
      storeSessionInDatabase: true,
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5, // 5 minutes (short-lived)
      },
      // Cross-subdomain authentication support
      // Cookie domain with leading dot allows sharing across all subdomains
      cookie: {
        name: COOKIES.SESSION_NAME,
        sameSite: 'lax',
        httpOnly: true,
        // Only set domain and secure in non-dev environments
        // In dev, omit domain (defaults to request origin) and secure (allows HTTP)
        ...(env.ENVIRONMENT !== ENV_NAMES.DEVELOPMENT &&
        env.ENVIRONMENT !== ENV_NAMES.TEST
          ? { domain: `.${DOMAINS.PROD}`, secure: true }
          : { secure: false }),
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
          (env.ENVIRONMENT === ENV_NAMES.DEVELOPMENT ||
            env.ENVIRONMENT === ENV_NAMES.TEST)
        ) {
          // Store with email as key, auto-expire after 5 minutes
          await env.AUTH_SESSION_KV.put(`verification:${user.email}`, token, {
            expirationTtl: 300, // 5 minutes
          });
        }

        // Send the actual verification email
        await sendVerificationEmail(env, user, token);
      },
      autoSignInAfterVerification: true,
      sendOnSignUp: true,
      // Re-sends the verification email when an unverified user attempts sign-in,
      // giving them another chance to complete verification. Without this, users
      // who missed the initial email have no self-service path to get a new link.
      sendOnSignIn: true,
    },
    emailAndPassword: {
      enabled: true,
      // NOTE (security vs UX trade-off): BetterAuth returns a 403 with a specific
      // "email not verified" message on login, which leaks account existence. We accept
      // this because: (1) registration already implicitly confirms existence, and
      // (2) a clear message reduces support burden. If stricter anti-enumeration is
      // needed, override the BetterAuth error handler to return generic "Invalid credentials".
      requireEmailVerification: true,
      autoSignIn: true,
    },
    user: {
      additionalFields: {
        role: {
          type: 'string',
          required: true,
          defaultValue: AUTH_ROLES.USER,
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
