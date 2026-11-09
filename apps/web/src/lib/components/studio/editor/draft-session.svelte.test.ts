/**
 * The content draft session (Codex-a6ofh.2.2): what each save sends, when it
 * sends it, how a new piece gets its row and its title, and the leave
 * guards. The remote commands are mocked; the autosave controller is real.
 */
import type { PublicationState } from '@codex/constants';
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contentSlugFromTitle } from '$lib/utils/content-slug';
import * as m from '$paraglide/messages';
import type { DraftValues } from './draft-session.svelte';

const remotes = vi.hoisted(() => ({
  saveContent: vi.fn(),
  createContentDraft: vi.fn(),
  readPublishState: vi.fn(),
}));
const nav = vi.hoisted(() => ({
  guards: [] as Array<(navigation: unknown) => void>,
  goto: vi.fn(),
  invalidateAll: vi.fn(),
}));
const told = vi.hoisted(() => ({
  toastAdd: vi.fn(),
  toastWarning: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}));

vi.mock('$lib/remote/content.remote', () => remotes);
vi.mock('$app/navigation', () => ({
  beforeNavigate: (guard: (navigation: unknown) => void) => {
    nav.guards.push(guard);
  },
  goto: (...args: unknown[]) => nav.goto(...args),
  invalidateAll: (...args: unknown[]) => nav.invalidateAll(...args),
}));
vi.mock('$lib/components/ui/Toast/toast-store', () => ({
  toast: { add: told.toastAdd, warning: told.toastWarning },
}));
vi.mock('$lib/observability', () => ({
  logger: { error: told.logError, warn: told.logWarn, info: told.logInfo },
}));

const { answeredLive, createDraftSession } = await import(
  './draft-session.svelte'
);
const { takeLiveHandoff, withdrawLiveHandoff } = await import('./live-handoff');
type Options = Parameters<typeof createDraftSession>[0];
type Session = ReturnType<typeof createDraftSession>;

const ID = '5e000000-0000-4000-8000-000000000001';
const ORG = '6e000000-0000-4000-8000-000000000002';
const SAVED_VALUES: DraftValues = {
  title: 'Runes deep dive',
  description: 'All three runes.',
  contentBody: null,
  mediaItemId: '7e000000-0000-4000-8000-000000000003',
  // Typed by the creator, not the title's: it never follows it.
  slug: 'runes-explained',
  categoryIds: ['8e000000-0000-4000-8000-000000000004'],
  tags: ['svelte'],
  featured: false,
  access: { kind: 'free', priceCents: 0, tierIds: [] },
  thumbnailUrl: null,
  shaderPreset: null,
};
const DRAFT: PublicationState = { status: 'draft', publishedAt: null };
const LIVE: PublicationState = {
  status: 'published',
  publishedAt: '2026-11-01T09:00:00.000Z',
};

const doc = (...text: string[]) =>
  JSON.stringify({
    type: 'doc',
    content: text.map((value) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: value }],
    })),
  });

/** What the real remote client throws when the network is gone. */
const offline = () => new TypeError('Failed to fetch');

let stop: (() => void) | null = null;
/**
 * What the page says the piece is; a test may change it mid-session. State,
 * as a page's would be, so the session can see it change.
 */
let publication = $state<PublicationState>(DRAFT);

function start(overrides: Partial<Options> = {}): Session {
  let session: Session | undefined;
  stop = $effect.root(() => {
    session = createDraftSession({
      saved: { id: ID, values: SAVED_VALUES },
      publication: () => publication,
      contentType: 'video',
      organizationId: ORG,
      ...overrides,
    });
  });
  // Runs the session's teardown effect, as mounting a component would.
  flushSync();
  if (!session) throw new Error('session not created');
  return session;
}

/** Unmount the editor in place, as a component closing would. */
function close(): void {
  stop?.();
  stop = null;
}

/** An in-app link click, as SvelteKit's beforeNavigate would see it. */
function navigate(cancel = vi.fn(), path = '/studio/content') {
  const to = new URL(path, 'http://studio-alpha.lvh.me:3000');
  nav.guards[0]?.({ willUnload: false, to: { url: to }, cancel });
  return { to, cancel };
}

/** Closing the tab: true when the page asked first. */
function unload(): boolean {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

/** Past the debounce, and every save it starts. */
const afterDebounce = () => vi.advanceTimersByTimeAsync(1500);
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  publication = DRAFT;
  nav.guards.length = 0;
  nav.goto.mockReset().mockResolvedValue(undefined);
  // The page's own refresh, as kit's: it reads the piece as the read
  // before it did. One that fails still resolves (a test says so).
  nav.invalidateAll.mockReset().mockImplementation(async () => {
    publication = LIVE;
  });
  withdrawLiveHandoff(ID);
  // Where the piece stands, as "Open it to update" reads it: live.
  remotes.readPublishState.mockReset().mockResolvedValue({
    status: 'published',
    publishedAt: '2026-11-09T10:00:00.000Z',
    publishRequestedAt: null,
    publishBlockedReason: null,
    slug: SAVED_VALUES.slug,
  });
  remotes.saveContent.mockReset().mockResolvedValue(undefined);
  // As the command does: the slug from the title it was sent.
  remotes.createContentDraft
    .mockReset()
    .mockImplementation(
      async (draft: { title: string; contentType: string }) => ({
        id: ID,
        slug: contentSlugFromTitle(draft.title, draft.contentType),
      })
    );
  for (const spy of Object.values(told)) spy.mockReset();
});

