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
import { cookieDomainFor, corsOriginsFor, type EnvName } from '@codex/urls';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createAuthMiddleware } from 'better-auth/api';
import {
  sendPasswordResetEmail,
  sendVerificationEmail,
  sendWelcomeEmail,
  wasWelcomeEmailSent,
} from './email';
import { handlePasswordChangedHook } from './password-changed-hook';
import type { AuthBindings } from './types';

interface AuthConfigOptions {
  env: AuthBindings;
  executionCtx: ExecutionContext;
}

/**
 * Resolve the cross-subdomain cookie domain for BetterAuth. Delegates to
 * `cookieDomainFor` (@codex/urls) — the centralised host+env derivation
 * that replaced the historical `getDevCookieDomain` function in this file.
 *
 * BetterAuth-specific policy preserved from the legacy ternary:
 *   - test env returns `undefined` (tests use exact origin)
 *   - DEVELOPMENT env with no host-derived scope falls back to `.lvh.me`
 *     (matches OLD `getDevCookieDomain`'s default — keeps local-dev with
 *     `WEB_APP_URL=http://localhost:3000` working cross-subdomain)
 *   - Unknown/missing ENVIRONMENT falls back to `.revelations.studio`
 *     (matches OLD else-branch of the env-ternary — safer default than
 *     `undefined` which would silently disable cross-subdomain cookies)
 */
function resolveCrossSubDomainCookieDomain(
  env: AuthBindings
): string | undefined {
  if (env.ENVIRONMENT === ENV_NAMES.TEST) return undefined;
  const host = parseWebAppHost(env.WEB_APP_URL);
  const derived = cookieDomainFor({
    host,
    env: env.ENVIRONMENT as EnvName | undefined,
  });
  if (derived !== undefined) return derived;
  // Fallback: preserve OLD getDevCookieDomain default for DEVELOPMENT,
  // OLD else-branch default for everything else.
  if (env.ENVIRONMENT === ENV_NAMES.DEVELOPMENT) return `.${DOMAINS.DEV}`;
  return `.${DOMAINS.PROD}`;
}

function parseWebAppHost(webAppUrl: string | undefined): string | undefined {
  if (!webAppUrl) return undefined;
  try {
    return new URL(webAppUrl).hostname;
  } catch {
    return undefined;
  }
}

/**
 * Create a configured BetterAuth instance
 *
 * @param options - Configuration options
 * @returns Configured BetterAuth instance
 */
export function createAuthInstance(options: AuthConfigOptions) {
  const { env, executionCtx } = options;

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
        // 5 min — client-side signed cookie cache. Trade-off reviewed
        // 2026-04-23 (Codex-5pbwc): shorter TTLs would reduce UI auth-state
        // staleness but multiply /api/auth/session requests; longer TTLs
        // push the revocation SLA. 5 min is acceptable because:
        //   1. Sign-out propagates immediately on the same device —
        //      BetterAuth calls `secondaryStorage.delete` which clears
        //      both the cookie cache and the KV session entry.
        //   2. Cross-device sign-out has no propagation path through
        //      cookies — different cookie jars — so no TTL change fixes it.
        //      The root layout's visibility-return re-check (Codex-b6emg)
        //      handles cross-device UI state refresh within one foreground.
        //   3. Access-control decisions (paid content streaming, admin
        //      actions, revoked subscriptions) are re-evaluated at the
        //      point of action against current DB state — not against
        //      cached session data — so a stale 5-min cache cannot grant
        //      authority the user no longer has.
        maxAge: 60 * 5,
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

        // Send the verification email WITHOUT blocking the sign-up / sign-in
        // HTTP response. BetterAuth awaits this callback, so awaiting the
        // notifications-api → Resend round-trip here stalls the response:
        // sendEmail retries 2× with exponential backoff, which can take ~20s
        // when Resend is slow or rejecting. That exceeds Cloudflare's
        // worker-subrequest budget, so the web app's fetch to /sign-up/email
        // returns a 522 and the user sees "Registration failed" — even though
        // the account was already created in the database.
        //
        // executionCtx.waitUntil keeps the worker alive until the send settles
        // (up to 30s), so the email still goes out in the background while the
        // response returns immediately. Same fire-and-forget pattern as the
        // welcome email (see email.ts sendWelcomeEmail).
        executionCtx.waitUntil(
          sendVerificationEmail(env, user, token).catch(() => {
            // Email delivery must never surface as an auth error. The
            // notifications-api audit log captures delivery failures.
          })
        );
      },
      // Fires after BetterAuth flips emailVerified=true (api/routes/email-verification.mjs:265).
      // The dedupe query awaits — verification response is delayed by ~10-50ms.
      // The send itself is fire-and-forget via waitUntil and never blocks.
      // ALL errors are caught — a thrown error here would propagate out of BetterAuth's
      // handler and turn a successful verification into a 500.
      afterEmailVerification: async (user) => {
        try {
          if (await wasWelcomeEmailSent(db, user.email)) return;
          sendWelcomeEmail(env, executionCtx, {
            name: user.name,
            email: user.email,
          });
        } catch {
          // Never let welcome-email plumbing fail a successful verification.
        }
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
      sendResetPassword: async ({ user, url }) => {
        // Fire-and-forget for the same reason as sendVerificationEmail above:
        // never block the auth HTTP response on external email delivery.
        executionCtx.waitUntil(
          sendPasswordResetEmail(env, user, url).catch(() => {
            // Delivery failures are captured in the notifications audit log.
          })
        );
      },
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
    // Top-level after-hook fires once per successful auth endpoint. The handler
    // path-matches /change-password (excludes /reset-password and all other
    // routes) and sends the password-changed confirmation email. See
    // password-changed-hook.ts for the full mechanism note.
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        await handlePasswordChangedHook(env, ctx);
      }),
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.WEB_APP_URL,
    trustedOrigins: [
      env.WEB_APP_URL,
      env.API_URL,
      // Per-env static origins from `@codex/urls`. Includes wildcards for
      // dev (`*.dev.revelations.studio`), staging (`*-staging.revelations.studio`),
      // production (`*.revelations.studio` — closes the dormant cross-subdomain
      // 403 risk surfaced in the 2026-05-22 post-epic audit), and the
      // lvh.me/nip.io/localhost set for local dev. `WEB_APP_URL` and `API_URL`
      // above carry the per-binding apex + API host that aren't in the
      // static list.
      ...corsOriginsFor(env.ENVIRONMENT as EnvName),
    ].filter((url): url is string => Boolean(url)),

    // Cross-subdomain cookie support
    // Allows sessions from lvh.me:3000 to work on {slug}.lvh.me:3000
    // Deployed dev:  sessions from dev.revelations.studio work on {slug}.dev.revelations.studio
    // Production:    sessions from revelations.studio work on {slug}.revelations.studio
    advanced: {
      crossSubDomainCookies: {
        enabled: true,
        // Domain derivation centralised in `cookieDomainFor` (@codex/urls)
        // since WP-5a (Codex-ora41). Byte-equal fixture matrix in
        // packages/urls/src/__tests__/cookie-domain-fixtures.test.ts pins
        // the contract for every known host across all envs.
        domain: resolveCrossSubDomainCookieDomain(env),
      },
    },
  });
}
