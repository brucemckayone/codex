/**
 * Journey SELL-MEDIA store (Codex-eqh0z).
 *
 * The pending-draft spine for the six media slots the sales page's `hero` /
 * `introVideo` / `reel` / `guide` sections resolve their primary content from,
 * plus the three UPLOADED stills — the card cover, the hero image (A32,
 * Codex-490z7) and the guide's signature (Codex-wqxv4's named-slot half).
 * Sibling to `page-builder-store.svelte.ts`: the route OWNS the lifecycle
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
  deleteJourneyHeroImage,
  deleteJourneySignatureImage,
  getJourneySellMedia,
  updateJourneySellMedia,
} from '$lib/remote/journeys.remote';
import { listMedia } from '$lib/remote/media.remote';
import { remoteErrorMessage } from './builder-save';

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

/**
 * Which media TYPES each slot can hold — the single source of truth for the P3
 * still-slot guard, so the panel and every section inspector filter identically.
 *
 * THE DEFECT THIS CLOSES. Three of the six slots draw a FRAME rather than play a
 * stream, and an AUDIO item has no frame BY CONSTRUCTION: `@codex/transcoding`
 * `paths.ts` returns `thumbnailKey: null` for any non-video, and the ready-row
 * CHECK asks only for a `waveformKey`. So the service's `toStill` could only ever
 * resolve an audio item to null. A creator picked an audio track for "Hero image"
 * (it was offered, with an "Audio" badge), saved, got NO error, and the hero kept
 * drawing its synthetic plate with nothing anywhere saying why.
 *
 * The three CLIP slots stay permissive on purpose: `reel`'s `waveform`
 * composition is audio-first, so tightening them would break a shipped
 * composition. Tightening the stills is the fix; tightening everything is a
 * regression.
 *
 * This is the UI half only. The write path re-checks server-side
 * (`CourseJourneyService.updateJourneySellMedia` → `assertMediaItemsInOrg`), and
 * that — not this — is the boundary.
 */
export const SLOT_ACCEPTS: Readonly<
  Record<JourneySellMediaSlot, readonly string[]>
> = {
  // Stills — a frame is required.
  heroMediaId: ['video'],
  guidePortraitMediaId: ['video'],
  signatureMediaId: ['video'],
  // Clips — a stream is played; audio is legitimate (reel · waveform).
  introVideoMediaId: ['video', 'audio'],
  previewVideoMediaId: ['video', 'audio'],
  guideVideoMediaId: ['video', 'audio'],
};

/** The six slots, all independently clearable. `null` = empty. */
export type SellMediaSlots = Record<JourneySellMediaSlot, string | null>;

/**
 * The ADDITIVE uploaded stills, as they arrive ON THE WIRE — and the reason this
 * shape has to exist at all rather than being read off `JourneySellMedia`.
 *
 * `journey-queries.ts`'s `JourneySellMedia` is a HAND-KEPT FE mirror of the
 * `@codex/shared-types` interface of the same name, and that file states in its
 * own doc comment that nothing in the build makes the pair agree (a BE package
 * cannot import an apps/web `$lib` type, which is why the twin exists). The
 * shared-types side carries `signatureImageUrl` and the worker sends it; the
 * mirror has not been given it yet, so reading it off the mirror does not
 * compile. THE REAL FIX IS ONE LINE ON THE MIRROR — handed off, not done here,
 * because that file belongs to another writer this round.
 *
 * This is NOT a type escape, and deliberately not a cast:
 *   · every field is OPTIONAL, so a mirror that lacks them satisfies it — which
 *     is exactly the deployment-skew truth anyway (an older worker omits them);
 *   · it keeps working unchanged, and stays correct, once the mirror carries the
 *     field, so nothing has to be unwound in a hurry;
 *   · it names ONLY the two additive stills. The six SLOTS are declared on the
 *     mirror and MUST stay compiler-checked — widening those is how a crossed or
 *     dropped mapping would stop being a compile error and start being a bug the
 *     tests have to catch alone.
 */
