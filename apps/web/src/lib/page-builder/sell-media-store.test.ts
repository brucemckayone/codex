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
 * The SAME failure mode has a second half, and it is why `UPLOADED_STILLS` below
 * is a table rather than three hand-written cases: the three uploaded stills
 * (cover, hero image, signature) are hand-listed in `open()` and again in
 * `save()`, and two of the three are OPTIONAL-additive on the wire — a worker
 * still serving an older dist omits the key entirely. So a forgotten mapping
 * reads back `undefined` and, with `strictNullChecks` off, type-checks perfectly;
 * the panel then renders its empty state over a file the creator can see in R2,
 * and offers an Upload where a Replace belongs.
 *
 * AND `open()`'s HALF IS NOT TYPE-CHECKED AT ALL — measured, not assumed. A
 * `query()` call's `.catch()` widens to `any` in this SvelteKit (2.55), so inside
 * `open()` the awaited `media` is `any`: I replaced one read with
 * `media.zzzNonsenseField` and `tsc --noEmit` over apps/web reported NOTHING.
 * `save()`'s half IS checked (a `command()`'s awaited value keeps its type), so
 * the two mappings have asymmetric protection and only these tests cover both.
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
const deleteJourneyHeroImage =
  vi.fn<(input: { pageId: string }) => Promise<void>>();
const deleteJourneySignatureImage =
  vi.fn<(input: { pageId: string }) => Promise<void>>();

/**
 * Every named export the STORE imports has to be here, and the factory is
 * CLOSED: a `vi.mock` factory replaces the whole module, so an import the store
 * adds later throws "No X export is defined on the mock" at first ACCESS — i.e.
 * inside the one method that uses it, not at load. That is late enough to look
 * like a bug in the method. The two delete commands are real `vi.fn()`s rather
 * than inline ones so a test can assert the request was actually made; the two
 * upload FORMS are only in the store's module graph via the panel, so a stub
 * shape is enough.
 */
