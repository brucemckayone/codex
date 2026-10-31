/**
 * Where a media item is used (Codex-6sbn1): the wire shapes of
 * `GET /api/media/:id/usage` and of the `usage` counts on each item of
 * `GET /api/media`. One lookup in `@codex/content` (`media-usage.ts`) answers
 * both, and the delete guard and the daily file purge.
 *
 * A use is LIVE when someone other than the creator can watch it: content
 * that is published or was ever released (people who bought it keep it), a
 * published course, or an org's intro video (always). A live use blocks the
 * delete; a draft use does not, and keeps its link to the deleted item so a
 * restore heals it.
 */

/** What uses the item, as the Studio draws its icon. */
export type MediaUseKind = 'film' | 'audio' | 'course' | 'intro';

/**
 * Which field holds the item: the content's one media item, a course page's
 * five sell-media slots, or the org's intro video.
 */
export type MediaUseSlot =
  | 'media'
  | 'intro'
  | 'reel'
  | 'guide_video'
  | 'hero'
  | 'guide_portrait'
  | 'org_intro';

/**
 * Why a use is live: `published` (on sale or free to watch now), `bought`
 * (taken off sale, but people who bought it can still watch), `always` (an
 * org's intro video). Null on a draft.
 */
export type MediaUseLiveReason = 'published' | 'bought' | 'always';

/**
 * Where the creator can swap in another item. Built from ids the caller's own
 * Studio already shows. Null when the caller can't change it there ("Ask an
 * admin").
 */
export type MediaUseLink =
  | {
      to: 'content';
      contentId: string;
      /** Null for personal content (the creators host). */
      orgSlug: string | null;
    }
  | {
      to: 'journey';
      /** The course's LANDING PAGE id, which the Studio route takes. */
      pageId: string;
      orgSlug: string;
    }
  | { to: 'brand'; orgSlug: string };

/** One use the caller may see named. */
export interface MediaUse {
  kind: MediaUseKind;
  slot: MediaUseSlot;
  live: boolean;
  liveReason: MediaUseLiveReason | null;
  /** The content's or course's title; for `org_intro`, the org's name. */
  title: string;
  /** Null: the creator's own profile (personal content). */
  orgName: string | null;
  link: MediaUseLink | null;
}

/** `GET /api/media/:id/usage` → `{ data: MediaUsage }`. */
export interface MediaUsage {
  /** Every use, named or not. The truth: `uses` is capped. */
  total: number;
  live: number;
  drafts: number;
  /**
   * Uses counted but named nowhere: drafts the caller neither owns nor runs
   * the org of. Included in `total`, `live` and `drafts`.
   */
  hidden: number;
  /** Live first, then drafts; at most 50 entries. */
  uses: MediaUse[];
  /**
   * Opaque. The delete sends it back as `?usage=`, and is refused with
   * `MEDIA_USAGE_CHANGED` when the uses differ from what it described.
   */
  fingerprint: string;
}

/** The `usage` counts each `GET /api/media` item carries (the library chip). */
export interface MediaUsageCounts {
  total: number;
  live: number;
}
