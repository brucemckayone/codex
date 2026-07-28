/**
 * Journey MONETISATION store (Codex-2pryk.2.4.2).
 *
 * The pending-draft spine for the two ways-in that do NOT live on the landing
 * page row: the course subscription (`course_subscription_plans` + a Stripe
 * Product/Prices) and the tier-access set (`course_tier_access`). Sibling to
 * `sell-media-store.svelte.ts`, which solved the same shape of problem for the
 * course's media refs — the route owns the lifecycle (`open()` on load → edit via
 * the pricing panel → `save()` → `close()` on destroy).
 *
 * WHY A SEPARATE STORE from `pageBuilder.pending.offer`: that bag is the page's
 * jsonb PRESENTATION of the ways-in, and treating it as the state the panel edits
 * is precisely the bug. Toggling `subscriptionEnabled` there changed a
 * presentational field and nothing else, so the panel gave positive feedback for
 * a save that could not affect what a buyer could purchase. Here the panel edits
 * state whose baseline is READ BACK from the authoritative tables, so "on" means
 * a plan row exists and "off" means it does not.
 *
 * The offer bag is still written — by `builder-save`, DERIVED from this store via
 * {@link MonetisationStore.presentationOffer} — so the sales page's teaser and
 * the product can no longer disagree.
 *
 * The ONE-OFF price is deliberately not here. It lives on `courses.price_cents`,
 * which `updateJourneyOffer` already owns; duplicating it would give one column
 * two write paths.
 *
 * IMPORT BOUNDARY (CE-4): this file sits under the scanned `$lib/page-builder`
 * PUBLIC_LIB_ROOT, so it imports ONLY remotes and types — never studio editor UI.
 */

import type { JourneyTierOption } from '$lib/page-builder/journey-queries';
import {
  getCourseMonetisation,
  updateCourseMonetisation,
} from '$lib/remote/journeys.remote';

/**
 * The editable monetisation draft. Prices are GBP pence; `null` = not set.
 *
 * `subscriptionEnabled` is kept EXPLICIT rather than derived from
 * `priceMonthlyCents !== null`, so a creator can withdraw the subscription
 * without losing the prices they typed — and putting it back on sale is one
 * click, not a re-type.
 */
export interface MonetisationDraft {
  subscriptionEnabled: boolean;
  priceMonthlyCents: number | null;
  priceAnnualCents: number | null;
  /** Exact set of org tiers that unlock the course. Kept sorted (see `#normalise`). */
  tierIds: string[];
}

/** The presentational subset the page's `offer` jsonb mirrors. */
export interface MonetisationPresentation {
  tiersEnabled: boolean;
  subscriptionEnabled: boolean;
  subscriptionPriceCents: number | null;
}

const EMPTY_DRAFT: MonetisationDraft = {
  subscriptionEnabled: false,
  priceMonthlyCents: null,
  priceAnnualCents: null,
  tierIds: [],
};

class MonetisationStore {
  /** The course whose monetisation is loaded; null when closed or page-only. */
  #courseId = $state<string | null>(null);
  /** Pending (edited) state — what a save would persist. */
  #pending = $state<MonetisationDraft>({ ...EMPTY_DRAFT });
  /** Last-persisted state, read back from the authoritative tables. */
  #saved = $state<MonetisationDraft>({ ...EMPTY_DRAFT });
  /** Every live org tier, for the picker. */
  #tierOptions = $state<JourneyTierOption[]>([]);
  #loading = $state(false);
  /**
   * True once a real baseline has been established. Until then the pending state
   * is a placeholder, NOT a draft — see {@link save}, which refuses to write it.
   */
  #loaded = $state(false);
  #loadError = $state<string | null>(null);

  get courseId(): string | null {
    return this.#courseId;
  }
  get draft(): MonetisationDraft {
    return this.#pending;
  }
  get tierOptions(): JourneyTierOption[] {
    return this.#tierOptions;
  }
  get loading(): boolean {
    return this.#loading;
  }
  get loaded(): boolean {
    return this.#loaded;
  }
  get loadError(): string | null {
    return this.#loadError;
  }

