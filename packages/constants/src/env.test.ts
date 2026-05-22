import { describe, expect, it } from 'vitest';
import { isDev, validateServiceUrl } from './env';

describe('isDev', () => {
  it('returns true for boolean true', () => {
    expect(isDev(true)).toBe(true);
  });

  it('returns false for boolean false', () => {
    expect(isDev(false)).toBe(false);
  });

  it('returns true when MODE is development', () => {
    expect(isDev({ MODE: 'development' })).toBe(true);
  });

  it('returns true when dev is true', () => {
    expect(isDev({ dev: true })).toBe(true);
  });

  it('returns false for production env', () => {
    expect(isDev({ MODE: 'production' })).toBe(false);
  });

  it('returns true when NODE_ENV is test (vitest sets this)', () => {
    // isDev() with no env falls through to Node.js fallback
    // NODE_ENV=test is treated as dev so cookies are non-secure on localhost
    expect(isDev()).toBe(true);
  });

  it('returns false for production even when NODE_ENV is test', () => {
    // Explicit MODE: production overrides the Node.js fallback
    expect(isDev({ MODE: 'production' })).toBe(false);
  });
});

// `getServiceUrl` tests moved to packages/urls/src/__tests__/build-service-url.test.ts
// as part of WP-3 (Codex-4xbuw) — the function was relocated to @codex/urls
// to centralize routing-layer logic. See plan: ~/.claude/plans/typed-honking-canyon.md

describe('validateServiceUrl', () => {
  it('allows http URLs', () => {
    expect(validateServiceUrl('http://localhost:3000')).toBe(
      'http://localhost:3000'
    );
  });

  it('allows https URLs', () => {
    expect(validateServiceUrl('https://api.example.com')).toBe(
      'https://api.example.com'
    );
  });

  it('rejects javascript: URLs', () => {
    expect(() => validateServiceUrl('javascript:alert(1)')).toThrow(
      'Invalid protocol'
    );
  });

  it('rejects data: URLs', () => {
    expect(() => validateServiceUrl('data:text/html,<script>')).toThrow(
      'Invalid protocol'
    );
  });

  it('rejects ftp: URLs', () => {
    expect(() => validateServiceUrl('ftp://example.com')).toThrow(
      'Invalid protocol'
    );
  });

  it('rejects file: URLs', () => {
    expect(() => validateServiceUrl('file:///etc/passwd')).toThrow(
      'Invalid protocol'
    );
  });

  it('rejects invalid URL format', () => {
    expect(() => validateServiceUrl('not-a-url')).toThrow('Invalid URL format');
  });

  it('requires HTTPS when requireHttps is true', () => {
    expect(() => validateServiceUrl('http://example.com', true)).toThrow(
      'HTTPS is required'
    );
  });

  it('allows HTTPS when requireHttps is true', () => {
    expect(validateServiceUrl('https://example.com', true)).toBe(
      'https://example.com'
    );
  });
  describe('SSRF Protection', () => {
    it('blocks AWS/GCP/Azure metadata IP', () => {
      expect(() =>
        validateServiceUrl('http://169.254.169.254/latest/meta-data')
      ).toThrow('Access to metadata service is blocked');
    });

    it('blocks Google Cloud internal metadata DNS', () => {
      expect(() =>
        validateServiceUrl(
          'http://metadata.google.internal/computeMetadata/v1/'
        )
      ).toThrow('Access to internal metadata DNS is blocked');
    });

    it('blocks private IPs in production (requireHttps=true)', () => {
      const privateIps = [
        'https://10.0.0.1',
        'https://192.168.1.1',
        'https://172.16.0.1', // 172.16.0.0/12
        'https://127.0.0.1',
        'https://localhost',
      ];

      privateIps.forEach((url) => {
        expect(() => validateServiceUrl(url, true)).toThrow(
          /Private IP\/Localhost access is blocked/
        );
      });
    });

    it('allows localhost in dev mode (requireHttps=false)', () => {
      expect(validateServiceUrl('http://localhost:3000', false)).toBe(
        'http://localhost:3000'
      );
      expect(validateServiceUrl('http://127.0.0.1:8080', false)).toBe(
        'http://127.0.0.1:8080'
      );
    });
  });
});