afterEach(() => {
  close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('what a save sends, and when', () => {
  // The first save sends only the title: the bead's "only the changed keys".
  it('saves once, 1.5 s after the last change, only what changed', async () => {
    const session = start();
    session.set('title', 'R');
    await vi.advanceTimersByTimeAsync(1000);
    session.set('title', 'Runes');
    await vi.advanceTimersByTimeAsync(1400);
    expect(remotes.saveContent).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    expect(remotes.saveContent).toHaveBeenCalledTimes(1);
    expect(remotes.saveContent).toHaveBeenCalledWith({
      id: ID,
      asDraft: true,
      patch: { title: 'Runes' },
    });
    expect(session.status).toBe('saved');
    expect(session.isDirty).toBe(false);
  });

  it('a change put back before the save sends nothing', async () => {
    const session = start();
    session.set('title', 'Something else');
    session.set('title', SAVED_VALUES.title);
    expect(session.isDirty).toBe(false);
    await expect(session.flush()).resolves.toEqual({ ok: true });
    expect(remotes.saveContent).not.toHaveBeenCalled();
  });

  it('one save at a time: what is typed during it goes next, and only that', async () => {
    const first = Promise.withResolvers<undefined>();
    remotes.saveContent.mockReturnValueOnce(first.promise);
    const session = start();
    session.set('title', 'First');
    await afterDebounce();
    expect(remotes.saveContent).toHaveBeenCalledTimes(1);

    session.set('description', 'Typed while saving');
    await afterDebounce();
    expect(remotes.saveContent).toHaveBeenCalledTimes(1);

    first.resolve(undefined);
    await settle();
    expect(remotes.saveContent).toHaveBeenCalledTimes(2);
    expect(remotes.saveContent).toHaveBeenLastCalledWith({
      id: ID,
      asDraft: true,
      patch: { description: 'Typed while saving' },
    });
  });

  it('a refused save says why and keeps its code, and Retry sends it again', async () => {
    remotes.saveContent.mockRejectedValueOnce({
      status: 409,
      body: {
        message: 'Content with this slug already exists',
        code: 'CONFLICT',
      },
    });
    const session = start();
    session.set('title', 'Refused once');
    const result = await session.flush();

    expect(result).toEqual({
      ok: false,
      message: 'Content with this slug already exists',
      code: 'CONFLICT',
    });
    expect(session.status).toBe('error');
    expect(session.errorMessage).toBe('Content with this slug already exists');
    expect(session.isDirty).toBe(true);
    expect(told.logWarn).toHaveBeenCalledWith(
      'studio_editor.save_refused',
      expect.objectContaining({ contentId: ID, status: 409 })
    );

    session.retry();
    await settle();
    expect(remotes.saveContent).toHaveBeenCalledTimes(2);
    expect(session.status).toBe('saved');
    expect(session.isDirty).toBe(false);
  });

  // What the remote client really throws: never its transport words. The
  // creator's own network (the browser says it is offline) is a warning;
  // anything else that never answered is an outage, an error, as the
  // studio's one rule has it, a TypeError from our own code included.
  it.each([
    [
      'the network is gone',
      offline(),
      'logWarn',
      'studio_editor.save_offline',
      false,
    ],
    [
      'a fetch failed while the browser is online',
      offline(),
      'logError',
      'studio_editor.save_failed',
      true,
    ],
    [
      'the response was not one',
      new Error('Failed to execute remote function'),
      'logError',
      'studio_editor.save_failed',
      true,
    ],
    [
      'the worker failed',
      {
        status: 500,
        body: {
          message: 'An unexpected error occurred',
          code: 'INTERNAL_ERROR',
        },
      },
      'logError',
      'studio_editor.save_failed',
      true,
    ],
  ] as const)('when %s, the bar says it plainly and the log keeps it', async (_label, thrown, log, event, online) => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
    remotes.saveContent.mockRejectedValueOnce(thrown);
    const session = start();
    session.set('title', 'Offline');
    await expect(session.flush()).resolves.toMatchObject({
      ok: false,
      message: m.studio_content_draft_save_failed(),
    });
    expect(told[log]).toHaveBeenCalledWith(
      event,
      expect.objectContaining({ contentId: ID })
    );
  });

  it('a rate-limited save is an outage in the log, as the studio counts one', async () => {
    remotes.saveContent.mockRejectedValueOnce({
      status: 429,
      body: { message: 'Too many requests', code: 'RATE_LIMITED' },
    });
    const session = start();
    session.set('title', 'Too fast');
    await session.flush();
    expect(told.logError).toHaveBeenCalledWith(
      'studio_editor.save_failed',
      expect.objectContaining({ contentId: ID, status: 429 })
    );
    expect(told.logWarn).not.toHaveBeenCalledWith(
      'studio_editor.save_refused',
      expect.anything()
    );
  });

  // A studio tab stays open for days: the worker's "Authentication
  // required" would not say what to do.
  it('a lapsed sign-in says to sign in again, and that nothing is lost', async () => {
    remotes.saveContent.mockRejectedValueOnce({
      status: 401,
      body: { message: 'Authentication required', code: 'UNAUTHORIZED' },
    });
    const session = start();
    session.set('title', 'Signed out');
    await expect(session.flush()).resolves.toMatchObject({
      ok: false,
      message: m.studio_content_draft_signed_out(),
    });
  });

  // The API refuses an empty title, which held back every other field. The
  // rest went, so it reads as saved; the field says what it still needs.
  it('an emptied title keeps the saved one, and everything else still saves', async () => {
    const session = start();
    session.set('title', '  ');
    session.set('description', 'Rewritten');
    const result = await session.flush();

    expect(remotes.saveContent).toHaveBeenCalledWith({
      id: ID,
      asDraft: true,
      patch: { description: 'Rewritten' },
    });
    // Saved, so the bar says so; Publish and Update are still told the
    // field is empty.
    expect(session.status).toBe('saved');
    expect(result).toMatchObject({ ok: false, code: 'TITLE_NEEDED' });
    expect(session.needsTitle).toBe(true);
    // Nothing a save would send, so no leave or tab-close prompt either.
    expect(session.isDirty).toBe(false);
  });

  it('a change put back while its save is out is still sent', async () => {
    const out = Promise.withResolvers<undefined>();
    remotes.saveContent.mockReturnValueOnce(out.promise);
    const session = start();
    session.set('title', 'Runes deep dive!');
    await afterDebounce();
    session.set('title', SAVED_VALUES.title);
    // The save that is out carries the "!".
    expect(session.isDirty).toBe(true);
    close();
    await settle();

    out.resolve(undefined);
    await settle();
    expect(remotes.saveContent).toHaveBeenLastCalledWith({
      id: ID,
      asDraft: true,
      patch: { title: SAVED_VALUES.title },
    });
  });
});

describe('a piece that has been live', () => {
  it('never autosaves; its changes wait for Update', async () => {
    publication = LIVE;
    const session = start();
    session.set('title', 'Edited live');
    await afterDebounce();
    expect(remotes.saveContent).not.toHaveBeenCalled();
    expect(session.hasUnpublishedChanges).toBe(true);

    await session.flush();
    expect(remotes.saveContent).toHaveBeenCalledWith({
      id: ID,
      patch: { title: 'Edited live' },
    });
    expect(session.hasUnpublishedChanges).toBe(false);
  });

  // Unpublishing keeps publishedAt, and its buyers still hold it: they
  // would see every half-typed edit (owner, 2026-11-05).
  it('an unpublished piece waits for Update too', async () => {
    publication = { status: 'draft', publishedAt: LIVE.publishedAt };
    const session = start();
    session.set('description', 'Reworked while off sale');
    await afterDebounce();
    expect(remotes.saveContent).not.toHaveBeenCalled();
    expect(session.hasUnpublishedChanges).toBe(true);
  });

  it('publishing while the editor is open stops the autosave', async () => {
    const session = start();
    publication = LIVE;
    session.set('title', 'Typed after Publish');
    await afterDebounce();
    expect(remotes.saveContent).not.toHaveBeenCalled();
  });

  // Typed while Publish was out: the save was armed before it went live.
  it('a save armed as a draft does not land on the piece once it is live', async () => {
    const session = start();
    session.set('title', 'Half a sente');
    publication = LIVE;
    await afterDebounce();
    expect(remotes.saveContent).not.toHaveBeenCalled();
    expect(session.hasUnpublishedChanges).toBe(true);
  });

  // Its own refresh, say: nothing autosaves onto a piece that may be live.
  it('a publication getter that throws reads as live, and is logged', async () => {
    const session = start({
      publication: () => {
        throw new TypeError('content.current is undefined');
      },
    });
    session.set('title', 'Unknown state');
    await afterDebounce();
    expect(remotes.saveContent).not.toHaveBeenCalled();
    expect(told.logError).toHaveBeenCalledWith(
      'studio_editor.publication_failed',
      expect.anything()
    );
  });

  it('an Update still on the wire is waited for, and its failure asks', async () => {
    const out = Promise.withResolvers<undefined>();
    remotes.saveContent.mockReturnValueOnce(out.promise);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    publication = LIVE;
    const session = start();
    session.set('title', 'Updating');
    void session.flush();
    const { cancel } = navigate();
    expect(cancel).toHaveBeenCalled();

    out.reject(offline());
    await settle();
    expect(confirm).toHaveBeenCalledWith(
      m.studio_content_draft_confirm_leave()
    );
    expect(nav.goto).not.toHaveBeenCalled();
  });

  it('closed in place under an Update that then fails, it says so', async () => {
    const out = Promise.withResolvers<undefined>();
    remotes.saveContent.mockReturnValueOnce(out.promise);
    publication = LIVE;
    const session = start();
    session.set('title', 'Updating');
    void session.flush();
    close();
    await settle();
    out.reject(offline());
    await settle();
    expect(told.toastAdd).toHaveBeenCalledWith(
      { variant: 'error', title: m.studio_content_draft_closed_unsaved() },
      { closeDelay: 0 }
    );
  });

  // Publish flips the piece to live, then saves: the save it joins stops
  // its queued follow-up, so flush sends that itself.
  it("Publish's save sends what was queued behind the autosave it joined", async () => {
    const out = Promise.withResolvers<undefined>();
    remotes.saveContent.mockReturnValueOnce(out.promise);
    const session = start();
    session.set('title', 'Autosaving');
    await afterDebounce();
    session.set('description', 'Queued behind it');
    const published = session.publish(vi.fn().mockResolvedValue({}));
    out.resolve(undefined);

    await expect(published).resolves.toMatchObject({ ok: true, live: true });
    expect(remotes.saveContent).toHaveBeenLastCalledWith({
      id: ID,
      patch: { description: 'Queued behind it' },
    });
  });

  // Only the editor's own Publish sends a draft's values without asDraft: a
  // page read that says live (a refresh, the schedule's) is not the creator
  // asking for an Update, so the server judges, and its refusal freezes the
  // screen (the round-3 review). A Publish that fails is a draft again: see
  // 'a refusal is a draft again' under publish.
  it("a page read that says live is no Update: a draft's flush still sends as a draft", async () => {
    const session = start();
    publication = LIVE;
    flushSync();
    session.set('description', 'Typed once it read live');
    remotes.saveContent.mockRejectedValueOnce({
      status: 409,
      body: { code: 'CONTENT_ALREADY_LIVE', message: 'This went live.' },
    });

    await session.flush();

    expect(remotes.saveContent).toHaveBeenCalledWith({
      id: ID,
      asDraft: true,
      patch: { description: 'Typed once it read live' },
    });
    expect(session.wentLiveElsewhere).toBe(true);
  });

  // An Update starts its own chain: nothing typed during it goes live
  // without another click.
  it('words typed while an Update is out wait for the next Update', async () => {
    const out = Promise.withResolvers<undefined>();
    remotes.saveContent.mockReturnValueOnce(out.promise);
    publication = LIVE;
    const session = start();
    session.set('title', 'Updated title');
    const updating = session.flush();
    session.set('description', 'Chapter 3 covers th');
    out.resolve(undefined);
    await updating;

    expect(remotes.saveContent).toHaveBeenCalledTimes(1);
    expect(session.hasUnpublishedChanges).toBe(true);
  });

  it('a draft whose page state is re-read keeps its save on time', async () => {
    const session = start();
    session.set('title', 'On time');
    await vi.advanceTimersByTimeAsync(1000);
    publication = { ...DRAFT };
    flushSync();
    await vi.advanceTimersByTimeAsync(500);
    expect(remotes.saveContent).toHaveBeenCalledTimes(1);
  });

  // A second click while the first Update is out rides it.
  it('a double-clicked Update sends nothing typed after the first click', async () => {
    const out = Promise.withResolvers<undefined>();
    remotes.saveContent.mockReturnValueOnce(out.promise);
    publication = LIVE;
    const session = start();
    session.set('title', 'Updated title');
    const first = session.flush();
    session.set('description', 'A');
    const second = session.flush();
    session.set('description', 'Chapter 3 covers th');
    out.resolve(undefined);
    await Promise.all([first, second]);

    expect(remotes.saveContent).toHaveBeenCalledTimes(1);
    expect(session.hasUnpublishedChanges).toBe(true);
  });

  // The session's own record of going live, not the page's later state.
  it('a draft that went live while open sends nothing as it closes', async () => {
    const session = start();
    publication = LIVE;
    flushSync();
    session.set('title', 'Half a sente');
    close();
    await settle();
    expect(remotes.saveContent).not.toHaveBeenCalled();
    expect(told.logWarn).toHaveBeenCalledWith(
      'studio_editor.closed_with_unsent_changes',
      { contentId: ID, keys: ['title'], abandoned: false }
    );
  });

  // Only the Update is still going; what was typed during it is not.
  it('leaving under a slow Update asks before dropping what was typed during it', async () => {
    const stalled = Promise.withResolvers<undefined>();
    remotes.saveContent.mockReturnValueOnce(stalled.promise);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    publication = LIVE;
    const session = start();
    session.set('title', 'New title');
    void session.flush();
    session.set('description', 'Chapter 3 covers th');
    navigate();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(confirm).toHaveBeenCalledWith(
      m.studio_content_draft_confirm_leave_live()
    );
    close();
    stalled.resolve(undefined);
    await settle();
  });

  it('two flushes joining one autosave both wait for the send that follows', async () => {
    const first = Promise.withResolvers<undefined>();
    remotes.saveContent
      .mockReturnValueOnce(first.promise)
      .mockRejectedValueOnce(offline());
    const session = start();
    session.set('title', 'Autosaving');
    await afterDebounce();
    session.set('description', 'Queued');
    publication = LIVE;
    flushSync();
    const p1 = session.flush();
    const p2 = session.flush();
    first.resolve(undefined);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
  });

  // A Publish that failed fast and was clicked again while its first save
  // was out cannot happen: Publish sends only once its save has landed, and
  // a second click joins the first ('a second Publish while one runs joins
  // it', under publish).

  // Update puts every field live at once: none goes without its title.
  it('Update with an emptied title sends nothing until the title is back', async () => {
    publication = LIVE;
    const session = start();
    session.set('title', '');
    session.set('description', 'Rewritten');
    await expect(session.flush()).resolves.toMatchObject({
      ok: false,
      code: 'TITLE_NEEDED',
    });
    expect(remotes.saveContent).not.toHaveBeenCalled();
  });
});

describe('a new piece', () => {
  const fresh = (overrides: Partial<Options> = {}) =>
    start({ saved: null, ...overrides });

  it('makes no row until something is added', async () => {
    const session = fresh();
    await afterDebounce();
    expect(remotes.createContentDraft).not.toHaveBeenCalled();
    expect(session.contentId).toBeNull();
  });

  it('the first save creates the row; later ones save it by id', async () => {
    const onCreated = vi.fn();
    const session = fresh({ onCreated });
    session.set('title', 'Hello');
    await afterDebounce();

    expect(remotes.createContentDraft).toHaveBeenCalledWith({
      contentType: 'video',
      organizationId: ORG,
      title: 'Hello',
    });
    expect(onCreated).toHaveBeenCalledWith(ID, { editorOpen: true });
    expect(session.contentId).toBe(ID);

    session.set('description', 'Then a description');
    await afterDebounce();
    expect(remotes.saveContent).toHaveBeenCalledWith({
      id: ID,
      asDraft: true,
      patch: { description: 'Then a description' },
    });
  });

  // The row exists: reporting a failed save would offer a Retry that
  // finds nothing to send.
  it('a page whose onCreated throws is logged, and the save still counts', async () => {
    const session = fresh({
      onCreated: () => {
        throw new Error('replaceState before the router is ready');
      },
    });
    session.set('title', 'Hello');
    await expect(session.flush()).resolves.toEqual({ ok: true });
    expect(session.contentId).toBe(ID);
    expect(told.logError).toHaveBeenCalledWith(
      'studio_editor.on_created_failed',
      expect.objectContaining({ contentId: ID })
    );
  });

  // The page's media title getter, not the save, failed: the words written
  // still title it.
  it('a media title getter that throws falls back to the first words', async () => {
    const session = fresh({
      contentType: 'written',
      workingTitle: () => {
        throw new TypeError('media.current is undefined');
      },
    });
    session.set('contentBody', doc('First words win.'));
    await expect(session.flush()).resolves.toEqual({ ok: true });
    expect(remotes.createContentDraft).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'First words win.' })
    );
    expect(told.logError).toHaveBeenCalledWith(
      'studio_editor.working_title_failed',
      expect.anything()
    );
  });

  it('a video added before any title takes the media title, shown in the field', async () => {
    const session = fresh({ workingTitle: () => 'Svelte runes deep dive' });
    session.set('mediaItemId', SAVED_VALUES.mediaItemId);
    await afterDebounce();

    expect(remotes.createContentDraft).toHaveBeenCalledWith({
      contentType: 'video',
      organizationId: ORG,
      mediaItemId: SAVED_VALUES.mediaItemId,
      title: 'Svelte runes deep dive',
    });
    expect(session.values.title).toBe('Svelte runes deep dive');
    expect(session.isDirty).toBe(false);
  });

  it('an article started in its body takes its first words', async () => {
    const session = fresh({ contentType: 'written' });
    session.set(
      'contentBody',
      doc(
        'Runes replace implicit reactivity with three explicit primitives, and this is how.'
      )
    );
    await afterDebounce();

    const sent = remotes.createContentDraft.mock.calls[0]?.[0];
    expect(sent?.title).toBe(
      'Runes replace implicit reactivity with three explicit'
    );
  });

  // The description is rich text too: its words, never its JSON.
  it('a description typed first titles it too', async () => {
    fresh({ contentType: 'written' }).set('description', doc('A short one.'));
    await afterDebounce();
    expect(remotes.createContentDraft).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'A short one.' })
    );
  });

  it('with nothing to title it, nothing is created and the bar says why', async () => {
    const session = fresh({ contentType: 'written' });
    session.set(
      'contentBody',
      JSON.stringify({
        type: 'doc',
        content: [{ type: 'image', attrs: { src: 'a.webp' } }],
      })
    );
    await expect(session.flush()).resolves.toMatchObject({
      ok: false,
      code: 'TITLE_NEEDED',
    });
    expect(remotes.createContentDraft).not.toHaveBeenCalled();
    expect(session.errorMessage).toBe(m.studio_content_draft_title_needed());
  });

  it('a title typed while the row is being made wins over the working one', async () => {
    const creating = Promise.withResolvers<{ id: string }>();
    remotes.createContentDraft.mockReturnValueOnce(creating.promise);
    const session = fresh({ workingTitle: () => 'clip-0042' });
    session.set('mediaItemId', SAVED_VALUES.mediaItemId);
    await afterDebounce();

    session.set('title', 'My real title');
    creating.resolve({ id: ID });
    await settle();

    expect(session.values.title).toBe('My real title');
    expect(remotes.saveContent).toHaveBeenCalledWith({
      id: ID,
      asDraft: true,
      patch: { title: 'My real title' },
    });
  });
});

