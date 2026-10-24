/**
 * The org content detail page never ships a locked piece's raw body to the
 * browser (Codex-osuqt review).
 *
 * The row comes from the public list, which used to strip the body only when
 * `isFree` was false. A row flagged free that also carries a gate (the course
 * service writes isFree + courseOnly on purpose) kept its full body. It reached
 * the browser two ways, and both are pinned here:
 *   - the load returned the row as-is, so the text was in the load payload;
 *   - the row was read through the `getPublicContent` REMOTE query, whose SSR
 *     result SvelteKit serialises into the page for hydration, so the body
 *     shipped whatever the load returned (measured live).
 * The rendered `contentBodyHtml` is the only body the page may send.
 *
 * And the other side (Codex-039vo): a gated piece's public row carries no
 * body, so an entitled reader's body comes from the access check. The page
 * used to render the stripped row, so every entitled reader got an empty page.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockServerGetPublicContent = vi.hoisted(() => vi.fn());
// Mocked only so a regression back onto the remote query is caught.
const mockRemoteGetPublicContent = vi.hoisted(() =>
  vi.fn(() => Promise.resolve({ items: [] }))
);
const mockContentCourses = vi.hoisted(() => vi.fn(() => Promise.resolve(null)));
const mockGetStreamingUrl = vi.hoisted(() => vi.fn());
const mockGetWithdrawnContent = vi.hoisted(() => vi.fn());
const mockGetProgress = vi.hoisted(() => vi.fn(() => Promise.resolve(null)));
const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock('$lib/observability', () => ({ logger: mockLogger }));

vi.mock('$lib/remote/content.remote', () => ({
  getPublicContent: mockRemoteGetPublicContent,
}));

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({
    access: {
      contentCourses: mockContentCourses,
      getStreamingUrl: mockGetStreamingUrl,
      getProgress: mockGetProgress,
      getWithdrawnContent: mockGetWithdrawnContent,
    },
    content: { getPublicContent: mockServerGetPublicContent },
  })),
}));

const row = (overrides: Record<string, unknown>) => ({
  id: 'c9',
  slug: 'practice',
  title: 'Practice',
  contentType: 'written',
  organizationId: 'o1',
  isFree: true,
  isPurchasable: false,
  priceCents: null,
  includedInTierId: null,
  isFollowerGated: false,
  isTeamOnly: false,
  courseOnly: false,
  contentBody: 'the article text',
  contentBodyJson: null,
  ...overrides,
});

const event = (contentSlug = 'practice', user: { id: string } | null = null) =>
  ({
    params: { slug: 'studio-alpha', contentSlug },
    parent: () => Promise.resolve({ org: { id: 'o1', slug: 'studio-alpha' } }),
    locals: { user },
    platform: { env: {} },
    cookies: { get: vi.fn() },
    setHeaders: vi.fn(),
    depends: vi.fn(),
  }) as never;

/**
 * A load's data with every streamed promise resolved. JSON.stringify writes a
 * Promise as `{}`, but SvelteKit serialises each resolved value into the page.
 */
const settled = async (data: Record<string, unknown>) =>
  Object.fromEntries(
    await Promise.all(
      Object.entries(data).map(async ([key, value]) => [key, await value])
    )
  );

/** The URLSearchParams the page sent to the server API, as an object. */
const sentParams = () =>
  Object.fromEntries(
    (mockServerGetPublicContent.mock.calls[0]?.[0] as URLSearchParams).entries()
  );

