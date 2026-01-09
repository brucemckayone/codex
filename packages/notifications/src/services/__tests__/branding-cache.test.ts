/**
 * Tests for branding cache functionality
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { BrandingCache } from '../branding-cache';

describe('BrandingCache', () => {
  let cache: BrandingCache;

  beforeEach(() => {
    cache = new BrandingCache(1000); // 1 second TTL for testing
  });

  it('returns null for missing entries', () => {
    expect(cache.get('org-1')).toBeNull();
  });

  it('caches and retrieves values', () => {
    const data = {
      platformName: 'TestCorp',
      primaryColor: '#ff0000',
      secondaryColor: '#00ff00',
      supportEmail: 'support@testcorp.com',
      logoUrl: 'https://example.com/logo.png',
    };

    cache.set('org-1', data);
    expect(cache.get('org-1')).toEqual(data);
  });

  it('returns null after TTL expires', async () => {
    const data = {
      platformName: 'TestCorp',
      primaryColor: '#ff0000',
      secondaryColor: '#00ff00',
      supportEmail: 'support@testcorp.com',
      logoUrl: 'https://example.com/logo.png',
    };

    cache.set('org-1', data);

    // Wait for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 1100));

    expect(cache.get('org-1')).toBeNull();
  });

  it('clears all entries', () => {
    cache.set('org-1', { test: 'data1' });
    cache.set('org-2', { test: 'data2' });

    cache.clear();

    expect(cache.get('org-1')).toBeNull();
    expect(cache.get('org-2')).toBeNull();
  });

  it('deletes specific entries', () => {
    cache.set('org-1', { test: 'data1' });
    cache.set('org-2', { test: 'data2' });

    cache.delete('org-1');

    expect(cache.get('org-1')).toBeNull();
    expect(cache.get('org-2')).toEqual({ test: 'data2' });
  });
});
