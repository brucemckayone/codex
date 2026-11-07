/**
 * The content editor's Write step (Codex-a6ofh.2.3): opening it makes no
 * row, the first thing added does and the address becomes the piece's, a
 * saved draft opens as it was saved, and Next saves before it moves on.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ContentWithRelations } from '$lib/types';
import { contentSlugFromTitle } from '$lib/utils/content-slug';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const MEDIA_ID = '6b000000-0000-4000-8000-000000000001';

const remotes = vi.hoisted(() => ({
  saveContent: vi.fn(),
  createContentDraft: vi.fn(),
  deleteThumbnailCommand: vi.fn(),
}));
// The cover's upload form, one per piece. A test sends it by hand with the
// callback the cover line gave `enhance`, and answers it in `result`.
type CoverSend = (submission: {
  form: { reset: () => void };
  submit: () => Promise<void>;
}) => Promise<void>;
const coverForm = vi.hoisted(() => ({
  result: undefined as unknown,
  send: null as CoverSend | null,
}));
vi.mock('$lib/remote/content.remote', () => ({
  ...remotes,
  uploadThumbnailForm: {
    for: () => ({
      get result() {
        return coverForm.result;
      },
      enhance: (send: CoverSend) => {
        coverForm.send = send;
        return { method: 'POST', action: '' };
      },
    }),
  },
}));

// The by-id media read, thenable as kit's query is: what `library.items`
// holds answers; an id in `pending` has not answered until `release(id)`;
// an id in `down` meets an outage (no answer at all); anything else is a
// 404, as media gone or not theirs is.
const library = vi.hoisted(() => ({
  items: [] as Record<string, unknown>[],
  pending: new Set<string>(),
  waiting: new Map<string, () => void>(),
  down: new Set<string>(),
}));
function release(id: string) {
  library.pending.delete(id);
  library.waiting.get(id)?.();
}
vi.mock('$lib/remote/media.remote', () => ({
  getMediaItem: (id: string) => {
    const refresh = async () => {};
    if (library.pending.has(id)) {
      const answered = new Promise<void>((resolve) =>
        library.waiting.set(id, resolve)
      );
      return {
        current: undefined,
        error: undefined,
        refresh,
        // biome-ignore lint/suspicious/noThenProperty: a thenable stands in for kit's query
        then: (
          ok: (value: unknown) => unknown,
          fail: (reason: unknown) => unknown
        ) =>
          answered
            .then(() => library.items.find((entry) => entry.id === id))
            .then(ok, fail),
      };
    }
    const item = library.items.find((entry) => entry.id === id);
    const failure = library.down.has(id)
      ? new TypeError('Failed to fetch')
      : { status: 404 };
    const answer = item ? Promise.resolve(item) : Promise.reject(failure);
    answer.catch(() => {});
    return {
      current: item,
      error: item ? undefined : failure,
      refresh,
      // Reactive, as kit's is: its `then` reads the query's promise, which a
      // refresh replaces (`refreshes.count` stands in for that).
      // biome-ignore lint/suspicious/noThenProperty: a thenable stands in for kit's query
      get then() {
        void refreshes.count;
        return (
          ok: (value: unknown) => unknown,
          fail: (reason: unknown) => unknown
        ) => answer.then(ok, fail);
      },
    };
  },
  listMedia: () => ({
    current: undefined,
    error: undefined,
    refresh: async () => {},
  }),
  getMediaPreview: vi.fn(),
}));
vi.mock('$lib/client/media-status.svelte', () => ({
  mediaStatus: {
    items: new Map(),
    now: 0,
    connection: 'idle',
    register: () => () => {},
    resume: () => {},
  },
}));
// The studio's upload queue: a dropped file becomes a row, changed in place.
// A refresh of the media queries (kit's `invalidateAll` after a form, say).
const refreshes = $state({ count: 0 });
const queue = $state<{ items: Record<string, unknown>[]; rejections: never[] }>(
  { items: [], rejections: [] }
);
vi.mock('$lib/client/upload-queue.svelte', () => ({
  uploadQueue: {
    get items() {
      return queue.items;
    },
    get rejections() {
      return queue.rejections;
    },
    add: (files: File[]) => {
      const file = files[0];
      if (!file) return [];
      queue.items.push({
        key: 'k1',
        id: null,
        status: 'uploading',
        title: file.name,
        progress: 10,
        // As the queue reads it: from the file's own type.
        mediaType: file.type.startsWith('audio/') ? 'audio' : 'video',
        failure: null,
      });
      return ['k1'];
    },
    cancel: vi.fn(),
    retry: vi.fn(),
    remove: vi.fn(),
  },
}));

// The guards a move goes past (the draft session's and the Write step's):
// a test plays a move through them by hand.
type Move = {
  to: { url: URL } | null;
  type: string;
  delta?: number;
  willUnload: boolean;
  cancel: () => void;
};
const nav = vi.hoisted(() => ({
  replaceState: vi.fn(),
  goto: vi.fn(),
  guards: [] as ((move: Move) => void)[],
  /** What runs once a move lands: the visit turns over. */
  arrived: [] as (() => void)[],
}));
// Shallow-routing state: what Back restores to a history entry.
const pageState = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock('$app/state', () => ({ page: pageState }));
vi.mock('$app/navigation', () => ({
  beforeNavigate: (guard: (move: Move) => void) => nav.guards.push(guard),
  afterNavigate: (then: () => void) => nav.arrived.push(then),
  replaceState: (...args: unknown[]) => nav.replaceState(...args),
  goto: (...args: unknown[]) => nav.goto(...args),
}));
vi.mock('$lib/components/ui/Toast/toast-store', () => ({
  toast: { add: vi.fn() },
}));
const told = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }));
vi.mock('$lib/observability', () => ({
  logger: { error: told.error, warn: told.warn },
}));

