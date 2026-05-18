/**
 * Content Collections — org-scoped factory.
 *
 * Each org gets its own TanStack DB collection keyed by `['content', orgId]`.
 * This eliminates the cross-org cache contamination class of bugs: the
 * QueryClient cache cannot return another org's data because the queryKey
 * includes the orgId.
 *
 * Use `getContentCollection(orgId)` from any page that needs reactive
 * client-side filtering / live queries over an org's catalogue.
 *
 * The cache (a Map per JS context) ensures that repeated calls for the
 * same orgId return the same collection instance — TanStack DB requires
 * collection identity for reactive subscriptions.
 */

import { createCollection } from '@tanstack/db';
import type { QueryClient } from '@tanstack/query-core';
import { queryCollectionOptions } from '@tanstack/query-db-collection';
import { listContent } from '$lib/remote/content.remote';
import type { ContentWithRelations } from '$lib/types';
import { queryClient } from './query-client';

// TanStack DB v0.5 split collection result types into `SingleResult` vs
// `NonSingleResult`; `createCollection<T, K>()` defaults to `SingleResult`
// (one-row collection), but passing `queryCollectionOptions(...)` makes it
// `NonSingleResult` (many-row catalogue). Derive the alias from the actual
// builder so the type follows the runtime shape.
function makeContentCollection(orgId: string, qc: QueryClient) {
  return createCollection<ContentWithRelations, string>(
    queryCollectionOptions({
      queryKey: ['content', orgId],
      queryFn: async () => {
        const result = await listContent({
          organizationId: orgId,
          status: 'published',
        });
        return result?.items ?? [];
      },
      queryClient: qc,
      getKey: (item) => item.id,
    })
  );
}

type ContentCollection = ReturnType<typeof makeContentCollection>;

const orgCollections = new Map<string, ContentCollection>();

/**
 * Get the org-scoped content collection.
 *
 * Returns `undefined` on the server (queryClient is undefined to prevent
 * cross-request data leaks in Cloudflare Workers' shared isolate).
 *
 * Repeated calls for the same orgId return the same collection instance,
 * so TanStack DB's live-query subscriptions remain stable across renders.
 */
export function getContentCollection(
  orgId: string
): ContentCollection | undefined {
  if (!queryClient) return undefined;
  const cached = orgCollections.get(orgId);
  if (cached) return cached;

  const collection = makeContentCollection(orgId, queryClient);
  orgCollections.set(orgId, collection);
  return collection;
}

/**
 * Load content for a specific organization (one-shot fetch — does NOT
 * populate the reactive collection). Use when you just need a server
 * response and don't want client-side reactivity.
 */
export async function loadContentForOrg(organizationId: string) {
  const result = await listContent({ organizationId, status: 'published' });
  return result?.items ?? [];
}

/**
 * Load content with custom filters (one-shot, non-reactive).
 */
export async function loadContentWithFilters(params: {
  organizationId?: string;
  status?: 'draft' | 'published' | 'archived';
  page?: number;
  limit?: number;
}) {
  return listContent(params);
}
