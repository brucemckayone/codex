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
  getCourseCurriculum: vi.fn(),
  getCourseOffer: vi.fn(),
  getCoursePagePreview: vi.fn(),
  resolveSellPreview: vi.fn(),
  getJourneySellMedia: vi.fn(async () => null),
  updateJourneySellMedia: vi.fn(),
  deleteJourneyCover: vi.fn(),
  deleteJourneyHeroImage: vi.fn(),
  deleteJourneySignatureImage: vi.fn(),
  getCourseMonetisation: vi.fn(async () => null),
  updateCourseMonetisation: vi.fn(),
}));
vi.mock('$lib/remote/media.remote', () => ({
  listMedia: vi.fn(async () => ({ items: [] })),
}));

const { createBuilderSession } = await import('./builder-session.svelte');
const { pageBuilder } = await import(
  '$lib/page-builder/page-builder-store.svelte'
);

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

/** Resolve the promises a save chain awaits, one macrotask at a time. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  flushSync();
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  draft = new FakeQuery<JourneyPageRecord>();
  remotes.getJourneyForBuilder.mockImplementation(() => draft);
  remotes.saveJourneyPage.mockReset().mockResolvedValue(undefined);
  remotes.updateJourneyOffer.mockReset().mockResolvedValue(undefined);
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

  it('carries a legacy crash-recovery draft over in v2 vocabulary', () => {
    const legacy = legacyRecord();
    const {
      id: _id,
      organizationId: _o,
      publishedAt: _p,
      ...editable
    } = legacy;
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        pageId: PAGE_ID,
        pending: {
          ...editable,
          title: 'Bone Deep, recovered',
          sections: editable.sections.map((s) =>
            s.id === 'sec-ache'
              ? { ...s, props: { heading: 'Typed before the crash' } }
              : s
          ),
        },
      })
    );
    const session = start(legacy);
    const pending = pageBuilder.pending;
    expect(pending?.sections.map((s) => s.type)).toEqual(['hero', 'problem']);
    expect(pending?.sections[1].props).toEqual({
      heading: 'Typed before the crash',
    });
    expect(pending?.title).toBe('Bone Deep, recovered');
    expect(session.isDirty).toBe(true);
    // Undo walks back to the saved page, not to the legacy draft.
    while (pageBuilder.canUndo) pageBuilder.undo();
    expect(pageBuilder.pending?.sections[1].props).toEqual({
      heading: 'You already know',
    });
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
