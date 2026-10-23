/**
 * A creator's public profile, catalogue and content detail read the PUBLIC
 * content list scoped by creator (Codex-osuqt).
 *
 * They used to call `api.content.list`, the studio list: it needs a session
 * and lists the SIGNED-IN user's own content. A visitor got a 401, shown as
 * an empty profile (and a 404 on every real piece), and a signed-in visitor
 * saw their own work on someone else's profile. So each case here fails if a
 * loader reaches the studio list at all.
 *
 * A failed read must not pass for "hasn't published": that is how a
 * uuid-only creatorId refused every real creator while every test stayed
 * green. So the failure path is pinned too: an error flag for the page, and a
 * log whose level says whether OUR request was wrong.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/errors';

// A BetterAuth user id: users.id is text, never a uuid.
const CREATOR_ID = 'a62da3ad5c94736a88f90ff5c666143c';

const mockGetPublicContent = vi.fn();
const mockStudioList = vi.fn(() => {
  throw new Error('the studio list must not back a public creator page');
});
const mockGetPublicProfile = vi.fn();
const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({
    account: { getPublicProfile: mockGetPublicProfile },
    content: { getPublicContent: mockGetPublicContent, list: mockStudioList },
  })),
}));

vi.mock('$lib/observability', () => ({ logger: mockLogger }));

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

const detailEvent = (contentSlug = 'first', username = '@alex-creator') =>
  event({ params: { username, contentSlug } });

/**
 * A load's data with every streamed promise resolved. JSON.stringify writes a
 * Promise as `{}`, but SvelteKit serialises each resolved value into the page,
 * so a "never ships" check on raw data cannot see a streamed field.
 */
