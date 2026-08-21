/**
 * Journey builder SAVE-GATING tests (Codex-xzwl5).
 *
 * The bug these lock out: `handleSave` caught its own errors and returned
 * normally, so a failed save was indistinguishable from a successful one —
 * `handlePublish` reported "Page published" over content that never persisted,
 * and `handleViewLive` opened the live page (stale) next to a builder showing the
 * new content. So every test here asserts the RESULT, not a side effect, and the
 * publish/view-live simulations assert the action DID NOT PROCEED.
 *
 * `markSaved` is the observable proof of "the draft was accepted": it promotes
 * pending → saved, so it must NOT run when any write leg failed (the draft has to
 * stay dirty and retryable).
 */

import type { PageBuilderState } from '@codex/shared-types';
import { describe, expect, it, vi } from 'vitest';
import {
  type BuilderSaveResult,
  type DerivedOfferPresentation,
  remoteErrorMessage,
  saveBuilderDraft,
  toPersistedOffer,
} from './builder-save';

const PAGE_ID = '00000000-0000-4000-8000-0000000000a0';

function makePayload(
  overrides: Partial<PageBuilderState> = {}
): PageBuilderState {
  return {
    pageType: 'course',
    slug: 'stillness',
    title: 'Stillness',
    status: 'draft',
    subjectType: 'course',
    subjectId: '00000000-0000-4000-8000-0000000000c0',
    brandOverrides: null,
    sections: [{ id: 'sec-hero', type: 'hero', enabled: true, props: {} }],
    ...overrides,
  };
}

