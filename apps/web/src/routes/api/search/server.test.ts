/**
 * The command palette's search endpoint.
 *
 * An org-scoped search must never answer with other orgs' content. Only a 404
 * on the org lookup (no such org) widens it to the platform-wide search; any
 * other failure skips the content search, and every failed read is logged,
 * because the palette shows an empty list either way.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/errors';

const {
  getPublicInfo,
  getPublicCreators,
  getPublicContent,
  getDiscoverContent,
} = vi.hoisted(() => ({
  getPublicInfo: vi.fn(),
  getPublicCreators: vi.fn(),
  getPublicContent: vi.fn(),
  getDiscoverContent: vi.fn(),
}));

vi.mock('$lib/server/api', () => ({
  createServerApi: () => ({
    org: { getPublicInfo, getPublicCreators },
    content: { getPublicContent, getDiscoverContent },
  }),
}));

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('$lib/observability', () => ({ logger: loggerMock }));

import { GET } from './+server';

const ORG_SLUG = 'studio-alpha';

const item = (id: string) => ({
  id,
  title: `Title ${id}`,
  slug: `slug-${id}`,
  contentType: 'video',
  thumbnailUrl: null,
  mediaItem: null,
  organization: { slug: ORG_SLUG },
});

async function search(query: string) {
  const response = await GET({
    url: new URL(`http://localhost/api/search?${query}`),
    platform: {},
    cookies: {},
  } as never);
  return response.json() as Promise<{
    content: Array<{ id: string }>;
    creators: Array<{ name: string }>;
  }>;
}

describe('GET /api/search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPublicInfo.mockResolvedValue({ id: 'org-1', slug: ORG_SLUG });
    getPublicContent.mockResolvedValue({ items: [item('org-hit')] });
    getDiscoverContent.mockResolvedValue({ items: [item('platform-hit')] });
    getPublicCreators.mockResolvedValue({
      items: [{ name: 'Alex', avatarUrl: null }],
    });
  });

  it('scopes the content search to the org the slug names', async () => {
    const body = await search(`q=yoga&scope=${ORG_SLUG}`);

    expect(getPublicContent).toHaveBeenCalledOnce();
    expect(getPublicContent.mock.calls[0][0].get('orgId')).toBe('org-1');
    expect(getDiscoverContent).not.toHaveBeenCalled();
    expect(body.content.map((c) => c.id)).toEqual(['org-hit']);
  });

  it('widens to the platform-wide search when no org has the slug', async () => {
    getPublicInfo.mockRejectedValue(
      new ApiError(404, 'Organization not found', 'NOT_FOUND')
    );

    const body = await search(`q=yoga&scope=${ORG_SLUG}`);

    expect(getDiscoverContent).toHaveBeenCalledOnce();
    expect(body.content.map((c) => c.id)).toEqual(['platform-hit']);
    expect(loggerMock.warn).not.toHaveBeenCalled();
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it.each([
    ['a 5xx', new ApiError(503, 'Service unavailable')],
    ['a rate limit', new ApiError(429, 'Too many requests')],
    ['a network failure', new TypeError('fetch failed')],
  ])('never searches every org when the org lookup hits %s', async (_, err) => {
    getPublicInfo.mockRejectedValue(err);

    const body = await search(`q=yoga&scope=${ORG_SLUG}`);

    expect(getDiscoverContent).not.toHaveBeenCalled();
    expect(getPublicContent).not.toHaveBeenCalled();
    expect(body.content).toEqual([]);
    // The creators search needs only the slug, so it still answers.
    expect(body.creators).toEqual([{ name: 'Alex', avatarUrl: null }]);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'Search scope org not loaded',
      expect.objectContaining({ scope: ORG_SLUG })
    );
  });

  it('logs a failed content search and still answers with the creators', async () => {
    getPublicContent.mockRejectedValue(new ApiError(500, 'Internal error'));

    const body = await search(`q=yoga&scope=${ORG_SLUG}`);

    expect(body.content).toEqual([]);
    expect(body.creators).toHaveLength(1);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'Search content not loaded',
      expect.objectContaining({ scope: ORG_SLUG, status: 500 })
    );
  });

  it('logs a failed creators search and still answers with the content', async () => {
    getPublicCreators.mockRejectedValue(new ApiError(502, 'Bad gateway'));

    const body = await search(`q=yoga&scope=${ORG_SLUG}`);

    expect(body.content.map((c) => c.id)).toEqual(['org-hit']);
    expect(body.creators).toEqual([]);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'Search creators not loaded',
      expect.objectContaining({ scope: ORG_SLUG, status: 502 })
    );
  });

  it('searches platform-wide with no lookup when there is no scope', async () => {
    const body = await search('q=yoga');

    expect(getPublicInfo).not.toHaveBeenCalled();
    expect(body.content.map((c) => c.id)).toEqual(['platform-hit']);
    expect(body.creators).toEqual([]);
  });
});