const settled = async (data: Record<string, unknown>) =>
  Object.fromEntries(
    await Promise.all(
      Object.entries(data).map(async ([key, value]) => [key, await value])
    )
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
      pagination: { page: 1, limit: 12, total: 30, totalPages: 3 },
    });
  });

  it("the profile lists the creator's published content, newest first", async () => {
    const { load } = await import('../+page.server');

    const data = (await load(event())) as {
      contentItems: unknown[];
      contentTotal: number;
      contentError: boolean;
      organizations: unknown[];
    };

    expect(sentParams()).toEqual({
      creatorId: CREATOR_ID,
      limit: '12',
      sort: 'newest',
    });
    expect(data.contentItems).toHaveLength(1);
    // The hero shows everything published, not the newest page of it.
    expect(data.contentTotal).toBe(30);
    expect(data.contentError).toBe(false);
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

  // A username that names nobody was a placeholder profile with HTTP 200: a
  // soft 404 that crawlers index as a real creator page.
  it.each([
    ['the profile', '../+page.server'],
    ['the catalogue', '../content/+page.server'],
  ])('%s is a 404 for a creator that does not exist', async (_page, path) => {
    mockGetPublicProfile.mockResolvedValueOnce(null);
    const { load } = await import(path);

    await expect(load(event())).rejects.toMatchObject({ status: 404 });
    expect(mockGetPublicContent).not.toHaveBeenCalled();
  });

  it.each([
    ['the profile', '../+page.server', 'Creator profile content not loaded'],
    [
      'the catalogue',
      '../content/+page.server',
      'Creator catalogue content not loaded',
    ],
  ])('%s shows an error, not an empty state, when the read fails', async (_page, path, message) => {
    mockGetPublicContent.mockRejectedValueOnce(
      new ApiError(503, 'content-api unavailable')
    );
    const { load } = await import(path);

    const data = (await load(event())) as {
      contentItems: unknown[];
      contentError: boolean;
    };

    expect(data.contentError).toBe(true);
    expect(data.contentItems).toEqual([]);
    // An outage is a warning, and the log says which status it was.
    expect(mockLogger.warn).toHaveBeenCalledWith(
      message,
      expect.objectContaining({ creatorId: CREATOR_ID, status: 503 })
    );
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('logs a 400 from our own request as an error: it is a contract bug', async () => {
    // The field the worker refused: its message alone is always "Invalid
    // request data", which names nothing.
    const details = [{ path: 'query.creatorId', message: 'Invalid user id' }];
    mockGetPublicContent.mockRejectedValueOnce(
      new ApiError(400, 'Invalid request data', 'VALIDATION_ERROR', details)
    );
    const { load } = await import('../+page.server');

    await load(event());

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Creator profile content not loaded',
      expect.objectContaining({
        status: 400,
        code: 'VALIDATION_ERROR',
        details,
      })
    );
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  // identity-api refuses a handle outside usernameSchema with a 400, which
  // every page let through as a 500 and an error log.
  it.each([
    ['the profile', '../+page.server', event({ params: { username: '@a_b' } })],
    [
      'the catalogue',
      '../content/+page.server',
      event({ params: { username: '@a_b' } }),
    ],
    [
      'the detail page',
      '../content/[contentSlug]/+page.server',
      detailEvent('first', '@a_b'),
    ],
  ])('%s is a 404 for a handle no creator can have, never sent', async (_page, path, ev) => {
    const { load } = await import(path);

    await expect(load(ev)).rejects.toMatchObject({ status: 404 });
    expect(mockGetPublicProfile).not.toHaveBeenCalled();
  });

  it('the detail page looks the piece up by creator and slug', async () => {
    mockGetPublicContent.mockResolvedValueOnce({
      items: [],
      pagination: { page: 1, limit: 1, total: 0, totalPages: 0 },
    });
    const { load } = await import('../content/[contentSlug]/+page.server');

    await expect(load(detailEvent())).rejects.toMatchObject({ status: 404 });

    // Every match, not the newest one: the page picks the personal piece.
    expect(sentParams()).toEqual({
      creatorId: CREATOR_ID,
      slug: 'first',
      limit: '50',
    });
    expect(mockStudioList).not.toHaveBeenCalled();
  });

  it('the detail page lets a failed lookup through as an error, not a 404', async () => {
    const outage = new Error('content-api unavailable');
    mockGetPublicContent.mockRejectedValueOnce(outage);
    const { load } = await import('../content/[contentSlug]/+page.server');

    await expect(load(detailEvent())).rejects.toBe(outage);
  });

  it('a slug longer than the API accepts is a 404, never sent', async () => {
    const { load } = await import('../content/[contentSlug]/+page.server');

    await expect(load(detailEvent('x'.repeat(501)))).rejects.toMatchObject({
      status: 404,
    });
    expect(mockGetPublicContent).not.toHaveBeenCalled();
  });

  // The public list keeps the body of a row flagged free that also carries a
  // gate (the course service writes isFree + courseOnly on purpose). The page
  // must not ship it: it was readable through view-source while shown locked.
  it("the detail page never ships a locked piece's raw body", async () => {
    // Every read returns it, the streamed related strip's included.
    mockGetPublicContent.mockResolvedValue({
      items: [
        {
          id: 'c9',
          slug: 'first',
          title: 'Practice',
          contentType: 'written',
          isFree: true,
          courseOnly: true,
          contentBody: 'the paid curriculum',
          contentBodyJson: null,
          organization: null,
        },
      ],
      pagination: { page: 1, limit: 1, total: 1, totalPages: 1 },
    });
    const { load } = await import('../content/[contentSlug]/+page.server');

    const data = (await load(detailEvent())) as {
      content: { contentBody: unknown; contentBodyJson: unknown };
      contentBodyHtml: string | null;
    };

    expect(data.content.contentBody).toBeNull();
    expect(data.content.contentBodyJson).toBeNull();
    expect(data.contentBodyHtml).toBeNull();
    const shipped = JSON.stringify(await settled(data));
    // The calibration: the related strip resolved to the piece, metadata only.
    expect(shipped).toContain('"relatedContent":[{"id":"c9"');
    expect(shipped).not.toContain('the paid curriculum');
  });

  // The list pages draw cards from metadata; the items serialise verbatim into
  // the anonymous HTML, so a body must never ride along.
  it.each([
    ['the profile', '../+page.server'],
    ['the catalogue', '../content/+page.server'],
  ])('%s ships no body in its items', async (_page, path) => {
    mockGetPublicContent.mockResolvedValueOnce({
      items: [
        {
          id: 'c5',
          title: 'Follower piece',
          slug: 'follower-piece',
          isFree: true,
          isFollowerGated: true,
          contentBody: 'a locked article',
          contentBodyJson: { type: 'doc' },
          organization: null,
        },
      ],
      pagination: { page: 1, limit: 12, total: 1, totalPages: 1 },
    });
    const { load } = await import(path);

    const data = await load(event());

    expect(JSON.stringify(data)).not.toContain('a locked article');
    expect(JSON.stringify(data)).not.toContain('"type":"doc"');
  });

  it('the catalogue bounds page and search to what the API accepts', async () => {
    const { load } = await import('../content/+page.server');

    await load(
      event({
        url: new URL(
          `http://lvh.me:3000/@alex-creator/content?page=1001&search=${' '.repeat(3)}${'x'.repeat(300)}`
        ),
      })
    );

    expect(sentParams().page).toBe('1000');
    expect(sentParams().search).toBe('x'.repeat(255));
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  // A creator can hold one slug in their personal space AND in each org; this
  // URL is the personal piece's.
  it('the detail page prefers the personal piece over a newer org piece', async () => {
    mockGetPublicContent.mockResolvedValueOnce({
      items: [
        {
          id: 'org-piece',
          slug: 'first',
          organizationId: 'o1',
          organization: { id: 'o1', slug: 'studio-alpha' },
          isFree: true,
        },
        {
          id: 'personal-piece',
          slug: 'first',
          organizationId: null,
          organization: null,
          isFree: true,
        },
      ],
      pagination: { page: 1, limit: 50, total: 2, totalPages: 1 },
    });
    const { load } = await import('../content/[contentSlug]/+page.server');

    const data = (await load(detailEvent())) as { content: { id: string } };

    expect(data.content.id).toBe('personal-piece');
    expect(sentParams().limit).toBe('50');
  });

  it("the detail page sends an org piece to its org's own page", async () => {
    mockGetPublicContent.mockResolvedValueOnce({
      items: [
        {
          id: 'org-piece',
          slug: 'first',
          organizationId: 'o1',
          organization: { id: 'o1', slug: 'studio-alpha' },
        },
      ],
      pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
    });
    const { load } = await import('../content/[contentSlug]/+page.server');

    await expect(load(detailEvent())).rejects.toMatchObject({
      status: 302,
      location: 'http://studio-alpha.lvh.me:3000/content/first',
    });
  });

  // An org row the read returned without its org: a broken relation, not a
  // missing piece, so it is logged though the visitor still gets a 404.
  it('logs a slug that matched only an org piece missing its org', async () => {
    mockGetPublicContent.mockResolvedValueOnce({
      items: [
        {
          id: 'orphan',
          slug: 'first',
          organizationId: 'o1',
          organization: null,
        },
      ],
      pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
    });
    const { load } = await import('../content/[contentSlug]/+page.server');

    await expect(load(detailEvent())).rejects.toMatchObject({ status: 404 });
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Creator content slug matched no personal or org piece',
      expect.objectContaining({
        creatorId: CREATOR_ID,
        matches: [{ id: 'orphan', organizationId: 'o1' }],
      })
    );
  });

  it('a slug that matched nothing is a 404 with nothing logged', async () => {
    mockGetPublicContent.mockResolvedValueOnce({
      items: [],
      pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
    });
    const { load } = await import('../content/[contentSlug]/+page.server');

    await expect(load(detailEvent())).rejects.toMatchObject({ status: 404 });
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  // This page shows only a personal piece, so an org-scoped strip never made
  // a request: it streamed a skeleton that always vanished.
  it("the detail page's related strip reads the creator's newest pieces", async () => {
    mockGetPublicContent.mockResolvedValue({
      items: [
        {
          id: 'personal-piece',
          slug: 'first',
          organizationId: null,
          organization: null,
          isFree: true,
        },
      ],
      pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
    });
    const { load } = await import('../content/[contentSlug]/+page.server');

    const data = (await load(detailEvent())) as {
      relatedContent: Promise<unknown[]>;
    };
    await data.relatedContent;

    const relatedParams = Object.fromEntries(
      (mockGetPublicContent.mock.calls[1]?.[0] as URLSearchParams).entries()
    );
    expect(relatedParams).toEqual({
      creatorId: CREATOR_ID,
      sort: 'newest',
      limit: '5',
    });
  });

  // Postgres refuses NUL in text: sent on, either was a content-api 500, an
  // alarm any visitor could raise with a URL.
  it('the catalogue drops a NUL from the search', async () => {
    const { load } = await import('../content/+page.server');

    await load(
      event({
        url: new URL(
          'http://lvh.me:3000/@alex-creator/content?search=ps%00alm'
        ),
      })
    );

    expect(sentParams().search).toBe('psalm');
  });

  it('a slug with a NUL is a 404, never sent', async () => {
    const { load } = await import('../content/[contentSlug]/+page.server');

    await expect(load(detailEvent('a\0b'))).rejects.toMatchObject({
      status: 404,
    });
    expect(mockGetPublicContent).not.toHaveBeenCalled();
  });

  // An object literal answers `constructor` and `toString` from its
  // prototype, so these were sent as a content type the API refused with a 400.
  it.each([
    'constructor',
    'toString',
    '__proto__',
    'nonsense',
  ])('the catalogue sends no content type for ?type=%s', async (type) => {
    const { load } = await import('../content/+page.server');

    await load(
      event({
        url: new URL(`http://lvh.me:3000/@alex-creator/content?type=${type}`),
      })
    );

    expect(sentParams()).not.toHaveProperty('contentType');
  });
});
