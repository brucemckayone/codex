/**
 * Journey builder SAVE ORCHESTRATION (Codex-xzwl5).
 *
 * Extracted out of `studio/journeys/[id]/page/+page.svelte` so the gating logic
 * is unit-testable in isolation.
 *
 * WHY IT EXISTS: the save drives FOUR endpoints — page copy via
 * `saveJourneyPage`, the course's subscription plan + tier access via
 * `updateCourseMonetisation` (Codex-2pryk.2.4.2), the page's offer row via
 * `updateJourneyOffer` (which owns the authoritative `courses.price_cents`), and
 * the course's sell media via `updateJourneySellMedia`.
 * The component used to `try/catch` both inline and
 * `toast.error(...)` on failure, then RETURN NORMALLY — so `handlePublish`'s
 * `await handleSave(); toast.success('Page published')` fired on a save that had
 * persisted nothing, and `handleViewLive` opened the live page showing stale
 * content while the builder showed the new content. A failed write was
 * indistinguishable from a successful one.
 *
 * So this returns an EXPLICIT, exhaustive {@link BuilderSaveResult}. Callers MUST
 * branch on `outcome` before claiming success or navigating; `'failed'` always
 * carries a creator-actionable `message`.
 *
 * The discriminant is a STRING, not a boolean `ok`: apps/web type-checks against
 * `.svelte-kit/tsconfig.json`, which leaves `strictNullChecks` off, and TS does
 * not narrow a boolean-literal discriminant by truthiness under that flag — so
 * `if (!result.ok) result.message` would not compile, while a `'failed'` compare
 * narrows under every flag combination.
 */

import type {
  PageBuilderState,
  PageOffer,
  PageSection,
} from '@codex/shared-types';

/**
 * The offer bag the write path persists: TOTAL — every path explicitly on or
 * off — where {@link PageOffer}'s fields are all optional for the render side.
 */
export interface PersistedPageOffer {
  tiersEnabled: boolean;
  subscriptionEnabled: boolean;
  subscriptionPriceCents: number | null;
  oneOffEnabled: boolean;
  oneOffPriceCents: number | null;
}

/** The page-copy payload — NAMED fields, because the save schema is `.strict()`. */
export interface SavePagePayload {
  id: string;
  pageType: string;
  slug: string;
  title: string;
  status: PageBuilderState['status'];
  subjectType: string | null;
  subjectId: string | null;
  brandOverrides: PageBuilderState['brandOverrides'];
  sections: PageSection[];
  /**
   * The page's LOOK — the design-axis bundle every section inherits per axis.
   *
   * OPTIONAL, and omitted rather than sent as `undefined` when the draft has
   * none: the service reads absence as "leave the stored bundle alone", so a
   * draft loaded before F-B2's read path existed cannot wipe a page's look.
   */
  design?: PageBuilderState['design'];
  /**
   * The page's SEO / share metadata.
   *
   * OPTIONAL and omitted rather than sent as `undefined` for the same reason
   * `design` is: the service reads absence as "leave the stored bag alone".
   * Clearing a field is the empty STRING, which IS sent — so a `.min(1)`
   * anywhere on this bag would make a cleared meta description unsaveable.
   *
   * TYPECHECK CANNOT CATCH the omission of this field from the `savePage` call
   * below, because an absent optional property is legal. That omission is
   * precisely the silent swallow the panel's `disabled` attribute was
   * defending against, so the guard here is `builder-save.test.ts`, not the
   * compiler.
   */
  seo?: PageBuilderState['seo'];
}

/**
 * Which leg failed. `page` = nothing persisted at all. `monetisation` = the copy
 * landed but the subscription plan / tier access was refused. `offer` = both
 * landed but the page's own offer row was refused. `media` = copy and pricing
 * landed but the course's sell media was refused. The four messages must
 * differ — a bare "failed to save" would be false for the copy, and "saved"
 * would be false for pricing.
 */
export type BuilderSaveFailureStage =
  | 'page'
  | 'monetisation'
  | 'offer'
  | 'media';

/**
 * The page's jsonb `offer` mirror as DERIVED from the authoritative monetisation
 * tables (Codex-2pryk.2.4.2). Structurally identical to
 * `MonetisationPresentation` in the monetisation store, redeclared here so this
 * module stays a pure, store-free orchestrator (it is unit-tested with plain
 * objects, and importing a `.svelte.ts` would drag the rune runtime in).
 */