describe('org content detail: the browser never receives a raw body', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads the piece and its related strip through the server API, never the serialised remote query', async () => {
    mockServerGetPublicContent.mockResolvedValue({
      items: [row({ contentBody: 'a related article body' })],
    });
    const { load } = await import('../+page.server');

    const data = (await load(event())) as {
      relatedContent: Promise<Array<{ contentBody: unknown }>>;
    };

    expect(sentParams()).toEqual({
      orgId: 'o1',
      slug: 'practice',
      limit: '1',
    });
    // Any remote call would put full rows in the page's hydration cache.
    expect(mockRemoteGetPublicContent).not.toHaveBeenCalled();
    const related = await data.relatedContent;
    expect(related.length).toBeGreaterThan(0);
    expect(related.every((item) => item.contentBody === null)).toBe(true);
  });

  it('a free-flagged course-only piece is locked and its body is not sent', async () => {
    mockServerGetPublicContent.mockResolvedValue({
      items: [row({ courseOnly: true, contentBody: 'the paid curriculum' })],
    });
    const { load } = await import('../+page.server');

    const data = (await load(event())) as {
      content: { contentBody: unknown; contentBodyJson: unknown };
      contentBodyHtml: string | null;
    };

    expect(data.contentBodyHtml).toBeNull();
    expect(data.content.contentBody).toBeNull();
    expect(data.content.contentBodyJson).toBeNull();
    const shipped = JSON.stringify(await settled(data));
    // The calibration: the streamed related strip resolved to the piece.
    expect(shipped).toContain('"relatedContent":[{"id":"c9"');
    expect(shipped).not.toContain('the paid curriculum');
  });

  it('a public piece still renders: the body arrives as HTML, not as the raw field', async () => {
    mockServerGetPublicContent.mockResolvedValue({
      items: [row({ contentBody: 'the article text' })],
    });
    const { load } = await import('../+page.server');

    const data = (await load(event())) as {
      content: { contentBody: unknown };
      contentBodyHtml: string | null;
    };

    expect(data.contentBodyHtml).toContain('the article text');
    expect(data.content.contentBody).toBeNull();
  });

  it('a failed journey cross-link read is logged, and the page still renders', async () => {
    mockServerGetPublicContent.mockResolvedValue({ items: [row({})] });
    mockContentCourses.mockRejectedValueOnce(new Error('access-api down'));
    const { load } = await import('../+page.server');

    const data = (await load(event())) as { parentCourses: Promise<unknown> };

    expect(await data.parentCourses).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Content course links not loaded',
      expect.objectContaining({ contentId: 'c9', error: 'access-api down' })
    );
  });
});

describe('org content detail: an entitled reader of a gated piece sees its body (Codex-039vo)', () => {
  // As the public list returns a gated row: no body.
  const gated = row({
    isFree: false,
    isFollowerGated: true,
    contentBody: null,
  });
  const reader = { id: 'u1' };
  const granted = (body: Record<string, unknown>) => ({
    streamingUrl: null,
    waveformUrl: null,
    expiresAt: '2026-10-23T22:00:00.000Z',
    contentType: 'written',
    ...body,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the body the access check returned', async () => {
    mockServerGetPublicContent.mockResolvedValue({ items: [gated] });
    mockGetStreamingUrl.mockResolvedValue(
      granted({
        body: { contentBody: 'the followers-only text', contentBodyJson: null },
      })
    );
    const { load } = await import('../+page.server');

    const data = (await load(event('practice', reader))) as {
      contentBodyHtml: string | null;
      accessAndProgress: Promise<Record<string, unknown>>;
    };

    expect(mockGetStreamingUrl).toHaveBeenCalledWith('c9', {
      includeBody: true,
    });
    expect(data.contentBodyHtml).toContain('the followers-only text');
    // The raw body rides nothing the page returns but the rendered HTML.
    const access = await data.accessAndProgress;
    expect(access).not.toHaveProperty('body');
  });

  // The gated path must never render from `content`. Seed the gated row WITH
  // a body (as a stale pre-v3 slot or a strip regression would ship it), so
  // these cases fail if the page falls back to the public row.
  const leaky = row({
    isFree: false,
    isFollowerGated: true,
    contentBody: 'the leaked text',
  });

  it('a reader the access check denies gets no body, even from a leaky row', async () => {
    mockServerGetPublicContent.mockResolvedValue({ items: [leaky] });
    const { ApiError } = await import('$lib/server/errors');
    mockGetStreamingUrl.mockRejectedValue(
      new ApiError(403, 'denied', 'ACCESS_DENIED')
    );
    const { load } = await import('../+page.server');

    const data = (await load(event('practice', reader))) as Record<
      string,
      unknown
    >;

    expect(data.contentBodyHtml).toBeNull();
    expect(JSON.stringify(await settled(data))).not.toContain(
      'the leaked text'
    );
  });

  it('a grant whose /stream carried no body renders none, never the public row', async () => {
    mockServerGetPublicContent.mockResolvedValue({ items: [leaky] });
    mockGetStreamingUrl.mockResolvedValue(granted({}));
    const { load } = await import('../+page.server');

    const data = (await load(event('practice', reader))) as Record<
      string,
      unknown
    >;

    expect(data.contentBodyHtml).toBeNull();
    expect(JSON.stringify(await settled(data))).not.toContain(
      'the leaked text'
    );
  });
});

