/**
 * Continue-watching selection (pure, server-independent).
 *
 * The platform landing page's "Continue watching" rail (WP-11) shows the
 * current user's cross-device resume items, derived from their server-backed
 * library + persisted playback progress (NOT localStorage). This module holds
 * the SELECTION rule as a pure function so it can be unit-tested without a
 * database or browser: given the raw library items it filters to in-progress
 * content, orders by playback recency, caps the list, and maps each item to
 * the compact shape the `ContentCard` `resume` variant consumes.
 *
 * The in-progress rule mirrors `ContinueWatching.svelte` exactly:
 * `progress exists AND positionSeconds > 0 AND NOT completed`. The `completed`
 * flag is authoritative — it is computed server-side at
 * `VIDEO_PROGRESS.COMPLETION_THRESHOLD` (95%) when progress is saved (see
 * `ContentAccessService.savePlaybackProgress` and
 * `$lib/collections/library.ts`), so this module trusts the flag rather than
 * recomputing the threshold from position/duration.
 */

import type { UserLibraryResponse } from '@codex/access';

/** A single library item as returned by the access library API. */
type LibraryItem = UserLibraryResponse['items'][number];

/** Playback progress for a library item (non-null branch). */
type LibraryProgress = NonNullable<LibraryItem['progress']>;

/** Library item whose `progress` is guaranteed present (post-filter narrowing). */
type InProgressLibraryItem = LibraryItem & { progress: LibraryProgress };

/**
 * Compact resume item consumed by the `ContentCard` `resume` variant.
 *
 * Carries `slug` / `id` / `organizationSlug` rather than a prebuilt `href`
 * because cross-org content URLs depend on the *current* request host
 * (subdomain routing). The caller (WP-11) finishes the link at render time
 * with `buildContentUrl(page.url, item)`. `progress` is passed through intact
 * so the card can render the resume bar without a second lookup.
 */
export interface ContinueWatchingItem {
  id: string;
  title: string;
  slug: string;
  organizationSlug: string | null;
  thumbnail: string | null;
  contentType: 'video' | 'audio' | 'article';
  duration: number;
  progress: LibraryProgress;
}

export interface SelectContinueWatchingOptions {
  /**
   * Maximum items to return. Defaults to {@link CONTINUE_WATCHING_LIMIT}.
   * Non-positive values yield an empty list.
   */
  limit?: number;
}

/** Default cap for the continue-watching rail. */
export const CONTINUE_WATCHING_LIMIT = 12;

/**
 * The in-progress predicate shared with `ContinueWatching.svelte`: content the
 * user has started (`positionSeconds > 0`) but not finished (`!completed`).
 * Acts as a type guard so callers get `progress` narrowed to non-null.
 */
export function isInProgress(item: LibraryItem): item is InProgressLibraryItem {
  const progress = item.progress;
  return (
    progress != null && progress.positionSeconds > 0 && !progress.completed
  );
}

/**
 * Map the DB `contentType` onto the card's three-value union. The library API
 * emits `'written'` for articles while `ContentCard` expects `'article'`;
 * every other type passes through unchanged. Mirrors the inline mapping in
 * `ContinueWatching.svelte`.
 */
function toCardContentType(contentType: string): 'video' | 'audio' | 'article' {
  return contentType === 'written'
    ? 'article'
    : (contentType as 'video' | 'audio' | 'article');
}

/** Project an in-progress library item into the compact resume shape. */
function toResumeItem(item: InProgressLibraryItem): ContinueWatchingItem {
  return {
    id: item.content.id,
    title: item.content.title,
    slug: item.content.slug,
    organizationSlug: item.content.organizationSlug,
    thumbnail: item.content.thumbnailUrl,
    contentType: toCardContentType(item.content.contentType),
    duration: item.content.durationSeconds,
    progress: item.progress,
  };
}

/**
 * Select the current user's continue-watching items from their library.
 *
 * Filters to in-progress content, orders by most-recent playback
 * (`progress.updatedAt` DESC via `localeCompare`, matching
 * `ContinueWatching.svelte`), caps to `limit`, and maps to the compact resume
 * shape. Pure and non-mutating — the input array is never reordered.
 */
export function selectContinueWatching(
  libraryItems: readonly LibraryItem[],
  options: SelectContinueWatchingOptions = {}
): ContinueWatchingItem[] {
  const limit = Math.max(0, options.limit ?? CONTINUE_WATCHING_LIMIT);

  return libraryItems
    .filter(isInProgress)
    .sort((a, b) => b.progress.updatedAt.localeCompare(a.progress.updatedAt))
    .slice(0, limit)
    .map(toResumeItem);
}