export interface DerivedOfferPresentation {
  tiersEnabled: boolean;
  subscriptionEnabled: boolean;
  subscriptionPriceCents: number | null;
}

/**
 * The monetisation leg: the two ways-in that live on the COURSE, not the page —
 * the subscription plan (a Stripe Product + Prices) and the tier-access set.
 *
 * Injected as a narrow port rather than by importing the store, so the whole
 * sequencing is testable with plain fakes.
 */
export interface MonetisationLeg {
  /** Skip the write when the creator changed nothing. */
  isDirty: boolean;
  /** Persist the plan + tier set. Rejects on refusal; must not swallow. */
  save(): Promise<unknown>;
  /**
   * The presentation to mirror into the page's `offer` bag, derived from the
   * PERSISTED state — `null` when no authoritative baseline is loaded (a page
   * with no subject course, or a failed read), in which case the bag's existing
   * values are left alone rather than overwritten with a derived "all off".
   */
  presentation(): DerivedOfferPresentation | null;
}

/**
 * The SELL-MEDIA leg: the six media slots that live on the COURSE
 * (`courses.*MediaId` + the guide bag), not on the page row.
 *
 * WHY IT IS A LEG HERE AND NOT A SECOND STEP IN THE COMPONENT. It used to run in
 * `+page.svelte` AFTER this function returned, which put it behind the caller's
 * own `staleWarning` early return: when `refresh()` (an `invalidate`, which
 * re-runs every dependent load and therefore rejects whenever ANY of them throws)
 * failed, the component toasted the staleness warning, returned `true`, and NEVER
 * ATTEMPTED THE MEDIA WRITE. `handlePublish` then said "Page published" over a
 * page whose media had never been sent — the exact class of false success this
 * whole module exists to make impossible. Inside the sequence it cannot be
 * skipped, and it lands BEFORE `markSaved()`, so a refusal leaves the draft dirty
 * and retryable like every other leg.
 */
export interface SellMediaLeg {
  /** Skip the write when no slot changed. */
  isDirty: boolean;
  /** Persist the slots. Rejects on refusal; must not swallow. */
  save(): Promise<unknown>;
}

/**
 * WHICH authoritative reads this save moved — the argument to
 * {@link BuilderSaveDeps.refreshQueries}.
 *
 * Two flags, not five, and not one: the builder holds five client queries, and
 * only these two answer anything this save writes. `getJourneyForBuilder` is the
 * draft that `markSaved()` just promoted (the server now holds exactly what the
 * store holds, so a re-read cannot say anything new), while
 * `getCourseCurriculum` and `getCoursePagePreview` answer course facts no leg
 * here touches. Refreshing those would spend round trips to learn nothing.
 */
export interface BuilderRefreshScope {
  /**
   * The authoritative pricing read (`getCourseOffer`) — true when the offer leg
   * and/or the monetisation leg ran. BOTH move it: `CourseOffer.purchase` mirrors
   * the `courses.price_cents` the offer leg writes, and `.subscription` / `.tiers`
   * / `.paths` mirror the plan and tier-access set the monetisation leg writes.
   */
  offer: boolean;
  /**
   * The sell-media read (`resolveSellPreview`) — true when the media leg ran. It
   * carries no pricing, so a pricing-only save must not spend it.
   */
  media: boolean;
}

export type BuilderSaveResult =
  | {
      outcome: 'saved';
      /** True when the offer leg actually ran (it is skipped when unchanged). */
      offerSaved: boolean;
      /** True when the plan / tier-access leg actually ran. */
      monetisationSaved: boolean;
      /**
       * Set when everything PERSISTED but the post-save cache invalidation
       * failed: the writes landed, so this is not a failure, but the studio's
       * own cached reads may lag. Surfaced as a warning, never as an error.
       */
      staleWarning?: string;
    }
  | {
      outcome: 'failed';
      stage: BuilderSaveFailureStage;
      message: string;
    };

