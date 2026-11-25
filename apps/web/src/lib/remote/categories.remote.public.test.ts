// @vitest-environment node

/**
 * getPublicCategories: the mapper from the public endpoint's rows to the
 * `TopicItem` contract drops fields on purpose (`icon`, `sortOrder`), so a new
 * field is dropped too unless it is named. `contentCount` is pinned here, and
 * so is its absence: a response that predates the count must stay countless,
 * never become 0.
 *
 * `$app/server` is mocked so each remote function IS its handler (the central
 * mock in src/tests/mocks.ts returns `query`'s first argument, the schema).
 * Each handler carries the `__.type` marker kit's remote-module check demands
 * of every export.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TopicItem } from '$lib/components/topic/topic-card.types';

const { getPublicCategoriesMock, remote } = vi.hoisted(() => ({
  getPublicCategoriesMock: vi.fn(),
  remote: (type: 'command' | 'form' | 'query') =>
    vi.fn((...args: unknown[]) =>
      Object.assign(args[args.length - 1] as object, {
        __: { type, id: '', name: '' },
      })
    ),
}));

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({
    content: { getPublicCategories: getPublicCategoriesMock },
  })),
}));

vi.mock('$app/server', () => ({
  command: remote('command'),
  form: remote('form'),
  query: remote('query'),
  getRequestEvent: vi.fn(() => ({
    platform: { env: {} },
    cookies: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
  })),
}));

type GetPublicCategories = (orgId: string) => Promise<TopicItem[]>;

const ORG_ID = '4d111111-1111-4111-8111-111111111111';

const ROW = {
  id: '4d000000-0000-4000-8000-0000000000c1',
  name: 'Ceremony',
  slug: 'ceremony',
  description: null,
  icon: '🕯️',
  sortOrder: 2,
  coverImageUrl: null,
};

async function read(rows: object[]): Promise<TopicItem[]> {
  getPublicCategoriesMock.mockResolvedValueOnce(rows);
  const { getPublicCategories } = await import('./categories.remote');
  return (getPublicCategories as unknown as GetPublicCategories)(ORG_ID);
}

describe('getPublicCategories → TopicItem', () => {
  beforeEach(() => {
    getPublicCategoriesMock.mockReset();
  });

  it('passes the published count through', async () => {
    const [topic] = await read([{ ...ROW, contentCount: 7 }]);

    expect(topic).toEqual({
      id: ROW.id,
      name: 'Ceremony',
      slug: 'ceremony',
      description: null,
      coverImageUrl: null,
      contentCount: 7,
    });
    expect(getPublicCategoriesMock).toHaveBeenCalledWith(ORG_ID);
  });

  it('leaves a count the response lacks absent, not 0', async () => {
    const [topic] = await read([ROW]);

    expect(topic?.contentCount).toBeUndefined();
  });
});
