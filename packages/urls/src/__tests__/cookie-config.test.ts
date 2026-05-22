/**
 * Tests for `getCookieConfig` — the wrapper that combines `cookieDomainFor`
 * with secure/httpOnly/sameSite/path defaults for `Set-Cookie` responses.
 *
 * Domain derivation is exhaustively tested by
 * `cookie-domain-fixtures.test.ts` (the byte-equal merge gate). This file
 * covers the wrapper-specific behaviour: secure flag, defaults, and option
 * overrides.
 *
 * Function relocated from `@codex/constants/src/cookies.ts` in WP-5a
 * (Codex-ora41) to break a module-load cycle.
 */

import { describe, expect, it } from 'vitest';
import { getCookieConfig } from '../cookie-config';

describe('getCookieConfig — secure flag', () => {
  it('sets secure=true in production (boolean env=false)', () => {
    expect(getCookieConfig(false).secure).toBe(true);
  });

  it('sets secure=false for localhost in dev mode', () => {
    expect(getCookieConfig(true, 'localhost').secure).toBe(false);
  });

  it('sets secure=false for localhost:3000 in dev mode', () => {
    expect(getCookieConfig(true, 'localhost:3000').secure).toBe(false);
  });

  it('sets secure=false for 127.0.0.1 in dev mode', () => {
    expect(getCookieConfig(true, '127.0.0.1').secure).toBe(false);
  });

  it('sets secure=false for 127.0.0.1:8080 in dev mode', () => {
    expect(getCookieConfig(true, '127.0.0.1:8080').secure).toBe(false);
  });

  it('sets secure=false for lvh.me in dev mode', () => {
    expect(getCookieConfig(true, 'lvh.me:3000').secure).toBe(false);
  });

  it('sets secure=false for subdomain.lvh.me in dev mode', () => {
    expect(getCookieConfig(true, 'bruce-studio.lvh.me:3000').secure).toBe(
      false
    );
  });

  it('sets secure=false for nip.io in dev mode', () => {
    expect(getCookieConfig(true, '192.168.1.10.nip.io:3000').secure).toBe(
      false
    );
  });

  it('sets secure=true for non-localhost in dev mode', () => {
    expect(getCookieConfig(true, 'dev.example.com').secure).toBe(true);
  });

  it('sets secure=true in dev mode with no host', () => {
    expect(getCookieConfig(true).secure).toBe(true);
  });

  it('handles undefined host safely (defaults to secure)', () => {
    expect(getCookieConfig(true, undefined).secure).toBe(true);
  });
});

describe('getCookieConfig — domain (via cookieDomainFor)', () => {
  it('sets domain to .revelations.studio in production with no host', () => {
    expect(getCookieConfig(false).domain).toBe('.revelations.studio');
  });

  it('uses COOKIE_DOMAIN env var override when set', () => {
    const config = getCookieConfig({
      MODE: 'production',
      COOKIE_DOMAIN: '.custom.com',
    });
    expect(config.domain).toBe('.custom.com');
  });

  it('does not set domain in dev mode without lvh.me host', () => {
    expect(getCookieConfig(true).domain).toBeUndefined();
  });

  it('sets domain to .lvh.me with lvh.me host in dev mode', () => {
    expect(getCookieConfig(true, 'lvh.me:3000').domain).toBe('.lvh.me');
  });

  it('sets domain to .lvh.me for subdomain.lvh.me in dev mode', () => {
    expect(getCookieConfig(true, 'bruce-studio.lvh.me:3000').domain).toBe(
      '.lvh.me'
    );
  });

  it('sets domain to .{ip}.nip.io with nip.io host in dev mode', () => {
    expect(getCookieConfig(true, '192.168.1.10.nip.io:3000').domain).toBe(
      '.192.168.1.10.nip.io'
    );
  });

  it('sets domain to .{ip}.nip.io for subdomain.{ip}.nip.io in dev mode', () => {
    expect(
      getCookieConfig(true, 'bruce-studio.192.168.1.10.nip.io:3000').domain
    ).toBe('.192.168.1.10.nip.io');
  });

  it('does not set domain in dev mode with no host (COOKIE_DOMAIN ignored)', () => {
    // env-driven path returns undefined when env=development AND no host
    // matches lvh.me/nip.io. The historical getCookieConfig behaviour
    // preserved this — dev mode requires a host signal to derive cookie scope.
    const config = getCookieConfig({
      dev: true,
      COOKIE_DOMAIN: '.custom.com',
    });
    expect(config.domain).toBeUndefined();
  });
});

describe('getCookieConfig — defaults', () => {
  it('sets httpOnly=true', () => {
    expect(getCookieConfig(true).httpOnly).toBe(true);
  });

  it('sets sameSite=lax', () => {
    expect(getCookieConfig(true).sameSite).toBe('lax');
  });

  it('sets path=/', () => {
    expect(getCookieConfig(true).path).toBe('/');
  });
});

describe('getCookieConfig — options override', () => {
  it('allows overriding sameSite', () => {
    expect(
      getCookieConfig(true, undefined, { sameSite: 'strict' }).sameSite
    ).toBe('strict');
  });

  it('allows overriding maxAge', () => {
    expect(getCookieConfig(true, undefined, { maxAge: 3600 }).maxAge).toBe(
      3600
    );
  });

  it('allows overriding domain', () => {
    expect(
      getCookieConfig(false, undefined, { domain: '.override.com' }).domain
    ).toBe('.override.com');
  });
});