export interface BuilderSaveDeps {
  /** The `landing_pages.id` being saved (the persisted row's id, not the slug). */
  pageId: string;
  /** The builder's pending draft snapshot (`pageBuilder.getSavePayload()`). */
  payload: PageBuilderState;
  /** The last-saved offer baseline — the offer leg is skipped when unchanged. */
  savedOffer: PageOffer | undefined;
  savePage(input: SavePagePayload): Promise<unknown>;
  saveOffer(input: {
    pageId: string;
    offer: PersistedPageOffer;
  }): Promise<unknown>;
  /**
   * The course's plan + tier-access leg. Optional: a plain landing page has no
   * subject course, so there is nothing to monetise.
   */
  monetisation?: MonetisationLeg;
  /**
   * The course's sell-media leg. Optional for the same reason `monetisation` is:
   * a plain landing page has no subject course, so it has no media slots.
   */
  sellMedia?: SellMediaLeg;
  /**
   * Re-read the studio's OWN client queries for the resources this save wrote.
   *
   * WHY THIS EXISTS SEPARATELY FROM {@link BuilderSaveDeps.refresh}. `refresh` is
   * an `invalidate(resource)`, and that re-runs `load` functions ONLY: SvelteKit
   * re-runs remote `query()` functions from a `_invalidate()` pass exclusively
   * when its internal `force_invalidation` flag is set, and the only two things
   * that set it are `invalidateAll()` and `refreshAll()` — never
   * `invalidate('cache:versions')` (`@sveltejs/kit` `client.js`: the
   * `if (force_invalidation) { query_map.forEach(...refresh()) }` block).
   *
   * So without this the builder's own canvas kept showing PRE-SAVE pricing and
   * PRE-SAVE media until a hard reload, while its toast said the page was saved —
   * the canvas contradicting the page it would publish, which is the same class of
   * lie as reporting success over a write that never landed. The two reads that
   * go stale are the authoritative ones the canvas is deliberately fed instead of
   * the draft's own presentation bag, so their staleness is invisible: they render
   * a plausible older number rather than nothing.
   *
   * NOT `invalidateAll()`, which would also re-run every `load` on the route for
   * data this save did not touch. The scope says which reads actually moved, and
   * this is called ONLY when at least one of them did.
   */
  refreshQueries?(scope: BuilderRefreshScope): Promise<unknown>;
  /**
   * Write the offer bag that was actually persisted back into the draft, so the
   * saved baseline includes the DERIVED presentation fields.
   *
   * Without this the derivation would be recomputed on every save and always
   * differ from a baseline that never carried it — re-sending the offer write on
   * every press, under a `strict` rate limit, forever.
   */
  syncOffer?(offer: PersistedPageOffer): void;
  /** Promote pending → saved. Runs only once EVERY leg has landed. */
  markSaved(): void;
  /**
   * Post-save cache invalidation for the `load` functions that `depends()` on the
   * cache-version key. A rejection degrades to `staleWarning`.
   *
   * LOADS ONLY. It does not re-read the route's remote queries — see
   * {@link BuilderSaveDeps.refreshQueries}, which exists precisely because this
   * one silently does not.
   */
  refresh?(): Promise<unknown>;
}

/**
 * Pull the human message out of a failed remote call. A `command()` that failed
 * via SvelteKit's `error(status, message)` arrives as `{ body: { message } }`,
 * NOT as `err.message` — reading only the latter is why a precise service
 * message ("Set a one-off price…") shows up as a blank/generic failure.
 */
export function remoteErrorMessage(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'body' in err) {
    const body = (err as { body?: unknown }).body;
    if (body && typeof body === 'object' && 'message' in body) {
      const message = (body as { message?: unknown }).message;
      if (typeof message === 'string' && message) return message;
    }
  }
  return err instanceof Error && err.message ? err.message : undefined;
}

/** Normalise the render-side {@link PageOffer} into the total persisted bag. */
export function toPersistedOffer(offer: PageOffer): PersistedPageOffer {
  return {
    tiersEnabled: offer.tiersEnabled ?? false,
    subscriptionEnabled: offer.subscriptionEnabled ?? false,
    subscriptionPriceCents: offer.subscriptionPriceCents ?? null,
    oneOffEnabled: offer.oneOffEnabled ?? false,
    oneOffPriceCents: offer.oneOffPriceCents ?? null,
  };
}

