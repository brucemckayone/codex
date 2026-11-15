/**
 * The empty list's "Nothing matches …" (Codex-a6ofh.3.6, mockup L3): each
 * filter by its menu's title and choice, in the toolbar's order.
 */
import { describe, expect, it } from 'vitest';
import * as m from '$paraglide/messages';
import { contentListFacets } from './list-options';
import { readContentListState } from './list-url';
import { NEEDS_NAMED, narrowedBy, noMatchWords } from './narrowed-words';

const ORG = '5f0c7b2e-1d3a-4c8e-9b6f-2a7d1e4c9b30';
const CAT = '7a1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';

const state = (query: string) =>
  readContentListState(new URL(`https://studio.test/studio/content${query}`));

// The org studio's facets (no Where); the personal studio's have no Category.
const ORG_FACETS = contentListFacets({});

const named = (title: string, value: string) =>
  m.studio_content_list_filter_named({ title, value });

describe('narrowedBy', () => {
  it('names each filter as its menu does, in the toolbar order', () => {
    expect(
      narrowedBy(
        state('?status=off-sale&type=audio&access=paid'),
        null,
        ORG,
        ORG_FACETS
      )
    ).toEqual([
      named(m.media_filter_status_label(), m.studio_content_filter_off_sale()),
      named(m.media_filter_type_label(), 'Audio'),
      named(m.studio_content_form_access_label(), 'Paid'),
    ]);
  });

  it('names a chip by its kind and the search as typed', () => {
    expect(
      narrowedBy(state('?needs=scheduled'), 'runes', ORG, ORG_FACETS)
    ).toEqual([
      NEEDS_NAMED.scheduled(),
      named(m.studio_content_list_search_facet(), '“runes”'),
    ]);
  });

  it('names the org studio’s category, and the personal studio’s org, from their menus', () => {
    const categories = [{ value: CAT, label: () => 'Q&A' }];
    expect(
      narrowedBy(
        state(`?category=${CAT}`),
        null,
        ORG,
        contentListFacets({ categories })
      )
    ).toEqual([named(m.studio_content_category_label(), 'Q&A')]);

    const where = [{ value: ORG, label: () => 'Studio Alpha' }];
    expect(
      narrowedBy(
        state(`?where=${ORG}`),
        null,
        null,
        contentListFacets({ where })
      )
    ).toEqual([named(m.studio_content_where_label(), 'Studio Alpha')]);
  });

  // Naming only the type would say videos alone match nothing, and hide the
  // category that narrows the list (review): "these filters" says no less.
  it('names none when one filter has no name yet', () => {
    // The categories not read: the menu has no Q&A to name.
    expect(
      narrowedBy(state(`?category=${CAT}&type=video`), null, ORG, ORG_FACETS)
    ).toEqual([]);
  });

  it('names nothing on the whole list', () => {
    expect(narrowedBy(state(''), null, ORG, ORG_FACETS)).toEqual([]);
  });
});

describe('noMatchWords', () => {
  it('joins the names, or says "these filters" with none', () => {
    expect(noMatchWords(['Type: Audio', 'Access: Paid'])).toBe(
      m.studio_content_list_no_match_named({
        filters: 'Type: Audio + Access: Paid',
      })
    );
    expect(noMatchWords([])).toBe(m.studio_content_list_no_match());
  });
});
