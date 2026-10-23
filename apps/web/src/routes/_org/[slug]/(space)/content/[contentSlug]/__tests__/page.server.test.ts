/**
 * The org content detail page never ships a locked piece's raw body in its
 * load payload (Codex-osuqt review).
 *
 * The row comes from the public list, which strips the body only when
 * `isFree` is false. A row flagged free that also carries a gate (the course
 * service writes isFree + courseOnly on purpose) kept its full body, and the
 * page returned that row as-is: the text was readable through view-source
 * while the page showed it locked. The rendered `contentBodyHtml` is the only
 * body the page may send.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetPublicContent = vi.hoisted(() => vi.fn());

vi.mock('$lib/remote/content.remote', () => ({
  getPublicContent: mockGetPublicContent,
}));

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({
    access: { contentCourses: vi.fn(() => Promise.resolve(null)) },
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

const event = () =>
  ({
    params: { slug: 'studio-alpha', contentSlug: 'practice' },
    parent: () => Promise.resolve({ org: { id: 'o1', slug: 'studio-alpha' } }),
    locals: { user: null },
    platform: { env: {} },
    cookies: { get: vi.fn() },
    setHeaders: vi.fn(),
    depends: vi.fn(),
  }) as never;

describe('org content detail: the load payload carries no raw body', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('a free-flagged course-only piece is locked and its body is not sent', async () => {
    mockGetPublicContent.mockResolvedValue({
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
    mockGetPublicContent.mockResolvedValue({
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
    mockGetPublicContent.mockResolvedValue({ items: [] });
    const { load } = await import('../+page.server');

    await expect(load(event())).rejects.toMatchObject({ status: 404 });
  });

  it('a failed read propagates as an error, not a 404', async () => {
    const outage = new Error('content-api unavailable');
    mockGetPublicContent.mockRejectedValue(outage);
    const { load } = await import('../+page.server');

    await expect(load(event())).rejects.toBe(outage);
  });

  it('a slug longer than the query accepts is a 404, never sent', async () => {
    const { load } = await import('../+page.server');
    const longSlug = {
      ...(event() as unknown as Record<string, unknown>),
      params: { slug: 'studio-alpha', contentSlug: 'x'.repeat(501) },
    } as never;

    await expect(load(longSlug)).rejects.toMatchObject({ status: 404 });
    expect(mockGetPublicContent).not.toHaveBeenCalled();
  });
});