/**
 * Mirror the authoritative monetisation state into the offer bag.
 *
 * The three overwritten fields are PRESENTATION — which ways-in the sales page
 * teases. Their authority is `course_subscription_plans` / `course_tier_access`,
 * so they are derived here rather than read from the panel's own toggles: that is
 * what makes a bag advertising a subscription with no plan behind it
 * unrepresentable instead of merely unlikely.
 *
 * `oneOff*` is untouched — it mirrors `courses.price_cents`, which the offer
 * endpoint itself writes, so the bag IS its presentation and its authority moves
 * in the same transaction.
 */
function withDerivedPresentation(
  offer: PersistedPageOffer,
  derived: DerivedOfferPresentation | null
): PersistedPageOffer {
  if (!derived) return offer;
  return {
    ...offer,
    tiersEnabled: derived.tiersEnabled,
    subscriptionEnabled: derived.subscriptionEnabled,
    subscriptionPriceCents: derived.subscriptionPriceCents,
  };
}

/**
 * Has the offer changed against the saved baseline? Pricing is a commerce
 * mutation under a `strict` rate limit, not something every copy edit should
 * spend — so the offer leg only runs when the creator actually changed it.
 *
 * Compares NORMALISED bags field by field. The previous `JSON.stringify`
 * comparison was key-order sensitive and compared a partial {@link PageOffer}
 * against a total one, so a semantically identical offer could re-send (or, worse,
 * a real change could compare equal) purely on key order.
 */
function offerChanged(
  offer: PersistedPageOffer,
  savedOffer: PageOffer | undefined
): boolean {
  const saved = toPersistedOffer(savedOffer ?? {});
  return (
    offer.tiersEnabled !== saved.tiersEnabled ||
    offer.subscriptionEnabled !== saved.subscriptionEnabled ||
    offer.subscriptionPriceCents !== saved.subscriptionPriceCents ||
    offer.oneOffEnabled !== saved.oneOffEnabled ||
    offer.oneOffPriceCents !== saved.oneOffPriceCents
  );
}

/**
 * Persist the builder draft: page copy, then pricing when it changed, then the
 * sell media when a slot changed. Never throws — every outcome is reported
 * through {@link BuilderSaveResult} so the caller cannot accidentally treat a
 * failure as a success.
 *
 * `markSaved()` runs ONLY once every write has landed, so a failed leg leaves
 * the draft dirty and retryable (a retry re-sends every leg).
 *
 * EVERY WRITE BELONGS INSIDE THIS SEQUENCE. A leg the caller runs after this
 * function returns is a leg the caller can skip — which is precisely what
 * happened to the media write behind the `staleWarning` early return (see
 * {@link SellMediaLeg}).
 */
