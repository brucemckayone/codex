import { MEDIA_LIBRARY_PAGE_SIZE } from '@codex/constants';
import { gateSearchQuery, mediaQuerySchema } from '@codex/validation';
import { describe, expect, it } from 'vitest';
import { filterHref } from '$lib/utils/filter-url';
import {
  activeFilterCount,
  isNarrowed,
  LIBRARY_DEFAULTS,
  LIBRARY_SORTS,
  LIBRARY_STATUSES,
  libraryListArgs,
  newContentHref,
  readLibraryState,
  readNewContentMedia,
} from './library-url';

const at = (query: string) =>
  readLibraryState(new URL(`https://studio.test/studio/media${query}`));
/** The args as the component builds them: the search gated at the call. */
const argsAt = (query: string, page = 1) => {
  const state = at(query);
  return libraryListArgs(state, gateSearchQuery(state.q), page);
};
const narrowedAt = (query: string) => {
  const state = at(query);
  return isNarrowed(state, gateSearchQuery(state.q));
};

describe('readLibraryState', () => {
  it('reads a bare URL as the whole library, newest first, in a grid', () => {
    expect(at('')).toEqual({ q: '', ...LIBRARY_DEFAULTS });
  });

  it('reads every param the library writes', () => {
    expect(
      at(
        '?q=hono&mediaType=audio&status=attention&usage=unused&sort=largest&view=list'
      )
    ).toEqual({
      q: 'hono',
      mediaType: 'audio',
      status: 'attention',
      usage: 'unused',
      sort: 'largest',
      view: 'list',
    });
  });

  // An old bookmark (`?status=transcoding`, the previous segment's value) or
  // a hand-typed one must show the library, not a 400 from the API.
  it('reads a value the library does not offer as its default', () => {
    expect(
      at('?mediaType=image&status=transcoding&usage=some&sort=best&view=wall')
    ).toEqual({ q: '', ...LIBRARY_DEFAULTS });
  });
});

describe('libraryListArgs', () => {
  it('asks for one page of 24, newest first, with every default left out', () => {
    expect(argsAt('')).toEqual({
      page: 1,
      limit: MEDIA_LIBRARY_PAGE_SIZE,
      usage: 'any',
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
  });

  it.each([
    ['newest', 'createdAt', 'desc'],
    ['oldest', 'createdAt', 'asc'],
    ['title', 'title', 'asc'],
    ['longest', 'durationSeconds', 'desc'],
    ['largest', 'fileSizeBytes', 'desc'],
  ] as const)('sorts %s by %s %s', (sort, sortBy, sortOrder) => {
    expect(argsAt(`?sort=${sort}`)).toMatchObject({
      sortBy,
      sortOrder,
    });
  });

  // Codex-k618q: below the floor, the search is not sent at all.
  it('sends a search only once it reaches the floor, trimmed', () => {
    expect(argsAt('?q=ho')).not.toHaveProperty('search');
    expect(argsAt('?q=%20hono%20', 2)).toMatchObject({
      page: 2,
      search: 'hono',
    });
  });

  // The args go to `listMedia`, whose schema IS the API's: every status,
  // sort and filter the library offers must be one the API takes.
  it('builds only args the API accepts, for every option', () => {
    for (const status of LIBRARY_STATUSES) {
      for (const sort of LIBRARY_SORTS) {
        const args = argsAt(
          `?status=${status}&sort=${sort}&usage=used&mediaType=video&q=hono`,
          3
        );
        expect(mediaQuerySchema.safeParse(args).success).toBe(true);
      }
    }
  });
});

describe('the URL the filters write', () => {
  // `filterHref` drops a default, so choosing "Any" again leaves a bare URL.
  it('round-trips: a default leaves the URL bare, a choice reads back', () => {
    const base = new URL(
      'https://studio.test/studio/media?status=ready&page=3'
    );
    const cleared = filterHref(base, { status: 'any' }, LIBRARY_DEFAULTS);
    expect(cleared).toBe('/studio/media');

    const chosen = new URL(
      filterHref(base, { usage: 'unused' }, LIBRARY_DEFAULTS),
      base
    );
    // A facet change resets the page: page 3 of the old filter means nothing.
    expect(chosen.searchParams.has('page')).toBe(false);
    expect(readLibraryState(chosen)).toMatchObject({
      status: 'ready',
      usage: 'unused',
    });
  });
});

describe('activeFilterCount / isNarrowed', () => {
  it('counts the facets that narrow the list, never sort or view', () => {
    expect(activeFilterCount(at('?sort=title&view=list'))).toBe(0);
    expect(
      activeFilterCount(at('?mediaType=video&status=ready&usage=used'))
    ).toBe(3);
  });

  it('is narrowed by a facet or a search past the floor, not by a stub', () => {
    expect(narrowedAt('?sort=oldest')).toBe(false);
    expect(narrowedAt('?q=ho')).toBe(false);
    expect(narrowedAt('?q=hono')).toBe(true);
    expect(narrowedAt('?usage=unused')).toBe(true);
  });
});

describe('new content from a media item (Codex-a6ofh.1.8)', () => {
  const ID = '6b000000-0000-4000-8000-000000000001';
  const read = (href: string) =>
    readNewContentMedia(new URL(href, 'https://studio.test'));

  it('round-trips: the link the tray and drawer write is the one the editor reads', () => {
    expect(read(newContentHref({ id: ID, mediaType: 'audio' }))).toEqual({
      id: ID,
      mediaType: 'audio',
    });
  });

  it('starts a blank piece from a hand-edited link, never a broken one', () => {
    expect(read(`/studio/content/new?media=${ID}`)).toBeNull();
    expect(read(`/studio/content/new?media=${ID}&type=written`)).toBeNull();
    expect(read('/studio/content/new?media=x&type=video')).toBeNull();
    expect(read('/studio/content/new')).toBeNull();
  });
});
