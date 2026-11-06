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
}));
const nav = vi.hoisted(() => ({
  guards: [] as Array<(navigation: unknown) => void>,
  goto: vi.fn(),
}));
const told = vi.hoisted(() => ({
  toastAdd: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock('$lib/remote/content.remote', () => remotes);
vi.mock('$app/navigation', () => ({
  beforeNavigate: (guard: (navigation: unknown) => void) => {
    nav.guards.push(guard);
  },
  goto: (...args: unknown[]) => nav.goto(...args),
}));
vi.mock('$lib/components/ui/Toast/toast-store', () => ({
  toast: { add: told.toastAdd },
}));
vi.mock('$lib/observability', () => ({
  logger: { error: told.logError, warn: told.logWarn },
}));

const { createDraftSession } = await import('./draft-session.svelte');
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
function navigate(cancel = vi.fn()) {
  const to = new URL('http://studio-alpha.lvh.me:3000/studio/content');
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
    publication = LIVE;
    const flushed = session.flush();
    out.resolve(undefined);

    await expect(flushed).resolves.toEqual({ ok: true });
    expect(remotes.saveContent).toHaveBeenLastCalledWith({
      id: ID,
      patch: { description: 'Queued behind it' },
    });
  });

  it('a Publish that fails and reads as a draft again saves what waited', async () => {
    const session = start();
    publication = LIVE;
    session.set('description', 'Typed while Publish was out');
    await afterDebounce();
    expect(remotes.saveContent).not.toHaveBeenCalled();

    publication = DRAFT;
    flushSync();
    await afterDebounce();
    expect(remotes.saveContent).toHaveBeenCalledWith({
      id: ID,
      patch: { description: 'Typed while Publish was out' },
    });
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

  // Publish failed fast and was clicked again while its first save was out.
  it('a Publish retried after a rollback still sends what was typed between', async () => {
    const out = Promise.withResolvers<undefined>();
    remotes.saveContent.mockReturnValueOnce(out.promise);
    const session = start();
    publication = LIVE;
    flushSync();
    session.set('title', 'First Publish');
    void session.flush();
    publication = DRAFT;
    flushSync();
    session.set('description', 'Typed after the rollback');
    publication = LIVE;
    flushSync();
    const retried = session.flush();
    out.resolve(undefined);
    await retried;
    expect(remotes.saveContent).toHaveBeenLastCalledWith({
      id: ID,
      patch: { description: 'Typed after the rollback' },
    });
  });

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
    publication = LIVE;
    flushSync();
    void session.flush();
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
    publication = LIVE;
    flushSync();
    void session.flush();
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
      fail: (_reason: unknown) => {},
    };
    const send = vi.fn(
      () =>
        new Promise((resolve, reject) => {
          answer.ok = () => resolve({});
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
    expect(result).toEqual({ ok: true });
    expect(remotes.saveContent).toHaveBeenCalledWith({
      id: ID,
      patch: { title: 'Runes, all three' },
    });
    expect(send).toHaveBeenCalledWith(ID);
    expect(remotes.saveContent.mock.invocationCallOrder[0]).toBeLessThan(
      send.mock.invocationCallOrder[0] ?? 0
    );
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
    await expect(run).resolves.toEqual({ ok: true });
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
    await expect(run).resolves.toEqual({ ok: true });
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
    await expect(run).resolves.toEqual({ ok: true });
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