vi.mock('$lib/remote/journeys.remote', () => ({
  getJourneySellMedia: (input: { pageId: string }) =>
    getJourneySellMedia(input),
  updateJourneySellMedia: (input: unknown) => updateJourneySellMedia(input),
  uploadJourneyCoverForm: { enhance: vi.fn(), fields: {}, pending: 0 },
  deleteJourneyCover: vi.fn(),
  uploadJourneyHeroImageForm: { enhance: vi.fn(), fields: {}, pending: 0 },
  deleteJourneyHeroImage: (input: { pageId: string }) =>
    deleteJourneyHeroImage(input),
  uploadJourneySignatureImageForm: { enhance: vi.fn(), fields: {}, pending: 0 },
  deleteJourneySignatureImage: (input: { pageId: string }) =>
    deleteJourneySignatureImage(input),
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
  deleteJourneyHeroImage.mockReset();
  deleteJourneyHeroImage.mockResolvedValue(undefined);
  deleteJourneySignatureImage.mockReset();
  deleteJourneySignatureImage.mockResolvedValue(undefined);
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

/**
 * THE THREE UPLOADED STILLS — the other half of this file's failure mode.
 *
 * They are not slots: they are written by their own multipart uploads, not by
 * `save()`, and the store only READS them back. But `open()` and `save()` still
 * hand-list all three, and the hero and signature are OPTIONAL-additive on the
 * wire, so a worker on an older dist omits the key rather than sending null.
 *
 * Derived table, for the same reason `ALL_SLOTS` is derived: a fourth uploaded
 * still added to the wire and to one mapping but not the other must fail HERE
 * rather than ship. Verified by mutation both ways — see each test.
 */
const UPLOADED_STILLS: readonly {
  /** The key on the wire (`JourneySellMedia`). */
  wire: 'coverImageUrl' | 'heroImageUrl' | 'signatureImageUrl';
  /** The store getter the panel actually renders from. */
  read: () => string | null;
  /**
   * True when the worker may omit the key entirely (deployment skew). The cover
   * predates the additive pair and is always sent.
   */
  optional: boolean;
}[] = [
  {
    wire: 'coverImageUrl',
    read: () => sellMedia.coverImageUrl,
    optional: false,
  },
  { wire: 'heroImageUrl', read: () => sellMedia.heroImageUrl, optional: true },
  {
    wire: 'signatureImageUrl',
    read: () => sellMedia.signatureImageUrl,
    optional: true,
  },
];

/** A distinct URL per still, so a crossed mapping fails as loudly as a missing one. */
const STILL_URLS: Record<string, string> = {
  coverImageUrl: 'https://cdn.example/courses/c/cover/md.webp',
  heroImageUrl: 'https://cdn.example/courses/c/hero/lg.webp',
  signatureImageUrl: 'https://cdn.example/courses/c/signature/md.webp',
};

describe('sell-media store · the uploaded stills', () => {
  it('hydrates EVERY uploaded still from the persisted shape', async () => {
    getJourneySellMedia.mockResolvedValue({
      ...PERSISTED,
      ...STILL_URLS,
    } as JourneySellMedia);

    await sellMedia.open(PAGE_ID);

    for (const still of UPLOADED_STILLS) {
      expect(
        still.read(),
        `${still.wire} was not hydrated — check open()'s mapping`
      ).toBe(STILL_URLS[still.wire]);
    }
  });

  it('reads an OMITTED optional-additive key as null, never undefined', async () => {
    // The deployment-skew case: a worker predating the column simply does not
    // send the key. `undefined` would leave `src={undefined}` one loosened guard
    // away from the DOM, and reads identically to "no upload" while being a
    // different fact — so it is normalised at the wire boundary, once.
    // Mutation-verified: deleting `?? null` from open() fails this.
    getJourneySellMedia.mockResolvedValue(PERSISTED);

    await sellMedia.open(PAGE_ID);

    for (const still of UPLOADED_STILLS.filter((s) => s.optional)) {
      expect(
        still.read(),
        `${still.wire} read back undefined — open() dropped its \`?? null\``
      ).toBeNull();
    }
  });

  it('re-baselines EVERY uploaded still from the save response', async () => {
    // `save()` writes only the six SLOTS, but the service echoes the whole row —
    // so the stills come back too, and dropping one from this mapping makes a
    // just-uploaded signature vanish from the panel the moment the creator
    // presses Save on unrelated copy.
    getJourneySellMedia.mockResolvedValue({ ...PERSISTED, heroMediaId: null });
    updateJourneySellMedia.mockResolvedValue({
      ...PERSISTED,
      ...STILL_URLS,
    } as JourneySellMedia);
    await sellMedia.open(PAGE_ID);

    sellMedia.setSlot('heroMediaId', PERSISTED.heroMediaId);
    await sellMedia.save();

    for (const still of UPLOADED_STILLS) {
      expect(
        still.read(),
        `${still.wire} was not re-baselined — check save()'s mapping`
      ).toBe(STILL_URLS[still.wire]);
    }
  });

  it('clearing the signature asks the server, and touches nothing else', async () => {
    getJourneySellMedia.mockResolvedValue({
      ...PERSISTED,
      ...STILL_URLS,
    } as JourneySellMedia);
    await sellMedia.open(PAGE_ID);

    await sellMedia.clearSignatureImage();

    expect(deleteJourneySignatureImage).toHaveBeenCalledWith({
      pageId: PAGE_ID,
    });
    expect(sellMedia.signatureImageUrl).toBeNull();
    // The two siblings are independent columns and independent uploads: clearing
    // one must not blank the others in the panel.
    expect(sellMedia.coverImageUrl).toBe(STILL_URLS.coverImageUrl);
    expect(sellMedia.heroImageUrl).toBe(STILL_URLS.heroImageUrl);
    // And it is not a slot write — the letter keeps its film fallback.
    expect(sellMedia.slot('signatureMediaId')).toBe(PERSISTED.signatureMediaId);
    expect(sellMedia.isDirty).toBe(false);
    expect(updateJourneySellMedia).not.toHaveBeenCalled();
  });

  it('a clear with no page open makes no request', async () => {
    // The panel disables its buttons on `!sellMedia.pageId`, but the store is the
    // boundary: a clear fired against a closed store would send `pageId:
    // undefined` and 400 in the creator's face.
    sellMedia.close();

    await sellMedia.clearSignatureImage();

    expect(deleteJourneySignatureImage).not.toHaveBeenCalled();
  });

  it('close() forgets every uploaded still', async () => {
    getJourneySellMedia.mockResolvedValue({
      ...PERSISTED,
      ...STILL_URLS,
    } as JourneySellMedia);
    await sellMedia.open(PAGE_ID);

    sellMedia.close();

    for (const still of UPLOADED_STILLS) {
      expect(
        still.read(),
        `${still.wire} survived close() — the next page would open showing it`
      ).toBeNull();
    }
  });
});

/**
 * A FAILED read — the state the builder had no treatment for anywhere.
 *
 * Both reads were `.catch(() => null)` with the reason discarded and only
 * `loading` exposed, so a media library that failed to list was
 * indistinguishable from an org with no ready media: six empty pickers, plus the
 * same `media` control in every section inspector, all quietly claiming "you have
 * nothing". And because `save()` is a TOTAL write, a creator who picked one clip
 * after a failed read would have sent five explicit nulls and CLEARED the other
 * five slots on the live sales page.
 *
 * So: the reason is kept, and a store with no baseline refuses to write.
 */
describe('sell-media store · read failure', () => {
  it('a clean load reports no error', async () => {
    getJourneySellMedia.mockResolvedValue(PERSISTED);

    await sellMedia.open(PAGE_ID);

    expect(sellMedia.loadError).toBeNull();
    expect(sellMedia.loaded).toBe(true);
  });

  it('keeps the LIBRARY failure reason instead of rendering it as "no media"', async () => {
    getJourneySellMedia.mockResolvedValue(PERSISTED);
    listMedia.mockRejectedValue({
      status: 500,
      body: { message: 'Media service unavailable' },
    });

    await sellMedia.open(PAGE_ID);

    expect(sellMedia.options).toEqual([]);
    // An empty list with a reason beside it is a different fact from an empty
    // list without one, and only the store can tell them apart.
    expect(sellMedia.loadError).toBe('Media service unavailable');
    // Fail-soft holds: the attached media still hydrated.
    expect(sellMedia.slot('heroMediaId')).toBe(PERSISTED.heroMediaId);
  });

  it('a failed ATTACHED-media read leaves no baseline, so a pick cannot wipe the rest', async () => {
    getJourneySellMedia.mockRejectedValue(
      new Error('Journey media unavailable')
    );

    await sellMedia.open(PAGE_ID);
    expect(sellMedia.loadError).toBe('Journey media unavailable');
    expect(sellMedia.loaded).toBe(false);

    sellMedia.setSlot('heroMediaId', PERSISTED.heroMediaId);
    // Not dirty ⇒ Save does not offer to persist a placeholder, and the leg in
    // `saveBuilderDraft` is skipped.
    expect(sellMedia.isDirty).toBe(false);

    await sellMedia.save();
    // THE ASSERTION THAT MATTERS: the destructive total write never happened.
    expect(updateJourneySellMedia).not.toHaveBeenCalled();
  });

  it('a journey with no subject course does not read media at all, and is not an error', async () => {
    // The slots live on the COURSE; the service answers NotFoundError for a page
    // with none. Asking anyway put a guaranteed 404 in every plain landing page's
    // log — and, once the reason is kept, an error in its author's face.
    await sellMedia.open(PAGE_ID, { hasCourse: false });

    expect(getJourneySellMedia).not.toHaveBeenCalled();
    expect(sellMedia.loadError).toBeNull();
    expect(sellMedia.loaded).toBe(false);
    // The library still loads: those options are org-wide, not course-scoped.
    expect(listMedia).toHaveBeenCalledTimes(1);
  });

  it('close() forgets a previous failure', async () => {
    getJourneySellMedia.mockRejectedValue(
      new Error('Journey media unavailable')
    );
    await sellMedia.open(PAGE_ID);
    expect(sellMedia.loadError).not.toBeNull();

    sellMedia.close();

    expect(sellMedia.loadError).toBeNull();
    expect(sellMedia.loaded).toBe(false);
  });
});
