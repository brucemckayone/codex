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
 * Derive the cross-subdomain cookie domain from WEB_APP_URL.
 *
 * - lvh.me URLs → `.lvh.me`
 * - nip.io URLs (e.g. `http://192.168.1.10.nip.io:3000`) → `.192.168.1.10.nip.io`
 * - Fallback → `.lvh.me`
 */
function getDevCookieDomain(env: AuthBindings): string {
  try {
    const hostname = new URL(env.WEB_APP_URL || '').hostname;
    if (hostname.endsWith('nip.io')) {
      const match = hostname.match(/(\d+\.\d+\.\d+\.\d+\.nip\.io)$/);
      if (match) return `.${match[1]}`;
    }
  } catch {
    /* fall through to default */
  }
  return `.${DOMAINS.DEV}`;
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
      cookie: {
        name: COOKIES.SESSION_NAME,
        sameSite: 'lax',
        httpOnly: true,
        secure:
          env.ENVIRONMENT !== ENV_NAMES.DEVELOPMENT &&
          env.ENVIRONMENT !== ENV_NAMES.TEST,
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
      // Dev-only origins
      ...(env.ENVIRONMENT === ENV_NAMES.DEVELOPMENT
        ? [
            'http://localhost:42069', // Auth worker's own URL for E2E tests
            'http://lvh.me:3000', // Dev app (cross-subdomain cookies)
            'http://lvh.me:5173', // Vite dev server
            'http://*.nip.io', // Phone/LAN testing (any {ip}.nip.io subdomain)
          ]
        : []),
    ].filter((url): url is string => Boolean(url)),

    // Cross-subdomain cookie support
    // Allows sessions from lvh.me:3000 to work on {slug}.lvh.me:3000
    // In production: sessions from revelations.studio work on {slug}.revelations.studio
    advanced: {
      crossSubDomainCookies: {
        enabled: true,
        domain:
          env.ENVIRONMENT === ENV_NAMES.DEVELOPMENT
            ? getDevCookieDomain(env) // .lvh.me or .{ip}.nip.io based on WEB_APP_URL
            : env.ENVIRONMENT === ENV_NAMES.TEST
              ? undefined // Tests use exact origin
              : `.${DOMAINS.PROD}`,
      },
    },
  });
}
