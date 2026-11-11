import { contentQuerySchema } from '@codex/validation';
import { describe, expect, it } from 'vitest';
import {
  CONTENT_LIST_DEFAULTS,
  CONTENT_LIST_PAGE_SIZE,
  contentListArgs,
  isContentListNarrowed,
  LIST_SORTS,
  readContentListState,
} from './list-url';

const ORG = '5f0c7b2e-1d3a-4c8e-9b6f-2a7d1e4c9b30';

function at(query: string) {
  return readContentListState(
    new URL(`https://studio.test/studio/content${query}`)
  );
}

describe('readContentListState', () => {
  it('reads a bare URL as every default', () => {
    expect(at('')).toEqual({ search: '', ...CONTENT_LIST_DEFAULTS });
  });

  it('reads each param the list offers', () => {
    expect(
      at(
        '?status=draft&type=audio&access=subscribers&sort=views&view=grid&search=runes'
      )
    ).toEqual({
      search: 'runes',
      status: 'draft',
      type: 'audio',
      access: 'subscribers',
      sort: 'views',
      view: 'grid',
    });
  });

  it('reads a value it does not offer as the default, never a refusal', () => {
    expect(
      at('?status=deleted&type=pdf&access=vip&sort=random&view=cards')
    ).toEqual({
      search: '',
      ...CONTENT_LIST_DEFAULTS,
    });
  });

  it('keeps the search as typed: the gate is the caller’s', () => {
    expect(at('?search=a').search).toBe('a');
  });
});

describe('contentListArgs', () => {
  it('asks for one page of 24, sorted by last updated, and nothing else by default', () => {
    expect(contentListArgs(at(''), null, null, 1)).toEqual({
      page: 1,
      limit: CONTENT_LIST_PAGE_SIZE,
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    });
  });

  it('forwards every facet under the name the API takes', () => {
    expect(
      contentListArgs(
        at('?status=published&type=written&access=paid&sort=title'),
        'runes',
        ORG,
        3
      )
    ).toEqual({
      page: 3,
      limit: CONTENT_LIST_PAGE_SIZE,
      organizationId: ORG,
      status: 'published',
      contentType: 'written',
      accessType: 'paid',
      search: 'runes',
      sortBy: 'title',
      sortOrder: 'asc',
    });
  });

  it('leaves a gated-out search out entirely', () => {
    expect(contentListArgs(at('?search=a'), null, ORG, 1)).not.toHaveProperty(
      'search'
    );
  });

  // The args reach content-api through its own schema: a sort or facet the
  // list offers that the API refuses would be a 400 no Try again could fix.
  it.each(LIST_SORTS)('builds args the API accepts for sort=%s', (sort) => {
    const args = contentListArgs(
      at(`?sort=${sort}&type=video&access=followers&status=archived`),
      'pattern',
      ORG,
      2
    );
    expect(contentQuerySchema.safeParse(args).success).toBe(true);
  });
});

describe('narrowing', () => {
  it('is narrowed by a facet or a search that reached the API', () => {
    expect(isContentListNarrowed(at(''), null)).toBe(false);
    expect(isContentListNarrowed(at('?sort=sales&view=grid'), null)).toBe(
      false
    );
    expect(isContentListNarrowed(at('?status=draft'), null)).toBe(true);
    expect(isContentListNarrowed(at('?type=video'), null)).toBe(true);
    expect(isContentListNarrowed(at('?access=paid'), null)).toBe(true);
    expect(isContentListNarrowed(at('?search=runes'), 'runes')).toBe(true);
  });
});
