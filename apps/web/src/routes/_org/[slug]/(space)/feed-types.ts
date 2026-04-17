/**
 * Feed section types for the org landing page.
 *
 * The homepage is composed of typed sections, each rendered as either a
 * spread (1–2 items) or a carousel (3+ items). See +page.server.ts for
 * composition and +page.svelte for render rules.
 */

import type { getPublicContent } from '$lib/remote/content.remote';

export type ContentItem = NonNullable<
  Awaited<ReturnType<typeof getPublicContent>>
>['items'][number];

export type FeedSection = {
  /** Stable id used for #each keying. */
  id:
    | 'featured'
    | 'videos'
    | 'audio'
    | 'articles'
    | 'free'
    | `category:${string}`;
  /** Small-caps label above the section title. */
  eyebrow: string;
  /** Display title. */
  title: string;
  /** Optional "View all →" link. */
  viewAllHref?: string;
  viewAllLabel?: string;
  /**
   * Section contents. The renderer picks format by length:
   *   items.length <= 2 → stacked spreads
   *   items.length >= 3 → carousel with hero first tile
   */
  items: ContentItem[];
};
