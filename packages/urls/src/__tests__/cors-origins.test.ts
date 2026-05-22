import { describe, expect, it } from 'vitest';
import { corsOriginsFor } from '../cors-origins';

describe('corsOriginsFor', () => {
  it('dev includes the dev apex + wildcard', () => {
    const origins = corsOriginsFor('dev');
    expect(origins).toContain('https://dev.revelations.studio');
    expect(origins).toContain('https://*.dev.revelations.studio');
  });

  it('development includes lvh.me + nip.io + auth-worker self URL', () => {
    const origins = corsOriginsFor('development');
    expect(origins).toContain('http://lvh.me:3000');
    expect(origins).toContain('http://localhost:42069');
    expect(origins).toContain('http://lvh.me:5173');
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

  it('test returns empty (tests use exact origin)', () => {
    expect(corsOriginsFor('test')).toEqual([]);
  });

  it('returns a new array each call (defensive — no shared mutable state)', () => {
    const a = corsOriginsFor('development');
    const b = corsOriginsFor('development');
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});
