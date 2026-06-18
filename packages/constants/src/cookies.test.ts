import { describe, expect, it } from 'vitest';
import { COOKIES } from './cookies';

// `getCookieConfig` tests moved to packages/urls/src/__tests__/cookie-config.test.ts
// as part of WP-5a (Codex-ora41) — the function was relocated to @codex/urls
// to break a module-load cycle (same precedent as `getServiceUrl` migration in
// WP-3). The byte-equal domain-derivation tests for the underlying logic live
// in packages/urls/src/__tests__/cookie-domain-fixtures.test.ts.

describe('COOKIES constants', () => {
  it('has SESSION_NAME', () => {
    expect(COOKIES.SESSION_NAME).toBe('codex-session');
  });

  it('has SESSION_MAX_AGE of 7 days', () => {
    expect(COOKIES.SESSION_MAX_AGE).toBe(60 * 60 * 24 * 7);
  });

  it('has TOKEN_MAX_AGE of 5 minutes', () => {
    expect(COOKIES.TOKEN_MAX_AGE).toBe(300);
  });
});
