export const COOKIES = {
  SESSION_NAME: 'codex-session',
  SESSION_MAX_AGE: 60 * 60 * 24 * 7, // 7 days
  TOKEN_MAX_AGE: 300, // 5 minutes
  // Short-lived hint set at registration so /verify-email can pre-fill the
  // "resend verification" form without putting the email in the URL.
  PENDING_VERIFICATION_EMAIL: 'codex-pending-verification-email',
} as const;

export interface CookieConfig {
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  domain?: string;
  maxAge?: number;
}

// `getCookieConfig` moved to `@codex/urls/cookie-config.ts` as part of WP-5a
// (Codex-ora41) — same precedent as `getServiceUrl` migration in WP-3:
// `@codex/urls` already depends on `@codex/constants` for `Env` type +
// SERVICE_PORTS + validateServiceUrl, so a shim here would create a
// module-load cycle. Consumers migrate to:
//   import { getCookieConfig } from '@codex/urls';
//
// The `COOKIES` constants and `CookieConfig` type stay here — they're
// pure constants/types, no logic.
