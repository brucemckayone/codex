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
  type BuilderRefreshScope,
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
 * The SELL-MEDIA leg.
 *
 * THE BUG THESE LOCK OUT, and it is the worst shape in the builder: the media
 * write used to run in `+page.svelte` AFTER `saveBuilderDraft` returned, BELOW the
 * component's `if (result.staleWarning) { toast.warning(...); return true; }`. So
 * whenever the post-save `invalidate('cache:versions')` rejected — which happens
 * whenever ANY load it re-runs throws, i.e. for reasons having nothing to do with
 * this save — the media write was never attempted, the creator was warned about
 * page STALENESS (not media), and `handleSave` returned TRUE. `handlePublish` then
 * announced "Page published" for a page whose media had never been sent, and
 * because `markSaved()` had already run inside the orchestrator the page draft was
 * clean, so the un-sent media was silently discardable on the next navigation.
 *
 * A leg the caller runs afterwards is a leg the caller can skip. These tests are
 * therefore about ORDER as much as about outcome.
 */
describe('saveBuilderDraft · sell-media leg', () => {
  function makeSellMedia(overrides: Record<string, unknown> = {}) {
    return {
      isDirty: true,
      save: vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  it('runs the media write even when the post-save refresh REJECTS', async () => {
    // The falsification case. With the leg in the component this passed the
    // `staleWarning` early return and never fired.
    const sellMedia = makeSellMedia();
    const deps = makeDeps({
      sellMedia,
      refresh: vi
        .fn<() => Promise<unknown>>()
        .mockRejectedValue(new Error('invalidate failed')),
    });

    const result = await saveBuilderDraft(deps);

    expect(sellMedia.save).toHaveBeenCalledTimes(1);
    // Still a SAVE with a staleness warning — the writes landed.
    expect(result.outcome).toBe('saved');
    expect(result).toMatchObject({ staleWarning: 'invalidate failed' });
    expect(deps.markSaved).toHaveBeenCalledTimes(1);
  });

  it('runs AFTER the offer leg and BEFORE markSaved, so a refusal stays retryable', async () => {
    const order: string[] = [];
    const sellMedia = makeSellMedia({
      save: vi.fn<() => Promise<unknown>>().mockImplementation(async () => {
        order.push('media');
      }),
    });
    const deps = makeDeps({
      sellMedia,
      payload: makePayload({ offer: { oneOffEnabled: true } }),
      saveOffer: vi
        .fn<(input: unknown) => Promise<unknown>>()
        .mockImplementation(async () => {
          order.push('offer');
        }),
      markSaved: vi.fn<() => void>().mockImplementation(() => {
        order.push('markSaved');
      }),
    });

    await saveBuilderDraft(deps);

    expect(order).toEqual(['offer', 'media', 'markSaved']);
  });

  it('a refused media write is a FAILURE naming the media, and does not mark the draft saved', async () => {
    const sellMedia = makeSellMedia({
      save: vi
        .fn<() => Promise<unknown>>()
        .mockRejectedValue(remoteError('That media is not yours')),
    });
    const deps = makeDeps({ sellMedia });

    const result = await saveBuilderDraft(deps);

    expect(result).toEqual({
      outcome: 'failed',
      stage: 'media',
      message: 'Page saved, but the media was not: That media is not yours',
    });
    // The copy DID land, so the message says so — but the draft stays dirty and
    // publish/view-live must not proceed.
    expect(deps.savePage).toHaveBeenCalledTimes(1);
    expect(deps.markSaved).not.toHaveBeenCalled();
  });

  it('names the leg when the refusal carries no message', async () => {
    const sellMedia = makeSellMedia({
      save: vi.fn<() => Promise<unknown>>().mockRejectedValue({ status: 500 }),
    });

    const result = await saveBuilderDraft(makeDeps({ sellMedia }));

    expect(result).toMatchObject({
      stage: 'media',
      message: 'Page saved, but the media could not be saved.',
    });
  });

  it('skips the write when no slot changed', async () => {
    const sellMedia = makeSellMedia({ isDirty: false });

    const result = await saveBuilderDraft(makeDeps({ sellMedia }));

    expect(sellMedia.save).not.toHaveBeenCalled();
    expect(result.outcome).toBe('saved');
  });

  it('a media-only failure blocks publish', async () => {
    const sellMedia = makeSellMedia({
      save: vi
        .fn<() => Promise<unknown>>()
        .mockRejectedValue(remoteError('That media is not yours')),
    });

    const result = await saveBuilderDraft(makeDeps({ sellMedia }));

    // Same gate as the pricing-only failure below: media is part of the page
    // going live, so "Page published" would be a claim about content nobody sent.
    expect(result.outcome).toBe('failed');
  });
});

/**
 * THE POST-SAVE RE-READ.
 *
 * The bug: `refresh` is `invalidate('cache:versions')`, and `invalidate(resource)`
 * re-runs `load` functions ONLY. SvelteKit re-runs remote `query()` functions
 * from an invalidation pass exclusively behind its internal `force_invalidation`
 * flag, which only `invalidateAll()` / `refreshAll()` set. So Save toasted
 * success while the canvas went on rendering the PRE-SAVE price and the PRE-SAVE
 * media until a hard reload — and both of those reads are authoritative ones the
 * canvas is fed deliberately INSTEAD of the draft's own bag, so the staleness
 * shows up as a plausible older number rather than as an obvious blank.
 *
 * WHY THESE TESTS DRIVE A VALUE AND NOT A SPY. Asserting `refreshQueries` was
 * called would pass over a refresher that refreshes nothing — which is exactly
 * the failure mode being fixed, since `invalidate()` WAS being called all along.
 * So each test below wires a fake query whose `.current` moves only when its own
 * `refresh()` runs, mutates the server-side value inside the write leg (as the
 * real endpoints do), and asserts THE OBSERVED VALUE CHANGED across the save.
 */
describe('saveBuilderDraft · the post-save re-read', () => {
  /**
   * A remote query, modelled on the only two properties this code uses:
   * `.current` is a SNAPSHOT (it does not track the server), and `refresh()` is
   * the sole thing that re-reads. That is the whole mechanism of the bug.
   */
  function fakeQuery<T>(read: () => T) {
    let current = read();
    return {
      get current() {
        return current;
      },
      refresh: vi.fn<() => Promise<void>>().mockImplementation(async () => {
        current = read();
      }),
    };
  }

  /** The builder's two authoritative reads, over a mutable "server". */
  function makeStudioReads() {
    const server = { priceCents: 1000, heroImageUrl: 'hero-old.webp' };
    const offerQuery = fakeQuery(() => ({
      purchase: { priceCents: server.priceCents },
    }));
    const sellPreviewQuery = fakeQuery(() => ({
      heroImageUrl: server.heroImageUrl,
    }));
    return {
      server,
      offerQuery,
      sellPreviewQuery,
      /** Exactly the wiring `+page.svelte` hands the orchestrator. */
      refreshQueries: (scope: BuilderRefreshScope) =>
        Promise.all([
          scope.offer ? offerQuery.refresh() : undefined,
          scope.media ? sellPreviewQuery.refresh() : undefined,
        ]),
    };
  }

  it('the canvas price MOVES across a save that changed the price', async () => {
    // THE FALSIFICATION. Without `refreshQueries` wired into the orchestrator this
    // reads 1000 — the pre-save number, beside a "Page saved" toast.
    const reads = makeStudioReads();
    const deps = makeDeps({
      payload: makePayload({
        offer: { oneOffEnabled: true, oneOffPriceCents: 2500 },
      }),
      refreshQueries: reads.refreshQueries,
      saveOffer: vi
        .fn<(input: unknown) => Promise<unknown>>()
        .mockImplementation(async () => {
          reads.server.priceCents = 2500;
        }),
    });

    expect(reads.offerQuery.current.purchase.priceCents).toBe(1000);

    const result = await saveBuilderDraft(deps);

    expect(result).toMatchObject({ outcome: 'saved', offerSaved: true });
    expect(reads.offerQuery.current.purchase.priceCents).toBe(2500);
  });

  it('the canvas MEDIA moves across a save that changed a slot', async () => {
    const reads = makeStudioReads();
    const deps = makeDeps({
      refreshQueries: reads.refreshQueries,
      sellMedia: {
        isDirty: true,
        save: vi.fn<() => Promise<unknown>>().mockImplementation(async () => {
          reads.server.heroImageUrl = 'hero-new.webp';
        }),
      },
    });

    const result = await saveBuilderDraft(deps);

    expect(result.outcome).toBe('saved');
    expect(reads.sellPreviewQuery.current.heroImageUrl).toBe('hero-new.webp');
  });

  it('a PLAN change moves the pricing read too, not just a one-off price change', async () => {
    // `CourseOffer.subscription` / `.tiers` mirror what the monetisation leg
    // writes, so a subscription-only save leaves the canvas as stale as a
    // price-only one did.
    const reads = makeStudioReads();
    const deps = makeDeps({
      monetisation: {
        isDirty: true,
        save: vi.fn<() => Promise<unknown>>().mockImplementation(async () => {
          reads.server.priceCents = 4200;
        }),
        presentation: vi
          .fn<() => DerivedOfferPresentation | null>()
          .mockReturnValue(null),
      },
      refreshQueries: reads.refreshQueries,
    });

    const result = await saveBuilderDraft(deps);

    expect(result).toMatchObject({
      monetisationSaved: true,
      offerSaved: false,
    });
    expect(reads.offerQuery.current.purchase.priceCents).toBe(4200);
  });

  it('re-reads ONLY what moved: a media-only save does not spend the pricing read', async () => {
    // The reason this is a scope and not an `invalidateAll()`: the creator waits on
    // these round trips, and four of the builder's five queries answer nothing this
    // save wrote.
    const reads = makeStudioReads();
    const deps = makeDeps({
      refreshQueries: reads.refreshQueries,
      sellMedia: {
        isDirty: true,
        save: vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined),
      },
    });

    await saveBuilderDraft(deps);

    expect(reads.sellPreviewQuery.refresh).toHaveBeenCalledTimes(1);
    expect(reads.offerQuery.refresh).not.toHaveBeenCalled();
  });

  it('does not re-read at all when a copy-only save moved neither', async () => {
    const refreshQueries = vi
      .fn<(scope: BuilderRefreshScope) => Promise<unknown>>()
      .mockResolvedValue(undefined);

    const result = await saveBuilderDraft(makeDeps({ refreshQueries }));

    expect(result.outcome).toBe('saved');
    expect(refreshQueries).not.toHaveBeenCalled();
  });

  it('re-reads the queries even when the load invalidation REJECTS', async () => {
    // Same shape as the media leg's own falsification case: a read placed behind
    // something that can bail is a read that gets skipped. A rejected `invalidate`
    // has nothing to do with this save and must not be what leaves the canvas
    // showing the old price.
    const reads = makeStudioReads();
    const deps = makeDeps({
      payload: makePayload({
        offer: { oneOffEnabled: true, oneOffPriceCents: 2500 },
      }),
      refreshQueries: reads.refreshQueries,
      saveOffer: vi
        .fn<(input: unknown) => Promise<unknown>>()
        .mockImplementation(async () => {
          reads.server.priceCents = 2500;
        }),
      refresh: vi
        .fn<() => Promise<unknown>>()
        .mockRejectedValue(new Error('invalidate failed')),
    });

    const result = await saveBuilderDraft(deps);

    expect(reads.offerQuery.current.purchase.priceCents).toBe(2500);
    expect(result).toMatchObject({
      outcome: 'saved',
      staleWarning: 'invalidate failed',
    });
  });

  it('still invalidates the loads when the query re-read rejects', async () => {
    const deps = makeDeps({
      payload: makePayload({
        offer: { oneOffEnabled: true, oneOffPriceCents: 2500 },
      }),
      refreshQueries: vi
        .fn<(scope: BuilderRefreshScope) => Promise<unknown>>()
        .mockRejectedValue(new Error('the offer read failed')),
    });

    const result = await saveBuilderDraft(deps);

    expect(deps.refresh).toHaveBeenCalledTimes(1);
    // A committed write with a lagging read is a WARNING, never a failure.
    expect(result).toMatchObject({
      outcome: 'saved',
      offerSaved: true,
      staleWarning: 'the offer read failed',
    });
  });

  it('never re-reads after a FAILED leg — there is nothing new to read', async () => {
    const refreshQueries = vi
      .fn<(scope: BuilderRefreshScope) => Promise<unknown>>()
      .mockResolvedValue(undefined);
    const deps = makeDeps({
      refreshQueries,
      savePage: vi
        .fn<(input: unknown) => Promise<unknown>>()
        .mockRejectedValue(remoteError('slug taken')),
    });

    await saveBuilderDraft(deps);

    expect(refreshQueries).not.toHaveBeenCalled();
    expect(deps.refresh).not.toHaveBeenCalled();
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