type UploadedStillsOnTheWire = {
  heroImageUrl?: string | null;
  signatureImageUrl?: string | null;
};

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
  /**
   * Resolved UPLOADED hero-image CDN URL, or null when none is uploaded
   * (Codex-490z7, A32).
   *
   * The UPLOAD only — never A32's fallback chain. If this held the hero video's
   * poster frame too, the panel could not tell "the creator uploaded an image"
   * from "a video happens to have a frame", and it would offer a Remove that
   * removes nothing.
   */
  #heroImageUrl = $state<string | null>(null);
  /**
   * Resolved UPLOADED signature-image CDN URL, or null when none is uploaded
   * (Codex-wqxv4's named-slot half).
   *
   * The UPLOAD only, for the identical reason as {@link #heroImageUrl}: if this
   * also held `signatureMediaId`'s poster frame, the panel could not tell "the
   * creator uploaded a mark" from "a film happens to have a frame", and it would
   * offer a Remove that removes nothing. `CourseSellPreview.signatureUrl` owns
   * the public chain.
   */
  #signatureImageUrl = $state<string | null>(null);
  /** The org's ready media items, for the pickers. */
  #options = $state<SellMediaOption[]>([]);
  #loading = $state(false);
  #coverBusy = $state(false);
  #heroImageBusy = $state(false);
  #signatureImageBusy = $state(false);
  /**
   * Why the last {@link open} could not read the attached media, if it could not.
   *
   * The two reads used to be `.catch(() => null)` with nothing recording the
   * reason, and `loading` was the only state a caller could see. So a FAILED
   * library read was indistinguishable from "this org has no ready media": six
   * pickers rendered their empty list, the same `media` control in every section
   * inspector did too, and the honest answer — "we could not ask" — had no
   * representation anywhere in the feature. Mirrors `monetisation.loadError`,
   * which took the same shape for the same reason.
   *
   * Fail-soft is kept: a read that fails still leaves the OTHER read's data
   * usable, because a media-library hiccup must not stop a creator editing copy.
   * What changes is that the failure is now SAYABLE.
   */
  #loadError = $state<string | null>(null);
  /**
   * True once a real baseline has been read back (mirrors `monetisation.#loaded`,
   * and for a sharper reason).
   *
   * {@link save} is a TOTAL write — every slot is sent, so an unset slot CLEARS.
   * Without a baseline the pending record is all-empty PLACEHOLDER, so a creator
   * who picked one clip after a failed read would have sent five explicit nulls
   * and wiped the journey's other five slots, live, in one press of Save.
   *
   * SO WHAT IS REFUSED IS THE WRITE, NOT THE PICK — stated precisely, because the
   * previous wording here ("the pick is refused (visibly, via loadError)") was
   * wrong in both halves and a reader acted on it. {@link setSlot} is unguarded:
   * the pick lands in `#pending` exactly as it would after a good read. What an
   * un-read store does is stay CLEAN ({@link isDirty} is hard-false without a
   * baseline) so the save orchestrator never runs the media leg, and {@link save}
   * checks `#loaded` again itself because that is the method that would do the
   * damage. The pick is therefore accepted and then dropped on close.
   *
   * The "visibly" half is now true: {@link loadError} carries the reason and
   * `PageMediaPanel` renders it above the slots, so a read failure is no longer
   * indistinguishable from an empty library. It is NOT yet true that the picker
   * refuses the pick — `MediaPicker` takes no `disabled` prop, so the panel cannot
   * lock the six slots the way `PagePricingPanel` locks its tier set on
   * `!monetisation.loaded`. Until it can, the honest reading of this state is
   * "the reason is on screen and the pick will not persist", which is what the
   * panel now says.
   */
  #loaded = $state(false);

  get pageId(): string | null {
    return this.#pageId;
  }
  get slots(): SellMediaSlots {
    return this.#pending;
  }
  get coverImageUrl(): string | null {
    return this.#coverImageUrl;
  }
  /** The UPLOADED hero image's URL, or null — see {@link #heroImageUrl}. */
  get heroImageUrl(): string | null {
    return this.#heroImageUrl;
  }
  /**
   * The UPLOADED signature's URL, or null — see {@link #signatureImageUrl}.
   */
  get signatureImageUrl(): string | null {
    return this.#signatureImageUrl;
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
  /** True while the hero image is being cleared (the upload owns its own form). */
  get heroImageBusy(): boolean {
    return this.#heroImageBusy;
  }
  /** True while the signature is being cleared — same split as the hero. */
  get signatureImageBusy(): boolean {
    return this.#signatureImageBusy;
  }
  /**
   * A creator-readable reason the media could not be read, or `null`.
   *
   * Truthy is the "did it fail?" test — never compare against a message.
   */
  get loadError(): string | null {
    return this.#loadError;
  }

  /**
   * True when a slot differs from the persisted baseline.
   *
   * Always false until a baseline was actually read ({@link #loaded}) — see that
   * field for why a total write with no baseline is destructive.
   */
  get isDirty(): boolean {
    if (!this.#loaded) return false;
    return (Object.keys(this.#pending) as JourneySellMediaSlot[]).some(
      (slot) => this.#pending[slot] !== this.#saved[slot]
    );
  }

  /** True once the attached media has been read back — see {@link #loaded}. */
  get loaded(): boolean {
    return this.#loaded;
  }

  /** Read one slot's pending value (what a picker renders as selected). */
  slot(slot: JourneySellMediaSlot): string | null {
    return this.#pending[slot];
  }

  /**
   * The picker options this slot may actually hold — see {@link SLOT_ACCEPTS}.
   *
   * Every surface with a sell-media picker calls THIS rather than reading
   * `options` directly, so the panel and the per-section inspector cannot drift
   * into offering different lists for the same slot. That drift is the same
   * two-sources-of-truth problem this whole store exists to prevent.
   */
  optionsFor(slot: JourneySellMediaSlot): SellMediaOption[] {
    const accepts = SLOT_ACCEPTS[slot];
    if (!accepts) return this.#options;
    return this.#options.filter((option) => accepts.includes(option.mediaType));
  }

  /**
   * Load the page's persisted media + the org's picker options.
   *
   * The two reads are independent, so a failure in one must not blank the other:
   * a media library that fails to list should still let the creator SEE which
   * clips are already attached (and vice versa). Both therefore fail soft to
   * their empty shape rather than throwing into the route's load — but the reason
   * is now KEPT ({@link loadError}), because "the read failed" and "you have no
   * ready media" are different facts and used to render identically.
   *
   * `hasCourse: false` skips the attached-media read entirely rather than making
   * a request that is guaranteed to fail: the slots live on the SUBJECT COURSE,
   * and the service answers `NotFoundError` ("Journey course not found") for a
   * page that has none. Firing it anyway would put a 404 in every plain landing
   * page's network log and — now that the reason is kept — show its author an
   * error about media they cannot have.
   */
  async open(
    pageId: string,
    options: { hasCourse?: boolean } = {}
  ): Promise<void> {
    const hasCourse = options.hasCourse ?? true;
    this.#pageId = pageId;
    this.#loading = true;
    this.#loadError = null;
    this.#loaded = false;
    /** Reasons, in the order the reads are declared. */
    const failures: string[] = [];
    try {
      const [media, library] = await Promise.all([
        hasCourse
          ? getJourneySellMedia({ pageId }).catch((err) => {
              failures.push(
                remoteErrorMessage(err) ??
                  'Could not read the media attached to this journey.'
              );
              return null;
            })
          : Promise.resolve(null),
        // `status: 'ready'` — an un-transcoded item has no playable rendition, so
        // offering it would let a creator attach a clip that renders as nothing.
        listMedia({ status: 'ready', limit: 100 }).catch((err) => {
          failures.push(
            remoteErrorMessage(err) ?? 'Could not list your media library.'
          );
          return null;
        }),
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
        // `?? null` because `heroImageUrl` is OPTIONAL-additive on the wire: a
        // worker deployment predating A32 omits the key entirely, and `undefined`
        // must read as "no uploaded hero", never leak into the DOM as a src.
        this.#heroImageUrl = media.heroImageUrl ?? null;
        // Same reasoning, same reason to keep it: `signatureImageUrl` is
        // optional-additive too, so a worker still serving an older dist omits
        // the key rather than sending null. `undefined` would make
        // `{#if sellMedia.signatureImageUrl}` false either way — but it would
        // also let `src={undefined}` reach the DOM if the guard were ever
        // loosened, so it is normalised HERE, once, at the wire boundary.
        this.#signatureImageUrl = media.signatureImageUrl ?? null;
      }

      this.#options = (library?.items ?? []).map((item) => ({
        id: item.id,
        title: item.title,
        mediaType: item.mediaType,
        durationSeconds: item.durationSeconds,
        fileSizeBytes: item.fileSizeBytes,
      }));

      // A RESOLVE establishes the baseline, `null` included: a course with no
      // media row legitimately reads as six empty slots, and that IS the truth to
      // diff against. Only a REJECTION leaves us without one.
      this.#loaded = hasCourse && failures.length === 0;
      this.#loadError = failures.length > 0 ? failures.join(' ') : null;
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
    // `isDirty` already carries the `#loaded` gate; the check is spelled out
    // again here because this is the method that would do the damage.
    if (!pageId || !this.#loaded || !this.isDirty) return;
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
    // The write path does not touch any of the three uploaded stills, but the
    // service echoes all three resolved from the row it just wrote — so this is a
    // refresh, not a clobber. `?? null` for the same optional-additive reason as
    // `open()`.
    this.#coverImageUrl = persisted.coverImageUrl;
    const echoed: UploadedStillsOnTheWire = persisted;
    this.#heroImageUrl = echoed.heroImageUrl ?? null;
    this.#signatureImageUrl = echoed.signatureImageUrl ?? null;
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

  /**
   * Record a hero image the PANEL has just uploaded (Codex-490z7, A32).
   *
   * Same split as {@link applyCoverUrl}, and for the same reason: a `File` cannot
   * cross a `command()` boundary (devalue cannot serialize one), so the multipart
   * `<form>` lives in the component and the store owns the resolved URL.
   */
  applyHeroImageUrl(url: string | null): void {
    this.#heroImageUrl = url;
  }

  /**
   * Clear the UPLOADED hero image.
   *
   * This does NOT blank the hero: A32's chain then falls through to
   * `heroMediaId`'s poster frame and only then to the section's synthetic plate.
   * So the panel must not describe this as "remove the hero".
   */
  async clearHeroImage(): Promise<void> {
    const pageId = this.#pageId;
    if (!pageId) return;
    this.#heroImageBusy = true;
    try {
      await deleteJourneyHeroImage({ pageId });
      this.#heroImageUrl = null;
    } finally {
      this.#heroImageBusy = false;
    }
  }

  /**
   * Record a signature the PANEL has just uploaded (Codex-wqxv4's named-slot
   * half).
   *
   * Same split as {@link applyCoverUrl} and {@link applyHeroImageUrl}, for the
   * same reason: a `File` cannot cross a `command()` boundary (devalue cannot
   * serialize one), so the multipart `<form>` lives in the component and the
   * store owns the resolved URL.
   */
  applySignatureImageUrl(url: string | null): void {
    this.#signatureImageUrl = url;
  }

  /**
   * Clear the UPLOADED signature.
   *
   * This does NOT unsign the letter: the public chain then falls through to
   * `signatureMediaId`'s poster frame, and only with neither does the letter sign
   * off with the typeset name alone. So the panel must not describe this as
   * "remove the signature".
   */
  async clearSignatureImage(): Promise<void> {
    const pageId = this.#pageId;
    if (!pageId) return;
    this.#signatureImageBusy = true;
    try {
      await deleteJourneySignatureImage({ pageId });
      this.#signatureImageUrl = null;
    } finally {
      this.#signatureImageBusy = false;
    }
  }

  /** Reset to the closed state (the route calls this on destroy). */
  close(): void {
    this.#pageId = null;
    this.#pending = { ...EMPTY_SLOTS };
    this.#saved = { ...EMPTY_SLOTS };
    this.#coverImageUrl = null;
    this.#heroImageUrl = null;
    this.#signatureImageUrl = null;
    this.#options = [];
    this.#loading = false;
    this.#coverBusy = false;
    this.#heroImageBusy = false;
    this.#signatureImageBusy = false;
    this.#loadError = null;
    this.#loaded = false;
  }
}

/**
 * The single sell-media store instance. Module-level like `pageBuilder` — one
 * builder is open at a time, and both the media panel and the section inspectors
 * must see the SAME pending draft.
 */
export const sellMedia = new SellMediaStore();
