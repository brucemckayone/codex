/**
 * The org studio's draft badge (Codex-a6ofh.3.6 review): the count is the
 * Drafts tab's (`lifecycle=draft`), and a read that fails leaves the badge
 * off but is LOGGED, never read as "no drafts" in silence. The personal
 * studio's twin has done this since Codex-a6ofh.3.2; the org's caught
 * everything and said nothing.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const list = vi.hoisted(() => vi.fn());

// `$lib/remote/org.remote` builds a remote `query()` at module scope, which
// needs SvelteKit app hooks a unit test has no access to.
vi.mock('$lib/remote/org.remote', () => ({
  getMyOrganizations: vi.fn(async () => []),
}));
vi.mock('$lib/server/api', () => ({
  createServerApi: () => ({
    org: {
      getMyMembership: vi.fn(async () => ({ role: 'owner', joinedAt: null })),
    },
    content: { list },
  }),
}));
vi.mock('$lib/observability', () => ({
  logger: {
    startTimer: vi.fn(() => ({ end: vi.fn() })),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const { load } = await import('../+layout.server');
const { ApiError } = await import('$lib/api/errors');
const { logger } = await import('$lib/observability');

const ORG = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Studio Alpha',
  slug: 'studio-alpha',
};

type LoadEvent = Parameters<typeof load>[0];

function runLoad() {
  return load({
    locals: { user: { id: 'u1', name: 'Creator', email: 'c@example.test' } },
    parent: async () => ({ org: ORG }),
    depends: vi.fn(),
    platform: {},
    cookies: {},
    setHeaders: vi.fn(),
    url: new URL('http://studio-alpha.lvh.me:3010/studio'),
  } as unknown as LoadEvent);
}

describe('org studio draft badge', () => {
  beforeEach(() => {
    list.mockReset();
    vi.mocked(logger.warn).mockClear();
    vi.mocked(logger.error).mockClear();
  });

  it('counts the Drafts tab: the never-live drafts of this org', async () => {
    list.mockResolvedValue({ items: [], pagination: { total: 3 } });

    const data = await runLoad();

    expect(data).toMatchObject({ badgeCounts: { draftContent: 3 } });
    const params = list.mock.calls[0]?.[0] as URLSearchParams;
    expect(params.get('lifecycle')).toBe('draft');
    expect(params.get('organizationId')).toBe(ORG.id);
    expect(params.has('status')).toBe(false);
  });

  it('a refused count is logged as one, and the badge stays off', async () => {
    list.mockRejectedValueOnce(new ApiError(400, 'Invalid request data'));

    const data = await runLoad();

    expect(data).toMatchObject({ badgeCounts: { draftContent: 0 } });
    expect(logger.error).toHaveBeenCalledWith(
      'studio.draft_badge_refused',
      expect.objectContaining({
        scope: 'org',
        organizationId: ORG.id,
        status: 400,
      })
    );
  });

  it('an outage is logged as one', async () => {
    list.mockRejectedValueOnce(new TypeError('fetch failed'));

    const data = await runLoad();

    expect(data).toMatchObject({ badgeCounts: { draftContent: 0 } });
    expect(logger.warn).toHaveBeenCalledWith(
      'studio.draft_badge_unavailable',
      expect.objectContaining({ scope: 'org', organizationId: ORG.id })
    );
  });
});
