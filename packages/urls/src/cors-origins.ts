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
        // Dev app (cross-subdomain cookies)
        'http://lvh.me:3000',
        // Vite dev server
        'http://lvh.me:5173',
        // Phone/LAN testing (any {ip}.nip.io subdomain)
        'http://*.nip.io',
      ];
    case 'staging':
      return [
        'https://codex-staging.revelations.studio',
        'https://*-staging.revelations.studio',
      ];
    case 'production':
      // Prod relies entirely on env.WEB_APP_URL + env.API_URL bindings
      // (no static origins beyond those).
      return [];
    case 'test':
      // Tests use exact origin per existing config.
      return [];
  }
}
