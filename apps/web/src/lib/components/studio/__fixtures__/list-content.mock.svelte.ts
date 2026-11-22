/**
 * Reactive test double for `listContent` in `$lib/remote/content.remote`
 * (Codex-a6ofh.2.6: the New menu's drafts). The real module imports
 * `$app/server`, so it cannot load in jsdom.
 *
 * One answer for every call, as the menu makes one: still loading until it
 * is landed (`current` undefined, no `error`), or a REJECTED kit query
 * (`current` undefined, the rejection on `error`). `refresh` is a spy that
 * changes nothing, so a test lands the outcome itself.
 *
 * `useKitQuery()` opts a test into kit's own behaviour around a failed read
 * (`kit-query.mock`): a Try again on a query whose first read failed hands
 * a page that tracks it a NEW query, still loading.
 *
 * A `.svelte.ts` module (runes compiled), NOT a `*.test.*` file → never
 * collected as a suite.
 */

import { vi } from 'vitest';
import type { ContentWithRelations } from '$lib/types';
import { type KitQuery, kitQuery } from './kit-query.mock.svelte';

type ContentPage = {
  items: ContentWithRelations[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

const state = $state<{ page: ContentPage | undefined; error: unknown }>({
  page: undefined,
  error: undefined,
});

export const refreshListContent = vi.fn(async () => {});

let kit: KitQuery<ContentPage> | null = null;

/** Answer as kit 2.55 does around a failed read, until the next reset. */
export function useKitQuery(): KitQuery<ContentPage> {
  kit = kitQuery<ContentPage>();
  return kit;
}

export const listContent = vi.fn((_input?: unknown) =>
  kit
    ? kit.get()
    : {
        get current() {
          return state.page;
        },
        get error() {
          return state.error;
        },
        refresh: refreshListContent,
      }
);

// ── test controls ───────────────────────────────────────────────────────

/** Land the read: these rows, of `total` in all. */
export function landContent(
  items: ContentWithRelations[],
  total = items.length
) {
  state.error = undefined;
  state.page = {
    items,
    pagination: { page: 1, limit: items.length, total, totalPages: 1 },
  };
}

/** Reject the read, as kit does: no value, the rejection on `error`. */
export function failContent(
  error: unknown = { status: 503, body: { message: 'Down' } }
) {
  state.page = undefined;
  state.error = error;
}

export function resetListContent() {
  kit = null;
  state.page = undefined;
  state.error = undefined;
  listContent.mockClear();
  refreshListContent.mockClear();
}
