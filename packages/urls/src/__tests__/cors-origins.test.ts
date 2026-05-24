import { describe, expect, it } from 'vitest';
import { corsOriginsFor } from '../cors-origins';

describe('corsOriginsFor', () => {
  it('dev includes the dev apex + wildcard', () => {
    const origins = corsOriginsFor('dev');
    expect(origins).toContain('https://dev.revelations.studio');
    expect(origins).toContain('https://*.dev.revelations.studio');
  });

  it('development includes lvh.me apex + org-subdomain wildcards + nip.io + auth-worker self URL', () => {
    const origins = corsOriginsFor('development');
    expect(origins).toContain('http://lvh.me:3000');
    expect(origins).toContain('http://lvh.me:5173');
    expect(origins).toContain('http://localhost:42069');
    // Cross-subdomain coverage for `<slug>.lvh.me` (studio, brand editor)
    expect(origins).toContain('http://*.lvh.me:3000');
    expect(origins).toContain('http://*.lvh.me:5173');
    expect(origins).toContain('http://*.nip.io');
  });

  it('staging includes -staging apex + wildcard', () => {
    const origins = corsOriginsFor('staging');
    expect(origins).toContain('https://codex-staging.revelations.studio');
    expect(origins).toContain('https://*-staging.revelations.studio');
  });

  it('production returns wildcard subdomain for cross-subdomain auth POSTs', () => {
    expect(corsOriginsFor('production')).toEqual([
      'https://*.revelations.studio',
    ]);
  });

  it('test includes lvh.me apex + org-subdomain wildcard for studio/brand-editor E2E flows', () => {
    const origins = corsOriginsFor('test');
    expect(origins).toContain('http://localhost:42069');
    expect(origins).toContain('http://lvh.me:5173');
    // Without this wildcard, studio E2E tests navigating to `<slug>.lvh.me:5173`
    // get rejected by BetterAuth's Origin check and the session never validates.
    expect(origins).toContain('http://*.lvh.me:5173');
  });

  it('returns a new array each call (defensive — no shared mutable state)', () => {
    const a = corsOriginsFor('development');
    const b = corsOriginsFor('development');
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});
