import type { EnvName } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// STUB — filled in WP-5a. The byte-equal fixture matrix in
// `__tests__/cookie-domain-fixtures.test.ts` (added by WP-5a) is the merge
// gate that proves backward-compatibility with existing cookie domain
// output. Until WP-5a lands, consumers continue using `getCookieConfig`
// from `@codex/constants/src/cookies.ts` directly.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derive the `Domain` cookie attribute for cross-subdomain auth.
 *
 * Two call modes:
 *   1. **host-driven** (request-aware, defense-in-depth) — used by web app
 *      `getCookieConfig` in `@codex/constants/src/cookies.ts`.
 *   2. **env-driven** (worker startup, no request yet) — used by BetterAuth
 *      `crossSubDomainCookies.domain` in `workers/auth/src/auth-config.ts`.
 *
 * When both are provided, `host` wins. Returns `undefined` when no
 * cross-subdomain scope applies (localhost/127.0.0.1/test env).
 *
 * Replaces:
 * - `getCookieConfig` host-branching logic in `@codex/constants/src/cookies.ts`
 * - `getDevCookieDomain` in `workers/auth/src/auth-config.ts`
 * - `crossSubDomainCookies.domain` ternary in `workers/auth/src/auth-config.ts`
 */
export function cookieDomainFor(_input: {
  host?: string;
  env?: EnvName | { ENVIRONMENT?: string; [k: string]: unknown };
}): string | undefined {
  throw new Error('cookieDomainFor: not implemented (WP-5a)');
}