// ProseMirror can't be typed into in jsdom: a textarea reports the body.
vi.mock('$lib/components/editor/RichTextEditor.svelte', async () => ({
  default: (await import('./__fixtures__/RichTextEditorStub.svelte')).default,
}));

// Step 2 has its own suite (PublishStep.svelte.test.ts): here, only which step mounts.
vi.mock('./PublishStep.svelte', async () => ({
  default: (await import('./__fixtures__/PublishStepProbe.svelte')).default,
}));
// So has a live piece's editor (LiveEditor.svelte.test.ts).
vi.mock('./LiveEditor.svelte', async () => ({
  default: (await import('./__fixtures__/LiveEditorProbe.svelte')).default,
}));

const ContentEditor = (await import('./ContentEditor.svelte')).default;

/** The autosave's debounce, with room. */
const SETTLE_MS = 1_600;

let component: ReturnType<typeof mount> | null = null;

function render(props: Record<string, unknown>) {
  component = mount(ContentEditor, {
    target: document.body,
    props: {
      content: null,
      contentType: 'video',
      organizationId: 'org-1',
      authorName: 'Studio Alpha',
      ...props,
    } as never,
  });
  flushSync();
}

function draft(fields: Partial<ContentWithRelations>): ContentWithRelations {
  return {
    id: 'c1',
    title: 'Svelte runes deep dive',
    contentType: 'video',
    status: 'draft',
    publishedAt: null,
    description: null,
    contentBody: null,
    contentBodyJson: null,
    mediaItemId: null,
    thumbnailUrl: null,
    ...fields,
  } as ContentWithRelations;
}

const text = () => document.body.textContent ?? '';
const field = (label: string) =>
  document.querySelector<HTMLTextAreaElement>(
    `textarea[aria-label="${label}"]`
  );
const nextButton = () =>
  [...document.querySelectorAll('button')].find((node) =>
    node.textContent?.includes('Next: publish')
  );

