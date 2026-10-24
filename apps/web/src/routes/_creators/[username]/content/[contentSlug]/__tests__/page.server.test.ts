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
const mockGetProgress = vi.hoisted(() => vi.fn(() => Promise.resolve(null)));
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
    setHeaders: vi.fn(),
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
