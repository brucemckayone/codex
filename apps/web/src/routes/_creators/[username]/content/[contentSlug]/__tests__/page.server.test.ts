/**
 * The creator content detail page takes a gated piece's body from the access
 * check, as the org detail page does (Codex-039vo).
 *
 * The two detail routes must stay in lockstep (see the module header of
 * `$lib/server/content-detail.ts`). A gated piece's public row carries no
 * body, so the page used to render that stripped row and every entitled
 * reader, the owner previewing their own personal piece included, got an
 * empty page. These cases are the org page's Codex-039vo cases run against
 * this load, so the lockstep is enforced by a test, not by review alone.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetPublicProfile = vi.hoisted(() => vi.fn());
const mockGetPublicContent = vi.hoisted(() => vi.fn());
const mockGetStreamingUrl = vi.hoisted(() => vi.fn());
const mockGetWithdrawnContent = vi.hoisted(() => vi.fn());
const mockGetProgress = vi.hoisted(() => vi.fn(() => Promise.resolve(null)));
const mockSetHeaders = vi.hoisted(() => vi.fn());
const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock('$lib/observability', () => ({ logger: mockLogger }));

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({
    account: { getPublicProfile: mockGetPublicProfile },
    access: {
      getStreamingUrl: mockGetStreamingUrl,
      getProgress: mockGetProgress,
      getWithdrawnContent: mockGetWithdrawnContent,
    },
    content: { getPublicContent: mockGetPublicContent },
  })),
}));

const row = (overrides: Record<string, unknown>) => ({
  id: 'c9',
  slug: 'practice',
  title: 'Practice',
  contentType: 'written',
  organizationId: null,
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

// As the public list returns a gated personal row: no body.
const gated = row({ isFree: false, isFollowerGated: true, contentBody: null });

// A gated row WITH a body, as a stale pre-v3 slot or a strip regression would
// ship it: the gated path must never render from it.
const leaky = row({
  isFree: false,
  isFollowerGated: true,
  contentBody: 'the leaked text',
});

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

const event = (user: { id: string } | null) =>
  ({
    params: { username: '@alex-creator', contentSlug: 'practice' },
    url: new URL('http://creators.lvh.me:3000/@alex-creator/content/practice'),
    locals: { user },
    platform: { env: {} },
    cookies: { get: vi.fn() },
    setHeaders: mockSetHeaders,
    depends: vi.fn(),
  }) as never;

const granted = (body: Record<string, unknown>) => ({
  streamingUrl: null,
  waveformUrl: null,
  expiresAt: '2026-10-23T22:00:00.000Z',
  contentType: 'written',
  ...body,
});

describe('creator content detail: an entitled reader of a gated piece sees its body (Codex-039vo)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPublicProfile.mockResolvedValue({
      id: 'creator-1',
      name: 'Alex',
      image: null,
    });
  });

  it('renders the body the access check returned', async () => {
    mockGetPublicContent.mockResolvedValue({ items: [gated] });
    mockGetStreamingUrl.mockResolvedValue(
      granted({
        body: { contentBody: 'the followers-only text', contentBodyJson: null },
      })
    );
    const { load } = await import('../+page.server');

    const data = (await load(event({ id: 'u1' }))) as {
      contentBodyHtml: string | null;
      accessAndProgress: Promise<Record<string, unknown>>;
    };

    expect(mockGetStreamingUrl).toHaveBeenCalledWith('c9', {
      includeBody: true,
    });
    expect(data.contentBodyHtml).toContain('the followers-only text');
    expect(await data.accessAndProgress).not.toHaveProperty('body');
  });

  it('a reader the access check denies gets no body, even from a leaky row', async () => {
    mockGetPublicContent.mockResolvedValue({ items: [leaky] });
    const { ApiError } = await import('$lib/server/errors');
    mockGetStreamingUrl.mockRejectedValue(
      new ApiError(403, 'denied', 'ACCESS_DENIED')
    );
    const { load } = await import('../+page.server');

    const data = (await load(event({ id: 'u1' }))) as Record<string, unknown>;

    expect(data.contentBodyHtml).toBeNull();
    expect(JSON.stringify(await settled(data))).not.toContain(
      'the leaked text'
    );
  });

  it('a grant whose /stream carried no body renders none, never the public row', async () => {
    mockGetPublicContent.mockResolvedValue({ items: [leaky] });
    mockGetStreamingUrl.mockResolvedValue(granted({}));
    const { load } = await import('../+page.server');

    const data = (await load(event({ id: 'u1' }))) as Record<string, unknown>;

    expect(data.contentBodyHtml).toBeNull();
    expect(JSON.stringify(await settled(data))).not.toContain(
      'the leaked text'
    );
  });

  it('a public piece renders for a visitor from its own row, with no access call', async () => {
    mockGetPublicContent.mockResolvedValue({ items: [row({})] });
    const { load } = await import('../+page.server');

    const data = (await load(event(null))) as {
      contentBodyHtml: string | null;
    };

    expect(data.contentBodyHtml).toContain('the article text');
    expect(mockGetStreamingUrl).not.toHaveBeenCalled();
  });
});

// Withdrawn from sale (Codex-ov2ii): no personal piece on the storefront, so a
// reader who still has one used to get "Content not found".
describe('creator content detail: a personal piece withdrawn from sale opens for whoever still has it', () => {
  const held = { by: 'purchase', until: null };
  const withdrawnPiece = row({
    isFree: false,
    isPurchasable: true,
    priceCents: 900,
    contentBody: 'the leaked text',
  });
  const orgPiece = row({
    id: 'o9',
    organizationId: 'o1',
    organization: { slug: 'studio-alpha' },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPublicProfile.mockResolvedValue({
      id: 'creator-1',
      name: 'Alex',
      image: null,
    });
  });

  it('a reader who still has it gets the note, and the body from the access check', async () => {
    mockGetPublicContent.mockResolvedValue({ items: [] });
    mockGetWithdrawnContent.mockResolvedValue({
      content: withdrawnPiece,
      held,
    });
    mockGetStreamingUrl.mockResolvedValue(
      granted({ body: { contentBody: 'the paid text', contentBodyJson: null } })
    );
    const { load } = await import('../+page.server');

    const data = (await load(event({ id: 'u1' }))) as Record<string, unknown>;

    expect(mockGetWithdrawnContent).toHaveBeenCalledWith({
      creatorId: 'creator-1',
      slug: 'practice',
    });
    expect(data.withdrawnHeld).toEqual(held);
    expect(data.contentBodyHtml).toContain('the paid text');
    expect(JSON.stringify(await settled(data))).not.toContain(
      'the leaked text'
    );
  });

  // This URL is the personal piece's: one the reader still has wins over an
  // org piece that shares its slug.
  it('a withdrawn personal piece wins over the org redirect', async () => {
    mockGetPublicContent.mockResolvedValue({ items: [orgPiece] });
    mockGetWithdrawnContent.mockResolvedValue({
      content: withdrawnPiece,
      held,
    });
    mockGetStreamingUrl.mockResolvedValue(
      granted({ body: { contentBody: 'the paid text', contentBodyJson: null } })
    );
    const { load } = await import('../+page.server');

    const data = (await load(event({ id: 'u1' }))) as Record<string, unknown>;

    expect(data.withdrawnHeld).toEqual(held);
  });

  it('with no withdrawn piece, an org piece still redirects', async () => {
    const { ApiError } = await import('$lib/server/errors');
    mockGetPublicContent.mockResolvedValue({ items: [orgPiece] });
    mockGetWithdrawnContent.mockRejectedValue(
      new ApiError(404, 'Content not found', 'NOT_FOUND')
    );
    const { load } = await import('../+page.server');

    await expect(load(event({ id: 'u1' }))).rejects.toMatchObject({
      status: 302,
    });
  });

  // The read is new on the redirect path: its failure must not turn a
  // working redirect into a 500.
  it('a failed withdrawn read still redirects to the org piece, and is logged', async () => {
    const { ApiError } = await import('$lib/server/errors');
    mockGetPublicContent.mockResolvedValue({ items: [orgPiece] });
    mockGetWithdrawnContent.mockRejectedValue(
      new ApiError(503, 'unavailable', 'SERVICE_UNAVAILABLE')
    );
    const { load } = await import('../+page.server');

    await expect(load(event({ id: 'u1' }))).rejects.toMatchObject({
      status: 302,
    });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Withdrawn read failed; redirecting to the org piece',
      expect.objectContaining({
        creatorId: 'creator-1',
        contentSlug: 'practice',
      })
    );
  });

  // The worker found the reader's piece; only the access check failed. The
  // 503 is theirs to retry, never a redirect to another item.
  it('a failed access check on a found withdrawn piece is a 503, never the org redirect', async () => {
    const { ApiError } = await import('$lib/server/errors');
    mockGetPublicContent.mockResolvedValue({ items: [orgPiece] });
    mockGetWithdrawnContent.mockResolvedValue({
      content: withdrawnPiece,
      held,
    });
    mockGetStreamingUrl.mockRejectedValue(
      new ApiError(502, 'bad gateway', 'UPSTREAM')
    );
    const { load } = await import('../+page.server');

    await expect(load(event({ id: 'u1' }))).rejects.toMatchObject({
      status: 503,
    });
  });

  it('with no org piece, a failed withdrawn read propagates: not a 404', async () => {
    const outage = new Error('content-api unavailable');
    mockGetPublicContent.mockResolvedValue({ items: [] });
    mockGetWithdrawnContent.mockRejectedValue(outage);
    const { load } = await import('../+page.server');

    await expect(load(event({ id: 'u1' }))).rejects.toBe(outage);
  });

  it('a visitor gets the 404 with no withdrawn read', async () => {
    mockGetPublicContent.mockResolvedValue({ items: [] });
    const { load } = await import('../+page.server');

    await expect(load(event(null))).rejects.toMatchObject({ status: 404 });
    expect(mockGetWithdrawnContent).not.toHaveBeenCalled();
  });
});

// The org page's Codex-hyz1c and Codex-uuz1g cases, run against this load.
describe('creator content detail: a page carrying a gated body is stored nowhere (Codex-hyz1c)', () => {
  const grantedWithBody = granted({
    body: { contentBody: 'the paid text', contentBodyJson: null },
  });
  const sentHeaders = () =>
    mockSetHeaders.mock.calls.map(([headers]) => headers);

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPublicProfile.mockResolvedValue({
      id: 'creator-1',
      name: 'Alex',
      image: null,
    });
  });

  it('a granted gated body: private, no-store', async () => {
    const { CACHE_HEADERS } = await import('$lib/server/cache');
    mockGetPublicContent.mockResolvedValue({ items: [gated] });
    mockGetStreamingUrl.mockResolvedValue(grantedWithBody);
    const { load } = await import('../+page.server');

    await load(event({ id: 'u1' }));

    expect(sentHeaders()).toEqual([CACHE_HEADERS.FRESH]);
  });

  it('a denied gated piece (no body sent): private, no-cache', async () => {
    const { CACHE_HEADERS } = await import('$lib/server/cache');
    const { ApiError } = await import('$lib/server/errors');
    mockGetPublicContent.mockResolvedValue({ items: [gated] });
    mockGetStreamingUrl.mockRejectedValue(
      new ApiError(403, 'denied', 'ACCESS_DENIED')
    );
    const { load } = await import('../+page.server');

    await load(event({ id: 'u1' }));

    expect(sentHeaders()).toEqual([CACHE_HEADERS.PRIVATE]);
  });

  it('a public piece, signed in: private, no-cache', async () => {
    const { CACHE_HEADERS } = await import('$lib/server/cache');
    mockGetPublicContent.mockResolvedValue({ items: [row({})] });
    mockGetStreamingUrl.mockResolvedValue(grantedWithBody);
    const { load } = await import('../+page.server');

    await load(event({ id: 'u1' }));

    expect(sentHeaders()).toEqual([CACHE_HEADERS.PRIVATE]);
  });

  it('a withdrawn item with its body: private, no-store', async () => {
    const { CACHE_HEADERS } = await import('$lib/server/cache');
    mockGetPublicContent.mockResolvedValue({ items: [] });
    mockGetWithdrawnContent.mockResolvedValue({
      content: row({ isFree: false, isPurchasable: true, priceCents: 900 }),
      held: { by: 'purchase', until: null },
    });
    mockGetStreamingUrl.mockResolvedValue(grantedWithBody);
    const { load } = await import('../+page.server');

    await load(event({ id: 'u1' }));

    expect(sentHeaders()).toEqual([CACHE_HEADERS.FRESH]);
  });
});

describe('creator content detail: a thrown access check fails closed and is logged (Codex-uuz1g)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPublicProfile.mockResolvedValue({
      id: 'creator-1',
      name: 'Alex',
      image: null,
    });
    // A /stream that returns no promise: a fault in our own code.
    mockGetStreamingUrl.mockImplementation(() => undefined);
  });

  it('on a gated piece', async () => {
    mockGetPublicContent.mockResolvedValue({ items: [gated] });
    const { load } = await import('../+page.server');

    const data = (await load(event({ id: 'u1' }))) as {
      contentBodyHtml: string | null;
      accessAndProgress: Promise<{ hasAccess: boolean }>;
    };

    expect(data.contentBodyHtml).toBeNull();
    expect((await data.accessAndProgress).hasAccess).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Content access check threw',
      expect.objectContaining({ contentId: 'c9' })
    );
  });

  it('on a public piece, signed in', async () => {
    mockGetPublicContent.mockResolvedValue({ items: [row({})] });
    const { load } = await import('../+page.server');

    const data = (await load(event({ id: 'u1' }))) as {
      accessAndProgress: Promise<{ accessCheckFailed?: boolean }>;
    };

    expect((await data.accessAndProgress).accessCheckFailed).toBe(true);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Content access check threw',
      expect.objectContaining({ contentId: 'c9' })
    );
  });
});