describe('leaving', () => {
  it('a move inside the studio waits for the save, then goes', async () => {
    const session = start();
    session.set('title', 'Save me first');
    const { to, cancel } = navigate();
    expect(cancel).toHaveBeenCalled();
    await settle();
    expect(remotes.saveContent).toHaveBeenCalledTimes(1);
    expect(nav.goto).toHaveBeenCalledWith(to);
  });

  it('nothing unsaved: the move goes ahead untouched', () => {
    start();
    const { cancel } = navigate();
    expect(cancel).not.toHaveBeenCalled();
  });

  it.each([
    [false, 0],
    [true, 1],
  ])('a failed save asks first (leave anyway: %s)', async (answer, gotos) => {
    remotes.saveContent.mockRejectedValueOnce(offline());
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(answer);
    const session = start();
    session.set('title', 'Cannot save');
    navigate();
    await settle();
    expect(confirm).toHaveBeenCalledWith(
      m.studio_content_draft_confirm_leave()
    );
    expect(nav.goto).toHaveBeenCalledTimes(gotos);
  });

  it('an untitled new piece says it needs a title', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const session = start({ saved: null, contentType: 'written' });
    session.set(
      'contentBody',
      JSON.stringify({
        type: 'doc',
        content: [{ type: 'image', attrs: { src: 'a.webp' } }],
      })
    );
    navigate();
    await settle();
    expect(confirm).toHaveBeenCalledWith(
      m.studio_content_draft_confirm_leave_untitled()
    );
  });

  it.each([
    [false, true],
    [true, false],
  ])('a piece that has been live asks before dropping its changes (leave: %s)', (answer, cancelled) => {
    publication = LIVE;
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(answer);
    const session = start();
    session.set('title', 'Not updated yet');
    const { cancel } = navigate();
    expect(confirm).toHaveBeenCalledWith(
      m.studio_content_draft_confirm_leave_live()
    );
    expect(cancel).toHaveBeenCalledTimes(cancelled ? 1 : 0);
    expect(remotes.saveContent).not.toHaveBeenCalled();
  });

  // The old page stays up while the next one loads, and stays editable.
  it('words typed while the next page loads are saved', async () => {
    const session = start();
    session.set('title', 'Saved before leaving');
    nav.goto.mockImplementationOnce(async () => {
      session.set('description', 'Typed during the load');
      close();
    });
    navigate();
    await settle();

    expect(remotes.saveContent).toHaveBeenCalledTimes(2);
    expect(remotes.saveContent).toHaveBeenLastCalledWith({
      id: ID,
      asDraft: true,
      patch: { description: 'Typed during the load' },
    });
  });

  it('a second click while the save is out asks once, and goes to the latest', async () => {
    const out = Promise.withResolvers<undefined>();
    remotes.saveContent.mockReturnValueOnce(out.promise);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const session = start();
    session.set('title', 'Double click');
    navigate();
    const second = new URL('http://studio-alpha.lvh.me:3000/studio/media');
    const cancel = vi.fn();
    nav.guards[0]?.({ willUnload: false, to: { url: second }, cancel });
    expect(cancel).toHaveBeenCalled();

    out.reject(offline());
    await settle();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(nav.goto).toHaveBeenCalledTimes(1);
    expect(nav.goto).toHaveBeenCalledWith(second);
  });

  it('a move that fails to start is logged', async () => {
    nav.goto.mockRejectedValueOnce(new Error('Not found: /studio/content'));
    const session = start();
    session.set('title', 'Going nowhere');
    navigate();
    await settle();
    expect(told.logWarn).toHaveBeenCalledWith(
      'studio_editor.leave_failed',
      expect.objectContaining({ error: 'Not found: /studio/content' })
    );
  });

  // What was queued behind the save now waits for Update.
  it('a piece that went live while the save was out asks before leaving', async () => {
    const out = Promise.withResolvers<undefined>();
    remotes.saveContent.mockReturnValueOnce(out.promise);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const session = start();
    session.set('title', 'Saved as a draft');
    navigate();
    session.set('description', 'Queued behind it');
    publication = LIVE;
    out.resolve(undefined);
    await settle();

    expect(confirm).toHaveBeenCalledWith(
      m.studio_content_draft_confirm_leave_live()
    );
    expect(nav.goto).not.toHaveBeenCalled();
    expect(remotes.saveContent).toHaveBeenCalledTimes(1);
  });

  it('a save on the wire with nothing new typed is still waited for', async () => {
    const out = Promise.withResolvers<undefined>();
    remotes.saveContent.mockReturnValueOnce(out.promise);
    const session = start();
    session.set('title', 'On the wire');
    await afterDebounce();
    expect(session.isDirty).toBe(false);

    const { to, cancel } = navigate();
    expect(cancel).toHaveBeenCalled();
    expect(nav.goto).not.toHaveBeenCalled();
    out.resolve(undefined);
    await settle();
    expect(nav.goto).toHaveBeenCalledWith(to);
  });

  // A stalled connection: links must not go dead behind a save that never
  // answers.
  it('a save that never settles asks after a while instead of waiting forever', async () => {
    const stalled = Promise.withResolvers<undefined>();
    remotes.saveContent.mockReturnValueOnce(stalled.promise);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const session = start();
    session.set('title', 'Stalled');
    navigate();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(confirm).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(confirm).toHaveBeenCalledWith(
      m.studio_content_draft_confirm_leave_slow()
    );
    // Lets its unload guard go, so it cannot answer for later tests.
    close();
    stalled.resolve(undefined);
    await settle();
  });

  // "Haven't finished saving" is not "couldn't be saved": the save goes on.
  it('leaving a slow save behind still tells if it fails, and the tab still asks', async () => {
    const stalled = Promise.withResolvers<undefined>();
    remotes.saveContent.mockReturnValueOnce(stalled.promise);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    nav.goto.mockImplementationOnce(async () => close());
    const session = start();
    session.set('title', 'Slow');
    navigate();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(nav.goto).toHaveBeenCalledTimes(1);
    expect(unload()).toBe(true);

    stalled.reject(offline());
    await settle();
    expect(told.toastAdd).toHaveBeenCalledTimes(1);
  });

  it('after "Leave anyway", the last try on the way out is quiet', async () => {
    remotes.saveContent.mockRejectedValue(offline());
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    nav.goto.mockImplementationOnce(async () => close());
    const session = start();
    session.set('title', 'Cannot save');
    navigate();
    await settle();

    expect(remotes.saveContent).toHaveBeenCalledTimes(2);
    expect(told.toastAdd).not.toHaveBeenCalled();
  });

  it('closed in place while its save is out, the move is not made', async () => {
    const out = Promise.withResolvers<undefined>();
    remotes.saveContent.mockReturnValueOnce(out.promise);
    const session = start();
    session.set('title', 'Closed mid-save');
    navigate();
    close();
    out.resolve(undefined);
    await settle();
    expect(nav.goto).not.toHaveBeenCalled();
  });

  // Another guard can stop the move the session sent on its way.
  it('a move that never happened leaves the editor guarded again', async () => {
    remotes.saveContent.mockRejectedValue(offline());
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const session = start();
    session.set('title', 'Cannot save');
    navigate();
    await settle();
    expect(nav.goto).toHaveBeenCalledTimes(1);

    expect(session.isDirty).toBe(true);
    expect(unload()).toBe(true);
  });

  it('closing the tab asks only while something is unsaved', async () => {
    const session = start();
    expect(unload()).toBe(false);
    session.set('title', 'Pending');
    expect(unload()).toBe(true);
    await afterDebounce();
    expect(unload()).toBe(false);
  });
});