/** A failed `command()` as SvelteKit's `error(status, message)` delivers it. */
function remoteError(message: string): unknown {
  return { status: 400, body: { message } };
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    pageId: PAGE_ID,
    payload: makePayload(),
    savedOffer: undefined,
    savePage: vi
      .fn<(input: unknown) => Promise<unknown>>()
      .mockResolvedValue(undefined),
    saveOffer: vi
      .fn<(input: unknown) => Promise<unknown>>()
      .mockResolvedValue(undefined),
    // Always present, as the real caller always passes it: the derived offer bag
    // must land in the draft before the baseline is promoted.
    syncOffer: vi.fn<(offer: unknown) => void>(),
    markSaved: vi.fn<() => void>(),
    refresh: vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('saveBuilderDraft', () => {
  it('persists the page from NAMED fields (the save schema is strict)', async () => {
    const deps = makeDeps();

    const result = await saveBuilderDraft(deps);

    expect(result).toEqual({
      outcome: 'saved',
      offerSaved: false,
      monetisationSaved: false,
    });
    expect(deps.savePage).toHaveBeenCalledWith({
      id: PAGE_ID,
      pageType: 'course',
      slug: 'stillness',
      title: 'Stillness',
      status: 'draft',
      subjectType: 'course',
      subjectId: '00000000-0000-4000-8000-0000000000c0',
      brandOverrides: null,
      sections: deps.payload.sections,
    });
    // No `offer` key on the payload ⇒ the pricing leg never runs.
    expect(deps.saveOffer).not.toHaveBeenCalled();
    expect(deps.markSaved).toHaveBeenCalledTimes(1);
  });

  it('sends the page LOOK when the draft has one (F-B2)', async () => {
    const deps = makeDeps({
      payload: makePayload({ design: { width: 'narrow', motion: 'drift' } }),
    });

    await saveBuilderDraft(deps);

    expect(deps.savePage).toHaveBeenCalledWith(
      expect.objectContaining({ design: { width: 'narrow', motion: 'drift' } })
    );
  });

  it('OMITS design entirely when the draft has none', async () => {
    // Absence is meaningful, not cosmetic: the service reads an absent `design` as
    // "leave the stored bundle alone". Sending `design: undefined` would express the
    // same thing today, but a draft loaded by a client that predates the axes must
    // never be able to say anything about a page's look at all.
    const deps = makeDeps();

    await saveBuilderDraft(deps);

    const sent = deps.savePage.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(sent)).not.toContain('design');
  });

  it('reports ok:false with the service message when the page write fails', async () => {
    const deps = makeDeps({
      savePage: vi
        .fn<(input: unknown) => Promise<unknown>>()
        .mockRejectedValue(
          remoteError('The slug "stillness" is already in use')
        ),
    });

    const result = await saveBuilderDraft(deps);

    expect(result).toEqual({
      outcome: 'failed',
      stage: 'page',
      message: 'The slug "stillness" is already in use',
    });
    // Nothing persisted ⇒ the draft must stay dirty and retryable.
    expect(deps.markSaved).not.toHaveBeenCalled();
    // A failed page write must not spend the rate-limited pricing mutation.
    expect(deps.saveOffer).not.toHaveBeenCalled();
    expect(deps.refresh).not.toHaveBeenCalled();
  });

  it('falls back to a generic message when the failure carries none', async () => {
    const deps = makeDeps({
      savePage: vi
        .fn<(input: unknown) => Promise<unknown>>()
        .mockRejectedValue({ status: 500 }),
    });

    const result = await saveBuilderDraft(deps);

    expect(result).toEqual({
      outcome: 'failed',
      stage: 'page',
      message: 'Failed to save page',
    });
  });

  it('saves the offer when it changed, normalising every path to an explicit value', async () => {
    const deps = makeDeps({
      payload: makePayload({
        offer: { oneOffEnabled: true, oneOffPriceCents: 4900 },
      }),
      savedOffer: undefined,
    });

    const result = await saveBuilderDraft(deps);

    expect(result).toEqual({
      outcome: 'saved',
      offerSaved: true,
      monetisationSaved: false,
    });
    expect(deps.saveOffer).toHaveBeenCalledWith({
      pageId: PAGE_ID,
      offer: {
        tiersEnabled: false,
        subscriptionEnabled: false,
        subscriptionPriceCents: null,
        oneOffEnabled: true,
        oneOffPriceCents: 4900,
      },
    });
  });

  it('skips the rate-limited pricing mutation when the offer is unchanged', async () => {
    const offer = { oneOffEnabled: true, oneOffPriceCents: 4900 };
    const deps = makeDeps({
      payload: makePayload({ offer: { ...offer } }),
      savedOffer: { ...offer },
    });

    const result = await saveBuilderDraft(deps);

    expect(result).toEqual({
      outcome: 'saved',
      offerSaved: false,
      monetisationSaved: false,
    });
    expect(deps.saveOffer).not.toHaveBeenCalled();
    expect(deps.markSaved).toHaveBeenCalledTimes(1);
  });

  it('distinguishes a pricing-only failure from a total failure', async () => {
    const deps = makeDeps({
      payload: makePayload({ offer: { oneOffEnabled: true } }),
      saveOffer: vi
        .fn<(input: unknown) => Promise<unknown>>()
        .mockRejectedValue(
          remoteError('Set a one-off price, or turn the one-off path off')
        ),
    });

    const result = await saveBuilderDraft(deps);

    // The copy DID land, so the message must not claim otherwise — and it must
    // carry the service's own actionable guidance.
    expect(result).toEqual({
      outcome: 'failed',
      stage: 'offer',
      message:
        'Page saved, but the pricing was not: Set a one-off price, or turn the one-off path off',
    });
    expect(deps.savePage).toHaveBeenCalledTimes(1);
    // Not marked saved ⇒ a retry re-sends BOTH legs.
    expect(deps.markSaved).not.toHaveBeenCalled();
  });

  it('treats a failed post-save refresh as a staleness WARNING, not a failed write', async () => {
    const deps = makeDeps({
      refresh: vi
        .fn<() => Promise<unknown>>()
        .mockRejectedValue(new Error('invalidate failed')),
    });

    const result = await saveBuilderDraft(deps);

    // The writes landed — reporting this as a failure would be as wrong as the
    // original bug in the other direction.
    expect(result.outcome).toBe('saved');
    expect(result).toMatchObject({ staleWarning: 'invalidate failed' });
    expect(deps.markSaved).toHaveBeenCalledTimes(1);
  });

  it('never throws — a rejection is always converted to ok:false', async () => {
    const deps = makeDeps({
      savePage: vi
        .fn<(input: unknown) => Promise<unknown>>()
        .mockRejectedValue(new Error('network down')),
    });

    await expect(saveBuilderDraft(deps)).resolves.toMatchObject({
      outcome: 'failed',
      stage: 'page',
      message: 'network down',
    });
  });
});

