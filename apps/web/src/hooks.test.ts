import { describe, expect, it } from 'vitest';
import { reroute } from './hooks';

// Mock the reroute input object
function createEvent(urlStr: string) {
  return {
    url: new URL(urlStr),
    fetch: () => Promise.resolve(new Response()),
  };
}

describe('Reroute Logic', () => {
  it('passes through platform routes (no subdomain)', () => {
    // revelations.studio/about -> /about
    // SvelteKit matches this to (platform)/about if it exists
    const event = createEvent('https://revelations.studio/about');
    expect(reroute(event)).toBe('/about');
  });

  it('passes through platform routes (www)', () => {
    // www.revelations.studio/about -> /about
    const event = createEvent('https://www.revelations.studio/about');
    expect(reroute(event)).toBe('/about');
  });

  it('passes through auth routes on any domain', () => {
    // login on platform
    expect(reroute(createEvent('https://revelations.studio/login'))).toBe(
      '/login'
    );

    // login on org domain (should stay /login, not become /_org/.../login)
    expect(reroute(createEvent('https://yoga.revelations.studio/login'))).toBe(
      '/login'
    );

    // login on creator domain
    expect(
      reroute(createEvent('https://creators.revelations.studio/login'))
    ).toBe('/login');
  });

  it('rewrites org subdomain routes', () => {
    const event = createEvent('https://yoga-studio.revelations.studio/explore');
    // Should map to /_org/[slug]/(space)/explore
    expect(reroute(event)).toBe('/_org/yoga-studio/(space)/explore');
  });

  it('rewrites org studio routes', () => {
    const event = createEvent(
      'https://yoga-studio.revelations.studio/studio/settings'
    );
    // Should map to /_org/[slug]/studio/settings
    expect(reroute(event)).toBe('/_org/yoga-studio/studio/settings');
  });

  it('rewrites creator subdomain routes', () => {
    const event = createEvent('https://creators.revelations.studio/alice');
    // Should map to /_creators/alice
    expect(reroute(event)).toBe('/_creators/alice');
  });

  it('rewrites creator studio routes', () => {
    const event = createEvent(
      'https://creators.revelations.studio/studio/analytics'
    );
    // Should map to /_creators/studio/analytics
    expect(reroute(event)).toBe('/_creators/studio/analytics');
  });
});
