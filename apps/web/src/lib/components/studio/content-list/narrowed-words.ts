/**
 * What narrows the content list, by name, for its empty state (Codex-a6ofh.3.6,
 * mockup L3 "Filters with no results"): "Nothing matches Type: Audio +
 * Access: Paid", never only "these filters". Each filter is said as its menu
 * says it, the menu's title and the option chosen; the search as typed.
 *
 * The same filters `isContentListNarrowed` counts, in the toolbar's order. A
 * filter whose option has no label to hand (a category or an org not read
 * yet) is left out: the caller says "these filters" when none is named.
 */
import type { ContentAttentionKind } from '@codex/constants';
import * as m from '$paraglide/messages';
import type { ListOption } from '../list-toolbar/list-option';
import { ACCESS_OPTIONS, STATUS_OPTIONS, TYPE_OPTIONS } from './list-options';
import {
  CATEGORY_ANY,
  CONTENT_LIST_DEFAULTS,
  type ContentListState,
  isOrgWhere,
  NEEDS_NONE,
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

function labelOf<T extends string>(
  options: readonly ListOption<T>[] | undefined,
  value: string
): string | undefined {
  return options?.find((option) => option.value === value)?.label();
}

/**
 * Each filter narrowing the list, named. `where` and `categories` are the
 * menus' own options, when the studio has them.
 */
export function narrowedBy(
  state: ContentListState,
  search: string | null,
  organizationId: string | null,
  named: {
    where?: readonly ListOption[];
    categories?: readonly ListOption[];
  } = {}
): string[] {
  const parts: string[] = [];
  const add = (title: string, value: string | undefined) => {
    if (value) parts.push(m.studio_content_list_filter_named({ title, value }));
  };
  if (state.status !== CONTENT_LIST_DEFAULTS.status) {
    add(m.studio_content_status_facet(), labelOf(STATUS_OPTIONS, state.status));
  }
  if (organizationId === null && isOrgWhere(state.where)) {
    add(m.studio_content_where_label(), labelOf(named.where, state.where));
  }
  if (state.type !== CONTENT_LIST_DEFAULTS.type) {
    add(m.media_filter_type_label(), labelOf(TYPE_OPTIONS, state.type));
  }
  if (state.access !== CONTENT_LIST_DEFAULTS.access) {
    add(
      m.studio_content_form_access_label(),
      labelOf(ACCESS_OPTIONS, state.access)
    );
  }
  if (organizationId !== null && state.category !== CATEGORY_ANY) {
    add(
      m.studio_content_category_label(),
      labelOf(named.categories, state.category)
    );
  }
  if (state.needs !== NEEDS_NONE) parts.push(NEEDS_NAMED[state.needs]());
  if (search !== null) {
    add(m.studio_content_list_search_facet(), `“${search}”`);
  }
  return parts;
}

/** The empty state's sentence: the filters by name, or "these filters". */
export function noMatchWords(parts: readonly string[]): string {
  return parts.length > 0
    ? m.studio_content_list_no_match_named({ filters: parts.join(' + ') })
    : m.studio_content_list_no_match();
}
