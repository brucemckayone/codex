/**
 * Journey builder SAVE ORCHESTRATION (Codex-xzwl5).
 *
 * Extracted out of `studio/journeys/[id]/page/+page.svelte` so the gating logic
 * is unit-testable in isolation (same reason `preview-wiring.ts` was extracted).
 *
 * WHY IT EXISTS: the save drives THREE endpoints — page copy via
 * `saveJourneyPage`, the course's subscription plan + tier access via
 * `updateCourseMonetisation` (Codex-2pryk.2.4.2), and the page's offer row via
 * `updateJourneyOffer` (which owns the authoritative `courses.price_cents`).
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
 * landed but the page's own offer row was refused. The three messages must
 * differ — a bare "failed to save" would be false for the copy, and "saved"
 * would be false for pricing.
 */
export type BuilderSaveFailureStage = 'page' | 'monetisation' | 'offer';

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
  /** Post-save cache invalidation. A rejection degrades to `staleWarning`. */
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
 * Persist the builder draft: page copy, then pricing when it changed. Never
 * throws — every outcome is reported through {@link BuilderSaveResult} so the
 * caller cannot accidentally treat a failure as a success.
 *
 * `markSaved()` runs ONLY once every write has landed, so a failed leg leaves
 * the draft dirty and retryable (a retry re-sends both legs).
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

  // Fold the persisted bag (derivation included) back into the draft BEFORE
  // promoting it, so the new baseline is what the server actually holds.
  deps.syncOffer?.(nextOffer);
  deps.markSaved();

  if (deps.refresh) {
    try {
      await deps.refresh();
    } catch (err) {
      return {
        outcome: 'saved',
        offerSaved,
        monetisationSaved,
        staleWarning:
          remoteErrorMessage(err) ??
          'Saved, but the live page may still show the previous version.',
      };
    }
  }

  return { outcome: 'saved', offerSaved, monetisationSaved };
}
