/**
 * The editor session: open (upgrade + crash recovery), the draft/published
 * save split, the publish gate and the three status transitions, and the two
 * guards. Remotes are mocked; the three stores are the real modules.
 */
import type { PageSection } from '@codex/shared-types';
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JourneyPageRecord } from '$lib/page-builder';

const remotes = vi.hoisted(() => ({
  getJourneyForBuilder: vi.fn(),
  saveJourneyPage: vi.fn(),
  updateJourneyOffer: vi.fn(),
  getCourseCurriculum: vi.fn(),
  getCourseOffer: vi.fn(),
  getCoursePagePreview: vi.fn(),
  resolveSellPreview: vi.fn(),
  getJourneySellMedia: vi.fn(),
  updateJourneySellMedia: vi.fn(),
  getCourseMonetisation: vi.fn(),
  updateCourseMonetisation: vi.fn(),
}));
const nav = vi.hoisted(() => ({
  guards: [] as Array<(navigation: unknown) => void>,
  goto: vi.fn(),
  invalidate: vi.fn(),
}));
const toasts = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));

vi.mock('$app/navigation', () => ({
  beforeNavigate: (guard: (navigation: unknown) => void) => {
    nav.guards.push(guard);
  },
  goto: (...args: unknown[]) => nav.goto(...args),
  invalidate: (...args: unknown[]) => nav.invalidate(...args),
}));
vi.mock('$app/state', () => ({
  page: {
    url: new URL('http://studio-alpha.lvh.me:3000/studio/journeys/p/page-next'),
    params: {},
  },
}));
vi.mock('$lib/components/ui/Toast/toast-store', () => ({ toast: toasts }));
vi.mock('$lib/remote/journeys.remote', () => ({
  getJourneyForBuilder: (input: unknown) => remotes.getJourneyForBuilder(input),
  saveJourneyPage: (input: unknown) => remotes.saveJourneyPage(input),
  updateJourneyOffer: (input: unknown) => remotes.updateJourneyOffer(input),
  getCourseCurriculum: (input: unknown) => remotes.getCourseCurriculum(input),
  getCourseOffer: (input: unknown) => remotes.getCourseOffer(input),
  getCoursePagePreview: (input: unknown) => remotes.getCoursePagePreview(input),
  resolveSellPreview: (input: unknown) => remotes.resolveSellPreview(input),
  getJourneySellMedia: (input: unknown) => remotes.getJourneySellMedia(input),
  updateJourneySellMedia: (input: unknown) =>
    remotes.updateJourneySellMedia(input),
  deleteJourneyCover: vi.fn(),
  deleteJourneyHeroImage: vi.fn(),
  deleteJourneySignatureImage: vi.fn(),
  getCourseMonetisation: (input: unknown) =>
    remotes.getCourseMonetisation(input),
  updateCourseMonetisation: (input: unknown) =>
    remotes.updateCourseMonetisation(input),
}));
vi.mock('$lib/remote/media.remote', () => ({
  listMedia: vi.fn(async () => ({ items: [] })),
}));

const { createBuilderSession } = await import('./builder-session.svelte');
const { pageBuilder } = await import(
  '$lib/page-builder/page-builder-store.svelte'
);
const { monetisation } = await import(
  '$lib/page-builder/monetisation-store.svelte'
);
const { sellMedia } = await import('$lib/page-builder/sell-media-store.svelte');

type Session = ReturnType<typeof createBuilderSession>;

/** A remote query as the session reads it, reactive like the real one. */
class FakeQuery<T> {
  current = $state<T | null | undefined>(undefined);
  loading = $state(true);
  error = $state<unknown>(undefined);
  refresh = vi.fn(async () => {});
}

const PAGE_ID = '00000000-0000-4000-8000-0000000000a1';
const STORAGE_KEY = 'codex:page-builder';

const hero = (): PageSection => ({
  id: 'sec-hero',
  type: 'hero',
  enabled: true,
  props: { heading: 'Find your ground' },
});

function record(overrides: Partial<JourneyPageRecord> = {}): JourneyPageRecord {
  return {
    id: PAGE_ID,
    organizationId: 'org-1',
    publishedAt: null,
    pageType: 'course',
    slug: 'bone-deep',
    title: 'Bone Deep',
    status: 'draft',
    subjectType: null,
    subjectId: null,
    brandOverrides: null,
    design: { style: 'bold' },
    sections: [hero()],
    ...overrides,
  };
}

