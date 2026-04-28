/**
 * Security domain constants
 */

import { COOKIES } from './cookies';

export const CSP_DIRECTIVES = {
  DEFAULT: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'https:'],
    fontSrc: ["'self'"],
    connectSrc: ["'self'"],
    frameSrc: ["'none'"],
    frameAncestors: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
  },
  PRESETS: {
    STRIPE: {
      scriptSrc: ["'self'", 'https://js.stripe.com'],
      frameSrc: ['https://js.stripe.com', 'https://hooks.stripe.com'],
      connectSrc: ["'self'", 'https://api.stripe.com'],
    },
    API: {
      defaultSrc: ["'none'"],
      scriptSrc: ["'none'"],
      styleSrc: ["'none'"],
      imgSrc: ["'none'"],
      fontSrc: ["'none'"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
    },
  },
} as const;

export const AUTH_COOKIES = {
  SESSION: COOKIES.SESSION_NAME,
  BETTER_AUTH: 'better-auth.session_token',
} as const;

export const AUTH_ROLES = {
  USER: 'customer',
  CREATOR: 'creator',
  ADMIN: 'admin',
  SYSTEM: 'system',
  PLATFORM_OWNER: 'platform_owner',
} as const;

export const BRAND_COLORS = {
  DEFAULT_BLUE: '#3B82F6',
} as const;

/**
 * Canonical BetterAuth POST endpoints that MUST be rate-limited to
 * prevent brute-force / credential-stuffing on the four user-facing
 * authentication surfaces.
 *
 * Source of truth — these are the actual BetterAuth routes the
 * SvelteKit app POSTs to (see `apps/web/src/routes/(auth)/**` and
 * `apps/web/src/lib/remote/auth.remote.ts`) and the routes documented
 * in `workers/auth/CLAUDE.md`.
 *
 * Rule (R9, hard): the auth worker's rate-limit middleware MUST match
 * its path-set against THIS constant — never against locally-hardcoded
 * literal paths that drift from BetterAuth's routing. Drift here was a
 * P0 blocker (login/signup/reset entirely unrate-limited in production)
 * — see denoise iter-002 F1 / Codex-ttavz.7.
 *
 * BetterAuth has many internal paths (e.g. `/api/auth/session`,
 * `/api/auth/sign-out`, `/api/auth/verify-email`) which are NOT
 * brute-force surfaces and are intentionally excluded — rate-limiting
 * them could break the SDK's polling and verification flows.
 */
export const BETTERAUTH_RATE_LIMITED_PATHS = [
  '/api/auth/sign-up/email',
  '/api/auth/sign-in/email',
  '/api/auth/forget-password',
  '/api/auth/reset-password',
] as const;

export type BetterAuthRateLimitedPath =
  (typeof BETTERAUTH_RATE_LIMITED_PATHS)[number];

/** Pre-built Set for O(1) lookups in the rate-limit middleware. */
export const BETTERAUTH_RATE_LIMITED_PATHS_SET = new Set<string>(
  BETTERAUTH_RATE_LIMITED_PATHS
);
