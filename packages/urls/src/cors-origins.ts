import type { EnvName } from './types';

/**
 * Returns the per-env list of trusted origins for BetterAuth's
 * `trustedOrigins` config. Callers (currently `workers/auth/src/auth-config.ts`
 * inline array) MUST additionally include the request-time origins
 * (`env.WEB_APP_URL`, `env.API_URL`) — those are env-binding-driven and
 * stay outside the static per-env list.
 *
 * Matches the existing inline array in `auth-config.ts:190-208`. Migration
 * of the consumer is deferred (the inline array is touched in WP-1 only to
 * rename `ENV_NAMES.DEV` → `ENV_NAMES.DEV_REMOTE`; full migration to
 * `corsOriginsFor` is a follow-up bead).
 */
export function corsOriginsFor(env: EnvName): string[] {
  switch (env) {
    case 'dev':
      // Deployed dev (long-lived dev.revelations.studio branch). Browser
      // requests come from the platform apex AND from per-org subdomains
      // (studio-alpha.dev.revelations.studio etc), so a wildcard is needed.
      return [
        'https://dev.revelations.studio',
        'https://*.dev.revelations.studio',
      ];
    case 'development':
      return [
        // Auth worker's own URL for E2E tests
        'http://localhost:42069',
        // Dev app — platform apex (cross-subdomain cookies)
        'http://lvh.me:3000',
        'http://lvh.me:5173',
        // Org subdomains served by apps/web — required for cross-subdomain
        // auth POSTs from `<slug>.lvh.me` (studio routes, brand editor, etc.)
        'http://*.lvh.me:3000',
        'http://*.lvh.me:5173',
        // Phone/LAN testing (any {ip}.nip.io subdomain)
        'http://*.nip.io',
      ];
    case 'staging':
      return [
        'https://codex-staging.revelations.studio',
        'https://*-staging.revelations.studio',
      ];
    case 'production':
      // Per-org subdomains (e.g. studio-alpha.revelations.studio) need
      // wildcard coverage so BetterAuth `trustedOrigins` accepts
      // client-side auth POSTs from any org subdomain. `WEB_APP_URL` and
      // `API_URL` cover the platform apex + API host; the wildcard
      // covers everything else. Audit 2026-05-22 found the previous
      // empty return left a dormant cross-subdomain 403 risk.
      return ['https://*.revelations.studio'];
    case 'test':
      // E2E test stack runs on lvh.me:5173 (apps/web) + worker ports. Studio
      // and other authenticated cross-subdomain tests navigate to
      // `<slug>.lvh.me:5173`, so the platform apex AND the org-subdomain
      // wildcard are both required — without them, BetterAuth's Origin check
      // rejects auth POSTs with INVALID_ORIGIN.
      return [
        // Auth worker's own URL (E2E auth fixture sets Origin = AUTH_URL)
        'http://localhost:42069',
        // apps/web — platform apex
        'http://lvh.me:5173',
        // apps/web — org subdomains (studio, brand editor, etc.)
        'http://*.lvh.me:5173',
      ];
  }
}
