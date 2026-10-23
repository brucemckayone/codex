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

// The detail page streams related content through the remote query, which
// needs a request context; the cases here only read the awaited fields.
vi.mock('$lib/remote/content.remote', () => ({
  getPublicContent: vi.fn(() => Promise.resolve({ items: [] })),
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

const detailEvent = (contentSlug = 'first') =>
  event({ params: { username: '@alex-creator', contentSlug } });

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
    mockGetPublicContent.mockRejectedValueOnce(
      new ApiError(400, 'Invalid request data', 'VALIDATION_ERROR')
    );
    const { load } = await import('../+page.server');

    await load(event());

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Creator profile content not loaded',
      expect.objectContaining({ status: 400, code: 'VALIDATION_ERROR' })
    );
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('the detail page looks the piece up by creator and slug', async () => {
    mockGetPublicContent.mockResolvedValueOnce({
      items: [],
      pagination: { page: 1, limit: 1, total: 0, totalPages: 0 },
    });
    const { load } = await import('../content/[contentSlug]/+page.server');

    await expect(load(detailEvent())).rejects.toMatchObject({ status: 404 });

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
    mockGetPublicContent.mockResolvedValueOnce({
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
    expect(JSON.stringify(data)).not.toContain('the paid curriculum');
  });
});