export async function saveBuilderDraft(
  deps: BuilderSaveDeps
): Promise<BuilderSaveResult> {
  const { payload } = deps;

  try {
    await deps.savePage({
      id: deps.pageId,
      pageType: payload.pageType,
      slug: payload.slug,
      title: payload.title,
      status: payload.status,
      subjectType: payload.subjectType,
      subjectId: payload.subjectId,
      brandOverrides: payload.brandOverrides,
      sections: payload.sections,
      // Spread-when-present: the save body is `.strict()`, and Zod strips a
      // literal `undefined` fine — but the SERVICE distinguishes absent (leave
      // the stored look alone) from set, so an explicit `design: undefined` would
      // still be the wrong thing to express here.
      ...(payload.design ? { design: payload.design } : {}),
      // Same spread-when-present contract as `design`, and for the same reason:
      // absent means "leave the stored SEO bag alone", so a draft loaded before
      // the `seo` column existed cannot wipe a page's metadata.
      ...(payload.seo ? { seo: payload.seo } : {}),
    });
  } catch (err) {
    return {
      outcome: 'failed',
      stage: 'page',
      message: remoteErrorMessage(err) ?? 'Failed to save page',
    };
  }

  // The monetisation leg goes BEFORE the offer leg, and that order is
  // load-bearing. It is the leg that talks to Stripe, and the offer bag it feeds
  // is derived from what it PERSISTED — so if the plan is refused (no Connect
  // account, a price below £1), the bag is never updated to advertise a
  // subscription that has no Stripe Product behind it.
  let monetisationSaved = false;
  if (deps.monetisation?.isDirty) {
    try {
      await deps.monetisation.save();
      monetisationSaved = true;
    } catch (err) {
      const why = remoteErrorMessage(err);
      return {
        outcome: 'failed',
        stage: 'monetisation',
        message: why
          ? `Page saved, but the pricing was not: ${why}`
          : 'Page saved, but the subscription and tier access could not be saved.',
      };
    }
  }

  // One bag, assembled from two authorities: the panel's own one-off fields plus
  // the derived mirror of the plan + tier state that just landed.
  const nextOffer = withDerivedPresentation(
    toPersistedOffer(payload.offer ?? {}),
    deps.monetisation?.presentation() ?? null
  );

  let offerSaved = false;
  if (offerChanged(nextOffer, deps.savedOffer)) {
    try {
      await deps.saveOffer({ pageId: deps.pageId, offer: nextOffer });
      offerSaved = true;
    } catch (err) {
      // The page copy DID save; only pricing was refused (e.g. an enabled path
      // with no price). Say exactly that.
      const why = remoteErrorMessage(err);
      return {
        outcome: 'failed',
        stage: 'offer',
        message: why
          ? `Page saved, but the pricing was not: ${why}`
          : 'Page saved, but the pricing could not be saved.',
      };
    }
  }

  // The sell media is the FOURTH resource (it writes `courses.*MediaId`, not the
  // page row) and only sends when a slot actually changed. Same partial-success
  // discipline as pricing: on refusal, say what DID save and report the failure,
  // so `handlePublish`/`handleViewLive` do not proceed on a half-written page. A
  // foreign media id lands here as a 403 carrying the service's own message.
  //
  // LAST, and before `markSaved()`: the media write is the only leg whose refusal
  // the creator can fix without touching the copy, so it is the cheapest one to
  // leave for last — and a refusal must still leave the draft dirty, because the
  // slots live in a separate store whose own `isDirty` is what re-sends them.
  let mediaSaved = false;
  if (deps.sellMedia?.isDirty) {
    try {
      await deps.sellMedia.save();
      mediaSaved = true;
    } catch (err) {
      const why = remoteErrorMessage(err);
      return {
        outcome: 'failed',
        stage: 'media',
        message: why
          ? `Page saved, but the media was not: ${why}`
          : 'Page saved, but the media could not be saved.',
      };
    }
  }

  // Fold the persisted bag (derivation included) back into the draft BEFORE
  // promoting it, so the new baseline is what the server actually holds.
  deps.syncOffer?.(nextOffer);
  deps.markSaved();

  const staleWarning = await refreshReads(deps, {
    offer: offerSaved || monetisationSaved,
    media: mediaSaved,
  });
  if (staleWarning) {
    return { outcome: 'saved', offerSaved, monetisationSaved, staleWarning };
  }

  return { outcome: 'saved', offerSaved, monetisationSaved };
}

/**
 * Re-read everything the save invalidated: the studio's own client queries for
 * the resources that moved, and the `load` functions that `depends()` on the
 * cache-version key.
 *
 * BOTH ALWAYS RUN, even when the first rejects, and that is the same lesson the
 * media leg taught: a read placed after something that can bail is a read that
 * gets skipped. A rejected `invalidate` (any `load` it re-runs throwing is
 * enough, for reasons having nothing to do with this save) must not be what
 * leaves the canvas showing last week's price.
 *
 * @returns the warning to surface, or `undefined` when every read landed. Never
 *   a failure: the writes are already committed by the time this runs, so the
 *   worst truthful thing to say is that the studio's reads may lag.
 */
async function refreshReads(
  deps: BuilderSaveDeps,
  scope: BuilderRefreshScope
): Promise<string | undefined> {
  const reads: Promise<unknown>[] = [];
  // Only when something actually moved — an all-false scope has nothing to
  // re-read, and calling with one would make "was a refresh needed?" unanswerable
  // from the call itself.
  if (deps.refreshQueries && (scope.offer || scope.media)) {
    reads.push(Promise.resolve().then(() => deps.refreshQueries?.(scope)));
  }
  if (deps.refresh) {
    reads.push(Promise.resolve().then(() => deps.refresh?.()));
  }

  const settled = await Promise.allSettled(reads);
  for (const outcome of settled) {
    if (outcome.status === 'rejected') {
      return (
        remoteErrorMessage(outcome.reason) ??
        'Saved, but the live page may still show the previous version.'
      );
    }
  }
  return undefined;
}