/**
 * The MONETISATION leg (Codex-2pryk.2.4.2) — the course's subscription plan and
 * tier-access set, which live on the course rather than the page row.
 *
 * The bug these lock out: the panel's "Membership tiers" and "Course subscription"
 * controls wrote only into `landing_pages.offer`, a presentational jsonb bag no
 * authoritative read consults. Turning either on could not change what a buyer was
 * able to purchase, yet the save reported success — so the tests here assert that
 * the real write is ATTEMPTED, that a refusal is not reported as success, and that
 * the bag can only ever mirror state that actually persisted.
 */
describe('saveBuilderDraft · monetisation leg', () => {
  function makeMonetisation(overrides: Record<string, unknown> = {}) {
    return {
      isDirty: true,
      save: vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined),
      presentation: vi
        .fn<() => DerivedOfferPresentation | null>()
        .mockReturnValue({
          tiersEnabled: true,
          subscriptionEnabled: true,
          subscriptionPriceCents: 1200,
        }),
      ...overrides,
    };
  }

  it('persists the plan + tier access, and mirrors what persisted into the offer bag', async () => {
    const monetisation = makeMonetisation();
    const deps = makeDeps({
      payload: makePayload({
        offer: { oneOffEnabled: true, oneOffPriceCents: 4900 },
      }),
      monetisation,
    });

    const result = await saveBuilderDraft(deps);

    expect(result).toEqual({
      outcome: 'saved',
      offerSaved: true,
      monetisationSaved: true,
    });
    expect(monetisation.save).toHaveBeenCalledTimes(1);
    expect(deps.saveOffer).toHaveBeenCalledWith({
      pageId: PAGE_ID,
      offer: {
        tiersEnabled: true,
        subscriptionEnabled: true,
        subscriptionPriceCents: 1200,
        oneOffEnabled: true,
        oneOffPriceCents: 4900,
      },
    });
  });

  it('runs BEFORE the offer leg, so the bag can only mirror a plan that landed', async () => {
    const order: string[] = [];
    const monetisation = makeMonetisation({
      save: vi.fn<() => Promise<unknown>>().mockImplementation(async () => {
        order.push('monetisation');
      }),
    });
    const deps = makeDeps({
      monetisation,
      saveOffer: vi
        .fn<(input: unknown) => Promise<unknown>>()
        .mockImplementation(async () => {
          order.push('offer');
        }),
    });

    await saveBuilderDraft(deps);

    expect(order).toEqual(['monetisation', 'offer']);
  });

  it('a refused plan does NOT write the offer bag and does NOT mark the draft saved', async () => {
    const monetisation = makeMonetisation({
      save: vi
        .fn<() => Promise<unknown>>()
        .mockRejectedValue(
          remoteError(
            'Connect a payout account before selling a course subscription — finish Stripe onboarding in Studio → Monetisation.'
          )
        ),
    });
    const deps = makeDeps({ monetisation });

    const result = await saveBuilderDraft(deps);

    expect(result).toEqual({
      outcome: 'failed',
      stage: 'monetisation',
      message:
        'Page saved, but the pricing was not: Connect a payout account before selling a course subscription — finish Stripe onboarding in Studio → Monetisation.',
    });
    // The bag must never advertise a subscription with no Stripe Product behind it.
    expect(deps.saveOffer).not.toHaveBeenCalled();
    // Not marked saved ⇒ the draft stays dirty and a retry re-sends the leg.
    expect(deps.markSaved).not.toHaveBeenCalled();
    expect(deps.refresh).not.toHaveBeenCalled();
  });

  it('names the leg when the refusal carries no message', async () => {
    const deps = makeDeps({
      monetisation: makeMonetisation({
        save: vi
          .fn<() => Promise<unknown>>()
          .mockRejectedValue({ status: 500 }),
      }),
    });

    await expect(saveBuilderDraft(deps)).resolves.toEqual({
      outcome: 'failed',
      stage: 'monetisation',
      message:
        'Page saved, but the subscription and tier access could not be saved.',
    });
  });

  it('still mirrors the derived presentation when the leg itself was NOT dirty', async () => {
    // A creator who edits only copy must not silently blank the tier/subscription
    // fields in the bag — the mirror is derived from the persisted baseline, which
    // exists whether or not this save changed it.
    const monetisation = makeMonetisation({ isDirty: false });
    const deps = makeDeps({ monetisation });

    const result = await saveBuilderDraft(deps);

    expect(monetisation.save).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      monetisationSaved: false,
      offerSaved: true,
    });
    expect(deps.saveOffer).toHaveBeenCalledWith({
      pageId: PAGE_ID,
      offer: {
        tiersEnabled: true,
        subscriptionEnabled: true,
        subscriptionPriceCents: 1200,
        oneOffEnabled: false,
        oneOffPriceCents: null,
      },
    });
  });

  it('leaves the bag ALONE when no authoritative baseline is loaded', async () => {
    // `presentation()` returns null for a page with no subject course, or when the
    // read failed. Deriving "everything off" from that would withdraw ways in the
    // panel never managed to see.
    const deps = makeDeps({
      payload: makePayload({
        offer: { tiersEnabled: true, subscriptionEnabled: true },
      }),
      monetisation: makeMonetisation({
        isDirty: false,
        presentation: vi
          .fn<() => DerivedOfferPresentation | null>()
          .mockReturnValue(null),
      }),
    });

    await saveBuilderDraft(deps);

    expect(deps.saveOffer).toHaveBeenCalledWith({
      pageId: PAGE_ID,
      offer: {
        tiersEnabled: true,
        subscriptionEnabled: true,
        subscriptionPriceCents: null,
        oneOffEnabled: false,
        oneOffPriceCents: null,
      },
    });
  });

  it('syncs the persisted bag into the draft BEFORE promoting it', async () => {
    // Without this the derivation is recomputed every save and always differs from
    // a baseline that never carried it — re-sending the rate-limited offer write on
    // every press.
    const order: string[] = [];
    const deps = makeDeps({
      monetisation: makeMonetisation({ isDirty: false }),
      syncOffer: vi.fn<(offer: unknown) => void>().mockImplementation(() => {
        order.push('syncOffer');
      }),
      markSaved: vi.fn<() => void>().mockImplementation(() => {
        order.push('markSaved');
      }),
    });

    await saveBuilderDraft(deps);

    expect(order).toEqual(['syncOffer', 'markSaved']);
    expect(deps.syncOffer).toHaveBeenCalledWith({
      tiersEnabled: true,
      subscriptionEnabled: true,
      subscriptionPriceCents: 1200,
      oneOffEnabled: false,
      oneOffPriceCents: null,
    });
  });

  it('does not re-send the offer write once the baseline carries the derivation', async () => {
    // The second press of Save, simulated: the baseline is what the first press
    // synced, so nothing changed and no rate-limited mutation is spent.
    const deps = makeDeps({
      monetisation: makeMonetisation({ isDirty: false }),
      savedOffer: {
        tiersEnabled: true,
        subscriptionEnabled: true,
        subscriptionPriceCents: 1200,
        oneOffEnabled: false,
        oneOffPriceCents: null,
      },
    });

    const result = await saveBuilderDraft(deps);

    expect(deps.saveOffer).not.toHaveBeenCalled();
    expect(result).toMatchObject({ offerSaved: false });
  });
});

