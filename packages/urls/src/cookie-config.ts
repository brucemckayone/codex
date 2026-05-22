import { type CookieConfig, type Env, isDev } from '@codex/constants';
import { cookieDomainFor } from './cookie-domain';
import type { EnvName } from './types';

/**
 * Get secure cookie configuration with environment awareness.
 *
 * Relocated from `@codex/constants/src/cookies.ts` to `@codex/urls` as part
 * of WP-5a (Codex-ora41). Same precedent as `getServiceUrl` migration in
 * WP-3: a shim in `@codex/constants` would create a module-load cycle
 * because `@codex/urls` already depends on `@codex/constants`.
 *
 * @param env - Environment bindings or boolean for dev mode check
 * @param host - Request host header (used to determine localhost)
 * @param options - Optional cookie config overrides
 * @returns Secure cookie configuration
 *
 * Security:
 * - `secure: true` except for localhost/127.0.0.1/lvh.me/nip.io in dev mode
 * - Domain derivation centralised in `cookieDomainFor` (defense-in-depth,
 *   host-driven with env fallback, plus `COOKIE_DOMAIN` env override)
 */
export function getCookieConfig(
  env?: Env | boolean,
  host?: string,
  options: Partial<CookieConfig> = {}
): CookieConfig {
  const devMode = isDev(env);

  // Only allow insecure cookies for local dev hosts in dev mode
  const isLocalDev =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host?.startsWith('localhost:') ||
    host?.startsWith('127.0.0.1:') ||
    host?.includes('lvh.me') ||
    host?.includes('nip.io');
  const secureCookie = devMode ? !isLocalDev : true;

  const config: CookieConfig = {
    path: '/',
    httpOnly: true,
    secure: secureCookie,
    sameSite: 'lax',
    ...options,
  };

  // Domain is host-driven (defense-in-depth — a misconfigured deployment
  // can't leak the prod cookie scope onto a dev request) with `env` as
  // fallback when host is absent. See `cookieDomainFor` for the byte-equal
  // fixture matrix that pins this behaviour.
  //
  // Boolean env (legacy callsite shape) maps to production/development env-
  // names so cookieDomainFor's env-driven fallback can decide a default.
  // `typeof null === 'object'` so we must explicitly exclude null — otherwise
  // a null env would crash inside cookieDomainFor reading properties.
  if (!config.domain) {
    const envForDomain: EnvName | Env | undefined =
      typeof env === 'object' && env !== null
        ? env
        : typeof env === 'boolean'
          ? env
            ? 'development'
            : 'production'
          : undefined;
    const derived = cookieDomainFor({ host, env: envForDomain });
    if (derived) config.domain = derived;
  }

  return config;
}