/** The legacy row shape the old builder stored. */
function legacyRecord(): JourneyPageRecord {
  return record({
    design: { width: 'wide', density: 'regular' },
    sections: [
      {
        id: 'sec-hero',
        type: 'hero',
        enabled: true,
        variant: 'split-media',
        props: { headline: 'Bone Deep' },
      },
      {
        id: 'sec-ache',
        type: 'ache',
        enabled: true,
        design: { surface: 'invert' },
        props: { heading: 'You already know' },
      },
    ],
  });
}

let draft: FakeQuery<JourneyPageRecord>;
let stop: (() => void) | null = null;

function start(loaded: JourneyPageRecord | null = record()): Session {
  draft.current = loaded;
  draft.loading = false;
  let session: Session | undefined;
  stop = $effect.root(() => {
    session = createBuilderSession({ pageId: () => PAGE_ID });
  });
  flushSync();
  if (!session) throw new Error('session not created');
  return session;
}

function editHeading(value: string): void {
  pageBuilder.setSectionProp('sec-hero', 'heading', value);
  flushSync();
}

/** The tab goes down: the session is gone, its recovery row is not. */
function crash(): void {
  const row = sessionStorage.getItem(STORAGE_KEY);
  stop?.();
  stop = null;
  if (row) sessionStorage.setItem(STORAGE_KEY, row);
}

/** Resolve the promises a save chain awaits, one macrotask at a time. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  flushSync();
}

/** Settle a whole chain: a save, then the follow-up it queued. */
async function drain(): Promise<void> {
  for (let i = 0; i < 8; i++) await settle();
}

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** The course the monetisation leg reads and writes, as the remote returns it. */
function plan(priceMonthly: number) {
  return {
    courseId: 'course-1',
    subscription: { priceMonthly, priceAnnual: 10000 },
    tierIds: [],
    tierOptions: [],
  };
}

/** The sell media the media leg writes, as the remote echoes it back. */
function mediaEcho(heroMediaId: string | null) {
  return {
    courseId: 'course-1',
    introVideoMediaId: null,
    previewVideoMediaId: null,
    guideVideoMediaId: null,
    guidePortraitMediaId: null,
    heroMediaId,
    signatureMediaId: null,
    coverImageUrl: null,
  };
}

