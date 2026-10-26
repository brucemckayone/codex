/**
 * The command palette's search endpoint.
 *
 * An org-scoped search must never answer with other orgs' content. Only a slug
 * no org has (a 404 from the lookup, or one no org could have) widens it to
 * the platform-wide search; any other failure skips the content search. Every
 * failed read is logged, because the palette shows an empty list either way,
 * and nothing a visitor can put in a URL raises an error-level log.
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

function expectNoErrorLog() {
  expect(loggerMock.error).not.toHaveBeenCalled();
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

  it('scopes both searches to the org the slug names', async () => {
    const body = await search(`q=yoga&scope=${ORG_SLUG}`);

    expect(getPublicContent).toHaveBeenCalledOnce();
    expect(getPublicContent.mock.calls[0][0].get('orgId')).toBe('org-1');
    expect(getPublicCreators.mock.calls[0][0]).toBe(ORG_SLUG);
    expect(getDiscoverContent).not.toHaveBeenCalled();
    expect(body.content.map((c) => c.id)).toEqual(['org-hit']);
    expect(body.creators).toEqual([{ name: 'Alex', avatarUrl: null }]);
  });

  it('widens to the platform-wide search, silently, when no org has the slug', async () => {
    getPublicInfo.mockRejectedValue(
      new ApiError(404, 'Organization not found', 'NOT_FOUND')
    );
    // What the real worker does for an unknown slug, should it be asked.
    getPublicCreators.mockRejectedValue(
      new ApiError(404, 'Organization not found', 'NOT_FOUND')
    );

    const body = await search(`q=yoga&scope=${ORG_SLUG}`);

    expect(getDiscoverContent).toHaveBeenCalledOnce();
    expect(body.content.map((c) => c.id)).toEqual(['platform-hit']);
    // No org, no creators: the lookup is not made, so it cannot 404 and log.
    expect(getPublicCreators).not.toHaveBeenCalled();
    expect(body.creators).toEqual([]);
    expect(loggerMock.warn).not.toHaveBeenCalled();
    expectNoErrorLog();
  });

  it.each([
    ['an underscore', 'studio_alpha'],
    ['a path', '..%2F..%2Fuser%2Fx'],
    ['an over-long slug', 'a'.repeat(256)],
  ])('never sends a slug with %s to the worker, and logs nothing', async (_, raw) => {
    const body = await search(`q=yoga&scope=${raw}`);

    expect(getPublicInfo).not.toHaveBeenCalled();
    expect(getPublicCreators).not.toHaveBeenCalled();
    expect(body.content.map((c) => c.id)).toEqual(['platform-hit']);
    expect(loggerMock.warn).not.toHaveBeenCalled();
    expectNoErrorLog();
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
    // The worker scopes creators by the slug itself, so they still answer.
    expect(getPublicCreators.mock.calls[0][0]).toBe(ORG_SLUG);
    expect(body.creators).toEqual([{ name: 'Alex', avatarUrl: null }]);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'Search scope org not loaded',
      expect.objectContaining({ scope: ORG_SLUG })
    );
  });

  it('never searches every org when the lookup answers without an id', async () => {
    getPublicInfo.mockResolvedValue(null);

    const body = await search(`q=yoga&scope=${ORG_SLUG}`);

    expect(getDiscoverContent).not.toHaveBeenCalled();
    expect(body.content).toEqual([]);
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
    expect(getPublicCreators).not.toHaveBeenCalled();
    expect(body.content.map((c) => c.id)).toEqual(['platform-hit']);
    expect(body.creators).toEqual([]);
  });
});
