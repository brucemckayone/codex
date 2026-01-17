import { type Env, isDev } from './env';
import { DOMAINS } from './urls';

export const COOKIES = {
  SESSION_NAME: 'codex-session',
  SESSION_MAX_AGE: 60 * 60 * 24 * 7, // 7 days
  TOKEN_MAX_AGE: 300, // 5 minutes
} as const;

export interface CookieConfig {
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  domain?: string;
  maxAge?: number;
}

/**
 * Get secure cookie configuration with environment awareness.
 *
 * @param env - Environment bindings or boolean for dev mode check
 * @param host - Request host header (used to determine localhost)
 * @param options - Optional cookie config overrides
 * @returns Secure cookie configuration
 *
 * Security:
 * - `secure: true` except for localhost/127.0.0.1 in dev mode
 * - Domain configurable via `COOKIE_DOMAIN` env var (defaults to .revelations.studio in prod)
 */
export function getCookieConfig(
  env?: Env | boolean,
  host?: string,
  options: Partial<CookieConfig> = {}
): CookieConfig {
  const devMode = isDev(env);

  // Only allow insecure cookies for localhost in dev mode
  const isLocalhost =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host?.startsWith('localhost:') ||
    host?.startsWith('127.0.0.1:');
  const secureCookie = devMode ? !isLocalhost : true;

  const config: CookieConfig = {
    path: '/',
    httpOnly: true,
    secure: secureCookie,
    sameSite: 'lax',
    ...options,
  };

  // Set domain in production (configurable via env)
  if (!devMode && !config.domain) {
    const envBindings = typeof env === 'object' ? env : undefined;
    config.domain =
      (envBindings?.COOKIE_DOMAIN as string) ?? `.${DOMAINS.PROD}`;
  }

  return config;
}
