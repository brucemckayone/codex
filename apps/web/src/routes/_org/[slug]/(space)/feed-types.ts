/**
 * Shared content-item type for the org landing page.
 *
 * `ContentItem` is one row of the public content list — the shape every
 * landing card (`ContentCard`), the "New this week" rail, the "Editor's picks"
 * carousel, and the "Browse everything" module map from. It carries the
 * `categorySlugs` the topic filter matches against (WP-3 taxonomy).
 *
 * See +page.server.ts for the load and +page.svelte for the section wiring.
 */

import type { getPublicContent } from '$lib/remote/content.remote';

export type ContentItem = NonNullable<
  Awaited<ReturnType<typeof getPublicContent>>
>['items'][number];
