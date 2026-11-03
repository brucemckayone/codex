/**
 * The media library's view, read from and written to the URL
 * (Codex-a6ofh.1.6; data-design §1.1: `?q=&status=&usage=&sort=&view=`).
 *
 * Every param has a default that leaves the URL bare (`filterHref` drops a
 * value equal to its default), and a value the library does not offer reads
 * as that default, so a stale or hand-typed link shows the whole library
 * rather than a refusal.
 */

import { MEDIA_LIBRARY_PAGE_SIZE } from '@codex/constants';
import type { MediaQueryInput } from '@codex/validation';

/** Status menu (mockup M1 note 3): `processing` and `attention` are groups. */
export const LIBRARY_STATUSES = [
  'any',
  'ready',
  'processing',
  'attention',
  'uploading',
] as const;
const LIBRARY_TYPES = ['all', 'video', 'audio'] as const;
const LIBRARY_USAGES = ['any', 'used', 'unused'] as const;
export const LIBRARY_SORTS = [
  'newest',
  'oldest',
  'title',
  'longest',
  'largest',
] as const;
const LIBRARY_VIEWS = ['grid', 'list'] as const;

export type LibraryStatus = (typeof LIBRARY_STATUSES)[number];
export type LibraryType = (typeof LIBRARY_TYPES)[number];
export type LibraryUsage = (typeof LIBRARY_USAGES)[number];
export type LibrarySort = (typeof LIBRARY_SORTS)[number];
export type LibraryView = (typeof LIBRARY_VIEWS)[number];

export interface LibraryState {
  /** The search box as typed; what reaches the API is gated. */
  q: string;
  mediaType: LibraryType;
  status: LibraryStatus;
  usage: LibraryUsage;
  sort: LibrarySort;
  view: LibraryView;
}

/** Each param's bare-URL value, for `filterHref`'s `defaults`. */
export const LIBRARY_DEFAULTS = {
  mediaType: 'all',
  status: 'any',
  usage: 'any',
  sort: 'newest',
  view: 'grid',
} as const satisfies Omit<LibraryState, 'q'>;

const SORT_ARGS: Record<
  LibrarySort,
  Required<Pick<MediaQueryInput, 'sortBy' | 'sortOrder'>>
> = {
  newest: { sortBy: 'createdAt', sortOrder: 'desc' },
  oldest: { sortBy: 'createdAt', sortOrder: 'asc' },
  title: { sortBy: 'title', sortOrder: 'asc' },
  longest: { sortBy: 'durationSeconds', sortOrder: 'desc' },
  largest: { sortBy: 'fileSizeBytes', sortOrder: 'desc' },
};

function pick<T extends string>(
  options: readonly T[],
  raw: string | null,
  fallback: T
): T {
  return options.find((option) => option === raw) ?? fallback;
}

export function readLibraryState(url: URL): LibraryState {
  const params = url.searchParams;
  return {
    q: params.get('q') ?? '',
    mediaType: pick(
      LIBRARY_TYPES,
      params.get('mediaType'),
      LIBRARY_DEFAULTS.mediaType
    ),
    status: pick(
      LIBRARY_STATUSES,
      params.get('status'),
      LIBRARY_DEFAULTS.status
    ),
    usage: pick(LIBRARY_USAGES, params.get('usage'), LIBRARY_DEFAULTS.usage),
    sort: pick(LIBRARY_SORTS, params.get('sort'), LIBRARY_DEFAULTS.sort),
    view: pick(LIBRARY_VIEWS, params.get('view'), LIBRARY_DEFAULTS.view),
  };
}

/**
 * `listMedia`'s args for one page of this view. `search` arrives GATED
 * (`gateSearchQuery(state.q)`, Codex-k618q) from the component that builds
 * the query, where the search-floor sweep looks for the gate; null leaves it
 * out, so a one- or two-letter keystroke lists everything rather than asking
 * the database for a pattern it cannot index.
 */
export function libraryListArgs(
  state: LibraryState,
  search: string | null,
  page: number
): MediaQueryInput {
  return {
    page,
    limit: MEDIA_LIBRARY_PAGE_SIZE,
    ...(state.mediaType !== 'all' && { mediaType: state.mediaType }),
    ...(state.status !== 'any' && { status: state.status }),
    usage: state.usage,
    ...(search && { search }),
    ...SORT_ARGS[state.sort],
  };
}

/** The facets that narrow the list (not sort, not view): "Filters · N". */
export function activeFilterCount(state: LibraryState): number {
  return (
    Number(state.mediaType !== LIBRARY_DEFAULTS.mediaType) +
    Number(state.status !== LIBRARY_DEFAULTS.status) +
    Number(state.usage !== LIBRARY_DEFAULTS.usage)
  );
}

/**
 * True when the list shows part of the library ("5 of 12", "No matches"):
 * a facet, or a (gated) search that reached the API.
 */
export function isNarrowed(
  state: LibraryState,
  search: string | null
): boolean {
  return activeFilterCount(state) > 0 || search !== null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The item the drawer shows (`?item=<id>`, Codex-a6ofh.1.7), or null. Only
 * an id shape opens it: a hand-typed `?item=x` would be refused by the read.
 */
export function readOpenItem(url: URL): string | null {
  const id = url.searchParams.get('item');
  return id && UUID.test(id) ? id : null;
}

/** The media a new piece starts with: "Create content from this" (Codex-a6ofh.1.8). */
export interface NewContentMedia {
  id: string;
  mediaType: 'video' | 'audio';
}

/**
 * Where "Create content from this" goes. The type rides along so the editor
 * opens as video or audio content at once, without first reading the item.
 */
export function newContentHref(media: NewContentMedia): string {
  const params = new URLSearchParams({
    media: media.id,
    type: media.mediaType,
  });
  return `/studio/content/new?${params}`;
}

/**
 * The media `/studio/content/new` starts with, or null. Both halves must be
 * well formed: a hand-edited link starts a blank piece, never a broken one.
 */
export function readNewContentMedia(url: URL): NewContentMedia | null {
  const id = url.searchParams.get('media');
  const mediaType = url.searchParams.get('type');
  if (!id || !UUID.test(id)) return null;
  if (mediaType !== 'video' && mediaType !== 'audio') return null;
  return { id, mediaType };
}
