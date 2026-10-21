/**
 * Reactive test double for `browseContent` in `$lib/remote/content.remote`
 * (Codex-2hxff.21). The real module imports `$app/server`, so it cannot load
 * in jsdom.
 *
 * Each page is its own query, as in production: a page nobody has set is
 * still loading (`current` undefined, no `error`), and a page set to fail
 * mirrors a REJECTED kit query (`current` undefined, the rejection on
 * `error`). Pages can be landed one at a time to watch the picker wait.
 *
 * Deliberately exports no `listContent`: the picker must read the org-wide
 * browse, and importing the creator-scoped list would fail loudly here.
 *
 * A `.svelte.ts` module (runes compiled), NOT a `*.test.*` file → never
 * collected as a suite.
 */

import { vi } from 'vitest';
import type { ContentWithRelations } from '$lib/types';

type ContentPage = {
  items: ContentWithRelations[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

type BrowseInput = { organizationId: string; page: number; limit: number };

const state = $state<{
  pages: Record<number, ContentPage>;
  errors: Record<number, unknown>;
}>({ pages: {}, errors: {} });

/** A published item with only the fields the grant picker reads set. */
export function contentItem(
  id: string,
  title: string,
  flags: Partial<
    Pick<
      ContentWithRelations,
      | 'creatorId'
      | 'courseOnly'
      | 'isTeamOnly'
      | 'isFollowerGated'
      | 'includedInTierId'
      | 'priceCents'
    >
  >
): ContentWithRelations {
  return {
    id,
    title,
    creatorId: 'signed-in-member',
    courseOnly: false,
    isTeamOnly: false,
    isFollowerGated: false,
    includedInTierId: null,
    priceCents: null,
    ...flags,
  } as ContentWithRelations;
}

export const browseContent = vi.fn((input: BrowseInput) => ({
  get current() {
    return state.pages[input.page];
  },
  get error() {
    return state.errors[input.page];
  },
}));

// ── test controls ───────────────────────────────────────────────────────

/** Land one page of a catalogue `totalPages` long. */
export function setPage(
  page: number,
  items: ContentWithRelations[],
  totalPages: number
) {
  state.pages[page] = {
    items,
    pagination: { page, limit: 100, total: totalPages * 100, totalPages },
  };
  delete state.errors[page];
}

/** A one-page catalogue. */
export function setContent(items: ContentWithRelations[]) {
  setPage(1, items, items.length > 0 ? 1 : 0);
}

export function setPageError(page: number, error: unknown) {
  delete state.pages[page];
  state.errors[page] = error;
}

export function reset() {
  state.pages = {};
  state.errors = {};
  browseContent.mockClear();
}
