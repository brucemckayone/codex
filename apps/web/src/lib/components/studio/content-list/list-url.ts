/**
 * The content list's view, read from and written to the URL
 * (Codex-a6ofh.3.1; content-list.html L1 and L5:
 * `?status=&type=&access=&sort=&view=&search=`, the personal studio's
 * `?where=`, L4b, Codex-a6ofh.3.2, the org studio's `?category=`,
 * Codex-a6ofh.3.3, and a "Needs you" chip's `?needs=`, Codex-a6ofh.3.4).
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
  CONTENT_ATTENTION_KINDS,
  CONTENT_LIST_SCOPE,
  CONTENT_TYPES,
  type ContentAccessType,
  type ContentAttentionKind,
} from '@codex/constants';
import type { ContentQueryInput } from '@codex/validation';
import { pickIdParam, pickParam } from '$lib/utils/filter-url';
import type { ListUrlPatch } from '../list-url-writer';
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
/** "Needs you" narrows to no chip's pieces: the whole list. */
export const NEEDS_NONE = 'none';
const LIST_NEEDS = [NEEDS_NONE, ...CONTENT_ATTENTION_KINDS] as const;

export type ListType = (typeof LIST_TYPES)[number];
export type ListAccess = 'any' | ContentAccessType;
export type ListSort = (typeof LIST_SORTS)[number];
export type ListView = (typeof LIST_VIEWS)[number];
export type ListNeeds = (typeof LIST_NEEDS)[number];

/** "Where" lists the content filed under no org: the personal studio's own. */
export const WHERE_PERSONAL = 'personal';
/** "Where" lists everything, every org's pieces too: "Everywhere". */
export const WHERE_ALL = 'all';
/** "Category" lists every category's pieces, and those in none: "Any". */
export const CATEGORY_ANY = 'any';

export interface ContentListState {
  /** The search box as typed; what reaches the API is gated. */
  search: string;
  status: ContentStatusFilter;
  type: ListType;
  access: ListAccess;
  sort: ListSort;
  view: ListView;
  /**
   * The personal studio's "Where" (Codex-a6ofh.3.2, mockup L4b):
   * `WHERE_PERSONAL`, `WHERE_ALL`, or one org's id. The org studio has no
   * Where (its list is its org) and ignores it.
   */
  where: string;
  /**
   * The org studio's Category (Codex-a6ofh.3.3, mockup L1 pin 4):
   * `CATEGORY_ANY`, or one category's id. The personal studio has no
   * Category (owner, 2026-11-12) and ignores it.
   */
  category: string;
  /**
   * A "Needs you" chip's kind (Codex-a6ofh.3.4), or `NEEDS_NONE`: the
   * pieces it counted, in both studios.
   */
  needs: ListNeeds;
}

/** Each param's bare-URL value, for `createListUrlWriter`'s `defaults`. */
export const CONTENT_LIST_DEFAULTS = {
  status: 'all',
  type: 'all',
  access: 'any',
  sort: 'updated',
  view: 'list',
  where: WHERE_PERSONAL,
  category: CATEGORY_ANY,
  needs: NEEDS_NONE,
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
    where: readWhere(params.get('where')),
    category:
      pickIdParam(params.get('category')) ?? CONTENT_LIST_DEFAULTS.category,
    needs: pickParam(
      LIST_NEEDS,
      params.get('needs'),
      CONTENT_LIST_DEFAULTS.needs
    ),
  };
}

/** `?where=`: Everywhere, an org's id, or else the default, Personal. */
function readWhere(raw: string | null): string {
  if (raw === WHERE_ALL) return WHERE_ALL;
  return pickIdParam(raw) ?? CONTENT_LIST_DEFAULTS.where;
}

/** True for a Where that is one org: the only one that shows part of it. */
export function isOrgWhere(where: string): boolean {
  return where !== WHERE_PERSONAL && where !== WHERE_ALL;
}

/**
 * Where the read looks: the list's, and the "Needs you" counts' alone (a
 * to-do, not a view: owner, Codex-a6ofh.3.4). The org studio's list is its
 * org, whatever the URL says. The personal studio's is its Where: personal
 * is `scope` (an organizationId cannot say "none"), an org is its id,
 * Everywhere neither.
 */
export function whereArgs(
  where: string,
  organizationId: string | null
): Pick<ContentQueryInput, 'scope' | 'organizationId'> {
  if (organizationId) return { organizationId };
  if (where === WHERE_PERSONAL) return { scope: CONTENT_LIST_SCOPE.PERSONAL };
  if (where === WHERE_ALL) return {};
  return { organizationId: where };
}

/**
 * `listContent`'s args for one page of this view. `search` arrives GATED
 * (`gateSearchQuery`, Codex-k618q) from the component that builds the query,
 * where the search-floor sweep looks for the gate; null leaves it out, so a
 * one- or two-letter keystroke lists everything rather than asking the
 * database for a pattern it cannot index. `organizationId` null is the
 * personal studio's list, which then looks where `state.where` says.
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
    ...whereArgs(state.where, organizationId),
    // The org studio's rows name their categories; its Category narrows.
    ...(organizationId && { include: 'categories' as const }),
    ...(organizationId &&
      state.category !== CATEGORY_ANY && { categoryId: state.category }),
    // A tab is a lifecycle (`content-status.ts`), asked of the API as one.
    ...(state.status !== 'all' && { lifecycle: state.status }),
    ...(state.type !== 'all' && { contentType: state.type }),
    ...(state.access !== 'any' && { accessType: state.access }),
    ...(state.needs !== NEEDS_NONE && { needs: state.needs }),
    ...(search && { search }),
    ...SORT_ARGS[state.sort],
  };
}

/**
 * What narrows a view within its Where, cleared: the search, the status and
 * the facets. Clear filters and a "Needs you" chip both write it; neither
 * touches the sort or the view.
 */
export const FACETS_CLEARED = {
  search: null,
  status: null,
  type: null,
  access: null,
  category: null,
} as const satisfies ListUrlPatch;

/**
 * A "Needs you" chip pressed: its pieces, and only those, so the rows shown
 * are the number it said; the Where stays. Pressing the chip in use again
 * shows the whole list.
 */
export function needsPatch(
  kind: ContentAttentionKind,
  state: ContentListState
): ListUrlPatch {
  if (state.needs === kind) return { needs: null };
  return { ...FACETS_CLEARED, needs: kind };
}

/**
 * True when the list shows part of the content ("No matches" rather than
 * "Make your first piece"): a facet (never the sort or the view), a (gated)
 * search that reached the API, the personal studio's Where on one org, the
 * org studio's Category, or a "Needs you" chip.
 * Personal, its default, is the studio's own whole list, not a narrowing:
 * empty, it says "Make your first piece", which a piece made here fixes.
 */
export function isContentListNarrowed(
  state: ContentListState,
  search: string | null,
  organizationId: string | null
): boolean {
  return (
    state.status !== CONTENT_LIST_DEFAULTS.status ||
    state.type !== CONTENT_LIST_DEFAULTS.type ||
    state.access !== CONTENT_LIST_DEFAULTS.access ||
    (organizationId === null && isOrgWhere(state.where)) ||
    (organizationId !== null && state.category !== CATEGORY_ANY) ||
    state.needs !== CONTENT_LIST_DEFAULTS.needs ||
    search !== null
  );
}
