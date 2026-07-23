/**
 * Tests for the URL builder family in @codex/urls/build-url.ts:
 *   - buildOrgUrl(currentUrl, slug, path?)
 *   - buildOrgUrlFromEnv(env, slug, path?)  ← NEW worker-side variant
 *   - buildPlatformUrl(currentUrl, path?)
 *   - buildCreatorsUrl(currentUrl, path?)
 *   - buildContentUrl(currentUrl, content)
 *   - buildJourneyUrl(currentUrl, journey, options?)  ← NEW (Codex-2pryk · WP-0)
 *
 * Test contract: must produce identical output to the historical
 * apps/web/src/lib/utils/subdomain.ts builders. Existing 35-test
 * subdomain.test.ts suite is the byte-equality gate; this file adds
 * the @codex/urls-specific coverage for new behaviours (buildOrgUrlFromEnv,
 * staging URLs, etc).
 */

import { describe, expect, it } from 'vitest';
import {
  buildContentUrl,
  buildCreatorsUrl,
  buildJourneyUrl,
  buildOrgUrl,
  buildOrgUrlFromEnv,
  buildPlatformUrl,
} from '../build-url';

describe('buildOrgUrl (URL-based)', () => {
  it('builds cross-org URL on lvh.me dev', () => {
    expect(
      buildOrgUrl(
        new URL('http://lvh.me:3000/explore'),
        'bruce-studio',
        '/studio'
      )
    ).toBe('http://bruce-studio.lvh.me:3000/studio');
  });

  it('builds cross-org URL on production', () => {
    expect(
      buildOrgUrl(
        new URL('https://revelations.studio/discover'),
        'yoga-studio',
        '/explore'
      )
    ).toBe('https://yoga-studio.revelations.studio/explore');
  });

  it('stays on deployed dev when navigating from a dev org subdomain', () => {
    // Regression: must NOT leak to prod (studio-beta.revelations.studio)
    expect(
      buildOrgUrl(
        new URL('https://studio-alpha.dev.revelations.studio/library'),
        'studio-beta',
        '/explore'
      )
    ).toBe('https://studio-beta.dev.revelations.studio/explore');
  });

  it('preserves protocol (https stays https)', () => {
    expect(buildOrgUrl(new URL('https://lvh.me:3000/'), 'bruce-studio')).toBe(
      'https://bruce-studio.lvh.me:3000/'
    );
  });

  it('preserves port from the current URL', () => {
    expect(
      buildOrgUrl(new URL('http://studio-alpha.lvh.me:4173/'), 'bruce-studio')
    ).toBe('http://bruce-studio.lvh.me:4173/');
  });

  it('defaults path to "/"', () => {
    expect(buildOrgUrl(new URL('http://lvh.me:3000/'), 'bruce-studio')).toBe(
      'http://bruce-studio.lvh.me:3000/'
    );
  });

  it('builds URL on localhost', () => {
    expect(
      buildOrgUrl(
        new URL('http://test-org.localhost:3000/'),
        'other-org',
        '/studio'
      )
    ).toBe('http://other-org.localhost:3000/studio');
  });
});

describe('buildOrgUrlFromEnv (worker-side, no URL context)', () => {
  it('builds dev URL', () => {
    expect(buildOrgUrlFromEnv('dev', 'studio-alpha')).toBe(
      'https://studio-alpha.dev.revelations.studio/'
    );
  });

  it('builds dev URL with path', () => {
    expect(buildOrgUrlFromEnv('dev', 'studio-alpha', '/explore')).toBe(
      'https://studio-alpha.dev.revelations.studio/explore'
    );
  });

  it('builds production URL', () => {
    expect(buildOrgUrlFromEnv('production', 'yoga-studio')).toBe(
      'https://yoga-studio.revelations.studio/'
    );
  });

  it('builds staging URL with -staging suffix pattern', () => {
    expect(buildOrgUrlFromEnv('staging', 'studio-alpha')).toBe(
      'https://studio-alpha-staging.revelations.studio/'
    );
  });

  it('builds development URL on lvh.me:3000', () => {
    expect(buildOrgUrlFromEnv('development', 'bruce-studio')).toBe(
      'http://bruce-studio.lvh.me:3000/'
    );
  });

  it('builds test URL identical to development (same row in ENV_HOSTS)', () => {
    expect(buildOrgUrlFromEnv('test', 'bruce-studio')).toBe(
      buildOrgUrlFromEnv('development', 'bruce-studio')
    );
  });

  it('defaults path to "/"', () => {
    const url = buildOrgUrlFromEnv('production', 'yoga-studio');
    expect(url.endsWith('/')).toBe(true);
  });

  it('preserves path including query strings', () => {
    expect(
      buildOrgUrlFromEnv('dev', 'studio-alpha', '/content/foo?ref=share')
    ).toBe('https://studio-alpha.dev.revelations.studio/content/foo?ref=share');
  });
});