  /**
   * True when the draft differs from the persisted baseline.
   *
   * Always false while `#loaded` is false: an un-loaded placeholder must never
   * look like unsaved work, or Save would offer to persist "no plan, no tiers"
   * over live state the panel never managed to read.
   */
  get isDirty(): boolean {
    if (!this.#loaded) return false;
    const a = this.#pending;
    const b = this.#saved;
    return (
      a.subscriptionEnabled !== b.subscriptionEnabled ||
      a.priceMonthlyCents !== b.priceMonthlyCents ||
      a.priceAnnualCents !== b.priceAnnualCents ||
      a.tierIds.join(',') !== b.tierIds.join(',')
    );
  }

  /** Is this tier currently selected as a way in? */
  hasTier(tierId: string): boolean {
    return this.#pending.tierIds.includes(tierId);
  }

  /**
   * The page's jsonb `offer` mirror, derived from the SAVED (persisted) state —
   * never from the pending draft, so the bag can only ever advertise a way in
   * that really exists.
   *
   * `null` when no baseline is loaded (a page with no subject course, or a failed
   * read). The caller must then leave the bag's existing values alone rather than
   * writing a derived "everything off".
   */
  get presentationOffer(): MonetisationPresentation | null {
    if (!this.#loaded) return null;
    return {
      tiersEnabled: this.#saved.tierIds.length > 0,
      subscriptionEnabled: this.#saved.subscriptionEnabled,
      subscriptionPriceCents: this.#saved.subscriptionEnabled
        ? this.#saved.priceMonthlyCents
        : null,
    };
  }

  /**
   * Load the course's authoritative plan + tier-access state and the org's tier
   * options.
   *
   * A failed read is recorded as {@link loadError} and leaves `#loaded` false —
   * NOT degraded to an empty draft. An empty baseline is indistinguishable from
   * "no plan, no tiers", so saving it would withdraw a live plan and clear real
   * tier grants the creator never touched.
   *
   * KNOWN GAP: a WITHDRAWN plan reads back as `subscription: null` (the offer read
   * filters `isActive`), so a FRESH load of one shows empty price fields and
   * re-listing means re-entering them. Within a session the typed prices survive a
   * withdraw → re-list cycle ({@link #adopt} keeps them), so this only bites after
   * a reload. The row and its prices do survive server-side; surfacing them would
   * need a studio-only plan read, which is a separate task. Re-listing with empty
   * fields is refused with a named message, so this is friction, never a silent
   * wrong price.
   */
  async open(courseId: string | null): Promise<void> {
    this.#courseId = courseId;
    this.#loadError = null;
    this.#loaded = false;
    if (!courseId) return;

    this.#loading = true;
    try {
      const state = await getCourseMonetisation({ courseId }).catch(() => null);
      if (!state) {
        this.#loadError =
          'Could not read this journey’s current pricing — reload before changing it.';
        return;
      }
      this.#adopt({
        subscriptionEnabled: state.subscription !== null,
        priceMonthlyCents: state.subscription?.priceMonthly ?? null,
        priceAnnualCents: state.subscription?.priceAnnual ?? null,
        tierIds: state.tierIds,
      });
      this.#tierOptions = state.tierOptions;
      this.#loaded = true;
    } finally {
      this.#loading = false;
    }
  }

  /** Put the subscription on sale, or withdraw it (prices are kept either way). */
  setSubscriptionEnabled(enabled: boolean): void {
    if (this.#pending.subscriptionEnabled === enabled) return;
    this.#pending = { ...this.#pending, subscriptionEnabled: enabled };
  }

  /** Set the monthly price in pence (`null` clears it). */
  setPriceMonthly(cents: number | null): void {
    if (this.#pending.priceMonthlyCents === cents) return;
    this.#pending = { ...this.#pending, priceMonthlyCents: cents };
  }

  /** Set the annual price in pence (`null` clears it). */
  setPriceAnnual(cents: number | null): void {
    if (this.#pending.priceAnnualCents === cents) return;
    this.#pending = { ...this.#pending, priceAnnualCents: cents };
  }

  /** Add or remove one tier from the set that unlocks this course. */
  toggleTier(tierId: string): void {
    const next = this.#pending.tierIds.includes(tierId)
      ? this.#pending.tierIds.filter((id) => id !== tierId)
      : [...this.#pending.tierIds, tierId];
    this.#pending = { ...this.#pending, tierIds: [...next].sort() };
  }

  /**
   * Persist the draft. Returns silently when there is nothing to do.
   *
   * Errors PROPAGATE — the caller reports them. Swallowing here is exactly how
   * this panel came to report success on a save that changed nothing, so the
   * baseline moves only once the write has come back with the persisted state.
   */
  async save(): Promise<void> {
    const courseId = this.#courseId;
    if (!courseId || !this.#loaded || !this.isDirty) return;

    const persisted = await updateCourseMonetisation({
      courseId,
      subscriptionEnabled: this.#pending.subscriptionEnabled,
      subscriptionPriceMonthly: this.#pending.priceMonthlyCents,
      subscriptionPriceAnnual: this.#pending.priceAnnualCents,
      tierIds: this.#pending.tierIds,
    });

    this.#adopt({
      subscriptionEnabled: persisted.subscription !== null,
      priceMonthlyCents: persisted.subscription?.priceMonthly ?? null,
      priceAnnualCents: persisted.subscription?.priceAnnual ?? null,
      tierIds: persisted.tierIds,
    });
  }

  /** Reset to the closed state (the route calls this on destroy). */
  close(): void {
    this.#courseId = null;
    this.#pending = { ...EMPTY_DRAFT };
    this.#saved = { ...EMPTY_DRAFT };
    this.#tierOptions = [];
    this.#loading = false;
    this.#loaded = false;
    this.#loadError = null;
  }

  /**
   * Make `state` both the draft and the baseline — the shape after a load or a
   * successful save, when there is by definition nothing unsaved.
   *
   * A withdrawn plan comes back as `subscription: null`, which loses the prices
   * the creator typed. Those are kept so re-listing is one click: the plan row
   * itself is retained on withdrawal (only `isActive` flips), so the prices are
   * not lost server-side either.
   */
  #adopt(state: MonetisationDraft): void {
    const normalised: MonetisationDraft = {
      subscriptionEnabled: state.subscriptionEnabled,
      priceMonthlyCents:
        state.priceMonthlyCents ?? this.#pending.priceMonthlyCents,
      priceAnnualCents:
        state.priceAnnualCents ?? this.#pending.priceAnnualCents,
      tierIds: [...state.tierIds].sort(),
    };
    this.#pending = { ...normalised };
    this.#saved = { ...normalised };
  }
}

/**
 * The single monetisation store instance. Module-level like `pageBuilder` and
 * `sellMedia` — one builder is open at a time, and the pricing panel and the
 * save orchestration must see the SAME pending draft.
 */
export const monetisation = new MonetisationStore();
