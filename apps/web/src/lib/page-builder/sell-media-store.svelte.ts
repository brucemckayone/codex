/**
 * Journey SELL-MEDIA store (Codex-eqh0z).
 *
 * The pending-draft spine for the six media slots the sales page's `hero` /
 * `introVideo` / `reel` / `guide` sections resolve their primary content from,
 * plus the still cover. Sibling to `page-builder-store.svelte.ts`: the route OWNS the lifecycle
 * (`open()` on load → edit via the panel or a section inspector → `save()` →
 * `close()` on destroy), and every surface that can set media reads and writes
 * THIS store, so the media panel and the per-section pickers can never disagree
 * about what is pending.
 *
 * Why a store rather than props: the pickers live in two places at once — the
 * `PageMediaPanel` (the slots together) and the per-section inspector
 * (`SectionEditor`'s `media` control, which sets the slot its section renders).
 * Threading the same pending state through two component trees would mean two
 * sources of truth for one save.
 *
 * IMPORT BOUNDARY (CE-4): this file sits under the scanned `$lib/page-builder`
 * PUBLIC_LIB_ROOT, so it imports ONLY remotes and types — never studio editor UI
 * (`$lib/components/page-builder/**`), which would leak the editor into the
 * public bundle. The editor components import THIS, never the reverse.
 */

import {
  deleteJourneyCover,
  getJourneySellMedia,
  updateJourneySellMedia,
} from '$lib/remote/journeys.remote';
import { listMedia } from '$lib/remote/media.remote';

/**
 * The six course columns a picker can target.
 *
 * `heroMediaId` and `signatureMediaId` are contract amendment A27 (Codex-wqxv4).
 * Three of the six are real `courses` columns, `guidePortraitMediaId` lives in
 * the `guide` jsonb bag and the two A27 slots are real columns again — but that
 * asymmetry is entirely the service's to hide: every slot here is a flat
 * `mediaId` the pickers set identically.
 */
export type JourneySellMediaSlot =
  | 'introVideoMediaId'
  | 'previewVideoMediaId'
  | 'guideVideoMediaId'
  | 'guidePortraitMediaId'
  | 'heroMediaId'
  | 'signatureMediaId';

/** The `media_items` projection the pickers render (matches `MediaPicker`). */
export interface SellMediaOption {
  id: string;
  title: string;
  mediaType: string;
  durationSeconds?: number | null;
  fileSizeBytes?: number | null;
}

/** The six slots, all independently clearable. `null` = empty. */
export type SellMediaSlots = Record<JourneySellMediaSlot, string | null>;

const EMPTY_SLOTS: SellMediaSlots = {
  introVideoMediaId: null,
  previewVideoMediaId: null,
  guideVideoMediaId: null,
  guidePortraitMediaId: null,
  heroMediaId: null,
  signatureMediaId: null,
};

class SellMediaStore {
  /** The page whose media is loaded; null when closed. */
  #pageId = $state<string | null>(null);
  /** Pending (edited) slots — what a save would persist. */
  #pending = $state<SellMediaSlots>({ ...EMPTY_SLOTS });
  /** Last-persisted slots — the dirty baseline. */
  #saved = $state<SellMediaSlots>({ ...EMPTY_SLOTS });
  /** Resolved cover CDN URL, or null when there is none. */
  #coverImageUrl = $state<string | null>(null);
  /** The org's ready media items, for the pickers. */
  #options = $state<SellMediaOption[]>([]);
  #loading = $state(false);
  #coverBusy = $state(false);

  get pageId(): string | null {
    return this.#pageId;
  }
  get slots(): SellMediaSlots {
    return this.#pending;
  }
  get coverImageUrl(): string | null {
    return this.#coverImageUrl;
  }
  get options(): SellMediaOption[] {
    return this.#options;
  }
  get loading(): boolean {
    return this.#loading;
  }
  get coverBusy(): boolean {
    return this.#coverBusy;
  }