function type(label: string, value: string) {
  const input = field(label);
  if (!input) throw new Error(`no ${label} field`);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

beforeEach(() => {
  vi.useFakeTimers();
  // As the command does: the slug from the title it was sent.
  remotes.createContentDraft.mockImplementation(
    async (draft: { title: string; contentType: string }) => ({
      id: 'c-new',
      slug: contentSlugFromTitle(draft.title, draft.contentType),
    })
  );
  remotes.saveContent.mockResolvedValue({});
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  library.items = [];
  library.pending.clear();
  library.waiting.clear();
  library.down.clear();
  pageState.state = {};
  nav.guards.length = 0;
  nav.arrived.length = 0;
  queue.items = [];
  coverForm.result = undefined;
  coverForm.send = null;
  vi.clearAllMocks();
  vi.useRealTimers();
});

const WINTER_LIGHT = {
  id: MEDIA_ID,
  title: 'Winter Light',
  mediaType: 'video',
  status: 'ready',
  durationSeconds: 1660,
  createdAt: new Date().toISOString(),
};

/** jsdom has no DragEvent: a drop on the media slot, carrying the file. */
function drop(file: File) {
  const slot = document.querySelector('.slot');
  if (!slot) throw new Error('no slot');
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files: [file] } });
  slot.dispatchEvent(event);
  flushSync();
}

describe('ContentEditor · a new piece', () => {
  test('opening it makes no row, and Next waits for one', async () => {
    render({});
    await vi.advanceTimersByTimeAsync(5_000);
    expect(remotes.createContentDraft).not.toHaveBeenCalled();
    expect(text()).toContain('New video · not saved yet');
    expect(nextButton()?.disabled).toBe(true);
  });

  test('the first words make the row, and the address becomes its edit page', async () => {
    render({});
    type('Title', 'Svelte runes');
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(remotes.createContentDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: 'video',
        organizationId: 'org-1',
        title: 'Svelte runes',
      })
    );
    // Swapped in place: a navigation would remount the page and drop the
    // session. The entry keeps the draft's id, for Back to find.
    expect(nav.replaceState).toHaveBeenCalledWith(
      '/studio/content/c-new/edit',
      { editorDraftId: 'c-new' }
    );
    expect(nav.goto).not.toHaveBeenCalled();
    flushSync();
    expect(nextButton()?.disabled).toBe(false);
    expect(text()).toContain('Draft');
  });

  test('"Create content from this": the draft is made with its media, named after it', async () => {
    library.items = [WINTER_LIGHT];
    render({ initialMediaId: MEDIA_ID });
    await vi.advanceTimersByTimeAsync(0);
    flushSync();
    expect(text()).toContain('27:40');
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(remotes.createContentDraft).toHaveBeenCalledWith(
      expect.objectContaining({ mediaItemId: MEDIA_ID, title: 'Winter Light' })
    );
  });
});

