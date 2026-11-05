/**
 * What the media library's menus offer, with their labels
 * (Codex-a6ofh.1.6). The toolbar, the phone sheet, the header's
 * "5 of 12 · Unused" and the empty states all read these, so a facet is
 * named the same everywhere.
 */

import type { MediaLibrarySummary } from '@codex/shared-types';
import * as m from '$paraglide/messages';
import type {
  LibrarySort,
  LibraryState,
  LibraryStatus,
  LibraryType,
  LibraryUsage,
} from './library-url';

export interface LibraryOption<T extends string = string> {
  value: T;
  label: () => string;
}

export const TYPE_OPTIONS: readonly LibraryOption<LibraryType>[] = [
  { value: 'all', label: () => m.media_filter_all() },
  { value: 'video', label: () => m.media_type_video() },
  { value: 'audio', label: () => m.media_type_audio() },
];

/** Mockup M1 note 3: Processing and Needs attention are groups. */
export const STATUS_OPTIONS: readonly LibraryOption<LibraryStatus>[] = [
  { value: 'any', label: () => m.media_filter_any() },
  { value: 'ready', label: () => m.media_status_ready() },
  { value: 'processing', label: () => m.media_status_processing() },
  { value: 'attention', label: () => m.media_filter_status_attention() },
  { value: 'uploading', label: () => m.media_status_uploading() },
];

export const USAGE_OPTIONS: readonly LibraryOption<LibraryUsage>[] = [
  { value: 'any', label: () => m.media_filter_any() },
  { value: 'used', label: () => m.media_filter_usage_used() },
  { value: 'unused', label: () => m.media_filter_usage_unused() },
];

export const SORT_OPTIONS: readonly LibraryOption<LibrarySort>[] = [
  { value: 'newest', label: () => m.media_sort_newest() },
  { value: 'oldest', label: () => m.media_sort_oldest() },
  { value: 'title', label: () => m.media_sort_title() },
  { value: 'longest', label: () => m.media_sort_longest() },
  { value: 'largest', label: () => m.media_sort_largest() },
];

/**
 * The one facet narrowing the list, named for the header ("5 of 12 ·
 * Unused"); null when none, or more than one, is set, where a single label
 * would misdescribe the view.
 */
export function soleFacetLabel(state: LibraryState): string | null {
  const chosen: (LibraryOption | undefined)[] = [
    state.mediaType === 'all'
      ? undefined
      : TYPE_OPTIONS.find((o) => o.value === state.mediaType),
    state.status === 'any'
      ? undefined
      : STATUS_OPTIONS.find((o) => o.value === state.status),
    state.usage === 'any'
      ? undefined
      : USAGE_OPTIONS.find((o) => o.value === state.usage),
  ];
  const set = chosen.filter(
    (option): option is LibraryOption => option !== undefined
  );
  return set.length === 1 ? (set[0]?.label() ?? null) : null;
}

export interface AttentionLine {
  /** "2 need attention." */
  title: string;
  /** "1 failed to process, and 1 upload stopped before it finished." */
  detail: string;
}

/**
 * The needs-attention line (mockup M1 note 6) from the library's sums; null
 * when nothing needs the creator, or when that is already the filter shown.
 */
export function attentionLine(
  sums: MediaLibrarySummary | undefined,
  status: LibraryState['status']
): AttentionLine | null {
  if (!sums || status === 'attention') return null;
  const count = sums.failed + sums.stopped;
  if (count === 0) return null;
  const failed =
    sums.failed === 0
      ? null
      : sums.failed === 1
        ? m.media_attention_failed_one()
        : m.media_attention_failed({ count: sums.failed });
  const stopped =
    sums.stopped === 0
      ? null
      : sums.stopped === 1
        ? m.media_attention_stopped_one()
        : m.media_attention_stopped({ count: sums.stopped });
  return {
    title:
      count === 1
        ? m.media_attention_title_one()
        : m.media_attention_title({ count }),
    detail:
      failed && stopped
        ? m.media_attention_both({ failed, stopped })
        : m.media_attention_single({ detail: failed ?? stopped ?? '' }),
  };
}