// The read used to end in `.catch(() => null)`, so every content-api outage
// rendered "Content not found" (a 404 that hides an outage).
describe('org content detail: a 404 means the piece does not exist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('no result is a 404', async () => {
    mockServerGetPublicContent.mockResolvedValue({ items: [] });
    const { load } = await import('../+page.server');

    await expect(load(event())).rejects.toMatchObject({ status: 404 });
  });

  it('a failed read propagates as an error, not a 404', async () => {
    const outage = new Error('content-api unavailable');
    mockServerGetPublicContent.mockRejectedValue(outage);
    const { load } = await import('../+page.server');

    await expect(load(event())).rejects.toBe(outage);
  });

  it('a slug longer than the query accepts is a 404, never sent', async () => {
    const { load } = await import('../+page.server');

    await expect(load(event('x'.repeat(501)))).rejects.toMatchObject({
      status: 404,
    });
    expect(mockServerGetPublicContent).not.toHaveBeenCalled();
  });

  // Postgres refuses NUL in text: sent on, it was a content-api 500.
  it('a slug with a NUL is a 404, never sent', async () => {
    const { load } = await import('../+page.server');

    await expect(load(event('a\0b'))).rejects.toMatchObject({ status: 404 });
    expect(mockServerGetPublicContent).not.toHaveBeenCalled();
  });
});

// Withdrawn from sale (Codex-ov2ii): the public lookup misses, so a reader who
// still has the item used to get "Content not found".
describe('org content detail: an item withdrawn from sale opens for whoever still has it', () => {
  const reader = { id: 'u1' };
  const held = { by: 'purchase', until: null };
  // As the withdrawn read returns it: no body. A LEAKY one is used below, as
  // a regression back to the row's own body would ship it.
  const leaky = row({
    isFree: false,
    isPurchasable: true,
    priceCents: 900,
    contentBody: 'the leaked text',
  });
  const granted = {
    streamingUrl: null,
    waveformUrl: null,
    expiresAt: '2026-10-23T22:00:00.000Z',
    contentType: 'written',
    body: { contentBody: 'the paid text', contentBodyJson: null },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockServerGetPublicContent.mockResolvedValue({ items: [] });
  });

  it('a reader who still has it gets the note, and the body from the access check', async () => {
    mockGetWithdrawnContent.mockResolvedValue({ content: leaky, held });
    mockGetStreamingUrl.mockResolvedValue(granted);
    const { load } = await import('../+page.server');

    const data = (await load(event('practice', reader))) as Record<
      string,
      unknown
    >;

    expect(mockGetWithdrawnContent).toHaveBeenCalledWith({
      orgId: 'o1',
      slug: 'practice',
    });
    expect(mockGetStreamingUrl).toHaveBeenCalledWith('c9', {
      includeBody: true,
    });
    expect(data.withdrawnHeld).toEqual(held);
    expect(data.contentBodyHtml).toContain('the paid text');
    expect(JSON.stringify(await settled(data))).not.toContain(
      'the leaked text'
    );
  });

  it('a reader without it gets the same 404', async () => {
    const { ApiError } = await import('$lib/server/errors');
    mockGetWithdrawnContent.mockRejectedValue(
      new ApiError(404, 'Content not found', 'NOT_FOUND')
    );
    const { load } = await import('../+page.server');

    await expect(load(event('practice', reader))).rejects.toMatchObject({
      status: 404,
    });
    expect(mockGetStreamingUrl).not.toHaveBeenCalled();
  });

  it('a visitor gets the 404 with no withdrawn read', async () => {
    const { load } = await import('../+page.server');

    await expect(load(event('practice', null))).rejects.toMatchObject({
      status: 404,
    });
    expect(mockGetWithdrawnContent).not.toHaveBeenCalled();
  });

  it('a piece on the storefront never asks the withdrawn read', async () => {
    mockServerGetPublicContent.mockResolvedValue({ items: [row({})] });
    mockGetStreamingUrl.mockResolvedValue(granted);
    const { load } = await import('../+page.server');

    const data = (await load(event('practice', reader))) as Record<
      string,
      unknown
    >;
    await settled(data);

    expect(mockGetWithdrawnContent).not.toHaveBeenCalled();
    expect(data).not.toHaveProperty('withdrawnHeld');
  });
});