describe('closing the editor in place', () => {
  // Sent just after the teardown, which reads state as it was before its
  // last change: from inside it, this save carried `title: undefined`.
  it('saves what is left, as typed', async () => {
    const session = start();
    session.set('title', 'Last words');
    close();
    await settle();
    expect(remotes.saveContent).toHaveBeenCalledTimes(1);
    expect(remotes.saveContent).toHaveBeenCalledWith({
      id: ID,
      asDraft: true,
      patch: { title: 'Last words' },
    });
  });

  it('while a save is out, what was typed during it still goes', async () => {
    const first = Promise.withResolvers<undefined>();
    remotes.saveContent.mockReturnValueOnce(first.promise);
    const session = start();
    session.set('title', 'First');
    await afterDebounce();
    session.set('description', 'Typed during the save');
    close();
    await settle();

    first.resolve(undefined);
    await settle();
    expect(remotes.saveContent).toHaveBeenCalledTimes(2);
    expect(remotes.saveContent).toHaveBeenLastCalledWith({
      id: ID,
      asDraft: true,
      patch: { description: 'Typed during the save' },
    });
  });

  // The save bar went with the editor: a toast that stays until read.
  it('a last save that fails is told, until the creator dismisses it', async () => {
    remotes.saveContent.mockRejectedValueOnce(offline());
    const session = start();
    session.set('title', 'Lost?');
    close();
    await settle();
    expect(told.toastAdd).toHaveBeenCalledWith(
      {
        variant: 'error',
        title: m.studio_content_draft_closed_unsaved(),
      },
      { closeDelay: 0 }
    );
  });

  // The page can still list it, or keep its id so a new editor does not
  // make it twice; only the URL swap is for an open editor.
  it('a row it creates is still told to the page, as made with the editor closed', async () => {
    const onCreated = vi.fn();
    const session = start({ saved: null, onCreated });
    session.set('title', 'Made on the way out');
    close();
    await settle();
    expect(remotes.createContentDraft).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(ID, { editorOpen: false });
  });

  it('closing the tab while the last save is out still asks', async () => {
    const out = Promise.withResolvers<undefined>();
    remotes.saveContent.mockReturnValueOnce(out.promise);
    const session = start();
    session.set('title', 'On the wire');
    close();
    await settle();
    expect(unload()).toBe(true);

    out.resolve(undefined);
    await settle();
    expect(unload()).toBe(false);
  });

  it('closed with only a save on the wire, its failure is still told', async () => {
    const out = Promise.withResolvers<undefined>();
    remotes.saveContent.mockReturnValueOnce(out.promise);
    const session = start();
    session.set('title', 'On the wire');
    await afterDebounce();
    close();
    await settle();
    out.reject(offline());
    await settle();
    expect(told.toastAdd).toHaveBeenCalledTimes(1);
  });

  it('once the last save lands, nothing more is saved, and a late set is told', async () => {
    const session = start();
    session.set('title', 'Last words');
    close();
    await settle();
    session.set('title', 'After the close');
    await afterDebounce();
    expect(remotes.saveContent).toHaveBeenCalledTimes(1);
    expect(told.logError).toHaveBeenCalledWith(
      'studio_editor.set_after_close_dropped',
      { contentId: ID, key: 'title' }
    );
    expect(told.toastAdd).toHaveBeenCalledTimes(1);
  });

  it('a late set of the value already sent is no news', async () => {
    const session = start();
    session.set('title', 'Last words');
    close();
    await settle();
    session.set('title', 'Last words');
    expect(told.logError).not.toHaveBeenCalled();
    expect(told.toastAdd).not.toHaveBeenCalled();
  });

  // Only Update sends a live piece's changes, and the editor has gone.
  it('a late set on a live piece is told, even while its Update is out', async () => {
    const out = Promise.withResolvers<undefined>();
    remotes.saveContent.mockReturnValueOnce(out.promise);
    publication = LIVE;
    const session = start();
    session.set('title', 'Updating');
    void session.flush();
    close();
    await settle();
    session.set('mediaItemId', '7e000000-0000-4000-8000-000000000009');
    out.resolve(undefined);
    await settle();

    expect(remotes.saveContent).toHaveBeenCalledTimes(1);
    expect(told.logError).toHaveBeenCalledWith(
      'studio_editor.set_after_close_dropped',
      { contentId: ID, key: 'mediaItemId' }
    );
    expect(told.toastAdd).toHaveBeenCalledTimes(1);
  });

  // Publish rode the autosave, and its second send carries the late value:
  // it was not lost, so nothing says it was.
  it('a late set that a joined Publish then sends is not reported lost', async () => {
    const first = Promise.withResolvers<undefined>();
    remotes.saveContent.mockReturnValueOnce(first.promise);
    const session = start();
    session.set('title', 'Autosaving');
    await afterDebounce();
    session.set('description', 'Queued behind it');
    void session.publish(vi.fn().mockResolvedValue({}));
    close();
    await settle();
    session.set('mediaItemId', '7e000000-0000-4000-8000-000000000009');
    first.resolve(undefined);
    await settle();

    expect(remotes.saveContent).toHaveBeenLastCalledWith({
      id: ID,
      patch: {
        description: 'Queued behind it',
        mediaItemId: '7e000000-0000-4000-8000-000000000009',
      },
    });
    expect(told.logError).not.toHaveBeenCalled();
    expect(told.toastAdd).not.toHaveBeenCalled();
  });

  it('closed under an Update, words typed during it leave a trace', async () => {
    const out = Promise.withResolvers<undefined>();
    remotes.saveContent.mockReturnValueOnce(out.promise);
    publication = LIVE;
    const session = start();
    session.set('title', 'Updating');
    void session.flush();
    session.set('description', 'Typed during it');
    close();
    await settle();
    out.resolve(undefined);
    await settle();
    expect(told.logWarn).toHaveBeenCalledWith(
      'studio_editor.closed_with_unsent_changes',
      { contentId: ID, keys: ['description'], abandoned: false }
    );
  });

  // An upload finishing while the last save is still out.
  it('a set while the last save is out is queued behind it, and saved', async () => {
    const out = Promise.withResolvers<undefined>();
    remotes.saveContent.mockReturnValueOnce(out.promise);
    const session = start();
    session.set('title', 'Last words');
    close();
    await settle();
    session.set('mediaItemId', '7e000000-0000-4000-8000-000000000009');
    out.resolve(undefined);
    await settle();
    expect(remotes.saveContent).toHaveBeenLastCalledWith({
      id: ID,
      asDraft: true,
      patch: { mediaItemId: '7e000000-0000-4000-8000-000000000009' },
    });
    expect(told.logError).not.toHaveBeenCalled();
  });

  // After a move the page's state is the next route's: the session goes by
  // what it last saw while mounted.
  it('a publication getter broken by the next route does not drop the last words', async () => {
    let gone = false;
    const session = start({
      publication: () => {
        if (gone) throw new TypeError('content is null');
        return publication;
      },
    });
    session.set('title', 'Saved before leaving');
    nav.goto.mockImplementationOnce(async () => {
      session.set('description', 'Typed during the load');
      gone = true;
      close();
    });
    navigate();
    await settle();
    expect(remotes.saveContent).toHaveBeenLastCalledWith({
      id: ID,
      asDraft: true,
      patch: { description: 'Typed during the load' },
    });
  });

  // Publish joined an autosave and saved what was queued behind it in a
  // second chain; the editor closed before that one settled.
  it('closed under a second chain, its failure is still told', async () => {
    const first = Promise.withResolvers<undefined>();
    const second = Promise.withResolvers<undefined>();
    remotes.saveContent
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const session = start();
    session.set('title', 'Autosaving');
    await afterDebounce();
    session.set('description', 'Queued behind it');
    void session.publish(vi.fn().mockResolvedValue({}));
    close();
    await settle();

    first.resolve(undefined);
    await settle();
    expect(remotes.saveContent).toHaveBeenCalledTimes(2);
    second.reject(offline());
    await settle();
    expect(told.toastAdd).toHaveBeenCalledTimes(1);
  });
});

// The Publish step's fields (Codex-a6ofh.2.4): lists and the access group are
// compared by what they hold, and the group goes as the flags the API reads.
describe('the Publish step’s fields', () => {
  it('a list or the access group set again with the same contents is no change', async () => {
    const session = start();
    session.set('tags', ['svelte']);
    session.set('access', { kind: 'free', priceCents: 0, tierIds: [] });
    await afterDebounce();
    expect(session.isDirty).toBe(false);
    expect(remotes.saveContent).not.toHaveBeenCalled();
  });

  it('the access group goes as the flags the API reads', async () => {
    const session = start();
    session.set('access', { kind: 'paid', priceCents: 1200, tierIds: [] });
    await afterDebounce();
    expect(remotes.saveContent).toHaveBeenCalledWith({
      id: ID,
      asDraft: true,
      patch: {
        isFree: false,
        isPurchasable: true,
        priceCents: 1200,
        isTierGated: false,
        isFollowerGated: false,
        isTeamOnly: false,
      },
    });
  });

  it('a list changed in place after its save is still seen as a change', async () => {
    const session = start();
    session.set('tags', ['svelte', 'runes']);
    await afterDebounce();
    // What the server holds is a copy, never the list on screen.
    (session.values.tags as string[]).push('state');
    session.set('tags', [...session.values.tags]);
    await afterDebounce();
    expect(remotes.saveContent).toHaveBeenLastCalledWith({
      id: ID,
      asDraft: true,
      patch: { tags: ['svelte', 'runes', 'state'] },
    });
  });
});

// The slug follows the title until the piece goes live (Codex-a6ofh.2.4).
describe('the slug', () => {
  /** A draft whose slug is the one its title gave. */
  const TITLED = { ...SAVED_VALUES, slug: 'runes-deep-dive' };

  it('a slug that is the title’s own follows it, and is made free if taken', async () => {
    const session = start({ saved: { id: ID, values: TITLED } });
    session.set('title', 'Runes, all three');
    await afterDebounce();
    expect(remotes.saveContent).toHaveBeenCalledWith({
      id: ID,
      asDraft: true,
      patch: { title: 'Runes, all three', slug: 'runes-all-three' },
      slugFollowsTitle: true,
    });
  });

  it('a slug the save made free is the one held, and still follows', async () => {
    remotes.saveContent.mockResolvedValueOnce({ slug: 'runes-all-three-2' });
    const session = start({ saved: { id: ID, values: TITLED } });
    session.set('title', 'Runes, all three');
    await afterDebounce();
    expect(session.values.slug).toBe('runes-all-three-2');
    expect(session.isDirty).toBe(false);

    session.set('title', 'Runes');
    await afterDebounce();
    expect(remotes.saveContent).toHaveBeenLastCalledWith({
      id: ID,
      asDraft: true,
      patch: { title: 'Runes', slug: 'runes' },
      slugFollowsTitle: true,
    });
  });

  it('a title that gives the same slug (a capital, a "!") leaves a freed slug where it is', async () => {
    remotes.saveContent.mockResolvedValueOnce({
      slug: 'runes-all-three-a1b2c3',
    });
    const session = start({ saved: { id: ID, values: TITLED } });
    session.set('title', 'Runes, all three');
    await afterDebounce();
    expect(session.values.slug).toBe('runes-all-three-a1b2c3');

    session.set('title', 'Runes, ALL three!');
    await afterDebounce();
    expect(remotes.saveContent).toHaveBeenLastCalledWith({
      id: ID,
      asDraft: true,
      patch: { title: 'Runes, ALL three!' },
    });
  });

  it('a slug a save made free (`-2`) still follows when the draft is opened again', async () => {
    const session = start({
      saved: { id: ID, values: { ...TITLED, slug: 'runes-deep-dive-2' } },
    });
    session.set('title', 'Runes, all three');
    await afterDebounce();
    expect(remotes.saveContent).toHaveBeenCalledWith({
      id: ID,
      asDraft: true,
      patch: { title: 'Runes, all three', slug: 'runes-all-three' },
      slugFollowsTitle: true,
    });
  });

  it('a slug the creator typed stays, and goes as theirs', async () => {
    const session = start({ saved: { id: ID, values: TITLED } });
    session.set('slug', 'my-runes');
    session.set('title', 'Runes, all three');
    await afterDebounce();
    expect(remotes.saveContent).toHaveBeenCalledWith({
      id: ID,
      asDraft: true,
      patch: { title: 'Runes, all three', slug: 'my-runes' },
    });
  });

  it('one that is not the title’s, from an earlier visit, stays too', async () => {
    const session = start();
    session.set('title', 'Runes, all three');
    expect(session.values.slug).toBe(SAVED_VALUES.slug);
  });

  it('an emptied title leaves it; the next one moves it', () => {
    const session = start({ saved: { id: ID, values: TITLED } });
    session.set('title', '');
    expect(session.values.slug).toBe('runes-deep-dive');
    session.set('title', 'Winter');
    expect(session.values.slug).toBe('winter');
  });

  it('never moves on a piece that has been live', () => {
    publication = LIVE;
    const session = start({ saved: { id: ID, values: TITLED } });
    session.set('title', 'Runes, all three');
    expect(session.values.slug).toBe('runes-deep-dive');
  });

  it('nor while its Publish is out', async () => {
    const send = Promise.withResolvers<unknown>();
    const session = start({ saved: { id: ID, values: TITLED } });
    const run = session.publish(() => send.promise);
    session.set('title', 'Runes, all three');
    expect(session.values.slug).toBe('runes-deep-dive');
    send.resolve({});
    await run;
  });

  it('a new piece’s first save makes it; it follows from then on', async () => {
    const session = start({ saved: null });
    session.set('title', 'Runes');
    await afterDebounce();
    expect(session.values.slug).toBe('runes');
    expect(session.isDirty).toBe(false);

    session.set('title', 'Runes, all three');
    await afterDebounce();
    expect(remotes.saveContent).toHaveBeenLastCalledWith({
      id: ID,
      asDraft: true,
      patch: { title: 'Runes, all three', slug: 'runes-all-three' },
      slugFollowsTitle: true,
    });
  });

  it('a title typed while the first save is out moves the slug it made', async () => {
    const created = Promise.withResolvers<{ id: string; slug: string }>();
    remotes.createContentDraft.mockReturnValueOnce(created.promise);
    const session = start({ saved: null });
    session.set('title', 'Runes');
    await afterDebounce();
    session.set('title', 'Runes, all three');
    created.resolve({ id: ID, slug: 'runes' });
    await settle();
    expect(session.values.slug).toBe('runes-all-three');
  });
});

