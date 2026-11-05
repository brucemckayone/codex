/**
 * The media picker's list query (Codex-a6ofh.1.8, mockup M5), apart from the
 * dialog so each rule is tested on its own. It is the library's query with
 * the field's own limits: its media types, and only what it can hold.
 */
import type { MediaQueryInput } from '@codex/validation';
import {
  LIBRARY_DEFAULTS,
  type LibrarySort,
  libraryListArgs,
} from './library-url';

/** Ready only; or still processing; or both (the `attachable` group). */
export type PickerSegment = 'ready' | 'processing' | 'all';

export interface PickerFacets {
  /** What the field holds: one type narrows the list, both leave it open. */
  mediaTypes: readonly ('video' | 'audio')[];
  segment: PickerSegment;
  sort: LibrarySort;
}

const STATUS: Record<PickerSegment, MediaQueryInput['status']> = {
  ready: 'ready',
  processing: 'processing',
  all: 'attachable',
};

/**
 * `listMedia`'s args for one page. `search` arrives GATED from the dialog
 * (`gateSearchQuery`, Codex-k618q), where the search-floor sweep looks for
 * the gate. Never a failed or stopped item: no segment offers one.
 */
export function pickerListArgs(
  facets: PickerFacets,
  search: string | null,
  page: number
): MediaQueryInput {
  const [only] = facets.mediaTypes.length === 1 ? facets.mediaTypes : [];
  return {
    ...libraryListArgs(
      {
        ...LIBRARY_DEFAULTS,
        q: '',
        mediaType: only ?? 'all',
        sort: facets.sort,
      },
      search,
      page
    ),
    status: STATUS[facets.segment],
  };
}
