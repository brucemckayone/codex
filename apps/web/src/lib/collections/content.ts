/**
 * Content Collection
 *
 * TanStack DB collection for content data with live queries.
 * Powered by listContent() remote function.
 * Enables sub-ms client-side queries, filtering, and joins.
 */

import { createCollection } from '@tanstack/db';
import { queryCollectionOptions } from '@tanstack/query-db-collection';
import { listContent } from '$lib/remote/content.remote';
import type { ContentWithRelations } from '$lib/types';
import { queryClient } from './query-client';

/**
 * Content Collection
 *
 * Local-first store for content data.
 * Automatically syncs with server via listContent() remote function.
 *
 * Usage:
 * ```svelte
 * <script>
 *   import { useLiveQuery, contentCollection, eq } from '$lib/collections';
 *
 *   const publishedContent = useLiveQuery((q) =>
 *     q.from({ content: contentCollection })
 *      .where(({ content }) => eq(content.status, 'published'))
 *   );
 * </script>
 * ```
 */
export const contentCollection = createCollection<ContentWithRelations, string>(
  queryCollectionOptions({
    queryKey: ['content'],

    // Load data via remote function
    queryFn: async () => {
      const result = await listContent({ status: 'published' });
      return result?.items ?? [];
    },

    queryClient,
    getKey: (item) => item.id,
  })
);

/**
 * Load content for a specific organization
 *
 * Use when you need server-side filtering by organization.
 * The results are NOT automatically added to the collection.
 *
 * @param organizationId - The organization ID to filter by
 * @returns Promise with content items
 */
export async function loadContentForOrg(organizationId: string) {
  const result = await listContent({ organizationId, status: 'published' });
  return result?.items ?? [];
}

/**
 * Load content with custom filters
 *
 * For advanced use cases where you need specific server-side filtering.
 *
 * @param params - Query parameters for content listing
 * @returns Promise with paginated content response
 */
export async function loadContentWithFilters(params: {
  organizationId?: string;
  status?: 'draft' | 'published' | 'archived';
  page?: number;
  limit?: number;
}) {
  return listContent(params);
}
