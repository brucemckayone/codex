/**
 * Typed shapes for the "Browse everything" hybrid module (WP-10).
 *
 * Lives in a plain `.ts` module (NOT `BrowseModule.svelte`'s `<script module>`)
 * so consumers can `import type { BrowseItem, BrowseType }` under plain `tsc` —
 * an ambient `*.svelte` module only declares a default export, so a
 * `<script module>` re-export trips TS2614. Mirrors `feature-carousel.types.ts`
 * and `topic-card.types.ts`.
 */

/**
 * The type-tab filter axis. `'all'` is the unfiltered default (rails view);
 * the three concrete values narrow the catalogue to a single content type.
 *
 * NOTE the vocabulary: the backend/DB stores articles as `'written'`
 * (`getPublicContent` item `.contentType`), but this surface — and the
 * `ContentCard` it feeds — speaks `'article'`. WP-11 maps `'written' →
 * 'article'` when it builds `BrowseItem[]`, so `BrowseModule` never sees the
 * raw DB value.
 */
export type BrowseType = 'all' | 'video' | 'audio' | 'article';

/**
 * One catalogue entry, already flattened to exactly what a browse-surface
 * `ContentCard` renders. Mirrors the props the landing's existing `gridCard`
 * snippet passes (`(space)/+page.svelte`) so WP-11's `ContentItem → BrowseItem`
 * mapping is a 1:1 field copy — the mapping's only real work is:
 *   1. `contentType`: `'written' → 'article'`,
 *   2. `href`: `buildContentUrl(page.url, content)`,
 *   3. `categorySlugs`: the item's `content_categories` membership (WP-3 data).
 *
 * Kept intentionally minimal (no `any`); every optional field is guarded by
 * `ContentCard`, which treats the same fields as optional.
 */
export interface BrowseItem {
  id: string;
  title: string;
  /** Resolved content-detail URL. WP-11 builds this with `buildContentUrl`. */
  href: string;
  /** Card-vocabulary type (`'written'` already mapped to `'article'`). */
  contentType: 'video' | 'audio' | 'article';
  thumbnail?: string | null;
  description?: string | null;
  /** Playback/reading duration in seconds. */
  duration?: number | null;
  creator?: {
    username?: string;
    displayName?: string;
    avatar?: string | null;
  };
  price?: {
    amount: number;
    currency: string;
  } | null;
  /** Human-readable category label shown as the card's overlay tag. */
  category?: string | null;
  /**
   * Category slugs this item belongs to (many-to-many, WP-1 taxonomy). Drives
   * the topic filter: an item matches the active topic when this array includes
   * the active category slug.
   *
   * WP-11 MUST populate this from `content_categories`. Today `getPublicContent`
   * items carry no slugs, so until that wiring lands the topic filter matches
   * nothing (empty grid) — the type-tab filter is fully functional regardless.
   */
  categorySlugs?: string[];
  /** Creator-flagged feature (DB `content.featured`) — glow + star on the card. */
  featured?: boolean;
  /** Content-level access strategy, forwarded to the card's PriceBadge. */
  contentAccessType?:
    | 'free'
    | 'paid'
    | 'followers'
    | 'subscribers'
    | 'team'
    | null;
  /** Whether the viewer's subscription/membership covers this item. */
  included?: boolean;
  /** Whether the viewer follows this org (contextualises the followers badge). */
  isFollower?: boolean;
  /** Resolved tier name for subscriber-gated content. */
  tierName?: string | null;
}

/** A curated topic, as surfaced in the filter chip. */
export interface BrowseCategory {
  slug: string;
  name: string;
}
