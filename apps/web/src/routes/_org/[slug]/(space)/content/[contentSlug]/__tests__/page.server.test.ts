/**
 * The org content detail page never ships a locked piece's raw body to the
 * browser (Codex-osuqt review).
 *
 * The row comes from the public list, which strips the body only when
 * `isFree` is false. A row flagged free that also carries a gate (the course
 * service writes isFree + courseOnly on purpose) kept its full body. It reached
 * the browser two ways, and both are pinned here:
 *   - the load returned the row as-is, so the text was in the load payload;
 *   - the row was read through the `getPublicContent` REMOTE query, whose SSR
 *     result SvelteKit serialises into the page for hydration, so the body
 *     shipped whatever the load returned (measured live).
 * The rendered `contentBodyHtml` is the only body the page may send.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockServerGetPublicContent = vi.hoisted(() => vi.fn());
// Mocked only so a regression back onto the remote query is caught.
const mockRemoteGetPublicContent = vi.hoisted(() =>
  vi.fn(() => Promise.resolve({ items: [] }))
);

vi.mock('$lib/remote/content.remote', () => ({
  getPublicContent: mockRemoteGetPublicContent,
}));

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({
    access: { contentCourses: vi.fn(() => Promise.resolve(null)) },
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

const event = (contentSlug = 'practice') =>
  ({
    params: { slug: 'studio-alpha', contentSlug },
    parent: () => Promise.resolve({ org: { id: 'o1', slug: 'studio-alpha' } }),
    locals: { user: null },
    platform: { env: {} },
    cookies: { get: vi.fn() },
    setHeaders: vi.fn(),
    depends: vi.fn(),
  }) as never;

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
    expect(JSON.stringify(data)).not.toContain('the paid curriculum');
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
});