  /** True when a slot differs from the persisted baseline. */
  get isDirty(): boolean {
    return (Object.keys(this.#pending) as JourneySellMediaSlot[]).some(
      (slot) => this.#pending[slot] !== this.#saved[slot]
    );
  }

  /** Read one slot's pending value (what a picker renders as selected). */
  slot(slot: JourneySellMediaSlot): string | null {
    return this.#pending[slot];
  }

  /**
   * Load the page's persisted media + the org's picker options.
   *
   * The two reads are independent, so a failure in one must not blank the other:
   * a media library that fails to list should still let the creator SEE which
   * clips are already attached (and vice versa). Both therefore fail soft to
   * their empty shape rather than throwing into the route's load.
   */
  async open(pageId: string): Promise<void> {
    this.#pageId = pageId;
    this.#loading = true;
    try {
      const [media, library] = await Promise.all([
        getJourneySellMedia({ pageId }).catch(() => null),
        // `status: 'ready'` — an un-transcoded item has no playable rendition, so
        // offering it would let a creator attach a clip that renders as nothing.
        listMedia({ status: 'ready', limit: 100 }).catch(() => null),
      ]);

      if (media) {
        const slots: SellMediaSlots = {
          introVideoMediaId: media.introVideoMediaId,
          previewVideoMediaId: media.previewVideoMediaId,
          guideVideoMediaId: media.guideVideoMediaId,
          guidePortraitMediaId: media.guidePortraitMediaId,
          heroMediaId: media.heroMediaId,
          signatureMediaId: media.signatureMediaId,
        };
        this.#pending = { ...slots };
        this.#saved = { ...slots };
        this.#coverImageUrl = media.coverImageUrl;
      }

      this.#options = (library?.items ?? []).map((item) => ({
        id: item.id,
        title: item.title,
        mediaType: item.mediaType,
        durationSeconds: item.durationSeconds,
        fileSizeBytes: item.fileSizeBytes,
      }));
    } finally {
      this.#loading = false;
    }
  }

  /** Set (or with `null`, clear) one slot in the pending draft. */
  setSlot(slot: JourneySellMediaSlot, mediaId: string | null): void {
    // Idempotent: Melt-based pickers echo their value on mount/sync, so a
    // no-op write must not mark the draft dirty.
    if (this.#pending[slot] === mediaId) return;
    this.#pending = { ...this.#pending, [slot]: mediaId };
  }

  /**
   * Persist the pending slots. Returns the saved shape.
   *
   * Errors PROPAGATE — the caller reports them. Swallowing here is exactly how
   * the pricing panel came to report success on a failed save, so this method
   * only marks the baseline once the write has actually come back.
   */
  async save(): Promise<void> {
    const pageId = this.#pageId;
    if (!pageId || !this.isDirty) return;
    const persisted = await updateJourneySellMedia({
      pageId,
      media: this.#pending,
    });
    const slots: SellMediaSlots = {
      introVideoMediaId: persisted.introVideoMediaId,
      previewVideoMediaId: persisted.previewVideoMediaId,
      guideVideoMediaId: persisted.guideVideoMediaId,
      guidePortraitMediaId: persisted.guidePortraitMediaId,
      heroMediaId: persisted.heroMediaId,
      signatureMediaId: persisted.signatureMediaId,
    };
    this.#pending = { ...slots };
    this.#saved = { ...slots };
    this.#coverImageUrl = persisted.coverImageUrl;
  }

  /**
   * Record a cover the PANEL has just uploaded.
   *
   * The upload itself is a `form()` submission owned by the panel rather than a
   * method here, because a `File` cannot cross a `command()` boundary — devalue
   * cannot serialize one, so the multipart `<form>` has to live in the component
   * (see `uploadJourneyCoverForm`). The store still owns the resolved URL, so the
   * card preview and the save payload read one source rather than two.
   *
   * Immediate, and deliberately NOT part of the page save: a multipart upload
   * has a different failure mode from a JSON patch.
   */
  applyCoverUrl(url: string | null): void {
    this.#coverImageUrl = url;
  }

  /** Clear the cover — the journey card falls back to its typographic form. */
  async clearCover(): Promise<void> {
    const pageId = this.#pageId;
    if (!pageId) return;
    this.#coverBusy = true;
    try {
      await deleteJourneyCover({ pageId });
      this.#coverImageUrl = null;
    } finally {
      this.#coverBusy = false;
    }
  }

  /** Reset to the closed state (the route calls this on destroy). */
  close(): void {
    this.#pageId = null;
    this.#pending = { ...EMPTY_SLOTS };
    this.#saved = { ...EMPTY_SLOTS };
    this.#coverImageUrl = null;
    this.#options = [];
    this.#loading = false;
    this.#coverBusy = false;
  }
}

/**
 * The single sell-media store instance. Module-level like `pageBuilder` — one
 * builder is open at a time, and both the media panel and the section inspectors
 * must see the SAME pending draft.
 */
export const sellMedia = new SellMediaStore();
