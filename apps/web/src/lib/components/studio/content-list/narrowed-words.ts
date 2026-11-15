/**
 * What narrows the content list, by name, for its empty state (Codex-a6ofh.3.6,
 * mockup L3 "Filters with no results"): "Nothing matches Type: Audio +
 * Access: Paid", never only "these filters". Each filter is said as its menu
 * says it, from the same facets the toolbar draws (`contentListFacets`), and
 * the search as typed.
 *
 * Which filters narrow is `narrowingFilters`'s rule, the one
 * `isContentListNarrowed` reads. A filter whose choice has no label to hand
 * (a category or an org not read yet) is left out: the caller says "these
 * filters" when none is named.
 */
import type { ContentAttentionKind } from '@codex/constants';
import * as m from '$paraglide/messages';
import type { ListFacet, ListOption } from '../list-toolbar/list-option';
import { type ContentListFacetKey, STATUS_OPTIONS } from './list-options';
import {
  type ContentListState,
  NEEDS_NONE,
  narrowingFilters,
} from './list-url';

/** A "Needs you" kind without its count, as its chip names it. */
export const NEEDS_NAMED: Record<ContentAttentionKind, () => string> = {
  'live-media-gone': m.studio_content_needs_live_media_gone_named,
  scheduled: m.studio_content_needs_scheduled_named,
  'didnt-go-live': m.studio_content_needs_didnt_go_live_named,
  'media-gone': m.studio_content_needs_media_gone_named,
  processing: m.studio_content_needs_processing_named,
  ready: m.studio_content_needs_ready_named,
};

function labelOf(
  options: readonly ListOption[] | undefined,
  value: string
): string | undefined {
  return options?.find((option) => option.value === value)?.label();
}

/** Each filter narrowing the list, named, given the toolbar's facets. */
export function narrowedBy(
  state: ContentListState,
  search: string | null,
  organizationId: string | null,
  facets: readonly ListFacet<ContentListFacetKey>[]
): string[] {
  const parts: string[] = [];
  const add = (title: string, value: string | undefined) => {
    if (value) parts.push(m.studio_content_list_filter_named({ title, value }));
  };
  for (const filter of narrowingFilters(state, search, organizationId)) {
    if (filter === 'status') {
      add(m.media_filter_status_label(), labelOf(STATUS_OPTIONS, state.status));
    } else if (filter === 'needs') {
      if (state.needs !== NEEDS_NONE) parts.push(NEEDS_NAMED[state.needs]());
    } else if (filter === 'search') {
      if (search !== null) {
        add(m.studio_content_list_search_facet(), `“${search}”`);
      }
    } else {
      const facet = facets.find((one) => one.key === filter);
      if (facet) add(facet.title(), labelOf(facet.options, state[filter]));
    }
  }
  return parts;
}

/** The empty state's sentence: the filters by name, or "these filters". */
export function noMatchWords(parts: readonly string[]): string {
  return parts.length > 0
    ? m.studio_content_list_no_match_named({ filters: parts.join(' + ') })
    : m.studio_content_list_no_match();
}