describe('buildPlatformUrl (URL-based)', () => {
  it('strips subdomain to platform apex on prod', () => {
    expect(
      buildPlatformUrl(
        new URL('https://yoga-studio.revelations.studio/foo'),
        '/about'
      )
    ).toBe('https://revelations.studio/about');
  });

  it('strips subdomain to lvh.me on local dev', () => {
    expect(
      buildPlatformUrl(new URL('http://bruce-studio.lvh.me:3000/'), '/library')
    ).toBe('http://lvh.me:3000/library');
  });

  it('preserves dev.revelations.studio apex on deployed dev', () => {
    expect(
      buildPlatformUrl(
        new URL('https://studio-alpha.dev.revelations.studio/'),
        '/discover'
      )
    ).toBe('https://dev.revelations.studio/discover');
  });

  it('defaults path to "/"', () => {
    expect(buildPlatformUrl(new URL('http://lvh.me:3000/'))).toBe(
      'http://lvh.me:3000/'
    );
  });
});

describe('buildCreatorsUrl (URL-based)', () => {
  it('builds creators subdomain on lvh.me', () => {
    expect(
      buildCreatorsUrl(new URL('http://lvh.me:3000/'), '/profile/bruce')
    ).toBe('http://creators.lvh.me:3000/profile/bruce');
  });

  it('builds creators subdomain on production', () => {
    expect(
      buildCreatorsUrl(
        new URL('https://revelations.studio/discover'),
        '/profile/jane'
      )
    ).toBe('https://creators.revelations.studio/profile/jane');
  });

  it('builds creators URL on deployed dev', () => {
    expect(
      buildCreatorsUrl(
        new URL('https://studio-alpha.dev.revelations.studio/explore'),
        '/profile/alex'
      )
    ).toBe('https://creators.dev.revelations.studio/profile/alex');
  });

  it('defaults path to "/"', () => {
    expect(buildCreatorsUrl(new URL('http://lvh.me:3000/'))).toBe(
      'http://creators.lvh.me:3000/'
    );
  });
});

describe('buildContentUrl (cross-org-aware)', () => {
  it('returns root-relative path when content is on current org subdomain', () => {
    expect(
      buildContentUrl(new URL('http://yoga-studio.lvh.me:3000/'), {
        id: 'content-123',
        slug: 'morning-flow',
        organizationSlug: 'yoga-studio',
      })
    ).toBe('/content/morning-flow');
  });

  it('returns full cross-org URL when content is on another org', () => {
    expect(
      buildContentUrl(new URL('http://yoga-studio.lvh.me:3000/'), {
        id: 'content-456',
        slug: 'cooking-101',
        organizationSlug: 'cooking-school',
      })
    ).toBe('http://cooking-school.lvh.me:3000/content/cooking-101');
  });

  it('returns full URL when current page is on the platform apex', () => {
    expect(
      buildContentUrl(new URL('http://lvh.me:3000/discover'), {
        id: 'content-789',
        slug: 'jazz-intro',
        organizationSlug: 'music-school',
      })
    ).toBe('http://music-school.lvh.me:3000/content/jazz-intro');
  });

  it('falls back to content ID when slug is null', () => {
    expect(
      buildContentUrl(new URL('http://yoga-studio.lvh.me:3000/'), {
        id: 'content-abc',
        slug: null,
        organizationSlug: 'yoga-studio',
      })
    ).toBe('/content/content-abc');
  });

  it('falls back to content ID when slug is missing', () => {
    expect(
      buildContentUrl(new URL('http://yoga-studio.lvh.me:3000/'), {
        id: 'content-def',
        organizationSlug: 'yoga-studio',
      })
    ).toBe('/content/content-def');
  });

  it('returns root-relative path when organizationSlug is missing', () => {
    expect(
      buildContentUrl(new URL('http://lvh.me:3000/'), {
        id: 'content-xyz',
        slug: 'standalone',
      })
    ).toBe('/content/standalone');
  });

  it('handles deployed dev cross-org navigation', () => {
    expect(
      buildContentUrl(new URL('https://studio-alpha.dev.revelations.studio/'), {
        id: 'content-1',
        slug: 'first-video',
        organizationSlug: 'studio-beta',
      })
    ).toBe('https://studio-beta.dev.revelations.studio/content/first-video');
  });
});

