/**
 * A creator's public profile, catalogue and content detail read the PUBLIC
 * content list scoped by creator (Codex-osuqt).
 *
 * They used to call `api.content.list`, the studio list: it needs a session
 * and lists the SIGNED-IN user's own content. A visitor got a 401, shown as
 * an empty profile (and a 404 on every real piece), and a signed-in visitor
 * saw their own work on someone else's profile. So each case here fails if a
 * loader reaches the studio list at all.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// A BetterAuth user id: users.id is text, never a uuid.
const CREATOR_ID = 'a62da3ad5c94736a88f90ff5c666143c';

const mockGetPublicContent = vi.fn();
const mockStudioList = vi.fn(() => {
  throw new Error('the studio list must not back a public creator page');
});
const mockGetPublicProfile = vi.fn();

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({
    account: { getPublicProfile: mockGetPublicProfile },
    content: { getPublicContent: mockGetPublicContent, list: mockStudioList },
  })),
}));

vi.mock('$lib/observability', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const event = (overrides: Record<string, unknown> = {}) =>
  ({
    params: { username: '@alex-creator' },
    url: new URL('http://lvh.me:3000/@alex-creator/content'),
    locals: { user: null },
    platform: { env: {} },
    cookies: { get: vi.fn() },
    setHeaders: vi.fn(),
    depends: vi.fn(),
    ...overrides,
  }) as never;

/** The URLSearchParams a loader passed to the public list, as an object. */
const sentParams = () =>
  Object.fromEntries(
    (mockGetPublicContent.mock.calls[0]?.[0] as URLSearchParams).entries()
  );

describe('creator public pages read the public list by creator (Codex-osuqt)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPublicProfile.mockResolvedValue({
      id: CREATOR_ID,
      name: 'Alex',
      image: null,
    });
    mockGetPublicContent.mockResolvedValue({
      items: [
        {
          id: 'c1',
          title: 'First',
          slug: 'first',
          organization: {
            id: 'o1',
            name: 'Studio Alpha',
            slug: 'studio-alpha',
            logoUrl: null,
          },
        },
      ],
      pagination: { page: 1, limit: 12, total: 1, totalPages: 1 },
    });
  });

  it("the profile lists the creator's published content, newest first", async () => {
    const { load } = await import('../+page.server');

    const data = (await load(event())) as {
      contentItems: unknown[];
      organizations: unknown[];
    };

    expect(sentParams()).toEqual({
      creatorId: CREATOR_ID,
      limit: '12',
      sort: 'newest',
    });
    expect(data.contentItems).toHaveLength(1);
    expect(data.organizations).toHaveLength(1);
    expect(mockStudioList).not.toHaveBeenCalled();
  });

  it('the catalogue passes its page, search and type filter', async () => {
    const { load } = await import('../content/+page.server');

    await load(
      event({
        url: new URL(
          'http://lvh.me:3000/@alex-creator/content?page=2&search=psalm&type=article'
        ),
      })
    );

    expect(sentParams()).toEqual({
      creatorId: CREATOR_ID,
      limit: '12',
      page: '2',
      sort: 'newest',
      search: 'psalm',
      contentType: 'written',
    });
    expect(mockStudioList).not.toHaveBeenCalled();
  });

  it('the detail page looks the piece up by creator and slug', async () => {
    mockGetPublicContent.mockResolvedValueOnce({
      items: [],
      pagination: { page: 1, limit: 1, total: 0, totalPages: 0 },
    });
    const { load } = await import('../content/[contentSlug]/+page.server');

    await expect(
      load(
        event({ params: { username: '@alex-creator', contentSlug: 'first' } })
      )
    ).rejects.toMatchObject({ status: 404 });

    expect(sentParams()).toEqual({
      creatorId: CREATOR_ID,
      slug: 'first',
      limit: '1',
    });
    expect(mockStudioList).not.toHaveBeenCalled();
  });

  it('the detail page lets a failed lookup through as an error, not a 404', async () => {
    const outage = new Error('content-api unavailable');
    mockGetPublicContent.mockRejectedValueOnce(outage);
    const { load } = await import('../content/[contentSlug]/+page.server');

    await expect(
      load(
        event({ params: { username: '@alex-creator', contentSlug: 'first' } })
      )
    ).rejects.toBe(outage);
  });
});
