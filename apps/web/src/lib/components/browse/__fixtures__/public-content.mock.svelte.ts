/**
 * Test double for `getPublicContent` in `$lib/remote/content.remote`, for
 * BrowseModule's server-backed topic filter (Codex-8swlj.4). The real module
 * imports `$app/server`, so it cannot run in jsdom.
 *
 * Every call answers with the ONE query kit's double holds (`kit-query.mock`),
 * so a test drives a read with `land` / `fail` and sees kit's own behaviour
 * around a failed first read: a Retry on it hands the module a NEW query,
 * still loading.
 *
 * A `.svelte.ts` module (runes compiled), NOT a `*.test.*` file, so it is
 * never collected as a suite.
 */

import { vi } from 'vitest';
import type { BrowseItem } from '$lib/components/browse/browse-module.types';
import {
  type KitQuery,
  kitQuery,
} from '$lib/components/studio/__fixtures__/kit-query.mock.svelte';

/**
 * A landed page. Its rows are browse-shaped already, so a test's
 * `toBrowseItem` passes them through unchanged.
 */
export interface TopicPage {
  items: BrowseItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

let kit: KitQuery<TopicPage> = kitQuery<TopicPage>();

export const getPublicContent = vi.fn((_args: unknown) => kit.get());

/** A fresh query for the next test; returns its controls. */
export function resetPublicContent(): KitQuery<TopicPage> {
  kit = kitQuery<TopicPage>();
  getPublicContent.mockClear();
  return kit;
}

/** A landed page of these rows, of `total` in all. */
export function topicPage(
  items: BrowseItem[],
  total = items.length
): TopicPage {
  return {
    items,
    pagination: {
      page: 1,
      limit: 24,
      total,
      totalPages: Math.ceil(total / 24),
    },
  };
}
