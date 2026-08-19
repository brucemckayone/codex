/**
 * Sell-media store tests (Codex-eqh0z; A27 slots per Codex-wqxv4).
 *
 * The failure mode this file exists to catch is silent and specific: the store
 * hydrates and re-baselines its slots by HAND-LISTING them (`open()` maps the
 * persisted shape field by field, `save()` does it again). A slot added to
 * `JourneySellMediaSlot` and to `EMPTY_SLOTS` but forgotten in one of those two
 * mappings type-checks perfectly — `apps/web` runs with `strictNullChecks` off —
 * and then reads back `undefined`. The picker shows nothing selected, the creator
 * re-picks, and the only symptom is media that "won't stick".
 *
 * So the two round-trip tests are DERIVED from `Object.keys(sellMedia.slots)`
 * rather than listing the six slots: adding a seventh slot to the union without
 * wiring both mappings fails these tests instead of shipping.
 *
 * The store is a module-level Svelte 5 `$state` singleton, so every test resets
 * via `close()` first (mirrors `monetisation-store.test.ts`).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JourneySellMedia } from './journey-queries';

const getJourneySellMedia =
  vi.fn<(input: { pageId: string }) => Promise<JourneySellMedia | null>>();
const updateJourneySellMedia =
  vi.fn<(input: unknown) => Promise<JourneySellMedia>>();
const listMedia = vi.fn<(input: unknown) => Promise<{ items: unknown[] }>>();

vi.mock('$lib/remote/journeys.remote', () => ({
  getJourneySellMedia: (input: { pageId: string }) =>
    getJourneySellMedia(input),
  updateJourneySellMedia: (input: unknown) => updateJourneySellMedia(input),
  uploadJourneyCover: vi.fn(),
  deleteJourneyCover: vi.fn(),
}));

vi.mock('$lib/remote/media.remote', () => ({
  listMedia: (input: unknown) => listMedia(input),
}));

// Imported AFTER the mocks so the store binds to the fakes.
const { sellMedia } = await import('./sell-media-store.svelte');

const PAGE_ID = '00000000-0000-4000-8000-0000000000b0';
const COURSE_ID = '00000000-0000-4000-8000-0000000000c0';

/**
 * A persisted shape whose every slot holds a DISTINCT id, so a mapping that
 * crosses two slots (`heroMediaId: media.signatureMediaId`) fails as loudly as
 * one that omits a slot entirely.
 */
const PERSISTED: JourneySellMedia = {
  courseId: COURSE_ID,
  introVideoMediaId: '00000000-0000-4000-8000-000000000001',
  previewVideoMediaId: '00000000-0000-4000-8000-000000000002',
  guideVideoMediaId: '00000000-0000-4000-8000-000000000003',
  guidePortraitMediaId: '00000000-0000-4000-8000-000000000004',
  heroMediaId: '00000000-0000-4000-8000-000000000005',
  signatureMediaId: '00000000-0000-4000-8000-000000000006',
  coverImageUrl: null,
};

/**
 * The slot names the store declares, captured from a PRISTINE (closed) store —
 * i.e. from `EMPTY_SLOTS`, the one place that names all of them.
 *
 * Captured once, before any `open()`, and deliberately NOT re-derived per test:
 * `open()` REPLACES the pending record wholesale, so a slot missing from its
 * mapping is missing from `Object.keys(sellMedia.slots)` too — deriving the
 * expectation from the post-load record would let exactly the bug this file
 * exists to catch derive itself away. Verified by mutation: dropping
 * `heroMediaId` from `open()` fails `hydrates EVERY slot`.
 */
const ALL_SLOTS: readonly string[] = (() => {
  sellMedia.close();
  return Object.keys(sellMedia.slots);
})();

beforeEach(() => {
  sellMedia.close();
  getJourneySellMedia.mockReset();
  updateJourneySellMedia.mockReset();
  listMedia.mockReset();
  listMedia.mockResolvedValue({ items: [] });
});

describe('sell-media store · slots', () => {
  it('carries the A27 hero and signature slots', () => {
    // Named explicitly for exactly one reason: the DERIVED tests below would all
    // pass on a store that had silently DROPPED a slot from its record. This is
    // the anchor that says which slots must exist at all.
    expect(ALL_SLOTS).toEqual(
      expect.arrayContaining(['heroMediaId', 'signatureMediaId'])
    );
  });

  it('starts every slot empty', () => {
    for (const slot of ALL_SLOTS) {
      expect(sellMedia.slots[slot], `${slot} is not empty on open`).toBeNull();
    }
  });
});

