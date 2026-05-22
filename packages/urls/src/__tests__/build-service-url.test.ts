import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServiceUrl } from '../build-url';
import type { EnvName, ServiceName } from '../types';

const ALL_SERVICES: ServiceName[] = [
  'auth',
  'content',
  'access',
  'org',
  'ecom',
  'admin',
  'identity',
  'notifications',
  'media',
];

describe('buildServiceUrl', () => {
  // Save + restore process.env across tests so env-var override fallbacks
  // don't bleed between cases.
  let originalEnv: NodeJS.ProcessEnv;
  beforeEach(() => {
    originalEnv = { ...process.env };
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  describe('EnvName string resolution', () => {
    it('production yields auth.revelations.studio for auth', () => {
      expect(buildServiceUrl('auth', 'production')).toBe(
        'https://auth.revelations.studio'
      );
    });

    it('staging yields auth-staging.revelations.studio for auth', () => {
      expect(buildServiceUrl('auth', 'staging')).toBe(
        'https://auth-staging.revelations.studio'
      );
    });

    it('dev (deployed) yields auth.dev.revelations.studio for auth', () => {
      expect(buildServiceUrl('auth', 'dev')).toBe(
        'https://auth.dev.revelations.studio'
      );
    });

    it('development yields http://localhost:42069 for auth', () => {
      expect(buildServiceUrl('auth', 'development')).toBe(
        'http://localhost:42069'
      );
    });

    it('test yields the same URL as development', () => {
      expect(buildServiceUrl('auth', 'test')).toBe(
        buildServiceUrl('auth', 'development')
      );
    });
  });

  describe('boolean env (backward-compat with old getServiceUrl)', () => {
    it('true resolves to development', () => {
      expect(buildServiceUrl('auth', true)).toBe('http://localhost:42069');
    });

    it('false resolves to production', () => {
      expect(buildServiceUrl('auth', false)).toBe(
        'https://auth.revelations.studio'
      );
    });
  });

  describe('Env object resolution', () => {
    it('reads ENVIRONMENT="production"', () => {
      expect(buildServiceUrl('org', { ENVIRONMENT: 'production' })).toBe(
        'https://organization-api.revelations.studio'
      );
    });

    it('reads ENVIRONMENT="staging"', () => {
      expect(buildServiceUrl('org', { ENVIRONMENT: 'staging' })).toBe(
        'https://organization-api-staging.revelations.studio'
      );
    });

    it('reads ENVIRONMENT="dev"', () => {
      expect(buildServiceUrl('org', { ENVIRONMENT: 'dev' })).toBe(
        'https://organization-api.dev.revelations.studio'
      );
    });

    it('reads ENVIRONMENT="development"', () => {
      expect(buildServiceUrl('org', { ENVIRONMENT: 'development' })).toBe(
        'http://localhost:42071'
      );
    });

    it('reads ENVIRONMENT="test"', () => {
      expect(buildServiceUrl('org', { ENVIRONMENT: 'test' })).toBe(
        'http://localhost:42071'
      );
    });

    it('MODE=development falls through when ENVIRONMENT absent', () => {
      expect(buildServiceUrl('auth', { MODE: 'development' })).toBe(
        'http://localhost:42069'
      );
    });

    it('MODE=production falls through when ENVIRONMENT absent', () => {
      expect(buildServiceUrl('auth', { MODE: 'production' })).toBe(
        'https://auth.revelations.studio'
      );
    });

    it('dev=true falls through when ENVIRONMENT and MODE absent', () => {
      expect(buildServiceUrl('auth', { dev: true })).toBe(
        'http://localhost:42069'
      );
    });

    it('dev=false does NOT force production (falls through to NODE_ENV)', () => {
      // dev: false is treated as absent — only `dev: true` selects development.
      // Under vitest NODE_ENV=test, the fallback path picks development.
      process.env.NODE_ENV = 'test';
      expect(buildServiceUrl('auth', { dev: false })).toBe(
        'http://localhost:42069'
      );
    });

    it('empty Env defaults to production when NODE_ENV is absent (safe-by-default)', () => {
      // Vitest sets NODE_ENV='test' by default; clear it to test the true
      // empty-Env fallback. In a real deployment Cloudflare Workers don't
      // expose process.env.NODE_ENV at all. `delete` is required because
      // assigning `undefined` to process.env.X coerces to the STRING
      // 'undefined' (Node.js process.env behavior).
      delete process.env.NODE_ENV;
      expect(buildServiceUrl('auth', {})).toBe(
        'https://auth.revelations.studio'
      );
    });

    it('ENVIRONMENT strictly wins over MODE (intentional precedence)', () => {
      // Resolves to development (env.ENVIRONMENT='development') even though
      // env.MODE='production' would suggest otherwise. The new precedence
      // is documented on resolveEnvName's JSDoc; this test pins it so any
      // future precedence change is caught.
      expect(
        buildServiceUrl('auth', {
          ENVIRONMENT: 'development',
          MODE: 'production',
        })
      ).toBe('http://localhost:42069');
    });

    it('ENVIRONMENT strictly wins over dev:true', () => {
      // env.dev:true would normally select development, but explicit
      // ENVIRONMENT='production' takes precedence.
      expect(
        buildServiceUrl('auth', { ENVIRONMENT: 'production', dev: true })
      ).toBe('https://auth.revelations.studio');
    });

    it('empty Env returns development URL when NODE_ENV=test (vitest default)', () => {
      // Documents the legitimate fallback path: when running under vitest,
      // an empty Env defaults to 'development'. This matches the historical
      // getServiceUrl behavior — backward-compat verified.
      process.env.NODE_ENV = 'test';
      expect(buildServiceUrl('auth', {})).toBe('http://localhost:42069');
    });
  });

  describe('undefined env fallback', () => {
    it('respects NODE_ENV=test → development', () => {
      process.env.NODE_ENV = 'test';
      expect(buildServiceUrl('auth')).toBe('http://localhost:42069');
    });

    it('respects NODE_ENV=production → production', () => {
      process.env.NODE_ENV = 'production';
      expect(buildServiceUrl('auth')).toBe('https://auth.revelations.studio');
    });
  });

  describe('env-var override (Cloudflare bindings)', () => {
    it('AUTH_WORKER_URL override wins over ENV_HOSTS default', () => {
      const url = buildServiceUrl('auth', {
        ENVIRONMENT: 'production',
        AUTH_WORKER_URL: 'https://custom-auth.example.com',
      });
      expect(url).toBe('https://custom-auth.example.com');
    });

    it('API_URL override applies to content service', () => {
      const url = buildServiceUrl('content', {
        ENVIRONMENT: 'production',
        API_URL: 'https://custom-content.example.com',
      });
      expect(url).toBe('https://custom-content.example.com');
    });

    it('API_URL override applies to access service (shared deployment)', () => {
      const url = buildServiceUrl('access', {
        ENVIRONMENT: 'production',
        API_URL: 'https://custom-content.example.com',
      });
      expect(url).toBe('https://custom-content.example.com');
    });

    it('per-service URL override applies (ORG_API_URL → org)', () => {
      const url = buildServiceUrl('org', {
        ENVIRONMENT: 'staging',
        ORG_API_URL: 'https://custom-org.example.com',
      });
      expect(url).toBe('https://custom-org.example.com');
    });

    it('override falls through to default when env value is empty string', () => {
      expect(
        buildServiceUrl('auth', {
          ENVIRONMENT: 'production',
          AUTH_WORKER_URL: '',
        })
      ).toBe('https://auth.revelations.studio');
    });

    it('reads override from process.env when bindings lack the key', () => {
      // Bindings-first, process.env-fallback path. Cloudflare Workers don't
      // expose process.env, but local dev + E2E tests rely on this fallback
      // when the binding isn't materialized into the env object.
      process.env.AUTH_WORKER_URL = 'https://from-process-env.example.com';
      const url = buildServiceUrl('auth', { ENVIRONMENT: 'production' });
      expect(url).toBe('https://from-process-env.example.com');
    });
  });

  describe('SSRF validation on env-var overrides', () => {
    it('rejects javascript: URL in deployed env', () => {
      expect(() =>
        buildServiceUrl('auth', {
          ENVIRONMENT: 'production',
          AUTH_WORKER_URL: 'javascript:alert(1)',
        })
      ).toThrow();
    });

    it('rejects http:// in deployed env (requireHttps)', () => {
      expect(() =>
        buildServiceUrl('auth', {
          ENVIRONMENT: 'production',
          AUTH_WORKER_URL: 'http://insecure.example.com',
        })
      ).toThrow();
    });

    it('allows http:// in development env (requireHttps=false)', () => {
      const url = buildServiceUrl('auth', {
        ENVIRONMENT: 'development',
        AUTH_WORKER_URL: 'http://localhost:9000',
      });
      expect(url).toBe('http://localhost:9000');
    });

    it('rejects private IP in deployed env (SSRF)', () => {
      expect(() =>
        buildServiceUrl('auth', {
          ENVIRONMENT: 'production',
          AUTH_WORKER_URL: 'https://10.0.0.1',
        })
      ).toThrow();
    });

    it('rejects cloud metadata service URL', () => {
      expect(() =>
        buildServiceUrl('auth', {
          ENVIRONMENT: 'production',
          AUTH_WORKER_URL: 'https://169.254.169.254',
        })
      ).toThrow();
    });
  });

  describe('default URLs are NOT validated (code-controlled, no SSRF surface)', () => {
    it('localhost defaults work in development without SSRF errors', () => {
      // ENV_HOSTS.development.apiUrl('auth') returns 'http://localhost:42069'.
      // The historical getServiceUrl also skipped validation on defaults.
      expect(buildServiceUrl('auth', 'development')).toBe(
        'http://localhost:42069'
      );
    });
  });

  describe('coverage matrix (every service × every env)', () => {
    const ALL_ENVS: EnvName[] = [
      'production',
      'staging',
      'dev',
      'development',
      'test',
    ];

    it('every combination produces a non-empty https://… or http://… URL', () => {
      for (const env of ALL_ENVS) {
        for (const service of ALL_SERVICES) {
          const url = buildServiceUrl(service, env);
          expect(url).toMatch(/^https?:\/\/.+/);
        }
      }
    });
  });
});
