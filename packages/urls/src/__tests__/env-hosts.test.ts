import { describe, expect, it } from 'vitest';
import { ENV_HOSTS, SERVICE_SUBDOMAIN } from '../env-hosts';
import type { EnvName, ServiceName } from '../types';

const ALL_ENVS: EnvName[] = [
  'production',
  'staging',
  'dev',
  'development',
  'test',
];

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

describe('ENV_HOSTS', () => {
  describe('completeness', () => {
    it('has an entry for every EnvName', () => {
      for (const env of ALL_ENVS) {
        expect(ENV_HOSTS[env]).toBeDefined();
      }
    });

    it('every env has scheme + apiUrl + orgHost', () => {
      for (const env of ALL_ENVS) {
        const host = ENV_HOSTS[env];
        expect(host.scheme).toMatch(/^https?$/);
        expect(typeof host.apiUrl).toBe('function');
        expect(typeof host.orgHost).toBe('function');
      }
    });
  });

  describe('production', () => {
    it('builds auth URL as auth.revelations.studio', () => {
      expect(ENV_HOSTS.production.apiUrl('auth')).toBe(
        'https://auth.revelations.studio'
      );
    });

    it('builds content URL as content-api.revelations.studio', () => {
      expect(ENV_HOSTS.production.apiUrl('content')).toBe(
        'https://content-api.revelations.studio'
      );
    });

    it('builds org subdomain hostname', () => {
      expect(ENV_HOSTS.production.orgHost('yoga-studio')).toBe(
        'yoga-studio.revelations.studio'
      );
    });
  });

  describe('staging (-staging suffix pattern)', () => {
    it('builds auth URL with -staging suffix', () => {
      expect(ENV_HOSTS.staging.apiUrl('auth')).toBe(
        'https://auth-staging.revelations.studio'
      );
    });

    it('builds org subdomain hostname with -staging suffix', () => {
      expect(ENV_HOSTS.staging.orgHost('studio-alpha')).toBe(
        'studio-alpha-staging.revelations.studio'
      );
    });
  });

  describe('dev (deployed dev.revelations.studio)', () => {
    it('builds auth URL at dev.revelations.studio', () => {
      expect(ENV_HOSTS.dev.apiUrl('auth')).toBe(
        'https://auth.dev.revelations.studio'
      );
    });

    it('builds org subdomain hostname two-deep', () => {
      expect(ENV_HOSTS.dev.orgHost('studio-alpha')).toBe(
        'studio-alpha.dev.revelations.studio'
      );
    });
  });

  describe('development (local)', () => {
    it('uses http scheme and lvh.me apex', () => {
      expect(ENV_HOSTS.development.scheme).toBe('http');
      expect(ENV_HOSTS.development.port).toBe(3000);
    });

    it('builds auth URL on localhost with port from SERVICE_PORTS', () => {
      expect(ENV_HOSTS.development.apiUrl('auth')).toBe(
        'http://localhost:42069'
      );
    });

    it('builds org subdomain on lvh.me', () => {
      expect(ENV_HOSTS.development.orgHost('bruce-studio')).toBe(
        'bruce-studio.lvh.me'
      );
    });
  });

  describe('test (mirrors development)', () => {
    it('matches development scheme/port/apiUrl', () => {
      expect(ENV_HOSTS.test.scheme).toBe('http');
      expect(ENV_HOSTS.test.port).toBe(3000);
      expect(ENV_HOSTS.test.apiUrl('auth')).toBe('http://localhost:42069');
    });
  });

  describe('apiUrl coverage for every service in every env', () => {
    it('every service yields a non-empty URL in every env', () => {
      for (const env of ALL_ENVS) {
        for (const service of ALL_SERVICES) {
          const url = ENV_HOSTS[env].apiUrl(service);
          expect(url).toMatch(/^https?:\/\/.+/);
        }
      }
    });
  });

  describe('scheme + port invariants', () => {
    it('https envs omit port (deployed only)', () => {
      for (const env of ['production', 'staging', 'dev'] as const) {
        expect(ENV_HOSTS[env].scheme).toBe('https');
        expect(ENV_HOSTS[env].port).toBeUndefined();
      }
    });

    it('http envs define a port (local only)', () => {
      for (const env of ['development', 'test'] as const) {
        expect(ENV_HOSTS[env].scheme).toBe('http');
        expect(typeof ENV_HOSTS[env].port).toBe('number');
      }
    });
  });
});

describe('SERVICE_SUBDOMAIN', () => {
  it('has an entry for every ServiceName', () => {
    for (const service of ALL_SERVICES) {
      expect(SERVICE_SUBDOMAIN[service]).toBeDefined();
      expect(typeof SERVICE_SUBDOMAIN[service]).toBe('string');
    }
  });

  it('content and access share the same subdomain (content-api)', () => {
    // They deploy to the same worker
    expect(SERVICE_SUBDOMAIN.content).toBe(SERVICE_SUBDOMAIN.access);
    expect(SERVICE_SUBDOMAIN.content).toBe('content-api');
  });
});