beforeEach(() => {
  draft = new FakeQuery<JourneyPageRecord>();
  remotes.getJourneyForBuilder.mockImplementation(() => draft);
  remotes.saveJourneyPage.mockReset().mockResolvedValue(undefined);
  remotes.updateJourneyOffer.mockReset().mockResolvedValue(undefined);
  for (const read of [
    remotes.getCourseCurriculum,
    remotes.getCourseOffer,
    remotes.getCoursePagePreview,
    remotes.resolveSellPreview,
  ]) {
    read.mockReset().mockReturnValue(undefined);
  }
  remotes.getJourneySellMedia.mockReset().mockResolvedValue(null);
  remotes.updateJourneySellMedia.mockReset();
  remotes.getCourseMonetisation.mockReset().mockResolvedValue(null);
  remotes.updateCourseMonetisation.mockReset();
  nav.guards.length = 0;
  nav.goto.mockReset().mockResolvedValue(undefined);
  nav.invalidate.mockReset().mockResolvedValue(undefined);
  for (const spy of Object.values(toasts)) spy.mockClear();
  sessionStorage.clear();
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('load', () => {
  it('reports loading, then missing for a page this org does not have', () => {
    draft.loading = true;
    let session: Session | undefined;
    stop = $effect.root(() => {
      session = createBuilderSession({ pageId: () => PAGE_ID });
    });
    flushSync();
    expect(session?.load).toBe('loading');
    draft.current = null;
    draft.loading = false;
    flushSync();
    expect(session?.load).toBe('missing');
  });

  it('reports a failed read with its message, never the spinner', () => {
    let session: Session | undefined;
    stop = $effect.root(() => {
      session = createBuilderSession({ pageId: () => PAGE_ID });
    });
    // A rejected query: `current` stays undefined and `loading` goes false.
    draft.error = { status: 500, body: { message: 'Worker down' } };
    draft.loading = false;
    flushSync();
    expect(session?.load).toBe('error');
    expect(session?.loadError).toBe('Worker down');
  });
});

describe('open', () => {
  it('upgrades a legacy page before the store sees it, and stays clean', () => {
    const session = start(legacyRecord());
    expect(session.load).toBe('ready');
    const pending = pageBuilder.pending;
    expect(pending?.design).toEqual({ style: 'bold' });
    expect(pending?.sections.map((s) => s.type)).toEqual(['hero', 'problem']);
    expect(pending?.sections[0].props).toEqual({ heading: 'Bone Deep' });
    expect(pending?.sections[0].variant).toBe('split');
    expect(pending?.sections[1].design).toEqual({ scheme: 'contrast' });
    // The upgraded page IS the baseline: nothing to save until an edit.
    expect(session.isDirty).toBe(false);
    expect(session.page?.sections).toHaveLength(2);
  });

  it('restores unsaved changes edited from the page the server still holds', () => {
    start(legacyRecord());
    pageBuilder.updateMeta('title', 'Bone Deep, recovered');
    flushSync();
    crash();

    const session = start(legacyRecord());
    // The draft is the UPGRADED page it was edited as, with the edit on it.
    expect(pageBuilder.pending?.sections.map((s) => s.type)).toEqual([
      'hero',
      'problem',
    ]);
    expect(pageBuilder.pending?.title).toBe('Bone Deep, recovered');
    expect(session.isDirty).toBe(true);
    expect(toasts.info).toHaveBeenCalledWith('Restored your unsaved changes');
  });

  it('reloading with a recovery row older than the server copy does not autosave it', async () => {
    vi.useFakeTimers();
    start();
    editHeading('Typed in this tab');
    crash();

    // Meanwhile another tab renamed the page and published it.
    const session = start(
      record({ title: 'Edited in the other tab', status: 'published' })
    );
    expect(pageBuilder.pending?.title).toBe('Edited in the other tab');
    expect(pageBuilder.pending?.sections[0].props.heading).toBe(
      'Find your ground'
    );
    expect(session.status).toBe('published');
    expect(session.isDirty).toBe(false);
    expect(toasts.warning).toHaveBeenCalledWith(
      'Unsaved changes from an earlier session weren’t restored because the page has changed since.'
    );
    vi.advanceTimersByTime(5000);
    await settle();
    expect(remotes.saveJourneyPage).not.toHaveBeenCalled();
  });

  it('never takes the status from a recovery row', () => {
    start();
    // The tab went down mid-publish, with the status already flipped.
    pageBuilder.updateMeta('status', 'published', { record: false });
    editHeading('Typed before the crash');
    crash();

    const session = start();
    expect(pageBuilder.pending?.sections[0].props.heading).toBe(
      'Typed before the crash'
    );
    expect(session.status).toBe('draft');
  });
});

describe('autosave', () => {
  it('saves a draft ~1.5s after the last change, in v2 vocabulary', async () => {
    vi.useFakeTimers();
    const session = start(legacyRecord());
    editHeading('Bone Deep, again');
    vi.advanceTimersByTime(1000);
    editHeading('Bone Deep, again and again');
    vi.advanceTimersByTime(1000);
    expect(remotes.saveJourneyPage).not.toHaveBeenCalled();
    vi.advanceTimersByTime(600);
    await settle();
    expect(remotes.saveJourneyPage).toHaveBeenCalledTimes(1);
    const sent = remotes.saveJourneyPage.mock.calls[0][0];
    expect(sent.design).toEqual({ style: 'bold' });
    expect(sent.sections.map((s: PageSection) => s.type)).toEqual([
      'hero',
      'problem',
    ]);
    expect(sent.sections[0].props.heading).toBe('Bone Deep, again and again');
    expect(session.isDirty).toBe(false);
    expect(session.saveStatus).toBe('saved');
  });

  it('never autosaves a published page — changes wait for Publish changes', async () => {
    vi.useFakeTimers();
    const session = start(record({ status: 'published' }));
    editHeading('A live edit');
    vi.advanceTimersByTime(5000);
    await settle();
    expect(remotes.saveJourneyPage).not.toHaveBeenCalled();
    expect(session.hasUnpublishedChanges).toBe(true);
  });

  it('does not mark keystrokes typed during a save as saved', async () => {
    vi.useFakeTimers();
    const first = deferred();
    remotes.saveJourneyPage.mockImplementationOnce(() => first.promise);
    const session = start();
    editHeading('Sent in the first save');
    vi.advanceTimersByTime(1500);
    await settle();
    expect(remotes.saveJourneyPage).toHaveBeenCalledTimes(1);
    editHeading('Typed while it was saving');
    first.resolve();
    await settle();
    await settle();
    expect(remotes.saveJourneyPage).toHaveBeenCalledTimes(2);
    expect(
      remotes.saveJourneyPage.mock.calls[1][0].sections[0].props.heading
    ).toBe('Typed while it was saving');
    expect(session.isDirty).toBe(false);
  });

  it('a crash after an overtaken save still restores the edit typed during it', async () => {
    vi.useFakeTimers();
    const first = deferred();
    remotes.saveJourneyPage
      .mockImplementationOnce(() => first.promise)
      // The follow-up never lands: the tab goes down first.
      .mockImplementationOnce(() => new Promise(() => {}));
    start();
    editHeading('Sent in the first save');
    vi.advanceTimersByTime(1500);
    await settle();
    editHeading('Typed while it was saving');
    first.resolve();
    await drain();
    expect(remotes.saveJourneyPage).toHaveBeenCalledTimes(2);
    crash();

    // The server holds what the first save sent, so the draft still applies.
    start(
      record({
        sections: [{ ...hero(), props: { heading: 'Sent in the first save' } }],
      })
    );
    expect(pageBuilder.pending?.sections[0].props.heading).toBe(
      'Typed while it was saving'
    );
    expect(toasts.info).toHaveBeenCalledWith('Restored your unsaved changes');
  });

  it('a one-off price typed during an autosave survives the save', async () => {
    vi.useFakeTimers();
    const first = deferred();
    remotes.saveJourneyPage.mockImplementationOnce(() => first.promise);
    const session = start();
    pageBuilder.updateOffer({ oneOffEnabled: true, oneOffPriceCents: 4900 });
    flushSync();
    vi.advanceTimersByTime(1500);
    await settle();
    expect(remotes.saveJourneyPage).toHaveBeenCalledTimes(1);

    // Corrected while the page leg is in flight.
    pageBuilder.updateOffer({ oneOffPriceCents: 4500 });
    flushSync();
    first.resolve();
    await drain();

    const sent = remotes.updateJourneyOffer.mock.calls.map(
      (call) => call[0].offer.oneOffPriceCents
    );
    expect(sent).toEqual([4900, 4500]);
    expect(pageBuilder.pending?.offer?.oneOffPriceCents).toBe(4500);
    expect(session.isDirty).toBe(false);
    expect(session.saveStatus).toBe('saved');
  });

  it('a price typed during the monetisation leg is not reverted', async () => {
    vi.useFakeTimers();
    remotes.getCourseMonetisation.mockResolvedValue(plan(1000));
    const inflight = deferred<ReturnType<typeof plan>>();
    remotes.updateCourseMonetisation
      .mockImplementationOnce(() => inflight.promise)
      .mockResolvedValueOnce(plan(2900));
    const session = start(
      record({ subjectType: 'course', subjectId: 'course-1' })
    );
    await settle();
    expect(monetisation.loaded).toBe(true);

    monetisation.setPriceMonthly(2000);
    flushSync();
    vi.advanceTimersByTime(1500);
    await drain();
    expect(remotes.updateCourseMonetisation).toHaveBeenCalledTimes(1);

    // Typed while the Stripe-backed write is in flight.
    monetisation.setPriceMonthly(2900);
    flushSync();
    inflight.resolve(plan(2000));
    await drain();

    const sent = remotes.updateCourseMonetisation.mock.calls.map(
      (call) => call[0].subscriptionPriceMonthly
    );
    expect(sent).toEqual([2000, 2900]);
    expect(monetisation.draft.priceMonthlyCents).toBe(2900);
    expect(session.isDirty).toBe(false);
    expect(session.saveStatus).toBe('saved');
  });

  it('an offer set back after a later leg failed is sent again', async () => {
    vi.useFakeTimers();
    remotes.updateJourneySellMedia
      .mockRejectedValueOnce({ body: { message: 'That clip is not ready' } })
      .mockResolvedValueOnce(mediaEcho('media-2'));
    const session = start(
      record({
        subjectType: 'course',
        subjectId: 'course-1',
        offer: { oneOffEnabled: true, oneOffPriceCents: 4900 },
      })
    );
    await settle();
    expect(sellMedia.loaded).toBe(true);
    const oneOffPrices = () =>
      remotes.updateJourneyOffer.mock.calls.map(
        (call) => call[0].offer.oneOffPriceCents
      );

    pageBuilder.updateOffer({ oneOffPriceCents: 5900 });
    sellMedia.setSlot('heroMediaId', 'media-1');
    flushSync();
    vi.advanceTimersByTime(1500);
    await drain();
    // The price landed; the media leg after it was refused.
    expect(oneOffPrices()).toEqual([5900]);
    expect(session.saveStatus).toBe('error');

    // The creator changes their mind about the price, and fixes the media.
    pageBuilder.updateOffer({ oneOffPriceCents: 4900 });
    sellMedia.setSlot('heroMediaId', 'media-2');
    flushSync();
    vi.advanceTimersByTime(1500);
    await drain();

    // The server holds £59, so £49 is a change and is sent.
    expect(oneOffPrices()).toEqual([5900, 4900]);
    expect(session.isDirty).toBe(false);
    expect(session.saveStatus).toBe('saved');
  });

  it('toasts a failed autosave once, with the server’s reason', async () => {
    vi.useFakeTimers();
    remotes.saveJourneyPage.mockRejectedValue({
      body: { message: 'The slug "bone-deep" is already in use' },
    });
    const session = start();
    editHeading('Will not save');
    vi.advanceTimersByTime(1500);
    await settle();
    expect(session.saveStatus).toBe('error');
    expect(toasts.error).toHaveBeenCalledTimes(1);
    expect(toasts.error.mock.calls[0][1]).toContain('already in use');
  });
});

describe('publish', () => {
  it('refuses a page with no hero, names why and focuses nothing it cannot', async () => {
    const session = start(record({ sections: [] }));
    const result = await session.publish();
    expect(result.ok).toBe(false);
    expect(toasts.error).toHaveBeenCalled();
    expect(remotes.saveJourneyPage).not.toHaveBeenCalled();
    expect(session.status).toBe('draft');
  });

  it('refuses a second hero and selects it for the creator', async () => {
    const session = start(
      record({ sections: [hero(), { ...hero(), id: 'sec-hero-2' }] })
    );
    const result = await session.publish();
    expect(result).toEqual({ ok: false, reveal: 'sec-hero-2' });
    expect(pageBuilder.selectedSectionId).toBe('sec-hero-2');
  });

  it('publishes a draft: status, one save, a clean page', async () => {
    const session = start();
    const result = await session.publish();
    await settle();
    expect(result.ok).toBe(true);
    expect(remotes.saveJourneyPage).toHaveBeenCalledTimes(1);
    expect(remotes.saveJourneyPage.mock.calls[0][0].status).toBe('published');
    expect(session.status).toBe('published');
    expect(session.isDirty).toBe(false);
    expect(toasts.success).toHaveBeenCalledWith('Page published');
  });

  it('rolls the status back when nothing reached the server', async () => {
    remotes.saveJourneyPage.mockRejectedValue(new Error('offline'));
    const session = start();
    const result = await session.publish();
    expect(result.ok).toBe(false);
    expect(session.status).toBe('draft');
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it('keeps the page live when only a later leg failed', async () => {
    remotes.updateJourneyOffer.mockRejectedValue({
      body: { message: 'Set a one-off price' },
    });
    const session = start();
    pageBuilder.updateOffer({ oneOffEnabled: true });
    flushSync();
    const result = await session.publish();
    expect(result.ok).toBe(false);
    // The page row — with its status — landed before the pricing leg.
    expect(remotes.saveJourneyPage.mock.calls[0][0].status).toBe('published');
    expect(session.status).toBe('published');
  });

  it('publishes changes on a live page', async () => {
    const session = start(record({ status: 'published' }));
    editHeading('A better promise');
    const result = await session.publishChanges();
    expect(result.ok).toBe(true);
    expect(
      remotes.saveJourneyPage.mock.calls[0][0].sections[0].props.heading
    ).toBe('A better promise');
    expect(session.hasUnpublishedChanges).toBe(false);
  });

  it('unpublishes back to a draft', async () => {
    const session = start(record({ status: 'published' }));
    const ok = await session.unpublish();
    expect(ok).toBe(true);
    expect(remotes.saveJourneyPage.mock.calls[0][0].status).toBe('draft');
    expect(session.status).toBe('draft');
  });
});

describe('the status is never an undo step', () => {
  it('undo after publish never changes the status, and never unpublishes', async () => {
    vi.useFakeTimers();
    const session = start();
    editHeading('Before going live');
    expect((await session.publish()).ok).toBe(true);
    await settle();
    remotes.saveJourneyPage.mockClear();

    editHeading('An edit on the live page');
    while (pageBuilder.canUndo) pageBuilder.undo();
    flushSync();

    expect(pageBuilder.pending?.sections[0].props.heading).toBe(
      'Find your ground'
    );
    expect(session.status).toBe('published');
    vi.advanceTimersByTime(5000);
    await settle();
    // Still live, so nothing autosaves — and nothing ever sent 'draft'.
    expect(remotes.saveJourneyPage).not.toHaveBeenCalled();
  });

  it('undo after unpublish never shows Live over a draft', async () => {
    const session = start(record({ status: 'published' }));
    editHeading('A live edit');
    expect(await session.unpublish()).toBe(true);

    while (pageBuilder.canUndo) pageBuilder.undo();
    flushSync();

    expect(session.status).toBe('draft');
    expect(session.hasUnpublishedChanges).toBe(false);
  });

  it('a failed publish rolls back without leaving a step to undo', async () => {
    remotes.saveJourneyPage.mockRejectedValue(new Error('offline'));
    const session = start();
    expect((await session.publish()).ok).toBe(false);

    expect(session.status).toBe('draft');
    expect(pageBuilder.canUndo).toBe(false);
  });
});

describe('guards', () => {
  it('blocks an unload while anything is unsaved', () => {
    start();
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    editHeading('Unsaved');
    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });

  it('saves a dirty draft before an in-app navigation, then continues it', async () => {
    start();
    editHeading('Save me first');
    const cancel = vi.fn();
    const to = new URL('http://studio-alpha.lvh.me:3000/studio/journeys');
    nav.guards[0]({ willUnload: false, to: { url: to }, cancel });
    expect(cancel).toHaveBeenCalled();
    await settle();
    expect(remotes.saveJourneyPage).toHaveBeenCalledTimes(1);
    expect(nav.goto).toHaveBeenCalledWith(to);
  });

  it('asks before leaving a live page with unpublished changes', () => {
    start(record({ status: 'published' }));
    editHeading('Not published yet');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const cancel = vi.fn();
    nav.guards[0]({
      willUnload: false,
      to: { url: new URL('http://studio-alpha.lvh.me:3000/studio') },
      cancel,
    });
    expect(confirm).toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
    expect(remotes.saveJourneyPage).not.toHaveBeenCalled();
  });

  it('keeps the canvas’s own links from navigating the editor away', () => {
    start();
    const cancel = vi.fn();
    nav.guards[0]({
      willUnload: false,
      to: {
        url: new URL(
          'http://studio-alpha.lvh.me:3000/journeys/bone-deep/checkout'
        ),
      },
      cancel,
    });
    expect(cancel).toHaveBeenCalled();
  });
});

describe('sections', () => {
  it('inserts at the top as one undoable step, with course-aware starter copy', () => {
    const session = start();
    const id = session.insertSection('cta', null);
    flushSync();
    expect(pageBuilder.pending?.sections[0].id).toBe(id);
    expect(pageBuilder.selectedSectionId).toBe(id);
    pageBuilder.undo();
    expect(pageBuilder.pending?.sections.map((s) => s.id)).toEqual([
      'sec-hero',
    ]);
  });

  it('fills an empty page from the Style’s template', () => {
    const session = start(record({ sections: [] }));
    session.startFromTemplate();
    flushSync();
    const types = pageBuilder.pending?.sections.map((s) => s.type) ?? [];
    expect(types[0]).toBe('hero');
    expect(types.length).toBeGreaterThan(3);
    expect(pageBuilder.pending?.sections[0].props.heading).toBe('Bone Deep');
  });
});
