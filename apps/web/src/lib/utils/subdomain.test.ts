import { describe, expect, it } from 'vitest';
import {
  buildCreatorsUrl,
  buildOrgUrl,
  extractSubdomain,
  getSubdomainContext,
} from './subdomain';

describe('Subdomain Utilities', () => {
  describe('extractSubdomain', () => {
    it('returns null for platform root', () => {
      expect(extractSubdomain('revelations.studio')).toBeNull();
      expect(extractSubdomain('localhost:3000')).toBeNull();
    });

    it('returns org slug from subdomain', () => {
      expect(extractSubdomain('yoga-studio.revelations.studio')).toBe(
        'yoga-studio'
      );
      expect(extractSubdomain('cooking-school.revelations.studio')).toBe(
        'cooking-school'
      );
    });

    it('returns subdomain from localhost', () => {
      expect(extractSubdomain('test-org.localhost:3000')).toBe('test-org');
      expect(extractSubdomain('creators.localhost:3000')).toBe('creators');
    });

    it('returns null for bare lvh.me', () => {
      expect(extractSubdomain('lvh.me:3000')).toBeNull();
      expect(extractSubdomain('lvh.me')).toBeNull();
    });

    it('returns subdomain from lvh.me', () => {
      expect(extractSubdomain('bruce-studio.lvh.me:3000')).toBe('bruce-studio');
      expect(extractSubdomain('creators.lvh.me:3000')).toBe('creators');
    });

    it('handles www alias', () => {
      // Logic might return 'www' and let context handler deal with it
      expect(extractSubdomain('www.revelations.studio')).toBe('www');
    });

    it('returns null for bare dev.revelations.studio (deployed dev apex)', () => {
      expect(extractSubdomain('dev.revelations.studio')).toBeNull();
    });

    it('returns org slug from {slug}.dev.revelations.studio', () => {
      expect(extractSubdomain('studio-alpha.dev.revelations.studio')).toBe(
        'studio-alpha'
      );
      expect(
        extractSubdomain('of-blood-and-bones.dev.revelations.studio')
      ).toBe('of-blood-and-bones');
    });

    it('returns reserved subdomain from dev.revelations.studio', () => {
      expect(extractSubdomain('auth.dev.revelations.studio')).toBe('auth');
      expect(extractSubdomain('creators.dev.revelations.studio')).toBe(
        'creators'
      );
    });

    it('rejects nested subdomains under dev.revelations.studio', () => {
      // We do not support two-level org subdomains in deployed dev
      expect(
        extractSubdomain('foo.studio-alpha.dev.revelations.studio')
      ).toBeNull();
    });
  });

  describe('getSubdomainContext', () => {
    it('identifies platform context', () => {
      expect(getSubdomainContext('revelations.studio')).toEqual({
        type: 'platform',
      });
      expect(getSubdomainContext('www.revelations.studio')).toEqual({
        type: 'platform',
      });
      expect(getSubdomainContext('localhost:3000')).toEqual({
        type: 'platform',
      });
      expect(getSubdomainContext('lvh.me:3000')).toEqual({
        type: 'platform',
      });
    });

    it('identifies creators context', () => {
      expect(getSubdomainContext('creators.revelations.studio')).toEqual({
        type: 'creators',
      });
      expect(getSubdomainContext('creators.localhost:3000')).toEqual({
        type: 'creators',
      });
      expect(getSubdomainContext('creators.lvh.me:3000')).toEqual({
        type: 'creators',
      });
    });

    it('identifies organization context', () => {
      const result = getSubdomainContext('yoga-studio.revelations.studio');
      expect(result).toEqual({ type: 'organization', slug: 'yoga-studio' });
    });

    it('identifies organization context from lvh.me', () => {
      const result = getSubdomainContext('bruce-studio.lvh.me:3000');
      expect(result).toEqual({
        type: 'organization',
        slug: 'bruce-studio',
      });
    });

    it('identifies reserved subdomains', () => {
      expect(getSubdomainContext('auth.revelations.studio')).toEqual({
        type: 'reserved',
        subdomain: 'auth',
      });
      expect(getSubdomainContext('api.revelations.studio')).toEqual({
        type: 'reserved',
        subdomain: 'api',
      });
    });

    it('identifies platform context on deployed dev apex', () => {
      expect(getSubdomainContext('dev.revelations.studio')).toEqual({
        type: 'platform',
      });
      expect(getSubdomainContext('www.dev.revelations.studio')).toEqual({
        type: 'platform',
      });
    });

    it('identifies organization context on deployed dev subdomain', () => {
      expect(
        getSubdomainContext('studio-alpha.dev.revelations.studio')
      ).toEqual({ type: 'organization', slug: 'studio-alpha' });
    });

    it('identifies reserved subdomains on deployed dev', () => {
      expect(getSubdomainContext('auth.dev.revelations.studio')).toEqual({
        type: 'reserved',
        subdomain: 'auth',
      });
    });
  });

  // ============================================================================
  // Codex-d3g6 sub-item 5: buildOrgUrl + buildCreatorsUrl
  // ============================================================================
  describe('buildOrgUrl', () => {
    it('builds full URL on lvh.me dev host', () => {
      const currentUrl = new URL('http://lvh.me:3000/explore');
      expect(buildOrgUrl(currentUrl, 'bruce-studio', '/studio')).toBe(
        'http://bruce-studio.lvh.me:3000/studio'
      );
    });

    it('builds full URL on production revelations.studio', () => {
      const currentUrl = new URL('https://revelations.studio/discover');
      expect(buildOrgUrl(currentUrl, 'yoga-studio', '/explore')).toBe(
        'https://yoga-studio.revelations.studio/explore'
      );
    });

    it('builds full URL on localhost (no port suffix when port absent)', () => {
      // localhost without port is unusual but the function should still
      // produce a syntactically valid URL.
      const currentUrl = new URL('http://localhost/account');
      expect(buildOrgUrl(currentUrl, 'test-org', '/library')).toBe(
        'http://test-org.localhost/library'
      );
    });

    it('builds full URL on localhost with port', () => {
      const currentUrl = new URL('http://test-org.localhost:3000/explore');
      expect(buildOrgUrl(currentUrl, 'other-org', '/studio')).toBe(
        'http://other-org.localhost:3000/studio'
      );
    });

    it('defaults to "/" when path is omitted', () => {
      const currentUrl = new URL('http://lvh.me:3000/');
      expect(buildOrgUrl(currentUrl, 'bruce-studio')).toBe(
        'http://bruce-studio.lvh.me:3000/'
      );
    });

    it('preserves protocol from current URL (https stays https)', () => {
      const currentUrl = new URL('https://lvh.me:3000/');
      expect(buildOrgUrl(currentUrl, 'bruce-studio', '/library')).toBe(
        'https://bruce-studio.lvh.me:3000/library'
      );
    });

    it('stays on dev.revelations.studio when navigating from a dev org subdomain', () => {
      // Regression: must NOT leak to prod (studio-beta.revelations.studio)
      // when crossing orgs from a dev page.
      const currentUrl = new URL(
        'https://studio-alpha.dev.revelations.studio/library'
      );
      expect(buildOrgUrl(currentUrl, 'studio-beta', '/explore')).toBe(
        'https://studio-beta.dev.revelations.studio/explore'
      );
    });

    it('stays on dev.revelations.studio when navigating from the dev apex', () => {
      const currentUrl = new URL('https://dev.revelations.studio/discover');
      expect(buildOrgUrl(currentUrl, 'studio-alpha', '/')).toBe(
        'https://studio-alpha.dev.revelations.studio/'
      );
    });
  });

  describe('buildCreatorsUrl', () => {
    it('builds creators subdomain URL on lvh.me', () => {
      const currentUrl = new URL('http://lvh.me:3000/');
      expect(buildCreatorsUrl(currentUrl, '/profile/bruce')).toBe(
        'http://creators.lvh.me:3000/profile/bruce'
      );
    });

    it('builds creators subdomain URL on production', () => {
      const currentUrl = new URL('https://revelations.studio/discover');
      expect(buildCreatorsUrl(currentUrl, '/profile/jane')).toBe(
        'https://creators.revelations.studio/profile/jane'
      );
    });

    it('builds creators subdomain URL on localhost with port', () => {
      const currentUrl = new URL('http://localhost:3000/');
      expect(buildCreatorsUrl(currentUrl, '/profile/bob')).toBe(
        'http://creators.localhost:3000/profile/bob'
      );
    });

    it('defaults to "/" when path is omitted', () => {
      const currentUrl = new URL('http://lvh.me:3000/');
      expect(buildCreatorsUrl(currentUrl)).toBe('http://creators.lvh.me:3000/');
    });

    it('builds creators URL on deployed dev', () => {
      const currentUrl = new URL(
        'https://studio-alpha.dev.revelations.studio/explore'
      );
      expect(buildCreatorsUrl(currentUrl, '/profile/alex')).toBe(
        'https://creators.dev.revelations.studio/profile/alex'
      );
    });
  });
});
