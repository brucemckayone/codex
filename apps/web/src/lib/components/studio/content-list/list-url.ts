/**
 * The content list's view, read from and written to the URL
 * (Codex-a6ofh.3.1; content-list.html L1 and L5:
 * `?status=&type=&access=&sort=&view=&search=`).
 *
 * As the media library's (`library-url.ts`): every param has a default that
 * leaves the URL bare (a value equal to its default is dropped), and a value
 * the list does not offer reads as that default (`pickParam`), so a stale or
 * hand-typed link shows the whole list rather than a refusal. The status is
 * `readStatusFilter`'s, so the dashboard's and the New menu's "drafts" links
 * keep opening the drafts.
 */

import {
  CONTENT_ACCESS_TYPE,
  CONTENT_TYPES,
  type ContentAccessType,
} from '@codex/constants';
import type { ContentQueryInput } from '@codex/validation';
import { pickParam } from '$lib/utils/filter-url';
import { type ContentStatusFilter, readStatusFilter } from './content-status';

/** One read of the list, and each "Show more": as the media library's. */
export const CONTENT_LIST_PAGE_SIZE = 24;

const LIST_TYPES = [
  'all',
  CONTENT_TYPES.VIDEO,
  CONTENT_TYPES.AUDIO,
  CONTENT_TYPES.WRITTEN,
] as const;
const LIST_ACCESS: readonly ListAccess[] = [
  'any',
  ...Object.values(CONTENT_ACCESS_TYPE),
];
/** Mockup L1 note 5: every one is a `contentQuerySchema` sort already. */
export const LIST_SORTS = [
  'updated',
  'newest',
  'published',
  'title',
  'views',
  'sales',
] as const;
const LIST_VIEWS = ['list', 'grid'] as const;

export type ListType = (typeof LIST_TYPES)[number];
export type ListAccess = 'any' | ContentAccessType;
export type ListSort = (typeof LIST_SORTS)[number];
export type ListView = (typeof LIST_VIEWS)[number];

export interface ContentListState {
  /** The search box as typed; what reaches the API is gated. */
  search: string;
  status: ContentStatusFilter;
  type: ListType;
  access: ListAccess;
  sort: ListSort;
  view: ListView;
}

/** Each param's bare-URL value, for `createListUrlWriter`'s `defaults`. */
export const CONTENT_LIST_DEFAULTS = {
  status: 'all',
  type: 'all',
  access: 'any',
  sort: 'updated',
  view: 'list',
} as const satisfies Omit<ContentListState, 'search'>;

const SORT_ARGS: Record<
  ListSort,
  Required<Pick<ContentQueryInput, 'sortBy' | 'sortOrder'>>
> = {
  updated: { sortBy: 'updatedAt', sortOrder: 'desc' },
  newest: { sortBy: 'createdAt', sortOrder: 'desc' },
  published: { sortBy: 'publishedAt', sortOrder: 'desc' },
  title: { sortBy: 'title', sortOrder: 'asc' },
  views: { sortBy: 'viewCount', sortOrder: 'desc' },
  sales: { sortBy: 'purchaseCount', sortOrder: 'desc' },
};

export function readContentListState(url: URL): ContentListState {
  const params = url.searchParams;
  return {
    search: params.get('search') ?? '',
    status: readStatusFilter(url),
    type: pickParam(LIST_TYPES, params.get('type'), CONTENT_LIST_DEFAULTS.type),
    access: pickParam(
      LIST_ACCESS,
      params.get('access'),
      CONTENT_LIST_DEFAULTS.access
    ),
    sort: pickParam(LIST_SORTS, params.get('sort'), CONTENT_LIST_DEFAULTS.sort),
    view: pickParam(LIST_VIEWS, params.get('view'), CONTENT_LIST_DEFAULTS.view),
  };
}

/**
 * `listContent`'s args for one page of this view. `search` arrives GATED
 * (`gateSearchQuery`, Codex-k618q) from the component that builds the query,
 * where the search-floor sweep looks for the gate; null leaves it out, so a
 * one- or two-letter keystroke lists everything rather than asking the
 * database for a pattern it cannot index. `organizationId` null is the
 * personal studio's list.
 */
export function contentListArgs(
  state: ContentListState,
  search: string | null,
  organizationId: string | null,
  page: number
): ContentQueryInput {
  return {
    page,
    limit: CONTENT_LIST_PAGE_SIZE,
    ...(organizationId && { organizationId }),
    ...(state.status !== 'all' && { status: state.status }),
    ...(state.type !== 'all' && { contentType: state.type }),
    ...(state.access !== 'any' && { accessType: state.access }),
    ...(search && { search }),
    ...SORT_ARGS[state.sort],
  };
}

/**
 * True when the list shows part of the content ("No matches" rather than
 * "Make your first piece"): a facet (never the sort or the view), or a
 * (gated) search that reached the API.
 */
export function isContentListNarrowed(
  state: ContentListState,
  search: string | null
): boolean {
  return (
    state.status !== CONTENT_LIST_DEFAULTS.status ||
    state.type !== CONTENT_LIST_DEFAULTS.type ||
    state.access !== CONTENT_LIST_DEFAULTS.access ||
    search !== null
  );
}
