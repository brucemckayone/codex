import { describe, expect, it } from 'vitest';
import { type Env, getServiceUrl, isDev, validateServiceUrl } from './env';

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

  it('returns false for undefined env', () => {
    expect(isDev()).toBe(false);
  });
});

describe('getServiceUrl', () => {
  it('returns dev URL in dev mode', () => {
    const url = getServiceUrl('auth', true);
    expect(url).toContain('localhost');
  });

  it('returns prod URL in prod mode', () => {
    const url = getServiceUrl('auth', false);
    expect(url).toContain('revelations.studio');
  });

  it('uses environment binding if provided', () => {
    const env: Env = {
      AUTH_WORKER_URL: 'https://custom.example.com',
      MODE: 'production',
    };
    const url = getServiceUrl('auth', env);
    expect(url).toBe('https://custom.example.com');
  });

  it('validates environment URLs in production', () => {
    const env: Env = {
      AUTH_WORKER_URL: 'http://insecure.example.com',
      MODE: 'production',
    };
    expect(() => getServiceUrl('auth', env)).toThrow('HTTPS is required');
  });

  it('allows HTTP in dev mode', () => {
    const env: Env = {
      AUTH_WORKER_URL: 'http://localhost:3000',
      dev: true,
    };
    const url = getServiceUrl('auth', env);
    expect(url).toBe('http://localhost:3000');
  });

  it('returns all service URLs in dev mode', () => {
    const services = [
      'auth',
      'content',
      'access',
      'org',
      'ecom',
      'admin',
      'identity',
      'notifications',
      'media',
    ] as const;

    for (const service of services) {
      const url = getServiceUrl(service, true);
      expect(url).toContain('localhost');
    }
  });

  it('returns all service URLs in prod mode', () => {
    const services = [
      'auth',
      'content',
      'access',
      'org',
      'ecom',
      'admin',
      'identity',
      'notifications',
      'media',
    ] as const;

    for (const service of services) {
      const url = getServiceUrl(service, false);
      expect(url).toMatch(/^https:\/\/.*revelations\.studio$/);
    }
  });
});

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
});
