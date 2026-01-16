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

export function getCookieConfig(
  env?: Env | boolean,
  options: Partial<CookieConfig> = {}
): CookieConfig {
  const devMode = isDev(env);

  const config: CookieConfig = {
    path: '/',
    httpOnly: true,
    secure: !devMode,
    sameSite: 'lax',
    ...options,
  };

  if (!devMode && !config.domain) {
    config.domain = `.${DOMAINS.PROD}`;
  }

  return config;
}