/**
 * The two callers the bead names. Both are one line in the component; these
 * simulate that line against the real result contract so a regression to
 * "proceed regardless" fails here.
 */
describe('gating publish / view-live on the save result', () => {
  /** Mirror of the component's `handlePublish`. */
  async function publish(result: BuilderSaveResult) {
    const toasts: string[] = [];
    const statusWrites: string[] = [];
    statusWrites.push('published');
    if (result.outcome === 'failed') {
      toasts.push(`error:${result.message}`);
      statusWrites.push('draft'); // rolled back
      return { published: false, toasts, statusWrites };
    }
    toasts.push('success:Page published');
    return { published: true, toasts, statusWrites };
  }

  /** Mirror of the component's `handleViewLive`. */
  async function viewLive(result: BuilderSaveResult, dirty = true) {
    const opened: string[] = [];
    if (dirty && result.outcome === 'failed') return { opened };
    opened.push('/journeys/stillness');
    return { opened };
  }

  it('publish does NOT proceed and never claims success when the save failed', async () => {
    const failed = await saveBuilderDraft(
      makeDeps({
        savePage: vi
          .fn<(input: unknown) => Promise<unknown>>()
          .mockRejectedValue(remoteError('slug taken')),
      })
    );

    const outcome = await publish(failed);

    expect(outcome.published).toBe(false);
    expect(outcome.toasts).toEqual(['error:slug taken']);
    expect(outcome.toasts).not.toContain('success:Page published');
    // The builder must not sit there showing "Published" over an unpublished page.
    expect(outcome.statusWrites).toEqual(['published', 'draft']);
  });

  it('publish proceeds when the save landed', async () => {
    const ok = await saveBuilderDraft(makeDeps());

    const outcome = await publish(ok);

    expect(outcome.published).toBe(true);
    expect(outcome.toasts).toEqual(['success:Page published']);
  });

  it('view-live does NOT open the live page when the save failed', async () => {
    const failed = await saveBuilderDraft(
      makeDeps({
        savePage: vi
          .fn<(input: unknown) => Promise<unknown>>()
          .mockRejectedValue(new Error('network down')),
      })
    );

    // Opening it would show the LAST-SAVED page beside a builder showing the new
    // content — the intermittent builder-vs-live discrepancy this bead is about.
    expect((await viewLive(failed)).opened).toEqual([]);
  });

  it('view-live opens the live page once the save landed', async () => {
    const ok = await saveBuilderDraft(makeDeps());

    expect((await viewLive(ok)).opened).toEqual(['/journeys/stillness']);
  });

  it('a pricing-only failure still blocks publish (the offer is part of the page going live)', async () => {
    const failed = await saveBuilderDraft(
      makeDeps({
        payload: makePayload({ offer: { oneOffEnabled: true } }),
        saveOffer: vi
          .fn<(input: unknown) => Promise<unknown>>()
          .mockRejectedValue(remoteError('Set a one-off price')),
      })
    );

    expect((await publish(failed)).published).toBe(false);
  });
});

describe('remoteErrorMessage', () => {
  it('prefers the SvelteKit error body message over err.message', () => {
    expect(
      remoteErrorMessage({
        body: { message: 'Set a one-off price' },
        message: 'Bad Request',
      })
    ).toBe('Set a one-off price');
  });

  it('falls back to err.message for a plain Error', () => {
    expect(remoteErrorMessage(new Error('network down'))).toBe('network down');
  });

  it('returns undefined when there is no human message to show', () => {
    expect(remoteErrorMessage({ status: 500 })).toBeUndefined();
    expect(remoteErrorMessage(null)).toBeUndefined();
    expect(remoteErrorMessage(new Error(''))).toBeUndefined();
  });
});

describe('toPersistedOffer', () => {
  it('makes every path explicit so "no price" travels as null, not a missing key', () => {
    expect(toPersistedOffer({})).toEqual({
      tiersEnabled: false,
      subscriptionEnabled: false,
      subscriptionPriceCents: null,
      oneOffEnabled: false,
      oneOffPriceCents: null,
    });
  });
});
