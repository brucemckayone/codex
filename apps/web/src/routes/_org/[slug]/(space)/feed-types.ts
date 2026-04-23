/**
 * Feed section types for the org landing page.
 *
 * The homepage is composed of typed sections. Each section carries an
 * explicit `layout` tag that the renderer dispatches on — this keeps
 * layout choice on the server (where we know the data shape) and the
 * template simple. See +page.server.ts for composition and +page.svelte
 * for render dispatch.
 */

import type { getPublicContent } from '$lib/remote/content.remote';

export type ContentItem = NonNullable<
  Awaited<ReturnType<typeof getPublicContent>>
>['items'][number];

/**
 * Layout contract for the landing page. Each variant renders a distinct
 * section shape:
 *
 *   spotlight  — one hero-sized item on an animated shader backdrop (anchor)
 *   spread     — 2-up editorial spread (Editor's Picks)
 *   carousel   — horizontally-scrolling row (videos, free samples)
 *   mosaic     — static grid of square tiles (audio wall)
 *   editorial  — 60/40 split: lead article spread + vertical list (articles)
 *   bento      — varied-tile grid with 2 hero + 4 minor items (Discover Mix)
 */
export type FeedLayout =
  | 'spotlight'
  | 'spread'
  | 'carousel'
  | 'mosaic'
  | 'editorial'
  | 'bento';

export type FeedSection = {
  /** Stable id used for #each keying. */
  id:
    | 'spotlight'
    | 'featured'
    | 'new-release'
    | 'videos'
    | 'audio'
    | 'articles'
    | 'free'
    | 'discover-mix';
  /** Layout dispatch tag — renderer picks the component from this. */
  layout: FeedLayout;
  /** Small-caps label above the section title. */
  eyebrow: string;
  /** Display title. */
  title: string;
  /** Optional "View all →" link. */
  viewAllHref?: string;
  viewAllLabel?: string;
  /**
   * Marks sections whose items span multiple content types (Free samples).
   * When true, the renderer normalises thumb aspect ratios
   * (typically to 16:9) so the row reads as a single rhythm instead of a
   * mix of 1:1 audio next to 16:9 video next to 3:2 article. Pure-type
   * sections (Videos / Audio / Articles) leave this undefined and keep
   * their natural per-type ratios.
   */
  mixedTypes?: boolean;
  /** Section contents. Spotlight uses `items[0]` as the hero. */
  items: ContentItem[];
};