// The session owns Publish (owner, 2026-11-05).
describe('publish', () => {
  /** A publish call that answers when the test says. */
  function pendingSend() {
    const answer = {
      ok: () => {},
      /** Accepted as a draft: publish when ready scheduled it. */
      draft: () => {},
      fail: (_reason: unknown) => {},
    };
    const send = vi.fn(
      () =>
        new Promise((resolve, reject) => {
          answer.ok = () => resolve({});
          answer.draft = () =>
            resolve({ status: 'draft', publishRequestedAt: new Date() });
          answer.fail = reject;
        })
    );
    return { send, answer };
  }

  it('saves what is on screen, then publishes', async () => {
    const session = start();
    session.set('title', 'Runes, all three');
    const send = vi.fn().mockResolvedValue({});
    const result = await session.publish(send);
    expect(result).toMatchObject({ ok: true, live: true });
    expect(remotes.saveContent).toHaveBeenCalledWith({
      id: ID,
      patch: { title: 'Runes, all three' },
    });
    expect(send).toHaveBeenCalledWith(ID);
    expect(remotes.saveContent.mock.invocationCallOrder[0]).toBeLessThan(
      send.mock.invocationCallOrder[0] ?? 0
    );
  });

  // Publish when ready (Codex-a6ofh.2.9): a schedule answers a draft, so the
  // piece is not live, and what was typed while it was out saves as a draft's.
  it('a send that answers a draft (scheduled) is not live, and edits go on saving', async () => {
    const session = start();
    const { send, answer } = pendingSend();
    const run = session.publish(send);
    await settle();
    session.set('tags', ['typed-while-out']);
    await afterDebounce();
    expect(remotes.saveContent).not.toHaveBeenCalled();
    answer.draft();
    await expect(run).resolves.toMatchObject({ ok: true, live: false });
    await afterDebounce();
    expect(remotes.saveContent).toHaveBeenCalledWith({
      id: ID,
      asDraft: true,
      patch: { tags: ['typed-while-out'] },
    });
  });

  it('answeredLive: only a draft answer is not live; no row reads as live', () => {
    expect(answeredLive({ status: 'draft' })).toBe(false);
    expect(answeredLive({ status: 'published' })).toBe(true);
    expect(answeredLive({})).toBe(true);
    expect(answeredLive(undefined)).toBe(true);
  });

  it('a timer that fires while Publish is out sends nothing to the piece going live', async () => {
    const session = start();
    const { send, answer } = pendingSend();
    const run = session.publish(send);
    await settle();
    session.set('tags', ['half-typ']);
    await afterDebounce();
    expect(remotes.saveContent).not.toHaveBeenCalled();
    answer.ok();
    await expect(run).resolves.toMatchObject({ ok: true, live: true });
    await afterDebounce();
    expect(remotes.saveContent).not.toHaveBeenCalled();
    // Live now: the words wait for Update.
    expect(session.hasUnpublishedChanges).toBe(true);
  });

  it('a refusal is a draft again: it keeps its code, and what was typed meanwhile saves', async () => {
    const session = start();
    const { send, answer } = pendingSend();
    const run = session.publish(send);
    await settle();
    session.set('tags', ['late']);
    answer.fail({
      status: 422,
      body: { code: 'MEDIA_REQUIRED', message: 'Add the video first.' },
    });
    await expect(run).resolves.toMatchObject({
      ok: false,
      code: 'MEDIA_REQUIRED',
      message: 'Add the video first.',
    });
    await afterDebounce();
    expect(remotes.saveContent).toHaveBeenCalledWith({
      id: ID,
      asDraft: true,
      patch: { tags: ['late'] },
    });
    expect(told.logWarn).toHaveBeenCalledWith(
      'studio_editor.publish_refused',
      expect.objectContaining({ code: 'MEDIA_REQUIRED' })
    );
  });

  it('a second Publish while one runs joins it', async () => {
    const session = start();
    const { send, answer } = pendingSend();
    const first = session.publish(send);
    const second = session.publish(send);
    expect(second).toBe(first);
    await settle();
    answer.ok();
    await first;
    expect(send).toHaveBeenCalledOnce();
  });

  it('a save that fails never publishes', async () => {
    const session = start();
    session.set('title', 'Runes, all three');
    remotes.saveContent.mockRejectedValueOnce(offline());
    const send = vi.fn();
    const result = await session.publish(send);
    expect(result.ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('a save that never answers stops Publish after 10 s, never publishing', async () => {
    const session = start();
    session.set('title', 'Runes, all three');
    remotes.saveContent.mockReturnValueOnce(new Promise(() => {}));
    const send = vi.fn();
    const run = session.publish(send);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(run).resolves.toMatchObject({
      ok: false,
      code: 'SAVE_SLOW',
      message: m.studio_editor_publish_save_slow(),
    });
    expect(send).not.toHaveBeenCalled();
    expect(told.logWarn).toHaveBeenCalledWith(
      'studio_editor.publish_save_slow',
      {
        contentId: ID,
      }
    );
  });

  it('a move asked for while Publish is out waits, and its caller takes it once', async () => {
    const session = start();
    const { send, answer } = pendingSend();
    const run = session.publish(send);
    await settle();
    const { to, cancel } = navigate();
    expect(cancel).toHaveBeenCalled();
    expect(nav.goto).not.toHaveBeenCalled();

    answer.ok();
    await expect(run).resolves.toMatchObject({ ok: true, live: true });
    expect(session.takeHeldMove()).toEqual(to);
    expect(session.takeHeldMove()).toBeNull();
    expect(nav.goto).not.toHaveBeenCalled();
  });

  it('a move waiting for a save when Publish starts waits for Publish too', async () => {
    const saved = Promise.withResolvers<unknown>();
    remotes.saveContent.mockReturnValueOnce(saved.promise);
    const session = start();
    session.set('tags', ['moving']);
    await afterDebounce(); // The save is out.
    const { to, cancel } = navigate();
    expect(cancel).toHaveBeenCalled();
    const { send, answer } = pendingSend();
    const run = session.publish(send);

    saved.resolve({});
    await settle();
    expect(nav.goto).not.toHaveBeenCalled();
    expect(session.holdingMove).toBe(true);
    expect(send).toHaveBeenCalled();

    answer.ok();
    await expect(run).resolves.toMatchObject({ ok: true, live: true });
    expect(session.takeHeldMove()).toEqual(to);
    expect(nav.goto).not.toHaveBeenCalled();
  });

  it('closing the tab while Publish is out asks first', async () => {
    // This session's own guard: a save left hanging by another test keeps
    // its listener on the window.
    const added = vi.spyOn(window, 'addEventListener');
    const session = start();
    const guard = added.mock.calls.find(
      ([type]) => String(type) === 'beforeunload'
    )?.[1];
    if (typeof guard !== 'function') throw new Error('no unload guard');
    const asks = () => {
      const event = new Event('beforeunload', { cancelable: true });
      guard(event);
      return event.defaultPrevented;
    };
    expect(asks()).toBe(false);

    const { send, answer } = pendingSend();
    const run = session.publish(send);
    await settle();
    expect(asks()).toBe(true);
    answer.ok();
    await run;
    expect(asks()).toBe(false);
  });

  it('a Publish that stops at its save says so: nothing was sent', async () => {
    remotes.saveContent.mockRejectedValueOnce({
      status: 503,
      body: { message: 'Service unavailable' },
    });
    const session = start();
    session.set('tags', ['unsaved']);
    const send = vi.fn();
    await expect(session.publish(send)).resolves.toMatchObject({
      ok: false,
      unsent: true,
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('a move held by one Publish is not left for the next', async () => {
    const session = start();
    const first = pendingSend();
    const run = session.publish(first.send);
    await settle();
    navigate();
    first.answer.fail({ status: 422, body: { code: 'MEDIA_REQUIRED' } });
    await run;

    const second = pendingSend();
    const again = session.publish(second.send);
    await settle();
    second.answer.ok();
    await again;
    expect(session.takeHeldMove()).toBeNull();
  });
});

describe('a piece that has been live: Discard, its count, and leaving (Codex-a6ofh.2.5)', () => {
  /** A dialog's question, answered when the test says. */
  function dialog() {
    const asked: string[] = [];
    let answer: (given: 'update' | 'leave' | 'stay') => void = () => {};
    const askToLeave = vi.fn((reason: string) => {
      asked.push(reason);
      return new Promise<'update' | 'leave' | 'stay'>((resolve) => {
        answer = resolve;
      });
    });
    return {
      askToLeave,
      asked,
      answer: (given: 'update' | 'leave' | 'stay') => answer(given),
    };
  }

  it('counts each field Update would send', () => {
    publication = LIVE;
    const session = start();
    expect(session.changeCount).toBe(0);
    session.set('title', 'Renamed');
    session.set('tags', ['svelte', 'runes']);
    expect(session.changeCount).toBe(2);
    session.set('title', SAVED_VALUES.title);
    expect(session.changeCount).toBe(1);
  });

  it('Discard puts every field back, an emptied title too, and sends nothing', async () => {
    publication = LIVE;
    const session = start();
    session.set('title', '');
    session.set('tags', ['changed']);
    session.set('thumbnailUrl', 'https://cdn.test/staged/lg.webp');

    session.discard();

    expect(session.values.title).toBe(SAVED_VALUES.title);
    expect(session.values.tags).toEqual(SAVED_VALUES.tags);
    expect(session.values.thumbnailUrl).toBeNull();
    expect(session.isDirty).toBe(false);
    await settle();
    expect(remotes.saveContent).not.toHaveBeenCalled();
  });

  it('Discard keeps what an Update on the wire already sent', async () => {
    const out = Promise.withResolvers<undefined>();
    remotes.saveContent.mockReturnValueOnce(out.promise);
    publication = LIVE;
    const session = start();
    session.set('title', 'Sent in the Update');
    void session.flush();
    session.set('description', 'Typed during it');

    session.discard();

    expect(session.values.title).toBe('Sent in the Update');
    expect(session.values.description).toBe(SAVED_VALUES.description);
    out.resolve(undefined);
    await settle();
  });

  it("a draft's Discard does nothing: its changes save as they come", () => {
    const session = start();
    session.set('title', 'Autosaving');
    session.discard();
    expect(session.values.title).toBe('Autosaving');
  });

  it('a cover staged on a live piece goes with its Update', async () => {
    publication = LIVE;
    const session = start();
    session.set('thumbnailUrl', 'https://cdn.test/staged/lg.webp');
    await session.flush();
    expect(remotes.saveContent).toHaveBeenCalledWith({
      id: ID,
      patch: { thumbnailUrl: 'https://cdn.test/staged/lg.webp' },
    });
  });

  it('a staged cover the server did not take shows the one it kept, and says so', async () => {
    // Too old to take: the row keeps its cover, and the answer says which.
    remotes.saveContent.mockResolvedValueOnce({
      thumbnailUrl: 'https://cdn.test/kept/lg.webp',
    });
    publication = LIVE;
    const session = start();
    session.set('thumbnailUrl', 'https://cdn.test/staged/lg.webp');
    session.set('title', 'Renamed');

    const result = await session.flush();

    // The rest of the Update landed; the cover is the one kept, never the
    // one sent taken for live, and nothing is left to send.
    expect(result.ok).toBe(true);
    expect(session.values.thumbnailUrl).toBe('https://cdn.test/kept/lg.webp');
    expect(session.isDirty).toBe(false);
    expect(told.toastWarning).toHaveBeenCalledWith(
      m.studio_live_cover_not_taken()
    );
  });

  it('a move while the page is still sending something waits for it, then goes on and asks', async () => {
    publication = LIVE;
    const asking = dialog();
    let busy = $state(true);
    const session = start({
      askToLeave: asking.askToLeave,
      holdWhile: () => busy,
    });
    const { to, cancel } = navigate();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(asking.asked).toEqual([]);
    expect(unload()).toBe(true);

    // The cover lands, then the page stops waiting: the move goes on.
    session.set('thumbnailUrl', 'https://cdn.test/staged/lg.webp');
    busy = false;
    flushSync();
    await settle();
    expect(nav.goto).toHaveBeenCalledWith(to);
    // Sent on, the guard sees what landed and asks as any move does.
    navigate();
    expect(asking.asked).toEqual(['live']);
  });

  it('a move held for something that then fails is dropped: the creator stays where that is said', async () => {
    publication = LIVE;
    let busy = $state(true);
    const session = start({ holdWhile: () => busy });
    navigate();
    expect(session.leavingWhenSent).toBe(true);

    // The cover failed: the page drops the move as it stops waiting.
    session.stay();
    busy = false;
    flushSync();
    await settle();

    expect(nav.goto).not.toHaveBeenCalled();
    expect(session.leavingWhenSent).toBe(false);
  });

  it('Leave now goes without what is on its way, and the question about the rest never holds it again', async () => {
    publication = LIVE;
    const asking = dialog();
    const session = start({
      askToLeave: asking.askToLeave,
      holdWhile: () => true,
    });
    session.set('title', 'Not updated yet');
    const { to } = navigate();
    const cancels: ReturnType<typeof vi.fn>[] = [];
    // Each move it sends reaches the guards, as kit's would; the last one
    // to go closes the editor, as a navigation's end does.
    nav.goto
      .mockImplementationOnce(async () => {
        cancels.push(navigate().cancel);
      })
      .mockImplementationOnce(async () => {
        cancels.push(navigate().cancel);
        close();
      });

    await session.leaveNow();
    // Asked about the title, once, and never held for the cover.
    expect(asking.asked).toEqual(['live']);
    asking.answer('leave');
    await settle();
    session.set('thumbnailUrl', 'https://cdn.test/staged/lg.webp');

    expect(nav.goto).toHaveBeenCalledTimes(2);
    expect(nav.goto).toHaveBeenLastCalledWith(to);
    expect(cancels[0]).toHaveBeenCalled();
    expect(cancels[1]).not.toHaveBeenCalled();
    expect(asking.asked).toEqual(['live']);
    // Landing after it went: the creator's to have left.
    expect(told.toastAdd).not.toHaveBeenCalled();
    expect(told.logError).not.toHaveBeenCalled();
  });

  it('…and staying at that question counts what is on its way again', async () => {
    publication = LIVE;
    const asking = dialog();
    const session = start({
      askToLeave: asking.askToLeave,
      holdWhile: () => true,
    });
    session.set('title', 'Not updated yet');
    navigate();
    nav.goto.mockImplementationOnce(async () => {
      navigate();
    });

    await session.leaveNow();
    asking.answer('stay');
    await settle();
    const { cancel } = navigate();

    // Held again: the cover is still on its way, and the creator stayed.
    expect(cancel).toHaveBeenCalled();
    expect(session.leavingWhenSent).toBe(true);
  });

  it('…and so does staying when an Update that was out fails', async () => {
    const out = Promise.withResolvers<undefined>();
    remotes.saveContent.mockReturnValueOnce(out.promise);
    publication = LIVE;
    const asking = dialog();
    const session = start({
      askToLeave: asking.askToLeave,
      holdWhile: () => true,
    });
    session.set('title', 'In the Update');
    void session.flush();
    navigate();
    nav.goto.mockImplementationOnce(async () => {
      navigate();
    });

    // Leave now's move waits for the Update on the wire, which fails.
    await session.leaveNow();
    out.reject(new Error('down'));
    await settle();
    expect(asking.asked).toEqual(['failed']);
    asking.answer('stay');
    await settle();
    const { cancel } = navigate();

    // Held for the cover again, not asked about the Update a second time.
    expect(cancel).toHaveBeenCalled();
    expect(session.leavingWhenSent).toBe(true);
    expect(asking.asked).toEqual(['failed']);
  });

  it('Leave now lets only its own move past: another, asked meanwhile, waits for what is on its way', async () => {
    publication = LIVE;
    const asking = dialog();
    const session = start({
      askToLeave: asking.askToLeave,
      holdWhile: () => true,
    });
    session.set('title', 'Not updated yet');
    navigate();
    nav.goto.mockImplementationOnce(async () => {
      navigate();
    });

    await session.leaveNow();
    expect(asking.asked).toEqual(['live']);
    // A Back to somewhere else while that question is open.
    const { cancel } = navigate(vi.fn(), '/studio/media');

    expect(cancel).toHaveBeenCalled();
    expect(session.leavingWhenSent).toBe(true);
    expect(asking.asked).toEqual(['live']);
  });

  // Each way of staying ends Leave now's pass: the cover is still on its
  // way, and a later move there must wait for it again.
  describe('after Leave now, staying holds the next move again', () => {
    function leavingNow(overrides: Partial<Options> = {}) {
      publication = LIVE;
      const session = start({ holdWhile: () => true, ...overrides });
      navigate();
      return session;
    }
    const heldAgain = (session: Session) => {
      const { cancel } = navigate();
      expect(cancel).toHaveBeenCalled();
      expect(session.leavingWhenSent).toBe(true);
    };

    it('when the question is answered Stay at once (the browser’s confirm)', async () => {
      const askToLeave = vi.fn(() => 'stay' as const);
      const session = leavingNow({ askToLeave });
      session.set('title', 'Not updated yet');
      nav.goto.mockImplementationOnce(async () => {
        navigate();
      });

      await session.leaveNow();

      expect(askToLeave).toHaveBeenCalledTimes(1);
      heldAgain(session);
      expect(askToLeave).toHaveBeenCalledTimes(1);
    });

    it('when its move, sent once the Update landed, is stopped on the way', async () => {
      const out = Promise.withResolvers<undefined>();
      remotes.saveContent.mockReturnValueOnce(out.promise);
      const session = leavingNow();
      session.set('title', 'In the Update');
      void session.flush();
      nav.goto
        .mockImplementationOnce(async () => {
          navigate();
        })
        // Stopped, not arrived: the editor is still here.
        .mockResolvedValueOnce(undefined);

      await session.leaveNow();
      out.resolve(undefined);
      await settle();

      expect(nav.goto).toHaveBeenCalledTimes(2);
      heldAgain(session);
    });

    it('when asking about the failed Update fails itself', async () => {
      const out = Promise.withResolvers<undefined>();
      remotes.saveContent.mockReturnValueOnce(out.promise);
      const askToLeave = vi
        .fn()
        .mockRejectedValueOnce(new Error('dialog gone'));
      const session = leavingNow({ askToLeave });
      session.set('title', 'In the Update');
      void session.flush();
      nav.goto.mockImplementationOnce(async () => {
        navigate();
      });

      await session.leaveNow();
      out.reject(new Error('down'));
      await settle();

      expect(told.logError).toHaveBeenCalledWith(
        'studio_editor.leave_save_failed',
        expect.anything()
      );
      heldAgain(session);
    });

    it('when asking about the other changes fails itself', async () => {
      const askToLeave = vi
        .fn()
        .mockRejectedValueOnce(new Error('dialog gone'));
      const session = leavingNow({ askToLeave });
      session.set('title', 'Not updated yet');
      nav.goto.mockImplementationOnce(async () => {
        navigate();
      });

      await session.leaveNow();
      await settle();

      expect(told.logError).toHaveBeenCalledWith(
        'studio_editor.leave_answer_failed',
        expect.anything()
      );
      heldAgain(session);
    });

    it('when the creator presses Stay in the bar', async () => {
      const session = leavingNow();
      // Nothing to ask about, so its move goes through, and is stopped.
      nav.goto.mockImplementationOnce(async () => {
        navigate();
      });
      await session.leaveNow();
      // A move elsewhere waits for the cover; the creator stays.
      navigate(vi.fn(), '/studio/media');
      expect(session.leavingWhenSent).toBe(true);

      session.stay();

      heldAgain(session);
    });
  });

  it('a question the page closes for a newer one leaves the pass to the move that one asks about', async () => {
    publication = LIVE;
    // As LiveEditor's dialog: a newer question answers the open one Stay.
    const open: ((given: 'update' | 'leave' | 'stay') => void)[] = [];
    const askToLeave = vi.fn(() => {
      open.at(-1)?.('stay');
      return new Promise<'update' | 'leave' | 'stay'>((resolve) => {
        open.push(resolve);
      });
    });
    const session = start({ askToLeave, holdWhile: () => true });
    session.set('title', 'Not updated yet');
    navigate();
    nav.goto.mockImplementationOnce(async () => {
      navigate();
    });
    await session.leaveNow();
    // A Back to the same list while that question is open: asked again.
    navigate();
    await settle();
    expect(askToLeave).toHaveBeenCalledTimes(2);

    const last = vi.fn();
    nav.goto.mockImplementationOnce(async () => {
      navigate(last);
    });
    open.at(-1)?.('leave');
    await settle();

    // Discarded and sent on, never held again for the cover.
    expect(nav.goto).toHaveBeenCalledTimes(2);
    expect(last).not.toHaveBeenCalled();
    expect(session.leavingWhenSent).toBe(false);
  });

  it('…and so does the question about a failed Update, closed for a newer one', async () => {
    const out = Promise.withResolvers<undefined>();
    remotes.saveContent.mockReturnValueOnce(out.promise);
    publication = LIVE;
    const open: ((given: 'update' | 'leave' | 'stay') => void)[] = [];
    const askToLeave = vi.fn(() => {
      open.at(-1)?.('stay');
      return new Promise<'update' | 'leave' | 'stay'>((resolve) => {
        open.push(resolve);
      });
    });
    const session = start({ askToLeave, holdWhile: () => true });
    session.set('title', 'In the Update');
    void session.flush();
    navigate();
    nav.goto.mockImplementationOnce(async () => {
      navigate();
    });
    await session.leaveNow();
    out.reject(new Error('down'));
    await settle();
    expect(askToLeave).toHaveBeenLastCalledWith('failed');
    // A Back to the same list while that question is open: asked anew.
    navigate();
    await settle();
    expect(askToLeave).toHaveBeenCalledTimes(2);

    const last = vi.fn();
    nav.goto.mockImplementationOnce(async () => {
      navigate(last);
    });
    open.at(-1)?.('leave');
    await settle();

    expect(last).not.toHaveBeenCalled();
    expect(session.leavingWhenSent).toBe(false);
  });

  it('a pass ends once nothing is on its way: a later upload holds a move there again', async () => {
    publication = LIVE;
    let busy = $state(true);
    const session = start({ holdWhile: () => busy });
    navigate();
    // Nothing to ask about: its move goes through, and is stopped.
    nav.goto.mockImplementationOnce(async () => {
      navigate();
    });
    await session.leaveNow();

    // The cover lands; later another is chosen.
    busy = false;
    flushSync();
    busy = true;
    flushSync();
    const { cancel } = navigate();

    expect(cancel).toHaveBeenCalled();
    expect(session.leavingWhenSent).toBe(true);
  });

  it('a leave() that is stopped leaves no pass: a value lost after a later close is still told', async () => {
    publication = LIVE;
    const session = start();
    // Stopped, not arrived: the editor is still here.
    await session.leave('/studio/content');
    close();

    session.set('thumbnailUrl', 'https://cdn.test/staged/lg.webp');

    expect(told.toastAdd).toHaveBeenCalled();
  });

  it('after leave(), a value landing late is no news: nothing is left to keep it', async () => {
    publication = LIVE;
    const session = start();
    nav.goto.mockImplementationOnce(async () => close());

    await session.leave('/studio/content');
    session.set('thumbnailUrl', 'https://cdn.test/staged/lg.webp');

    expect(told.toastAdd).not.toHaveBeenCalled();
    expect(told.logError).not.toHaveBeenCalled();
    expect(told.logInfo).toHaveBeenCalledWith(
      'studio_editor.set_after_leave_dropped',
      { contentId: ID, key: 'thumbnailUrl' }
    );
  });

  it('leave() goes without a question or a wait: nothing is left to keep', async () => {
    publication = LIVE;
    const asking = dialog();
    const session = start({
      askToLeave: asking.askToLeave,
      holdWhile: () => true,
    });
    session.set('title', 'Never sent');

    const going = session.leave('/studio/content');
    // The move leave() makes passes the guard.
    const { cancel } = navigate();
    await going;

    expect(nav.goto).toHaveBeenCalledWith('/studio/content');
    expect(cancel).not.toHaveBeenCalled();
    expect(asking.asked).toEqual([]);
    expect(session.values.title).toBe(SAVED_VALUES.title);
    expect(remotes.saveContent).not.toHaveBeenCalled();
  });

  it('leaving asks the page, holds the move, and Stay keeps the changes', async () => {
    publication = LIVE;
    const asking = dialog();
    const session = start({ askToLeave: asking.askToLeave });
    session.set('title', 'Not updated yet');
    const { cancel } = navigate();

    expect(asking.asked).toEqual(['live']);
    expect(cancel).toHaveBeenCalledTimes(1);
    asking.answer('stay');
    await settle();

    expect(nav.goto).not.toHaveBeenCalled();
    expect(session.values.title).toBe('Not updated yet');
  });

  it('Discard drops the changes, sends nothing, and goes on', async () => {
    publication = LIVE;
    const asking = dialog();
    const session = start({ askToLeave: asking.askToLeave });
    session.set('title', 'Not updated yet');
    const { to } = navigate();
    asking.answer('leave');
    await settle();

    expect(remotes.saveContent).not.toHaveBeenCalled();
    expect(session.isDirty).toBe(false);
    expect(nav.goto).toHaveBeenCalledWith(to);
    // Nothing unsent: the move it sent on passes the guard.
    const again = vi.fn();
    nav.guards[0]?.({ willUnload: false, to: { url: to }, cancel: again });
    expect(again).not.toHaveBeenCalled();
  });

  it('Update sends the changes, then goes on', async () => {
    publication = LIVE;
    const asking = dialog();
    const session = start({ askToLeave: asking.askToLeave });
    session.set('title', 'Updated on the way out');
    const { to } = navigate();
    asking.answer('update');
    await settle();

    expect(remotes.saveContent).toHaveBeenCalledWith({
      id: ID,
      patch: { title: 'Updated on the way out' },
    });
    expect(nav.goto).toHaveBeenCalledWith(to);
  });

  it('a refused Update stays, keeping the changes for the bar to say', async () => {
    remotes.saveContent.mockRejectedValueOnce(offline());
    publication = LIVE;
    const asking = dialog();
    const session = start({ askToLeave: asking.askToLeave });
    session.set('title', 'Refused on the way out');
    navigate();
    asking.answer('update');
    await settle();

    expect(nav.goto).not.toHaveBeenCalled();
    expect(session.status).toBe('error');
    expect(session.values.title).toBe('Refused on the way out');
  });

  it('a Back answered Discard goes back as one, not by address', async () => {
    const go = vi.spyOn(history, 'go').mockImplementation(() => {});
    publication = LIVE;
    const asking = dialog();
    const session = start({ askToLeave: asking.askToLeave });
    session.set('title', 'Not updated yet');
    const to = new URL('http://studio-alpha.lvh.me:3000/studio/content');
    nav.guards[0]?.({
      willUnload: false,
      type: 'popstate',
      delta: -1,
      to: { url: to },
      cancel: vi.fn(),
    });
    asking.answer('leave');
    await settle();

    expect(go).toHaveBeenCalledWith(-1);
    expect(nav.goto).not.toHaveBeenCalled();
    expect(session.isDirty).toBe(false);
  });

  it("a draft's failed save asks the page too, and Leave goes as abandoned", async () => {
    // Every save fails, the close's last quiet try too: only an abandoned
    // leave goes untold.
    remotes.saveContent.mockRejectedValue(offline());
    const asking = dialog();
    const session = start({ askToLeave: asking.askToLeave });
    session.set('title', 'Never saved');
    const { to } = navigate();
    await settle();

    expect(asking.asked).toEqual(['failed']);
    // The next page takes over: the editor closes during the move.
    nav.goto.mockImplementationOnce(async () => close());
    asking.answer('leave');
    await settle();
    expect(nav.goto).toHaveBeenCalledWith(to);
    // Left by choice: its last quiet try fails too, and nothing is toasted.
    expect(told.toastAdd).not.toHaveBeenCalled();
  });

  it("a draft's question answered Stay keeps the creator there", async () => {
    remotes.saveContent.mockRejectedValueOnce(offline());
    const asking = dialog();
    const session = start({ askToLeave: asking.askToLeave });
    session.set('title', 'Never saved');
    navigate();
    await settle();
    asking.answer('stay');
    await settle();
    expect(nav.goto).not.toHaveBeenCalled();
    expect(unload()).toBe(true);
  });
});

// The epic review's critical (Codex-a6ofh.2, owner 2026-11-09): a piece can
// go live with its draft's editor open (its schedule fired, an admin, another
// tab). The server refuses the draft's save; from then on this editor sends
// nothing, and "Open it to update" carries its changes to the live editor.
describe('it went live by another way', () => {
  const refusedAsLive = {
    status: 409,
    body: { code: 'CONTENT_ALREADY_LIVE', message: 'This went live.' },
  };
  const FOLLOWING: DraftValues = {
    ...SAVED_VALUES,
    title: 'Runes',
    slug: contentSlugFromTitle('Runes', 'video'),
  };

  async function wentLive(values: DraftValues = SAVED_VALUES) {
    const session = start({ saved: { id: ID, values } });
    remotes.saveContent.mockRejectedValueOnce(refusedAsLive);
    session.set('description', 'Half-typed');
    await afterDebounce();
    return session;
  }

  it('a draft save refused as live: nothing more is sent, whatever asks', async () => {
    const session = await wentLive();
    expect(remotes.saveContent).toHaveBeenCalledTimes(1);
    expect(remotes.saveContent).toHaveBeenCalledWith(
      expect.objectContaining({ asDraft: true })
    );
    expect(session.wentLiveElsewhere).toBe(true);
    expect(told.logWarn).toHaveBeenCalledWith(
      'studio_editor.went_live_elsewhere',
      { contentId: ID }
    );

    // More typing, Try again, and Next's or a move's flush: none sends, as
    // each would be an Update this editor was never asked for.
    session.set('description', 'More words');
    await afterDebounce();
    session.retry();
    await settle();
    const flushed = await session.flush();

    expect(remotes.saveContent).toHaveBeenCalledTimes(1);
    expect(flushed).toMatchObject({
      ok: false,
      code: 'CONTENT_ALREADY_LIVE',
      message: m.studio_editor_went_live_elsewhere({
        title: SAVED_VALUES.title,
      }),
    });
    expect(session.values.description).toBe('More words');
    expect(session.isDirty).toBe(true);
  });

  it('its address stays the live one: a slug that followed the title goes back', async () => {
    const session = start({ saved: { id: ID, values: FOLLOWING } });
    remotes.saveContent.mockRejectedValueOnce(refusedAsLive);
    session.set('title', 'Runes renamed');
    expect(session.values.slug).toBe(
      contentSlugFromTitle('Runes renamed', 'video')
    );
    await afterDebounce();

    expect(session.values.slug).toBe(FOLLOWING.slug);
    session.set('title', 'Runes renamed again');
    expect(session.values.slug).toBe(FOLLOWING.slug);
  });

  // On Publish, the schedule's own read is often the first to see it: what
  // was typed and not sent yet goes to the live editor too, never left on a
  // draft's screen with no Update to send it (the round-3 review).
  it('a page read that sees it go live under changes not sent: it went live under the editor', async () => {
    const session = start();
    session.set('description', 'Half-typed');
    publication = LIVE;
    flushSync();

    expect(session.wentLiveElsewhere).toBe(true);
    await afterDebounce();
    expect(remotes.saveContent).not.toHaveBeenCalled();
  });

  it('nothing waiting as it goes live: nothing to carry, so no notice', () => {
    const session = start();
    publication = LIVE;
    flushSync();
    expect(session.wentLiveElsewhere).toBe(false);
  });

  it('its own Publish going live is not that, though the page reads it live meanwhile', async () => {
    const send = Promise.withResolvers<unknown>();
    const session = start();
    const run = session.publish(() => send.promise);
    await settle();
    session.set('description', 'Typed while it published');
    publication = LIVE;
    flushSync();
    expect(session.wentLiveElsewhere).toBe(false);
    send.resolve({});
    await run;
  });

  it("a live piece's Update is not a draft's save: it goes without asDraft", async () => {
    publication = LIVE;
    const session = start();
    session.set('description', 'On purpose');
    await session.flush();

    expect(remotes.saveContent).toHaveBeenCalledWith({
      id: ID,
      patch: { description: 'On purpose' },
    });
  });

  it('Open it to update reads where it stands, has the page read it, then moves, carrying every change but the address', async () => {
    const session = await wentLive(FOLLOWING);
    session.set('title', 'Runes renamed');
    // An address typed on Publish meanwhile: a live piece keeps its own.
    session.set('slug', 'a-new-address');
    const steps: string[] = [];
    remotes.readPublishState.mockImplementation(async () => {
      steps.push('read');
      return { status: 'published', publishedAt: '2026-11-09T10:00:00.000Z' };
    });
    nav.invalidateAll.mockImplementation(async () => {
      steps.push('reread');
      publication = LIVE;
    });
    nav.goto.mockImplementation(async () => {
      steps.push('move');
      // The move is the session's own: its guard lets it go, unasked.
      const { cancel } = navigate(vi.fn(), `/studio/content/${ID}/edit`);
      expect(cancel).not.toHaveBeenCalled();
    });

    await session.openLive();

    expect(steps).toEqual(['read', 'reread', 'move']);
    expect(remotes.readPublishState).toHaveBeenCalledWith(ID);
    // From Write, the address it is on: replaced, never a second entry.
    expect(nav.goto).toHaveBeenCalledWith(`/studio/content/${ID}/edit`, {
      replaceState: true,
    });
    expect(takeLiveHandoff(ID)).toEqual({
      changes: { title: 'Runes renamed', description: 'Half-typed' },
    });
    expect(remotes.saveContent).toHaveBeenCalledTimes(1);
    expect(session.openLiveProblem).toBeNull();
  });

  // kit's invalidateAll() resolves when a refresh in it fails (2.55): only a
  // read whose failure is seen can say the piece reads as live (the round-2
  // review). One that fails keeps the creator here, changes and all.
  it('a read that fails stays, says so, and hands nothing off', async () => {
    const session = await wentLive();
    remotes.readPublishState.mockRejectedValueOnce(offline());

    await session.openLive();

    expect(nav.invalidateAll).not.toHaveBeenCalled();
    expect(nav.goto).not.toHaveBeenCalled();
    expect(takeLiveHandoff(ID)).toBeNull();
    expect(session.openLiveProblem).toBe('outage');
    expect(session.values.description).toBe('Half-typed');
    expect(told.logError).toHaveBeenCalledWith(
      'studio_editor.open_live_reread_failed',
      expect.objectContaining({ contentId: ID })
    );

    // The next press tries again, and clears what the last one said.
    await session.openLive();
    expect(session.openLiveProblem).toBeNull();
    expect(nav.goto).toHaveBeenCalledTimes(1);
  });

  // A refusal no try again cures is said as what it is, and is a warning,
  // not an alert (the studio's one rule; the round-3 review).
  it.each([
    [404, 'gone'],
    [401, 'signed-out'],
  ] as const)('a read refused %i says %s, warned, and stays', async (status, problem) => {
    const session = await wentLive();
    remotes.readPublishState.mockRejectedValueOnce({
      status,
      body: { code: 'X' },
    });

    await session.openLive();

    expect(session.openLiveProblem).toBe(problem);
    expect(nav.goto).not.toHaveBeenCalled();
    expect(told.logWarn).toHaveBeenCalledWith(
      'studio_editor.open_live_reread_failed',
      expect.objectContaining({ contentId: ID, status })
    );
    expect(told.logError).not.toHaveBeenCalledWith(
      'studio_editor.open_live_reread_failed',
      expect.anything()
    );
  });

  // The next editor is built from the page's read, not this one's, and
  // kit's invalidateAll resolves when its refresh failed: a move then would
  // open the draft editor again, the changes gone (the round-3 review).
  it('a page whose refresh still reads a draft stays: no move, nothing handed off', async () => {
    const session = await wentLive();
    nav.invalidateAll.mockResolvedValueOnce(undefined);

    await session.openLive();

    expect(nav.goto).not.toHaveBeenCalled();
    expect(takeLiveHandoff(ID)).toBeNull();
    expect(session.openLiveProblem).toBe('outage');
    expect(session.values.description).toBe('Half-typed');
    expect(told.logError).toHaveBeenCalledWith(
      'studio_editor.open_live_reread_failed',
      { contentId: ID, stage: 'page' }
    );
  });

  // Publish to the edit address changes the step, which reads again: a move
  // of its own, so Back goes to Publish, never to a same-address entry.
  it('from Publish, the move is pushed, not replaced', async () => {
    const was = location.href;
    history.replaceState(null, '', `/studio/content/${ID}/edit?step=publish`);
    try {
      const session = await wentLive();
      await session.openLive();
      expect(nav.goto).toHaveBeenCalledWith(`/studio/content/${ID}/edit`, {
        replaceState: false,
      });
    } finally {
      history.replaceState(null, '', was);
    }
  });

  // An error page in its place (a load failed while the page re-read): the
  // changes wait for the live editor's next mount, or are said as too late,
  // never withdrawn unsaid (the round-3 review).
  it('its screen replaced while the page re-read: the changes wait, said', async () => {
    const session = await wentLive();
    nav.invalidateAll.mockImplementationOnce(async () => {
      close();
    });

    await session.openLive();

    expect(nav.goto).not.toHaveBeenCalled();
    expect(told.logWarn).toHaveBeenCalledWith(
      'studio_editor.open_live_page_replaced',
      { contentId: ID, keys: ['description'] }
    );
    expect(takeLiveHandoff(ID)).toEqual({
      changes: { description: 'Half-typed' },
    });
  });

  it('left without them while the page re-read: nothing is carried', async () => {
    const session = await wentLive();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    nav.invalidateAll.mockImplementationOnce(async () => {
      // The live question, answered Leave: the move goes as it was.
      const { cancel } = navigate();
      expect(cancel).not.toHaveBeenCalled();
      close();
    });

    await session.openLive();

    expect(takeLiveHandoff(ID)).toBeNull();
    expect(told.logWarn).not.toHaveBeenCalledWith(
      'studio_editor.open_live_page_replaced',
      expect.anything()
    );
  });

  it('a read that says it was never live stays too: the live editor would not open', async () => {
    const session = await wentLive();
    remotes.readPublishState.mockResolvedValueOnce({
      status: 'draft',
      publishedAt: null,
    });

    await session.openLive();

    expect(nav.goto).not.toHaveBeenCalled();
    expect(session.openLiveProblem).toBe('outage');
  });

  it('while it reads, a move elsewhere is still asked about: only its own move passes', async () => {
    const session = await wentLive();
    const reading = Promise.withResolvers<{
      status: string;
      publishedAt: string;
    }>();
    remotes.readPublishState.mockReturnValueOnce(reading.promise);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    const opened = session.openLive();
    const { cancel } = navigate();

    expect(confirm).toHaveBeenCalledWith(
      m.studio_content_draft_confirm_leave_live()
    );
    expect(cancel).toHaveBeenCalled();
    reading.resolve({ status: 'published', publishedAt: '2026-11-09' });
    await opened;
    expect(nav.goto).toHaveBeenCalledWith(
      `/studio/content/${ID}/edit`,
      expect.anything()
    );
  });

  it('closed while it read: no move of its own, nothing handed off', async () => {
    const session = await wentLive();
    const reading = Promise.withResolvers<{
      status: string;
      publishedAt: string;
    }>();
    remotes.readPublishState.mockReturnValueOnce(reading.promise);

    const opened = session.openLive();
    close();
    reading.resolve({ status: 'published', publishedAt: '2026-11-09' });
    await opened;

    expect(nav.goto).not.toHaveBeenCalled();
    expect(takeLiveHandoff(ID)).toBeNull();
    // Nor does it have the page it went to read again: that page is not its.
    expect(nav.invalidateAll).not.toHaveBeenCalled();
  });

  it('carried to the live editor, its close leaves no trace of dropped changes', async () => {
    const session = await wentLive();
    await session.openLive();
    told.logWarn.mockClear();

    close();
    await settle();

    expect(told.logWarn).not.toHaveBeenCalledWith(
      'studio_editor.closed_with_unsent_changes',
      expect.anything()
    );
  });

  it('a move that fails is logged and said, and the creator stays with their changes', async () => {
    const session = await wentLive();
    nav.goto.mockRejectedValueOnce(new Error('navigation aborted'));

    await session.openLive();

    expect(told.logError).toHaveBeenCalledWith(
      'studio_editor.open_live_failed',
      expect.objectContaining({ contentId: ID })
    );
    expect(session.openLiveProblem).toBe('outage');
    expect(takeLiveHandoff(ID)).toBeNull();
    expect(session.values.description).toBe('Half-typed');
    // Guarding again: a move now asks, as the live piece's changes wait.
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { cancel } = navigate();
    expect(confirm).toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
  });

  it('a move that waits for a save it then finds live asks as live, not as a failure', async () => {
    const out = Promise.withResolvers<never>();
    const session = start();
    remotes.saveContent.mockReturnValueOnce(out.promise);
    session.set('description', 'Half-typed');
    await afterDebounce();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    const { cancel } = navigate();
    expect(cancel).toHaveBeenCalled();
    out.reject(refusedAsLive);
    await settle();

    expect(session.wentLiveElsewhere).toBe(true);
    expect(confirm).toHaveBeenCalledWith(
      m.studio_content_draft_confirm_leave_live()
    );
    expect(confirm).not.toHaveBeenCalledWith(
      m.studio_content_draft_confirm_leave()
    );
  });

  it('before it went live, Open it to update does nothing', async () => {
    const session = start();

    await session.openLive();

    expect(nav.goto).not.toHaveBeenCalled();
    expect(takeLiveHandoff(ID)).toBeNull();
  });

  it('carried changes start unsaved, waiting for Update, never autosaved', async () => {
    publication = LIVE;
    const session = start({ carried: { description: 'Carried over' } });

    expect(session.values.description).toBe('Carried over');
    expect(session.isDirty).toBe(true);
    expect(session.changeCount).toBe(1);
    await afterDebounce();
    expect(remotes.saveContent).not.toHaveBeenCalled();
  });
});
