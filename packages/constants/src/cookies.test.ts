import { describe, expect, it } from 'vitest';
import { COOKIES, getCookieConfig } from './cookies';

describe('getCookieConfig', () => {
  describe('secure flag', () => {
    it('sets secure=true in production', () => {
      const config = getCookieConfig(false);
      expect(config.secure).toBe(true);
    });

    it('sets secure=false for localhost in dev mode', () => {
      const config = getCookieConfig(true, 'localhost');
      expect(config.secure).toBe(false);
    });

    it('sets secure=false for localhost:3000 in dev mode', () => {
      const config = getCookieConfig(true, 'localhost:3000');
      expect(config.secure).toBe(false);
    });

    it('sets secure=false for 127.0.0.1 in dev mode', () => {
      const config = getCookieConfig(true, '127.0.0.1');
      expect(config.secure).toBe(false);
    });

    it('sets secure=false for 127.0.0.1:8080 in dev mode', () => {
      const config = getCookieConfig(true, '127.0.0.1:8080');
      expect(config.secure).toBe(false);
    });

    it('sets secure=true for non-localhost in dev mode', () => {
      const config = getCookieConfig(true, 'dev.example.com');
      expect(config.secure).toBe(true);
    });

    it('sets secure=true in dev mode with no host', () => {
      const config = getCookieConfig(true);
      expect(config.secure).toBe(true);
    });

    it('handles undefined host safely', () => {
      const config = getCookieConfig(true, undefined);
      expect(config.secure).toBe(true); // Should default to secure
    });
  });

  describe('domain', () => {
    it('sets domain to .revelations.studio in production', () => {
      const config = getCookieConfig(false);
      expect(config.domain).toBe('.revelations.studio');
    });

    it('uses COOKIE_DOMAIN env var if provided', () => {
      const config = getCookieConfig({ COOKIE_DOMAIN: '.custom.com' });
      expect(config.domain).toBe('.custom.com');
    });

    it('does not set domain in dev mode', () => {
      const config = getCookieConfig(true);
      expect(config.domain).toBeUndefined();
    });

    it('does not set domain in dev mode even with COOKIE_DOMAIN', () => {
      const config = getCookieConfig({
        dev: true,
        COOKIE_DOMAIN: '.custom.com',
      });
      expect(config.domain).toBeUndefined();
    });
  });

  describe('defaults', () => {
    it('sets httpOnly=true', () => {
      const config = getCookieConfig(true);
      expect(config.httpOnly).toBe(true);
    });

    it('sets sameSite=lax', () => {
      const config = getCookieConfig(true);
      expect(config.sameSite).toBe('lax');
    });

    it('sets path=/', () => {
      const config = getCookieConfig(true);
      expect(config.path).toBe('/');
    });
  });

  describe('options override', () => {
    it('allows overriding sameSite', () => {
      const config = getCookieConfig(true, undefined, { sameSite: 'strict' });
      expect(config.sameSite).toBe('strict');
    });

    it('allows overriding maxAge', () => {
      const config = getCookieConfig(true, undefined, { maxAge: 3600 });
      expect(config.maxAge).toBe(3600);
    });

    it('allows overriding domain', () => {
      const config = getCookieConfig(false, undefined, {
        domain: '.override.com',
      });
      expect(config.domain).toBe('.override.com');
    });
  });
});

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
