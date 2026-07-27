/**
 * Journey builder SAVE ORCHESTRATION (Codex-xzwl5).
 *
 * Extracted out of `studio/journeys/[id]/page/+page.svelte` so the gating logic
 * is unit-testable in isolation (same reason `preview-wiring.ts` was extracted).
 *
 * WHY IT EXISTS: the save drives TWO endpoints — page copy via `saveJourneyPage`
 * and pricing via `updateJourneyOffer` (which owns the authoritative
 * `courses.price_cents`). The component used to `try/catch` both inline and
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
}

/**
 * Which leg failed. `page` = nothing persisted at all. `offer` = the copy landed
 * but the pricing was refused, so the two messages must differ — a bare "failed
 * to save" would be false for the copy, and "saved" would be false for pricing.
 */
export type BuilderSaveFailureStage = 'page' | 'offer';

export type BuilderSaveResult =
  | {
      outcome: 'saved';
      /** True when the offer leg actually ran (it is skipped when unchanged). */
      offerSaved: boolean;
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
  /** Promote pending → saved. Runs only once BOTH legs have landed. */
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
 * Has the offer changed against the saved baseline? Pricing is a commerce
 * mutation under a `strict` rate limit, not something every copy edit should
 * spend — so the offer leg only runs when the creator actually changed it.
 */
function offerChanged(
  offer: PageOffer | undefined,
  savedOffer: PageOffer | undefined
): boolean {
  if (!offer) return false;
  return JSON.stringify(offer) !== JSON.stringify(savedOffer);
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
    });
  } catch (err) {
    return {
      outcome: 'failed',
      stage: 'page',
      message: remoteErrorMessage(err) ?? 'Failed to save page',
    };
  }

  let offerSaved = false;
  if (payload.offer && offerChanged(payload.offer, deps.savedOffer)) {
    try {
      await deps.saveOffer({
        pageId: deps.pageId,
        offer: toPersistedOffer(payload.offer),
      });
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

  deps.markSaved();

  if (deps.refresh) {
    try {
      await deps.refresh();
    } catch (err) {
      return {
        outcome: 'saved',
        offerSaved,
        staleWarning:
          remoteErrorMessage(err) ??
          'Saved, but the live page may still show the previous version.',
      };
    }
  }

  return { outcome: 'saved', offerSaved };
}
