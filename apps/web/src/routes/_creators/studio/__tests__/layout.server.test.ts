/**
 * The personal studio's layout (Codex-a6ofh.3.2): its rail's drafts badge
 * counts what the content list it opens shows, Personal, and its orgs carry
 * their ids, which the list's Where names its org options by.
 *
 * THE BUG THIS LOCKS. The badge's read sent no org, which the API reads as
 * every org, so it counted org drafts that the list (Personal by default)
 * leaves out: "Drafts 5" opened a list of 2.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/errors';

const list = vi.hoisted(() =>
  vi.fn(async (_params?: URLSearchParams) => ({ pagination: { total: 2 } }))
);
const logger = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('$lib/observability', () => ({ logger }));

// The remotes build a `query()` at module scope, which needs SvelteKit app
// hooks a unit test has no access to.
vi.mock('$lib/remote/account.remote', () => ({
  getProfile: vi.fn(async () => null),
}));
vi.mock('$lib/remote/onboarding.remote', () => ({
  getCreatorOnboarding: vi.fn(async () => null),
}));
vi.mock('$lib/remote/org.remote', () => ({
  getMyOrganizations: vi.fn(async () => [
    {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Studio Alpha',
      slug: 'studio-alpha',
      logoUrl: null,
      role: 'creator',
    },
  ]),
}));
vi.mock('$lib/server/api', () => ({
  createServerApi: () => ({ content: { list } }),
}));

const { load } = await import('../+layout.server');

type LoadEvent = Parameters<typeof load>[0];

function runLoad() {
  return load({
    locals: {
      user: {
        id: 'u1',
        name: 'Creator',
        email: 'c@example.test',
        role: 'creator',
      },
    },
    depends: vi.fn(),
    platform: {},
    cookies: {},
    setHeaders: vi.fn(),
    url: new URL('http://creators.lvh.me:3010/studio'),
  } as unknown as LoadEvent);
}

describe('personal studio layout', () => {
  beforeEach(() => {
    list.mockClear();
    vi.clearAllMocks();
  });

  it('counts the personal drafts, as the list the badge opens shows them', async () => {
    const data = await runLoad();

    expect(list).toHaveBeenCalledTimes(1);
    const params = list.mock.calls[0]?.[0];
    // The drafts never live, the Drafts tab's set (Codex-a6ofh.3.6).
    expect(params?.get('lifecycle')).toBe('draft');
    expect(params?.has('status')).toBe(false);
    expect(params?.get('scope')).toBe('personal');
    expect(params?.has('organizationId')).toBe(false);
    expect(data).toMatchObject({ badgeCounts: { draftContent: 2 } });
  });

  it('hands the orgs on with their ids, for the list’s Where', async () => {
    const data = await runLoad();

    expect(data).toMatchObject({
      orgs: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          name: 'Studio Alpha',
          slug: 'studio-alpha',
        },
      ],
    });
  });

  // The badge is decoration, so a failed read hides it, as no drafts would:
  // the log is what tells them apart (Codex-a6ofh.3.2 review).
  it('a refused badge read hides the badge and logs our bad request as an error', async () => {
    list.mockRejectedValueOnce(
      new ApiError(400, 'Invalid request data', 'VALIDATION_ERROR', [
        { path: ['scope'], message: 'Invalid input' },
      ])
    );

    const data = await runLoad();

    expect(data).toMatchObject({ badgeCounts: { draftContent: 0 } });
    expect(logger.error).toHaveBeenCalledWith(
      'studio.draft_badge_refused',
      expect.objectContaining({ scope: 'personal', status: 400 })
    );
  });

  it('a sign-out mid-load is a warning, never an error', async () => {
    list.mockRejectedValueOnce(
      new ApiError(401, 'Authentication required', 'UNAUTHORIZED')
    );

    await runLoad();

    expect(logger.warn).toHaveBeenCalledWith(
      'studio.draft_badge_refused',
      expect.objectContaining({ status: 401 })
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('an outage is logged as one', async () => {
    list.mockRejectedValueOnce(new TypeError('fetch failed'));

    const data = await runLoad();

    expect(data).toMatchObject({ badgeCounts: { draftContent: 0 } });
    expect(logger.warn).toHaveBeenCalledWith(
      'studio.draft_badge_unavailable',
      expect.objectContaining({ scope: 'personal' })
    );
  });
});
