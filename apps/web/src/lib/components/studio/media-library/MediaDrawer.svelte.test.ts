/**
 * The media drawer (Codex-a6ofh.1.7, mockup M3): every open reads the item
 * and its uses afresh, renders three states, edits title and description in
 * place on blur, and mints a preview only when the creator presses Play.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const MEDIA_ID = '6b000000-0000-4000-8000-000000000001';

const r = vi.hoisted(() => ({
  item: undefined as unknown,
  usage: undefined as unknown,
  update: vi.fn(async () => ({})),
  preview: vi.fn(),
}));

/** A query as `readFreshQuery` reads it: awaited, then `current`. */
function freshQuery(value: unknown) {
  const query = {
    ready: false,
    loading: true,
    current: undefined as unknown,
    refresh: vi.fn(async () => {}),
    // biome-ignore lint/suspicious/noThenProperty: a thenable stands in for kit's query
    then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
      if (value instanceof Error) return reject(value);
      query.current = value;
      query.ready = true;
      query.loading = false;
      resolve(value);
    },
  };
  return query;
}

vi.mock('$lib/remote/media.remote', () => ({
  getMediaItem: vi.fn(() => freshQuery(r.item)),
  getMediaUsage: vi.fn(() => freshQuery(r.usage)),
  updateMedia: r.update,
  getMediaPreview: r.preview,
  retryTranscoding: vi.fn(),
}));

const toastError = vi.hoisted(() => vi.fn());
vi.mock('$lib/components/ui/Toast/toast-store', () => ({
  toast: { error: toastError, info: vi.fn(), add: vi.fn(), success: vi.fn() },
}));

vi.mock('$lib/client/media-status.svelte', () => ({
  mediaStatus: {
    items: new Map(),
    now: 0,
    connection: 'idle',
    resume: vi.fn(),
    refreshList: vi.fn(),
  },
}));

const MediaDrawer = (await import('./MediaDrawer.svelte')).default;

const ITEM = {
  id: MEDIA_ID,
  title: 'Advanced Svelte Patterns',
  description: 'Full lesson recording.',
  status: 'ready',
  mediaType: 'video',
  durationSeconds: 2538,
  fileSizeBytes: 1.8 * 1024 ** 3,
  width: 1920,
  height: 1080,
  readyVariants: ['1080p', '720p', '480p'],
  loudnessIntegrated: -1600,
  createdAt: '2026-09-26T10:00:00.000Z',
};
const USES = {
  total: 0,
  live: 0,
  drafts: 0,
  hidden: 0,
  uses: [],
  fingerprint: 'fp',
};

let component: ReturnType<typeof mount> | null = null;
const onChanged = vi.fn();
const onDelete = vi.fn();

const props = $state<{ mediaId: string | null }>({ mediaId: MEDIA_ID });

function render() {
  props.mediaId = MEDIA_ID;
  component = mount(MediaDrawer, {
    target: document.body,
    props: {
      get mediaId() {
        return props.mediaId;
      },
      onClose: vi.fn(),
      onDelete,
      onChanged,
    },
  });
  flushSync();
}

function type(
  box: HTMLInputElement | HTMLTextAreaElement | null,
  value: string
) {
  if (!box) throw new Error('no box');
  box.value = value;
  box.dispatchEvent(new Event('input', { bubbles: true }));
}
const blur = (box: Element | null) =>
  box?.dispatchEvent(new FocusEvent('blur'));
const descBox = () =>
  document.querySelector<HTMLTextAreaElement>('#media-drawer-description');

const settle = async () => {
  for (let i = 0; i < 4; i++)
    await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
};
const text = () => document.body.textContent ?? '';
const titleBox = () =>
  document.querySelector<HTMLInputElement>('#media-drawer-title');