describe('buildJourneyUrl (cross-org-aware, surface-aware)', () => {
  // ── Cross-org routing + slug/id fallback (mirrors buildContentUrl) ──
  it('returns root-relative path when the journey is on the current org subdomain', () => {
    expect(
      buildJourneyUrl(new URL('http://acme.lvh.me:3000/'), {
        id: 'course-123',
        slug: 'rootwork',
        organizationSlug: 'acme',
      })
    ).toBe('/journeys/rootwork');
  });

  it('returns a full cross-org URL when the journey is on another org', () => {
    expect(
      buildJourneyUrl(new URL('http://acme.lvh.me:3000/'), {
        id: 'course-456',
        slug: 'grief-and-the-body',
        organizationSlug: 'other-studio',
      })
    ).toBe('http://other-studio.lvh.me:3000/journeys/grief-and-the-body');
  });

  it('returns a full URL when the current page is on the platform apex', () => {
    expect(
      buildJourneyUrl(new URL('http://lvh.me:3000/discover'), {
        id: 'course-789',
        slug: 'sleep',
        organizationSlug: 'rest-studio',
      })
    ).toBe('http://rest-studio.lvh.me:3000/journeys/sleep');
  });

  it('falls back to the journey id when slug is null', () => {
    expect(
      buildJourneyUrl(new URL('http://acme.lvh.me:3000/'), {
        id: 'course-abc',
        slug: null,
        organizationSlug: 'acme',
      })
    ).toBe('/journeys/course-abc');
  });

  it('falls back to the journey id when slug is missing', () => {
    expect(
      buildJourneyUrl(new URL('http://acme.lvh.me:3000/'), {
        id: 'course-def',
        organizationSlug: 'acme',
      })
    ).toBe('/journeys/course-def');
  });

  it('returns root-relative path when organizationSlug is missing', () => {
    expect(
      buildJourneyUrl(new URL('http://lvh.me:3000/'), {
        id: 'course-xyz',
        slug: 'standalone-journey',
      })
    ).toBe('/journeys/standalone-journey');
  });

  it('handles deployed dev cross-org navigation', () => {
    expect(
      buildJourneyUrl(new URL('https://studio-alpha.dev.revelations.studio/'), {
        id: 'course-1',
        slug: 'rootwork',
        organizationSlug: 'studio-beta',
      })
    ).toBe('https://studio-beta.dev.revelations.studio/journeys/rootwork');
  });

  // ── Surface variants (all sub-paths of /journeys/{slug}) ──
  it('defaults to the sales surface (no options == { surface: "sales" })', () => {
    const journey = {
      id: 'course-1',
      slug: 'rootwork',
      organizationSlug: 'acme',
    };
    const currentUrl = new URL('http://acme.lvh.me:3000/');
    expect(buildJourneyUrl(currentUrl, journey)).toBe(
      buildJourneyUrl(currentUrl, journey, { surface: 'sales' })
    );
  });

  it('appends /dashboard for the dashboard surface (same org → root-relative)', () => {
    expect(
      buildJourneyUrl(
        new URL('http://acme.lvh.me:3000/'),
        { id: 'course-1', slug: 'rootwork', organizationSlug: 'acme' },
        { surface: 'dashboard' }
      )
    ).toBe('/journeys/rootwork/dashboard');
  });

  it('appends /checkout for the checkout surface', () => {
    expect(
      buildJourneyUrl(
        new URL('http://acme.lvh.me:3000/'),
        { id: 'course-1', slug: 'rootwork', organizationSlug: 'acme' },
        { surface: 'checkout' }
      )
    ).toBe('/journeys/rootwork/checkout');
  });

  it('applies the surface suffix on a cross-org full URL', () => {
    expect(
      buildJourneyUrl(
        new URL('http://lvh.me:3000/'),
        { id: 'course-1', slug: 'rootwork', organizationSlug: 'acme' },
        { surface: 'dashboard' }
      )
    ).toBe('http://acme.lvh.me:3000/journeys/rootwork/dashboard');
  });

  it('combines the id fallback with a surface suffix', () => {
    expect(
      buildJourneyUrl(
        new URL('http://acme.lvh.me:3000/'),
        { id: 'course-2', organizationSlug: 'acme' },
        { surface: 'dashboard' }
      )
    ).toBe('/journeys/course-2/dashboard');
  });
});