describe('sell-media store · load', () => {
  it('hydrates EVERY slot from the persisted shape', async () => {
    getJourneySellMedia.mockResolvedValue(PERSISTED);

    await sellMedia.open(PAGE_ID);

    for (const slot of ALL_SLOTS) {
      expect(
        sellMedia.slot(slot as never),
        `${slot} was not hydrated — check open()'s mapping`
      ).toBe(PERSISTED[slot as keyof JourneySellMedia]);
    }
  });

  it('is not dirty straight after a load', async () => {
    getJourneySellMedia.mockResolvedValue(PERSISTED);

    await sellMedia.open(PAGE_ID);

    expect(sellMedia.isDirty).toBe(false);
  });

  it('treats a set A27 slot as dirty, and a no-op write as not', async () => {
    getJourneySellMedia.mockResolvedValue({
      ...PERSISTED,
      heroMediaId: null,
    });
    await sellMedia.open(PAGE_ID);

    // Melt-based pickers echo their value on mount, so re-setting what is already
    // pending must NOT dirty the draft.
    sellMedia.setSlot('heroMediaId', null);
    expect(sellMedia.isDirty).toBe(false);

    sellMedia.setSlot('heroMediaId', PERSISTED.heroMediaId);
    expect(sellMedia.isDirty).toBe(true);
    expect(sellMedia.slot('heroMediaId')).toBe(PERSISTED.heroMediaId);
  });
});

describe('sell-media store · save', () => {
  it('sends EVERY slot on the wire — the write is total, so a missing key clears', async () => {
    getJourneySellMedia.mockResolvedValue({
      ...PERSISTED,
      heroMediaId: null,
      signatureMediaId: null,
    });
    updateJourneySellMedia.mockResolvedValue(PERSISTED);
    await sellMedia.open(PAGE_ID);

    sellMedia.setSlot('heroMediaId', PERSISTED.heroMediaId);
    sellMedia.setSlot('signatureMediaId', PERSISTED.signatureMediaId);
    await sellMedia.save();

    const sent = updateJourneySellMedia.mock.calls[0]?.[0] as {
      pageId: string;
      media: Record<string, string | null>;
    };
    expect(sent.pageId).toBe(PAGE_ID);
    for (const slot of ALL_SLOTS) {
      expect(
        Object.hasOwn(sent.media, slot),
        `${slot} was not sent — an absent key CLEARS the column`
      ).toBe(true);
    }
    expect(sent.media.heroMediaId).toBe(PERSISTED.heroMediaId);
    expect(sent.media.signatureMediaId).toBe(PERSISTED.signatureMediaId);
  });

  it('re-baselines EVERY slot from the persisted response', async () => {
    getJourneySellMedia.mockResolvedValue({
      ...PERSISTED,
      heroMediaId: null,
      signatureMediaId: null,
    });
    updateJourneySellMedia.mockResolvedValue(PERSISTED);
    await sellMedia.open(PAGE_ID);

    sellMedia.setSlot('heroMediaId', PERSISTED.heroMediaId);
    sellMedia.setSlot('signatureMediaId', PERSISTED.signatureMediaId);
    await sellMedia.save();

    // Clean again — a slot missing from save()'s re-baseline would stay dirty
    // forever and the panel's Save button would never settle.
    expect(sellMedia.isDirty).toBe(false);
    for (const slot of ALL_SLOTS) {
      expect(
        sellMedia.slot(slot as never),
        `${slot} was not re-baselined — check save()'s mapping`
      ).toBe(PERSISTED[slot as keyof JourneySellMedia]);
    }
  });

  it('propagates a refused save instead of reporting success', async () => {
    getJourneySellMedia.mockResolvedValue({ ...PERSISTED, heroMediaId: null });
    updateJourneySellMedia.mockRejectedValue(
      new Error('Media item does not belong to this space')
    );
    await sellMedia.open(PAGE_ID);

    sellMedia.setSlot('heroMediaId', PERSISTED.heroMediaId);
    await expect(sellMedia.save()).rejects.toThrow(
      'Media item does not belong to this space'
    );
    // The baseline must NOT have moved — the creator's draft is still unsaved.
    expect(sellMedia.isDirty).toBe(true);
  });
});
