/**
 * Minimal, typed shape for a "Browse by topic" card — mirrors ONE row of
 * `GET /api/content/public/categories`
 * (workers/content-api/src/routes/public.ts). The endpoint never exposes the
 * raw R2 `coverImageKey`; it resolves the md variant to a CDN URL and hands
 * back `coverImageUrl` (or `null`). It also returns rows already ordered by the
 * curator's `sortOrder`, so consumers render them in array order — the card
 * itself is order-agnostic and `sortOrder` is intentionally omitted here.
 *
 * Lives in a plain `.ts` module (NOT the component's `<script module>`) so
 * consumers can `import type { TopicItem }` under plain `tsc` — an ambient
 * `*.svelte` module only declares a default export, so a `<script module>`
 * re-export trips TS2614. Mirrors `feature-carousel.types.ts`.
 *
 * Value types are `string | null` to match the endpoint exactly, and marked
 * optional so callers assembling `TopicItem[]` may simply omit them.
 */
export interface TopicItem {
  id: string;
  name: string;
  slug: string;
  /** Curator blurb. Endpoint returns `null` when unset. */
  description?: string | null;
  /**
   * Curator glyph — an emoji (the inline quick-add curation form). The public
   * API returns it as a raw `string | null`; there is no lucide name→component
   * resolver on this surface, so `TopicCard` renders it as text. Endpoint
   * returns `null` when unset.
   */
  icon?: string | null;
  /**
   * md-variant CDN URL for the topic cover, or `null` when the category has no
   * cover — in which case the card paints a brand-duotone gradient fallback.
   */
  coverImageUrl?: string | null;
}