beforeEach(() => {
  r.item = ITEM;
  r.usage = USES;
  r.update.mockReset();
  r.update.mockResolvedValue({});
  r.preview.mockReset();
  onChanged.mockReset();
  toastError.mockReset();
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

describe('MediaDrawer: reads', () => {
  test('shows the item: its facts, and that nothing uses it yet', async () => {
    render();
    await settle();
    expect(titleBox()?.value).toBe('Advanced Svelte Patterns');
    expect(text()).toContain('1920×1080');
    expect(text()).toContain('1080p · 720p · 480p');
    expect(text()).toContain('-16.0 LUFS');
    expect(text()).toContain('1.8 GB');
    expect(text()).toContain('Not used anywhere yet');
  });

  test("another creator's id, or a deleted one, says so: no Try again that cannot help", async () => {
    r.item = Object.assign(new Error('not found'), { status: 404 });
    render();
    await settle();
    expect(text()).toContain("Couldn't open this media");
    expect(text()).toContain("isn't yours to open");
    expect(text()).not.toContain('Try again');
  });

  test('a failed usage read says so, with its own Try again, and the rest still shows', async () => {
    r.usage = Object.assign(new Error('boom'), { status: 503 });
    render();
    await settle();
    expect(titleBox()).not.toBeNull();
    expect(text()).toContain("Couldn't load where it's used.");
  });
});

describe('MediaDrawer: edit in place', () => {
  test('saves the title on blur, says Saved, and tells the library', async () => {
    render();
    await settle();
    const box = titleBox();
    if (!box) throw new Error('no title box');
    box.value = 'Svelte Patterns: full cut';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new FocusEvent('blur'));
    await settle();
    expect(r.update).toHaveBeenCalledWith({
      id: MEDIA_ID,
      data: { title: 'Svelte Patterns: full cut' },
    });
    expect(text()).toContain('Saved');
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  test('an unchanged blur saves nothing; an emptied title puts the saved one back', async () => {
    render();
    await settle();
    const box = titleBox();
    if (!box) throw new Error('no title box');
    box.dispatchEvent(new FocusEvent('blur'));
    box.value = '   ';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new FocusEvent('blur'));
    await settle();
    expect(r.update).not.toHaveBeenCalled();
    expect(titleBox()?.value).toBe('Advanced Svelte Patterns');
  });

  test('a failed save keeps the draft and says so', async () => {
    r.update.mockRejectedValueOnce(
      Object.assign(new Error('500'), { status: 500 })
    );
    render();
    await settle();
    const desc = document.querySelector<HTMLTextAreaElement>(
      '#media-drawer-description'
    );
    if (!desc) throw new Error('no description box');
    desc.value = 'New words';
    desc.dispatchEvent(new Event('input', { bubbles: true }));
    desc.dispatchEvent(new FocusEvent('blur'));
    await settle();
    expect(text()).toContain("Couldn't save the description.");
    expect(desc.value).toBe('New words');
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('MediaDrawer: preview', () => {
  test('mints nothing until Play, and a 422 says it is not ready yet', async () => {
    r.preview.mockRejectedValueOnce(
      Object.assign(new Error('not ready'), { status: 422 })
    );
    render();
    await settle();
    expect(r.preview).not.toHaveBeenCalled();

    document
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Play Advanced Svelte Patterns"]'
      )
      ?.click();
    await settle();
    expect(r.preview).toHaveBeenCalledWith(MEDIA_ID);
    expect(text()).toContain("This isn't ready to play yet.");
  });

  test('a media item that is not ready offers no Play', async () => {
    r.item = { ...ITEM, status: 'transcoding' };
    render();
    await settle();
    expect(document.querySelector('button[aria-label^="Play"]')).toBeNull();
  });
});

describe('MediaDrawer: saves that fail (review, Codex-a6ofh.1.7)', () => {
  test("one field's failure is not hidden by the other's success", async () => {
    r.update.mockRejectedValueOnce(
      Object.assign(new Error('500'), { status: 500 })
    );
    render();
    await settle();
    type(titleBox(), 'New title');
    blur(titleBox());
    await settle();
    type(descBox(), 'New words');
    blur(descBox());
    await settle();
    expect(r.update).toHaveBeenCalledTimes(2);
    expect(text()).toContain("Couldn't save the title.");
    expect(text()).not.toContain('Saved');
  });

  test('a save refused because the item is gone says so', async () => {
    r.update.mockRejectedValueOnce(
      Object.assign(new Error('404'), { status: 404 })
    );
    render();
    await settle();
    type(titleBox(), 'New title');
    blur(titleBox());
    await settle();
    expect(text()).toContain('This media was deleted');
  });

  test('closing with an unsaved edit saves it, and a failure there still reaches the creator', async () => {
    r.update.mockRejectedValueOnce(
      Object.assign(new Error('503'), { status: 503 })
    );
    render();
    await settle();
    type(titleBox(), 'Typed, never blurred');
    props.mediaId = null;
    flushSync();
    await settle();
    expect(r.update).toHaveBeenCalledWith({
      id: MEDIA_ID,
      data: { title: 'Typed, never blurred' },
    });
    expect(toastError).toHaveBeenCalledWith(
      "Couldn't save your change to Advanced Svelte Patterns."
    );
  });

  test('an emptied title says a title is required', async () => {
    render();
    await settle();
    type(titleBox(), '');
    blur(titleBox());
    await settle();
    expect(text()).toContain('A title is required');
    expect(r.update).not.toHaveBeenCalled();
  });

  test('a read refused for an ended session asks to sign in, with no Try again', async () => {
    r.item = Object.assign(new Error('401'), { status: 401 });
    render();
    await settle();
    expect(text()).toContain('Your session ended.');
    expect(text()).not.toContain('Try again');
  });
});