describe('ContentEditor · a new piece named after its media', () => {
  test('waits for the media to be read: a draft made before would have no name', async () => {
    library.pending.add(MEDIA_ID);
    render({ initialMediaId: MEDIA_ID });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(remotes.createContentDraft).not.toHaveBeenCalled();
    expect(text()).not.toContain('Give it a title');

    library.items = [WINTER_LIGHT];
    release(MEDIA_ID);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(remotes.createContentDraft).toHaveBeenCalledWith(
      expect.objectContaining({ mediaItemId: MEDIA_ID, title: 'Winter Light' })
    );
  });

  test('a link to media gone or not theirs starts a blank piece, and says why in the log', async () => {
    render({ initialMediaId: MEDIA_ID });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(remotes.createContentDraft).not.toHaveBeenCalled();
    expect(text()).toContain('Add the video');
    expect(told.warn).toHaveBeenCalledWith(
      'studio_editor.initial_media_unread',
      expect.objectContaining({ mediaId: MEDIA_ID, status: 404 })
    );
    expect(told.error).not.toHaveBeenCalled();
    expect(text()).toContain("This media was deleted, or isn't yours to use.");
  });

  test('a later refresh of the linked media never puts back what the creator removed', async () => {
    library.items = [WINTER_LIGHT];
    render({ initialMediaId: MEDIA_ID });
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(remotes.createContentDraft).toHaveBeenCalledWith(
      expect.objectContaining({ mediaItemId: MEDIA_ID })
    );
    flushSync();
    [...document.querySelectorAll('button')]
      .find((node) => node.getAttribute('aria-label') === 'Remove Winter Light')
      ?.click();
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(remotes.saveContent).toHaveBeenLastCalledWith({
      id: 'c-new',
      patch: { mediaItemId: null },
    });

    refreshes.count += 1;
    flushSync();
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(remotes.saveContent).toHaveBeenCalledTimes(1);
    expect(text()).toContain('Add the video');
  });

  test('an outage keeps the media chosen: the slot says so and offers Try again', async () => {
    library.down.add(MEDIA_ID);
    render({ initialMediaId: MEDIA_ID });
    await vi.advanceTimersByTimeAsync(0);
    flushSync();
    expect(told.error).toHaveBeenCalledWith(
      'studio_editor.initial_media_unread',
      expect.objectContaining({ mediaId: MEDIA_ID })
    );
    expect(text()).not.toContain('Add the video');
    expect(
      [...document.querySelectorAll('button')].some(
        (node) => node.textContent?.trim() === 'Try Again'
      )
    ).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);
    // Nothing names it yet, so no draft: it waits for the media's title.
    expect(remotes.createContentDraft).not.toHaveBeenCalled();
  });

  test('Back to a new piece once its draft exists opens the draft, never a blank piece', async () => {
    pageState.state = { editorDraftId: 'c-made' };
    render({ initialMediaId: MEDIA_ID });
    flushSync();
    expect(nav.goto).toHaveBeenCalledWith('/studio/content/c-made/edit', {
      replaceState: true,
    });
    expect(field('Title')).toBeNull();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(remotes.createContentDraft).not.toHaveBeenCalled();
  });

  test('an upload first is named after its file, before the media can be read', async () => {
    library.pending.add(MEDIA_ID);
    render({});
    drop(new File(['x'], 'winter-light.mp4', { type: 'video/mp4' }));
    const row = queue.items[0];
    if (!row) throw new Error('no queued row');
    row.id = MEDIA_ID;
    flushSync();
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(remotes.createContentDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaItemId: MEDIA_ID,
        title: 'winter-light.mp4',
      })
    );
  });
});

