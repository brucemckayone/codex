import type { Env } from '@codex/constants';
import type { EnvName } from './types';

/**
 * Derive the `Domain` attribute for a cross-subdomain auth cookie.
 *
 * Replaces THREE separate derivers that existed prior to WP-5a:
 *  1. `getCookieConfig` host-branching logic in `@codex/constants/cookies.ts`
 *  2. `getDevCookieDomain` (WEB_APP_URL-based) in `workers/auth/src/auth-config.ts`
 *  3. The `crossSubDomainCookies.domain` ENV_NAMES ternary in auth-config.ts
 *
 * All three produced the same domain string for the same routing context;
 * `cookieDomainFor` is the single source of truth they now delegate to.
 *
 * ### Two call modes
 *
 * **Host-driven** (request-aware, defense-in-depth) — the primary mode.
 * Used by `getCookieConfig` (request host from `Host` header) and by
 * `auth-config.ts` (host extracted from `WEB_APP_URL`).
 *
 * **Env-driven** (no host) — fallback for callers without a host context.
 * Reads from the env-name and the `COOKIE_DOMAIN` env-binding override.
 *
 * When both `host` and `env` are provided, host classification wins
 * (defense-in-depth: a misconfigured deployment can't leak the prod
 * cookie scope onto a dev request).
 *
 * ### Return values (byte-equal contract — see fixture test)
 *
 * | Input | Returns |
 * |---|---|
 * | `localhost` / `127.x.x.x` | `undefined` (browser rejects Domain=localhost per RFC 6761) |
 * | `dev.revelations.studio` or `*.dev.revelations.studio` | `.dev.revelations.studio` |
 * | `*.{IP}.nip.io` | `.{IP}.nip.io` (LAN cross-subdomain testing) |
 * | `lvh.me` or `*.lvh.me` | `.lvh.me` (local dev cross-subdomain) |
 * | `*.revelations.studio` (prod + staging) | `env.COOKIE_DOMAIN ?? .revelations.studio` |
 * | env=`production` / `staging`, no host | `env.COOKIE_DOMAIN ?? .revelations.studio` |
 * | env=`dev`, no host | `.dev.revelations.studio` |
 * | env=`development`, no host | `.lvh.me` |
 * | env=`test`, no host | `undefined` |
 *
 * ### Test-env policy lives in callers, not here
 *
 * BetterAuth's `crossSubDomainCookies.domain` deliberately forces
 * `undefined` for `env=test` (so tests use exact origin). That policy
 * stays in `auth-config.ts` as an explicit override; `cookieDomainFor`
 * does NOT short-circuit test env on its host-driven path, because
 * `getCookieConfig` historically returns `.lvh.me` for lvh.me hosts
 * even under test env (used for cookie deletion on logout).
 *
 * Centralization preserves both behaviours: host-derivation logic is
 * unified here, BetterAuth-specific test policy stays in its consumer.
 */
export function cookieDomainFor(input: {
  host?: string;
  env?: EnvName | Env;
}): string | undefined {
  const { host, env } = input;
  const hostNoPort = host?.split(':')[0]?.toLowerCase();

  // ─── Host-driven path (primary) ───────────────────────────────────────
  if (hostNoPort) {
    // localhost / 127.x.x.x → no Domain (browser rejects Domain=localhost
    // per RFC 6761; same for loopback IPs)
    if (hostNoPort === 'localhost' || /^127\./.test(hostNoPort)) {
      return undefined;
    }

    // Deployed dev: dev.revelations.studio + every subdomain.
    // MUST come before the generic revelations.studio check below — both
    // hosts end with `.revelations.studio`.
    if (
      hostNoPort === 'dev.revelations.studio' ||
      hostNoPort.endsWith('.dev.revelations.studio')
    ) {
      return '.dev.revelations.studio';
    }

    // nip.io (LAN testing) — extract the IP-portion as the cookie scope
    if (hostNoPort.includes('nip.io')) {
      const m = hostNoPort.match(/(\d+\.\d+\.\d+\.\d+\.nip\.io)/);
      if (m) return `.${m[1]}`;
      // Fall through if no IP match (malformed nip.io host)
    }

    // lvh.me (local dev cross-subdomain support)
    if (hostNoPort.includes('lvh.me')) {
      return '.lvh.me';
    }

    // Anything else under revelations.studio (prod + staging suffix hosts).
    // MUST require either exact apex OR `.revelations.studio` suffix —
    // bare `endsWith('revelations.studio')` would also match adversarial
    // hostnames like `evil-revelations.studio` (no separator).
    if (
      hostNoPort === 'revelations.studio' ||
      hostNoPort.endsWith('.revelations.studio')
    ) {
      const override = readCookieDomainOverride(env);
      if (override) return override;
      return '.revelations.studio';
    }

    // Unknown host — fall through to env-driven
  }

  // ─── Env-driven path (fallback for missing/unknown host) ──────────────
  if (env === undefined || env === null) return undefined;
  const envName = typeof env === 'string' ? env : resolveEnvName(env);

  switch (envName) {
    case 'production':
    case 'staging': {
      const override = readCookieDomainOverride(env);
      return override ?? '.revelations.studio';
    }
    case 'dev':
      // Deployed dev has a fixed apex — safe to assume scope without host
      return '.dev.revelations.studio';
    case 'development':
      // Local dev has multiple possible hosts (lvh.me / nip.io / localhost).
      // Without a host signal we deliberately don't guess — caller must
      // provide `host` to get the lvh.me / nip.io scope.
      return undefined;
    case 'test':
      // Tests use exact origin (no cross-subdomain scope)
      return undefined;
    default:
      return undefined;
  }
}

/**
 * Read the `COOKIE_DOMAIN` env-binding override. Allows prod deployments to
 * customise the cookie scope (e.g. for multi-tenant white-labelled deploys).
 */
function readCookieDomainOverride(
  env: EnvName | Env | undefined
): string | undefined {
  if (env && typeof env === 'object' && env !== null) {
    const e = env as { COOKIE_DOMAIN?: string };
    if (e.COOKIE_DOMAIN && typeof e.COOKIE_DOMAIN === 'string') {
      return e.COOKIE_DOMAIN;
    }
  }
  return undefined;
}

/**
 * Resolve `EnvName` from an `Env`-shaped object. Mirrors the precedence in
 * `build-url.ts:resolveEnvName` but only handles the object case — string
 * inputs are normalised at the call site.
 */
function resolveEnvName(env: Env): EnvName | undefined {
  const e = env as { ENVIRONMENT?: string; MODE?: string; dev?: boolean };
  if (
    e.ENVIRONMENT === 'production' ||
    e.ENVIRONMENT === 'staging' ||
    e.ENVIRONMENT === 'dev' ||
    e.ENVIRONMENT === 'development' ||
    e.ENVIRONMENT === 'test'
  ) {
    return e.ENVIRONMENT;
  }
  if (e.MODE === 'production') return 'production';
  if (e.MODE === 'development') return 'development';
  if (e.dev === true) return 'development';
  return undefined;
}
