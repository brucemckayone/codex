import { describe, expect, it } from 'vitest';
import { extractSubdomain, getSubdomainContext } from './subdomain';

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

    it('handles www alias', () => {
      // Logic might return 'www' and let context handler deal with it
      expect(extractSubdomain('www.revelations.studio')).toBe('www');
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
    });

    it('identifies creators context', () => {
      expect(getSubdomainContext('creators.revelations.studio')).toEqual({
        type: 'creators',
      });
      expect(getSubdomainContext('creators.localhost:3000')).toEqual({
        type: 'creators',
      });
    });

    it('identifies organization context', () => {
      const result = getSubdomainContext('yoga-studio.revelations.studio');
      expect(result).toEqual({ type: 'organization', slug: 'yoga-studio' });
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
  });
});