describe('ContentEditor · a move into step 2 waits as Next does', () => {
  function move(href: string, cancel: () => void) {
    for (const guard of nav.guards) {
      guard({
        to: { url: new URL(`https://alpha.test${href}`) },
        type: 'popstate',
        delta: 1,
        willUnload: false,
        cancel,
      });
    }
  }

  /** The bar's line saying a move is held, and for what; empty when none is. */
  const held = () => document.querySelector('.write-held')?.textContent?.trim();
  const PUBLISH = '/studio/content/c1/edit?step=publish';

  /** The cover going up through the cover line's own form; answer it with a result. */
  function sendingCover() {
    const send = coverForm.send;
    if (!send) throw new Error('no cover form');
    let answer: (result: unknown) => void = () => {};
    const sent = send({
      form: { reset: vi.fn() },
      submit: () =>
        new Promise<void>((resolve) => {
          answer = (result) => {
            coverForm.result = result;
            resolve();
          };
        }),
    });
    flushSync();
    return async (result: unknown) => {
      answer(result);
      await sent;
      flushSync();
    };
  }

  test('Forward into step 2 is held while a file has no media row, then goes on', async () => {
    render({ content: draft({}) });
    drop(new File(['x'], 'winter-light.mp4', { type: 'video/mp4' }));
    flushSync();

    const cancel = vi.fn();
    move(PUBLISH, cancel);
    flushSync();
    expect(cancel).toHaveBeenCalled();
    expect(held()).toBe('Wait for the upload to start');

    const go = vi.spyOn(history, 'go').mockImplementation(() => {});
    const row = queue.items[0];
    if (!row) throw new Error('no queued row');
    row.id = MEDIA_ID;
    flushSync();
    expect(go).toHaveBeenCalledWith(1);
    go.mockRestore();
  });

  test('a move held for a file is dropped when its upload fails, and stays dropped when a retry works', () => {
    render({ content: draft({}) });
    drop(new File(['x'], 'winter-light.mp4', { type: 'video/mp4' }));
    flushSync();
    const go = vi.spyOn(history, 'go').mockImplementation(() => {});
    const cancel = vi.fn();
    move(PUBLISH, cancel);
    flushSync();
    expect(cancel).toHaveBeenCalled();

    const row = queue.items[0];
    if (!row) throw new Error('no queued row');
    row.status = 'error';
    flushSync();
    expect(text()).toContain('Upload failed. Please try again.');
    expect(held()).toBe('');

    // A Try again that works later never sends the move dropped before it.
    row.status = 'uploading';
    row.id = MEDIA_ID;
    flushSync();
    expect(go).not.toHaveBeenCalled();
    expect(nav.goto).not.toHaveBeenCalled();
    go.mockRestore();
  });

  test('a move held for a file is dropped when the file is cancelled before its row', () => {
    render({ content: draft({}) });
    drop(new File(['x'], 'winter-light.mp4', { type: 'video/mp4' }));
    flushSync();
    const go = vi.spyOn(history, 'go').mockImplementation(() => {});
    const cancel = vi.fn();
    move(PUBLISH, cancel);
    flushSync();
    expect(cancel).toHaveBeenCalled();

    // The queue drops a cancelled row.
    queue.items = [];
    flushSync();
    expect(go).not.toHaveBeenCalled();
    expect(nav.goto).not.toHaveBeenCalled();
    expect(held()).toBe('');
    go.mockRestore();
  });

  test('a move held for the cover is dropped when an upload that had its row fails meanwhile', async () => {
    render({ contentType: 'audio', content: draft({ contentType: 'audio' }) });
    drop(new File(['x'], 'evening-talk.mp3', { type: 'audio/mpeg' }));
    const row = queue.items[0];
    if (!row) throw new Error('no queued row');
    row.id = MEDIA_ID;
    flushSync();
    const answerCover = sendingCover();
    const go = vi.spyOn(history, 'go').mockImplementation(() => {});
    const cancel = vi.fn();
    move(PUBLISH, cancel);
    flushSync();
    expect(cancel).toHaveBeenCalled();
    expect(held()).toBe('Wait for the cover to finish');

    // Its bytes fail after its row came: the picker undoes the attach.
    row.status = 'error';
    flushSync();
    await answerCover({
      success: true,
      thumbnailUrl: 'https://cdn.test/new.webp',
    });
    expect(go).not.toHaveBeenCalled();
    expect(nav.goto).not.toHaveBeenCalled();
    go.mockRestore();
  });

  test.each([
    {
      said: 'an outage',
      result: {
        success: false,
        status: 500,
        error: 'Failed to upload thumbnail',
      },
      level: 'error',
      event: 'studio_editor.cover_upload_failed',
      shown: 'Couldn’t upload the cover. Try again.',
    },
    {
      said: 'a refusal',
      result: {
        success: false,
        status: 422,
        error: 'This image is too large to process.',
      },
      level: 'warn',
      event: 'studio_editor.cover_upload_refused',
      shown: 'This image is too large to process.',
    },
    {
      said: 'a refusal with no reason',
      result: { success: false, status: 422, error: '' },
      level: 'warn',
      event: 'studio_editor.cover_upload_refused',
      shown: 'Couldn’t upload the cover. Try again.',
    },
  ] as const)('a move held for a cover upload is dropped on $said, says why, and logs it as one', async ({
    result,
    level,
    event,
    shown,
  }) => {
    render({
      contentType: 'written',
      content: draft({ contentType: 'written' }),
    });
    const answerCover = sendingCover();
    const go = vi.spyOn(history, 'go').mockImplementation(() => {});
    const cancel = vi.fn();
    move(PUBLISH, cancel);
    flushSync();
    expect(cancel).toHaveBeenCalled();
    expect(held()).toBe('Wait for the cover to finish');

    await answerCover(result);
    expect(go).not.toHaveBeenCalled();
    expect(nav.goto).not.toHaveBeenCalled();
    expect(text()).toContain(shown);
    expect(held()).toBe('');
    expect(told[level]).toHaveBeenCalledWith(
      event,
      expect.objectContaining({ status: result.status })
    );
    go.mockRestore();
  });

  test('a move held for a cover upload goes on once the cover is saved', async () => {
    render({
      contentType: 'written',
      content: draft({ contentType: 'written' }),
    });
    const answerCover = sendingCover();
    const go = vi.spyOn(history, 'go').mockImplementation(() => {});
    move(PUBLISH, vi.fn());
    flushSync();

    await answerCover({
      success: true,
      thumbnailUrl: 'https://cdn.test/new.webp',
    });
    expect(go).toHaveBeenCalledWith(1);
    go.mockRestore();
  });

  /** An article with a cover, whose removal answers when the test says. */
  function removingCover() {
    const settle = { ok: () => {}, fail: (_reason: unknown) => {} };
    remotes.deleteThumbnailCommand.mockReturnValue(
      new Promise<void>((resolve, reject) => {
        settle.ok = () => resolve();
        settle.fail = reject;
      })
    );
    render({
      contentType: 'written',
      content: draft({
        contentType: 'written',
        thumbnailUrl: 'https://cdn.test/c.webp',
      }),
    });
    const remove = [...document.querySelectorAll('button')].find(
      (node) => node.textContent?.trim() === 'Remove cover'
    );
    if (!remove) throw new Error('no Remove cover button');
    remove.click();
    flushSync();
    return settle;
  }

  test('a move held for the cover is dropped when the cover fails', async () => {
    const removal = removingCover();
    const go = vi.spyOn(history, 'go').mockImplementation(() => {});
    const cancel = vi.fn();
    move(PUBLISH, cancel);
    flushSync();
    expect(cancel).toHaveBeenCalled();
    expect(held()).toBe('Wait for the cover to finish');

    removal.fail(new Error('content-api down'));
    await vi.advanceTimersByTimeAsync(0);
    expect(go).not.toHaveBeenCalled();
    expect(nav.goto).not.toHaveBeenCalled();
    expect(held()).toBe('');
    expect(text()).toContain('Couldn’t remove the cover. Try again.');
    go.mockRestore();
  });

  test('a move held for the cover goes on once the cover is done', async () => {
    const removal = removingCover();
    const go = vi.spyOn(history, 'go').mockImplementation(() => {});
    move('/studio/content/c1/edit?step=publish', vi.fn());
    flushSync();

    removal.ok();
    await vi.advanceTimersByTimeAsync(0);
    expect(go).toHaveBeenCalledWith(1);
    go.mockRestore();
  });

  // The session asks about unsaved words; its answer decides the move held
  // here for the cover too (the E2.3 seam, closed in Codex-a6ofh.2.5).
  test('a move held for the cover is dropped when the creator stays after a failed save', async () => {
    const removal = removingCover();
    remotes.saveContent.mockRejectedValue(new TypeError('Failed to fetch'));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const go = vi.spyOn(history, 'go').mockImplementation(() => {});
    type('Title', 'Unsaved words');
    move(PUBLISH, vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(confirm).toHaveBeenCalledTimes(1);

    removal.ok();
    await vi.advanceTimersByTimeAsync(0);
    expect(go).not.toHaveBeenCalled();
    expect(held()).toBe('');
    expect(confirm).toHaveBeenCalledTimes(1);
    go.mockRestore();
  });

  test('Leave after a failed save goes, never held for the cover to be asked about again', async () => {
    removingCover();
    remotes.saveContent.mockRejectedValue(new TypeError('Failed to fetch'));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    // The session's own move comes by every guard, as SvelteKit's would.
    const cancel = vi.fn();
    nav.goto.mockImplementationOnce(async (to: unknown) => {
      for (const guard of nav.guards) {
        guard({
          to: { url: new URL(String(to)) },
          type: 'goto',
          willUnload: false,
          cancel,
        });
      }
    });
    type('Title', 'Unsaved words');
    move(PUBLISH, vi.fn());
    await vi.advanceTimersByTimeAsync(0);

    expect(nav.goto).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  test('leaving the editor is never held: the upload carries on in the tray', () => {
    render({ content: draft({}) });
    drop(new File(['x'], 'winter-light.mp4', { type: 'video/mp4' }));
    flushSync();
    const cancel = vi.fn();
    move('/studio/content', cancel);
    expect(cancel).not.toHaveBeenCalled();
  });
});

describe('ContentEditor · a saved draft', () => {
  const doc = (text: string) =>
    JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    });

  test('opens as saved: the lede as visitors read it, and nothing sent', async () => {
    const words = Array.from({ length: 450 }, () => 'word').join(' ');
    render({
      contentType: 'written',
      content: draft({
        contentType: 'written',
        description: doc('Everything about runes.'),
        contentBodyJson: JSON.parse(doc(words)),
      }),
    });
    expect(field('Description')?.value).toBe('Everything about runes.');
    expect(text()).toContain('2 min read');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(remotes.saveContent).not.toHaveBeenCalled();
  });

  test('Next saves what was typed, then opens step 2 on a fresh read', async () => {
    render({ content: draft({}) });
    type('Title', 'Runes, properly');
    nextButton()?.click();
    await vi.advanceTimersByTimeAsync(0);
    // The slug is still its title's: it follows (Codex-a6ofh.2.4).
    expect(remotes.saveContent).toHaveBeenCalledWith({
      id: 'c1',
      patch: { title: 'Runes, properly', slug: 'runes-properly' },
      slugFollowsTitle: true,
    });
    // Each edit route reads the piece again on arriving at step 2.
    expect(nav.goto).toHaveBeenCalledWith(
      '/studio/content/c1/edit?step=publish'
    );
  });

  test('Next stays put when the save fails, and the bar says why', async () => {
    remotes.saveContent.mockRejectedValue(new TypeError('Failed to fetch'));
    render({ content: draft({}) });
    type('Title', 'Runes, properly');
    nextButton()?.click();
    await vi.advanceTimersByTimeAsync(0);
    flushSync();
    expect(nav.goto).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
  });

  test('Next waits 10 s at most for a save that never answers, then stays put and keeps focus', async () => {
    remotes.saveContent.mockReturnValue(new Promise(() => {}));
    render({ content: draft({}) });
    type('Title', 'Runes, properly');
    const next = nextButton();
    next?.focus();
    next?.click();
    await vi.advanceTimersByTimeAsync(10_000);
    flushSync();
    expect(nav.goto).not.toHaveBeenCalled();
    // Still saving, not refused: the canvas is live again, and nothing moved.
    expect(
      document.querySelector('.editor-canvas')?.hasAttribute('inert')
    ).toBe(false);
    expect(document.activeElement).toBe(next);
  });
});

describe('ContentEditor · which step', () => {
  test('a saved draft at step 2 opens the Publish step', () => {
    render({ content: draft({}), step: 'publish' });
    expect(
      document.querySelector('[data-probe="publish-step"]')?.textContent
    ).toBe('c1');
    expect(field('Title')).toBeNull();
  });

  test('a piece that has been live opens its tabs, at the one the address asks for', () => {
    render({
      content: draft({
        status: 'published',
        publishedAt: new Date('2026-11-01T09:00:00.000Z'),
      }),
      step: 'write',
      liveTab: 'settings',
    });
    const probe = document.querySelector('[data-probe="live-editor"]');
    expect(probe?.textContent).toBe('c1');
    expect(probe?.getAttribute('data-tab')).toBe('settings');
    expect(document.querySelector('[data-probe="publish-step"]')).toBeNull();
  });

  test('Write is the step otherwise, and for a piece not yet saved', () => {
    render({ content: null, step: 'publish' });
    expect(document.querySelector('[data-probe="publish-step"]')).toBeNull();
    expect(field('Title')).not.toBeNull();
  });

  test('the next step is built as the visit turns over, never as its props move', async () => {
    const Host = (await import('./__fixtures__/ContentEditorStepHost.svelte'))
      .default;
    component = mount(Host, {
      target: document.body,
      props: { content: draft({}) },
    });
    flushSync();
    const arrive = () => {
      for (const then of [...nav.arrived]) then();
      flushSync();
    };
    arrive(); // The move that mounted it.
    const probe = () => document.querySelector('[data-probe="publish-step"]');

    document.querySelector<HTMLButtonElement>('[data-next-step]')?.click();
    flushSync();
    expect(probe()).toBeNull();
    expect(field('Title')).not.toBeNull();

    arrive();
    expect(probe()?.textContent).toBe('c1');
  });
});
