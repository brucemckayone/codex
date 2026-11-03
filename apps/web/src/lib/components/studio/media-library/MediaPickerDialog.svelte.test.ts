/**
 * The shared media picker (Codex-a6ofh.1.8, mockup M5). Ports the old
 * combobox's contracts (MediaPicker.svelte.test.ts, deleted with it): an
 * outside value is shown and never echoed, and only the creator's own act
 * calls `onchange`. Then the dialog's own: the chosen item read by id, the
 * list's three states, ready-only unless a draft may hold processing media,
 * server search behind the floor, paging, and an upload attached the moment
 * it has an id.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { MediaStatusSubscriber } from '$lib/client/media-status.svelte';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const CHOSEN = '6b000000-0000-4000-8000-000000000001';
const OTHER = '6b000000-0000-4000-8000-000000000002';
const UPLOADED = '6b000000-0000-4000-8000-000000000003';

type Row = {
  id: string;
  title: string;
  mediaType: string;
  status: string;
  usage?: { total: number; live: number };
};

const ROWS: Row[] = [
  {
    id: CHOSEN,
    title: 'Advanced Svelte Patterns',
    mediaType: 'video',
    status: 'ready',
    usage: { total: 3, live: 1 },
  },
  {
    id: OTHER,
    title: 'Svelte runes: lesson 1',
    mediaType: 'video',
    status: 'ready',
    usage: { total: 0, live: 0 },
  },
];

/** A kit query as the dialog reads it: `current`, `error`, `refresh`, and awaitable. */
function fakeQuery(value: unknown) {
  const failed = value instanceof Error;
  return {
    current: failed ? undefined : value,
    error: failed ? value : undefined,
    refresh: vi.fn(async () => {}),
    // biome-ignore lint/suspicious/noThenProperty: a thenable stands in for kit's query
    then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
      return failed ? reject(value) : resolve(value);
    },
  };
}

function page(items: Row[], total = items.length) {
  return {
    items,
    pagination: {
      page: 1,
      limit: 24,
      total,
      totalPages: Math.ceil(total / 24),
    },
  };
}

const remote = vi.hoisted(() => ({
  listMedia: vi.fn(),
  getMediaItem: vi.fn(),
}));
vi.mock('$lib/remote/media.remote', () => ({
  listMedia: (args: unknown) => remote.listMedia(args),
  getMediaItem: (id: string) => remote.getMediaItem(id),
}));

// The studio's upload queue, as the picker reads it. Its rows change IN
// PLACE as they upload (`item.id = …`, `item.status = …`), as the real
// UploadQueue's do: a fake that swapped in new row objects hid the picker
// never seeing an id (the review's critical finding, Codex-a6ofh.1.8).
type QueueRow = {
  key: string;
  id: string | null;
  status: 'queued' | 'uploading' | 'completing' | 'done' | 'error';
  title: string;
  progress: number;
  mediaType: 'video' | 'audio';
};
const queue = $state<{
  items: QueueRow[];
  rejections: {
    key: string;
    name: string;
    reason: 'type' | 'empty' | 'too_large';
  }[];
}>({ items: [], rejections: [] });
const add = vi.fn();
const retry = vi.fn();
const removeRow = vi.fn();
const cancelRow = vi.fn();

// The studio's status socket: a chosen item still on its way registers for
// its one id (data-design §1.5). A spy, so no socket opens in jsdom.
const statusSocket = vi.hoisted(() => ({
  register: vi.fn((_subscriber: MediaStatusSubscriber) => () => {}),
  resume: vi.fn(),
}));
/** The store's own reactive state, which the real register() reads. */
const socketState = $state({ connection: 'idle' });
vi.mock('$lib/client/media-status.svelte', () => ({
  mediaStatus: {
    items: new Map(),
    now: 0,
    get connection() {
      return socketState.connection;
    },
    register: statusSocket.register,
    resume: () => statusSocket.resume(),
  },
}));
vi.mock('$lib/client/upload-queue.svelte', () => ({
  uploadQueue: {
    get items() {
      return queue.items;
    },
    get rejections() {
      return queue.rejections;
    },
    add: (files: File[]) => add(files),
    retry: (key: string) => retry(key),
    remove: (key: string) => removeRow(key),
    cancel: (key: string) => cancelRow(key),
  },
}));

/** The one queued row, changed in place. */
function row0(): QueueRow {
  const found = queue.items[0];
  if (!found) throw new Error('no queued row');
  return found;
}

/** Layout-free jsdom: floating-ui's autoUpdate needs an observer to exist. */
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const MediaPickerDialog = (await import('./MediaPickerDialog.svelte')).default;

let component: ReturnType<typeof mount> | null = null;
const onchange = vi.fn();
const props = $state<{
  value: string | null;
  allowProcessing: boolean;
  mediaTypes: ('video' | 'audio')[];
}>({
  value: null,
  allowProcessing: false,
  mediaTypes: ['video'],
});
const realResizeObserver = globalThis.ResizeObserver;

function render(init: Partial<typeof props> = {}) {
  Object.assign(
    props,
    { value: null, allowProcessing: false, mediaTypes: ['video'] },
    init
  );
  component = mount(MediaPickerDialog, {
    target: document.body,
    props: {
      get value() {
        return props.value;
      },
      get allowProcessing() {
        return props.allowProcessing;
      },
      get mediaTypes() {
        return props.mediaTypes;
      },
      onchange,
      ariaLabel: 'Intro film',
      name: 'mediaItemId',
    },
  });
  flushSync();
}

const text = () => document.body.textContent ?? '';
const settle = async () => {
  for (let i = 0; i < 4; i++)
    await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
};

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(
    (el) => el.textContent?.trim() === label
  );
  if (!found) throw new Error(`no button ${label}`);
  return found;
}

function labelled(name: string): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(
    `button[aria-label="${name}"]`
  );
  if (!found) throw new Error(`no button labelled ${name}`);
  return found;
}

function openDialog() {
  const trigger = [...document.querySelectorAll('button')].find(
    (el) =>
      el.getAttribute('aria-label') === 'Intro film' ||
      el.getAttribute('aria-label') === 'Change Intro film'
  );
  if (!trigger) throw new Error('no trigger');
  trigger.click();
  flushSync();
}

function row(title: string): HTMLElement {
  const found = [
    ...document.querySelectorAll<HTMLElement>('label.picker-row'),
  ].find((el) => el.textContent?.includes(title));
  if (!found) throw new Error(`no row ${title}`);
  return found;
}

function mark(title: string) {
  row(title).querySelector('input')?.click();
  flushSync();
}

/** The args of the latest list read. */
const lastListArgs = () =>
  remote.listMedia.mock.calls.at(-1)?.[0] as
    | Record<string, unknown>
    | undefined;

beforeEach(() => {
  globalThis.ResizeObserver =
    NoopResizeObserver as unknown as typeof ResizeObserver;
  remote.listMedia.mockReset();
  remote.listMedia.mockImplementation(() => fakeQuery(page(ROWS)));
  remote.getMediaItem.mockReset();
  remote.getMediaItem.mockImplementation((id: string) => {
    const item = ROWS.find((r) => r.id === id);
    return item
      ? fakeQuery(item)
      : fakeQuery(Object.assign(new Error('not found'), { status: 404 }));
  });
  queue.items = [];
  queue.rejections = [];
  add.mockReset();
  retry.mockReset();
  removeRow.mockReset();
  cancelRow.mockReset();
  statusSocket.register.mockReset();
  statusSocket.register.mockImplementation(() => () => {});
  statusSocket.resume.mockReset();
  socketState.connection = 'idle';
  onchange.mockReset();
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  globalThis.ResizeObserver = realResizeObserver;
});

describe('MediaPickerDialog: the field', () => {
  test('a saved value is read by id and shown, whatever page of the library it is on', () => {
    render({ value: CHOSEN });
    expect(remote.getMediaItem).toHaveBeenCalledWith(CHOSEN);
    expect(text()).toContain('Advanced Svelte Patterns');
    // Nothing is listed until the dialog opens.
    expect(remote.listMedia).not.toHaveBeenCalled();
    expect(
      document.querySelector<HTMLInputElement>('input[name="mediaItemId"]')
        ?.value
    ).toBe(CHOSEN);
  });

  test('a saved value that is gone says so, and is never echoed back as a clear', () => {
    render({ value: '6b000000-0000-4000-8000-00000000dead' });
    expect(text()).toContain(m.media_picker_chosen_gone());
    expect(text()).not.toContain(m.common_try_again());
    expect(onchange).not.toHaveBeenCalled();
    // The form still carries it.
    expect(
      document.querySelector<HTMLInputElement>('input[name="mediaItemId"]')
        ?.value
    ).toBe('6b000000-0000-4000-8000-00000000dead');
  });

  test('a failed read of the chosen item says so, with a Try again', () => {
    remote.getMediaItem.mockImplementation(() =>
      fakeQuery(Object.assign(new Error('boom'), { status: 503 }))
    );
    render({ value: CHOSEN });
    expect(text()).toContain(m.media_picker_chosen_failed());
    expect(text()).toContain(m.common_try_again());
    expect(onchange).not.toHaveBeenCalled();
  });
});

describe('MediaPickerDialog: an outside value is shown, never echoed', () => {
  test('a value changed from outside, and the list changing under it: no call', async () => {
    render({ value: CHOSEN });
    openDialog();
    remote.listMedia.mockImplementation(() => fakeQuery(page(ROWS.slice(1))));
    props.value = OTHER;
    flushSync();
    await settle();
    expect(onchange).not.toHaveBeenCalled();
  });

  test("the creator's own Attach and Remove are the calls", () => {
    render({ value: CHOSEN });
    openDialog();
    mark('Svelte runes: lesson 1');
    button(m.media_picker_attach()).click();
    flushSync();
    expect(onchange).toHaveBeenCalledWith(OTHER);

    button(m.media_picker_clear()).click();
    expect(onchange).toHaveBeenLastCalledWith(null);
  });

  test('Cancel, or Attach on the item already chosen, reports nothing', () => {
    render({ value: CHOSEN });
    openDialog();
    mark('Svelte runes: lesson 1');
    button(m.common_cancel()).click();
    flushSync();
    openDialog();
    button(m.media_picker_attach()).click();
    flushSync();
    expect(onchange).not.toHaveBeenCalled();
  });
});

describe('MediaPickerDialog: the list', () => {
  test('lists this field’s type, ready only, 24 at a time, and says what the marked item is used by', () => {
    render();
    openDialog();
    expect(lastListArgs()).toMatchObject({
      mediaType: 'video',
      status: 'ready',
      limit: 24,
      page: 1,
    });
    expect(text()).toContain(m.media_picker_lead_ready());
    // No upload, and no status segments, where only ready media can go.
    expect(text()).not.toContain(m.media_picker_upload_video());
    expect(
      document.querySelector('[role="radiogroup"][aria-label="Status"]')
    ).toBeNull();

    mark('Advanced Svelte Patterns');
    expect(text()).toContain(m.media_chip_in_use({ count: 3 }));
  });

  test('a field that holds both types leaves the type open', () => {
    render({ mediaTypes: ['video', 'audio'] });
    openDialog();
    expect(lastListArgs()?.mediaType).toBeUndefined();
  });

  test('while the list loads: no rows, and never the empty state', () => {
    remote.listMedia.mockImplementation(() => fakeQuery(undefined));
    render();
    openDialog();
    expect(document.querySelector('label.picker-row')).toBeNull();
    expect(text()).not.toContain(m.media_picker_empty_title());
  });

  test('a failed list says so with a Try again, never the empty state', () => {
    const failed = fakeQuery(Object.assign(new Error('down'), { status: 503 }));
    remote.listMedia.mockImplementation(() => failed);
    render();
    openDialog();
    expect(text()).toContain(m.media_picker_list_failed());
    expect(text()).not.toContain(m.media_picker_empty_title());
    button(m.common_try_again()).click();
    expect(failed.refresh).toHaveBeenCalledTimes(1);
  });

  test('an empty library, and a search with no results, are different states', async () => {
    remote.listMedia.mockImplementation(() => fakeQuery(page([])));
    render();
    openDialog();
    expect(text()).toContain(m.media_picker_empty_title());

    const box = document.querySelector<HTMLInputElement>(
      'input[type="search"]'
    );
    if (!box) throw new Error('no search');
    box.value = 'svelte';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    flushSync();
    expect(text()).toContain(m.media_picker_no_results());
    expect(text()).toContain(m.media_picker_clear_search());
  });

  test('searches on the server once typing pauses, and below the floor asks for no pattern', async () => {
    render();
    openDialog();
    const box = document.querySelector<HTMLInputElement>(
      'input[type="search"]'
    );
    if (!box) throw new Error('no search');
    box.value = 'sv';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    flushSync();
    expect(lastListArgs()).not.toHaveProperty('search');

    box.value = 'svelte';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    // Not on the keystroke itself.
    expect(lastListArgs()).not.toHaveProperty('search');
    await new Promise((resolve) => setTimeout(resolve, 300));
    flushSync();
    expect(lastListArgs()).toMatchObject({ search: 'svelte' });
  });

  test('Show more appends the next page, once each', async () => {
    remote.listMedia.mockImplementation((args: { page: number }) =>
      args.page === 1
        ? fakeQuery(page(ROWS, 3))
        : fakeQuery(
            page(
              [
                ROWS[1] as Row,
                {
                  id: UPLOADED,
                  title: 'Svelte stores recap',
                  mediaType: 'video',
                  status: 'ready',
                },
              ],
              3
            )
          )
    );
    render();
    openDialog();
    // Marked, not attached: Show more is not the form's submit (the ui Button
    // has no default type, so inside the form it would have attached this).
    mark('Svelte runes: lesson 1');
    button(m.media_library_show_more({ left: 1, total: 3 })).click();
    await settle();
    expect(onchange).not.toHaveBeenCalled();
    expect(document.querySelector('.media-picker')).not.toBeNull();
    expect(lastListArgs()).toMatchObject({ page: 2 });
    expect(document.querySelectorAll('label.picker-row')).toHaveLength(3);
    expect(text()).not.toContain(
      m.media_library_show_more({ left: 0, total: 3 })
    );
  });
});

describe('MediaPickerDialog: a draft may hold processing media (the content editor)', () => {
  test('offers Ready, Processing and All, and All is never a failed item', () => {
    render({ allowProcessing: true });
    openDialog();
    expect(lastListArgs()?.status).toBe('ready');
    button(m.media_picker_segment_all()).click();
    flushSync();
    expect(lastListArgs()?.status).toBe('attachable');
    button(m.media_status_processing()).click();
    flushSync();
    expect(lastListArgs()?.status).toBe('processing');
  });

  function upload(file: File) {
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('no file input');
    Object.defineProperty(input, 'files', {
      value: [file],
      configurable: true,
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
  }

  function queueRow(mediaType: 'video' | 'audio' = 'video') {
    add.mockImplementation(() => {
      queue.items.push({
        key: 'row-1',
        id: null,
        status: 'queued',
        title: 'Workshop',
        progress: 0,
        mediaType,
      });
      return ['row-1'];
    });
  }

  /** Render with something already chosen, open the dialog, start an upload. */
  function startUpload(before: string | null = null) {
    queueRow();
    render({ allowProcessing: true, value: before });
    openDialog();
    upload(new File(['x'], 'workshop.mov', { type: 'video/quicktime' }));
  }

  test('an upload is attached the moment createMedia gives it an id, and the bytes carry on in the tray', () => {
    queueRow();
    render({ allowProcessing: true });
    openDialog();
    expect(
      document.querySelector('input[type="file"]')?.getAttribute('accept')
    ).not.toContain('audio/');
    upload(new File(['x'], 'workshop.mov', { type: 'video/quicktime' }));
    expect(add).toHaveBeenCalledTimes(1);
    // The dialog closes; the field shows the upload waiting.
    expect(document.querySelector('.media-picker')).toBeNull();
    expect(text()).toContain(m.media_picker_upload_waiting());
    expect(onchange).not.toHaveBeenCalled();

    // createMedia returned: the SAME row object takes its id.
    row0().id = UPLOADED;
    row0().status = 'uploading';
    row0().progress = 40;
    flushSync();
    expect(onchange).toHaveBeenCalledWith(UPLOADED);
    props.value = UPLOADED;
    flushSync();
    expect(text()).toContain(m.media_picker_uploading({ pct: 40 }));
  });

  test('a cancel puts back what the field held before: the draft never points at a deleted row', () => {
    startUpload(CHOSEN);
    row0().id = UPLOADED;
    row0().status = 'uploading';
    flushSync();
    props.value = UPLOADED;
    flushSync();

    queue.items.splice(0, 1);
    flushSync();
    expect(onchange).toHaveBeenLastCalledWith(CHOSEN);
  });

  test('a failed upload says so, never "Uploading", detaches, and offers Try again and Remove', () => {
    startUpload(CHOSEN);
    row0().id = UPLOADED;
    row0().status = 'uploading';
    row0().progress = 37;
    flushSync();
    props.value = UPLOADED;
    flushSync();

    row0().status = 'error';
    flushSync();
    props.value = CHOSEN;
    flushSync();
    expect(onchange).toHaveBeenLastCalledWith(CHOSEN);
    expect(text()).toContain(m.media_upload_error());
    expect(text()).not.toContain(m.media_picker_uploading({ pct: 37 }));
    // What the field kept shows under the failure, so its Remove acts on
    // something visible; the upload's own buttons are named for it.
    expect(text()).toContain('Advanced Svelte Patterns');

    labelled(m.media_upload_try_again_named({ name: 'Workshop' })).click();
    expect(retry).toHaveBeenCalledWith('row-1');
    labelled(m.media_picker_upload_discard_named({ name: 'Workshop' })).click();
    expect(removeRow).toHaveBeenCalledWith('row-1');
    expect(onchange).toHaveBeenCalledTimes(2);
  });

  test('the upload’s Try again, pressed from the keyboard, leaves focus on the field’s button', async () => {
    startUpload(CHOSEN);
    row0().id = UPLOADED;
    row0().status = 'error';
    flushSync();
    // As the real retry(): back in the queue, and straight into a free slot.
    retry.mockImplementation(() => {
      row0().status = 'uploading';
      row0().progress = 0;
    });
    // The dialog's close hands focus to the field's button a beat later:
    // let it land first, so only the press decides where focus ends.
    await settle();
    const again = labelled(
      m.media_upload_try_again_named({ name: 'Workshop' })
    );
    again.focus();
    expect(document.activeElement).toBe(again);
    again.click();
    await settle();
    expect(text()).toContain(m.media_picker_uploading({ pct: 0 }));
    expect(document.activeElement?.getAttribute('aria-label')).toBe(
      m.media_picker_change_named({ name: 'Intro film' })
    );
  });

  test('Cancel, pressed from the keyboard, stops the upload and leaves focus on the field’s button', async () => {
    startUpload(CHOSEN);
    row0().status = 'uploading';
    flushSync();
    cancelRow.mockImplementation(() => {
      queue.items = [];
    });
    await settle();
    const cancel = labelled(m.media_tray_cancel_named({ name: 'Workshop' }));
    cancel.focus();
    expect(document.activeElement).toBe(cancel);
    cancel.click();
    await settle();
    expect(text()).not.toContain(m.media_tray_cancel());
    expect(document.activeElement?.getAttribute('aria-label')).toBe(
      m.media_picker_change_named({ name: 'Intro film' })
    );
  });

  for (const next of ['completing', 'error', 'done'] as const) {
    test(`Cancel, focused when the row moves on by itself (${next}), hands focus to the field’s button`, async () => {
      startUpload(CHOSEN);
      row0().id = UPLOADED;
      row0().status = 'uploading';
      flushSync();
      await settle();
      const cancel = labelled(m.media_tray_cancel_named({ name: 'Workshop' }));
      cancel.focus();
      expect(document.activeElement).toBe(cancel);
      row0().status = next;
      flushSync();
      await settle();
      expect(cancel.isConnected).toBe(false);
      expect(document.activeElement?.getAttribute('aria-label')).toBe(
        m.media_picker_change_named({ name: 'Intro film' })
      );
    });
  }

  test('a press whose focus the creator moves on at once keeps it where they put it', async () => {
    startUpload(CHOSEN);
    row0().id = UPLOADED;
    row0().status = 'error';
    flushSync();
    removeRow.mockImplementation(() => {
      queue.items = [];
    });
    await settle();
    const elsewhere = document.createElement('input');
    document.body.appendChild(elsewhere);
    const discard = labelled(
      m.media_picker_upload_discard_named({ name: 'Workshop' })
    );
    discard.focus();
    discard.click();
    elsewhere.focus();
    await settle();
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  test('Discard, pressed from the keyboard, removes the failed upload and leaves focus on the field’s button', async () => {
    startUpload(CHOSEN);
    row0().id = UPLOADED;
    row0().status = 'error';
    flushSync();
    removeRow.mockImplementation(() => {
      queue.items = [];
    });
    await settle();
    const discard = labelled(
      m.media_picker_upload_discard_named({ name: 'Workshop' })
    );
    discard.focus();
    expect(document.activeElement).toBe(discard);
    discard.click();
    await settle();
    expect(text()).not.toContain(m.media_upload_error());
    expect(document.activeElement?.getAttribute('aria-label')).toBe(
      m.media_picker_change_named({ name: 'Intro film' })
    );
  });

  test('in flight, the upload is the field: its own Cancel stops it, and no Remove acts on a hidden value', () => {
    startUpload(CHOSEN);
    row0().id = UPLOADED;
    row0().status = 'uploading';
    flushSync();
    props.value = UPLOADED;
    flushSync();
    expect(text()).not.toContain(m.media_picker_clear());
    labelled(m.media_tray_cancel_named({ name: 'Workshop' })).click();
    expect(cancelRow).toHaveBeenCalledWith('row-1');
  });

  test('a retried upload is a new media item: the field follows it', () => {
    startUpload();
    row0().id = UPLOADED;
    row0().status = 'uploading';
    flushSync();
    props.value = UPLOADED;
    flushSync();
    row0().status = 'error';
    flushSync();
    props.value = null;
    flushSync();
    // Retried: queued again, then a new media row.
    row0().id = null;
    row0().status = 'queued';
    flushSync();
    row0().id = CHOSEN;
    row0().status = 'uploading';
    flushSync();
    expect(onchange.mock.calls.map(([id]) => id)).toEqual([
      UPLOADED,
      null,
      CHOSEN,
    ]);
  });

  test('a file the queue refuses says why, here: the modal covers the tray', () => {
    add.mockImplementation(() => {
      queue.rejections.push({
        key: 'rej-1',
        name: 'huge.mov',
        reason: 'too_large',
      });
      return [];
    });
    render({ allowProcessing: true });
    openDialog();
    upload(new File(['x'], 'huge.mov', { type: 'video/quicktime' }));
    expect(text()).toContain(
      m.media_upload_rejected_too_large({ name: 'huge.mov' })
    );
    expect(document.querySelector('.media-picker')).not.toBeNull();
  });

  test('a file of a type this field can’t hold uploads to the library only', () => {
    queueRow('audio');
    render({ allowProcessing: true });
    openDialog();
    upload(new File(['x'], 'talk.mp3', { type: 'audio/mpeg' }));
    expect(text()).toContain(m.media_picker_upload_wrong_type());
    row0().id = UPLOADED;
    row0().status = 'uploading';
    flushSync();
    expect(onchange).not.toHaveBeenCalled();
  });
});

describe('MediaPickerDialog: failures never read as progress or as empty (review)', () => {
  test('a chosen item whose processing failed reads as failed, and one left mid-upload as stopped', () => {
    remote.getMediaItem.mockImplementation((id: string) =>
      fakeQuery({
        id,
        title: 'Hono APIs: screen capture',
        mediaType: 'video',
        status: id === CHOSEN ? 'failed' : 'uploading',
        createdAt: '2026-01-01T00:00:00.000Z',
      })
    );
    render({ value: CHOSEN });
    expect(text()).toContain(m.media_status_failed());
    expect(text()).not.toContain(m.media_status_processing());
    if (component) unmount(component);
    component = null;

    render({ value: OTHER });
    expect(
      document.querySelector('.field-card')?.getAttribute('data-status')
    ).toBe('stopped');
  });

  test('a facet change whose first read fails says so, even after an empty list: never "no media"', () => {
    remote.listMedia.mockImplementation((args: { status?: string }) =>
      args.status === 'processing'
        ? fakeQuery(Object.assign(new Error('down'), { status: 503 }))
        : fakeQuery(page([]))
    );
    render({ allowProcessing: true });
    openDialog();
    expect(text()).toContain(m.media_picker_empty_title());

    button(m.media_status_processing()).click();
    flushSync();
    expect(text()).toContain(m.media_picker_list_failed());
    expect(text()).not.toContain(m.media_picker_empty_title());
  });

  test('a reopened dialog starts clean: the last opening’s extra pages never append', async () => {
    remote.listMedia.mockImplementation((args: { page: number }) =>
      args.page === 1
        ? fakeQuery(page(ROWS, 3))
        : fakeQuery(
            page(
              [
                {
                  id: UPLOADED,
                  title: 'Svelte stores recap',
                  mediaType: 'video',
                  status: 'ready',
                },
              ],
              3
            )
          )
    );
    render();
    openDialog();
    button(m.media_library_show_more({ left: 1, total: 3 })).click();
    await settle();
    expect(document.querySelectorAll('label.picker-row')).toHaveLength(3);
    button(m.common_cancel()).click();
    flushSync();

    // Since: an item went, so the library is one page of two.
    remote.listMedia.mockImplementation(() => fakeQuery(page(ROWS)));
    openDialog();
    expect(document.querySelectorAll('label.picker-row')).toHaveLength(2);
    expect(text()).not.toContain('Svelte stores recap');
  });

  const recap = {
    id: UPLOADED,
    title: 'Svelte stores recap',
    mediaType: 'video',
    status: 'ready',
  };

  test('a Show more still on its way when the dialog closes never lands in the next opening', async () => {
    let finishMore!: (value: unknown) => void;
    remote.listMedia.mockImplementation((args: { page: number }) =>
      args.page === 1
        ? fakeQuery(page(ROWS, 3))
        : new Promise((resolve) => {
            finishMore = resolve;
          })
    );
    render();
    openDialog();
    button(m.media_library_show_more({ left: 1, total: 3 })).click();
    button(m.common_cancel()).click();
    flushSync();
    // The same list again: only the opening tells the two apart.
    openDialog();
    finishMore(page([recap], 3));
    await settle();
    expect(document.querySelectorAll('label.picker-row')).toHaveLength(2);
    expect(text()).not.toContain('Svelte stores recap');
  });

  test('a Show more that fails after the facets changed logs what it asked for, and says nothing here', async () => {
    const { logger } = await import('$lib/observability');
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    let refuseMore!: (error: unknown) => void;
    remote.listMedia.mockImplementation((args: { page: number }) =>
      args.page === 1
        ? fakeQuery(page(ROWS, 3))
        : new Promise((_, reject) => {
            refuseMore = reject;
          })
    );
    render({ allowProcessing: true });
    openDialog();
    button(m.media_library_show_more({ left: 1, total: 3 })).click();
    const asked = remote.listMedia.mock.calls.at(-1)?.[0] as {
      status: string;
    };
    button(m.media_status_processing()).click();
    flushSync();
    refuseMore(Object.assign(new Error('down'), { status: 503 }));
    await settle();
    expect(error).toHaveBeenCalledWith(
      'media_picker.show_more_failed',
      expect.objectContaining({ listStatus: asked.status, page: 2 })
    );
    expect(asked.status).not.toBe('processing');
    // A note for the list now shown would be about a read it never made.
    expect(text()).not.toContain(m.media_picker_more_failed());
    error.mockRestore();
  });

  /** Page 1 of 3 rows; page 2 is held, and refused when the test says. */
  function refusedSecondPage() {
    const held: { refuse: (error: unknown) => void } = { refuse: () => {} };
    remote.listMedia.mockImplementation((args: { page: number }) =>
      args.page === 1
        ? fakeQuery(page(ROWS, 3))
        : new Promise((_, reject) => {
            held.refuse = reject;
          })
    );
    return held;
  }

  test('a Show more that fails in the list on screen says so, and is logged', async () => {
    const { logger } = await import('$lib/observability');
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const held = refusedSecondPage();
    render();
    openDialog();
    button(m.media_library_show_more({ left: 1, total: 3 })).click();
    held.refuse(Object.assign(new Error('down'), { status: 503 }));
    await settle();
    expect(text()).toContain(m.media_picker_more_failed());
    expect(error).toHaveBeenCalledWith(
      'media_picker.show_more_failed',
      expect.objectContaining({ status: 503, page: 2 })
    );
    error.mockRestore();
  });

  test('a Show more that fails after the dialog closed and opened again says nothing in the new opening', async () => {
    const { logger } = await import('$lib/observability');
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const held = refusedSecondPage();
    render();
    openDialog();
    button(m.media_library_show_more({ left: 1, total: 3 })).click();
    button(m.common_cancel()).click();
    flushSync();
    // The same list again: only the opening tells the two apart.
    openDialog();
    held.refuse(Object.assign(new Error('down'), { status: 503 }));
    await settle();
    expect(error).toHaveBeenCalledWith(
      'media_picker.show_more_failed',
      expect.objectContaining({ page: 2 })
    );
    expect(text()).not.toContain(m.media_picker_more_failed());
    error.mockRestore();
  });

  test('a chosen item still processing is watched on the status socket; a ready one is not', () => {
    remote.getMediaItem.mockImplementation((id: string) =>
      fakeQuery({
        id,
        title: 'Raw cut',
        mediaType: 'video',
        status: id === CHOSEN ? 'transcoding' : 'ready',
      })
    );
    render({ value: CHOSEN });
    expect(statusSocket.register).toHaveBeenCalledTimes(1);
    if (component) unmount(component);
    component = null;
    statusSocket.register.mockClear();
    render({ value: OTHER });
    expect(statusSocket.register).not.toHaveBeenCalled();
  });

  // The real register() reads the store's reactive `connection`: registered
  // in a TRACKED effect, every pause or stop re-subscribed, and each
  // re-subscribe restarted the bounded fallback (open-ended polling).
  test('registers once, untracked: a connection change never re-subscribes, and it releases', () => {
    const release = vi.fn();
    statusSocket.register.mockImplementation(() => {
      void socketState.connection; // as the real store's register() reads it
      return release;
    });
    remote.getMediaItem.mockImplementation((id: string) =>
      fakeQuery({
        id,
        title: 'Raw cut',
        mediaType: 'video',
        status: id === CHOSEN ? 'transcoding' : 'ready',
      })
    );
    render({ value: CHOSEN });
    expect(statusSocket.register).toHaveBeenCalledTimes(1);

    socketState.connection = 'paused';
    flushSync();
    socketState.connection = 'stopped';
    flushSync();
    expect(statusSocket.register).toHaveBeenCalledTimes(1);

    // Another (ready) item: the watch on the first is released.
    props.value = OTHER;
    flushSync();
    expect(release).toHaveBeenCalledTimes(1);
    expect(statusSocket.register).toHaveBeenCalledTimes(1);
  });

  test('the subscriber re-reads its own item only; a re-read never re-subscribes; unmount releases', () => {
    const release = vi.fn();
    statusSocket.register.mockImplementation(() => release);
    const reading = $state({
      item: {
        id: CHOSEN,
        title: 'Raw cut',
        mediaType: 'video',
        status: 'transcoding',
      },
    });
    const chosenQuery = {
      get current() {
        return reading.item;
      },
      error: undefined,
      refresh: vi.fn(async () => {}),
    };
    remote.getMediaItem.mockImplementation(() => chosenQuery);
    render({ value: CHOSEN });
    const subscriber = statusSocket.register.mock.calls[0]?.[0];
    if (!subscriber) throw new Error('not registered');
    expect(subscriber.listed()).toEqual(new Map([[CHOSEN, 'transcoding']]));
    subscriber.settled?.(OTHER, 'ready');
    expect(chosenQuery.refresh).not.toHaveBeenCalled();
    subscriber.settled?.(CHOSEN, 'ready');
    expect(chosenQuery.refresh).toHaveBeenCalledTimes(1);

    // A re-read is a new object: the same status, or another on the way.
    reading.item = { ...reading.item, title: 'Raw cut v2' };
    flushSync();
    reading.item = { ...reading.item, status: 'uploaded' };
    flushSync();
    expect(statusSocket.register).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();

    if (component) unmount(component);
    component = null;
    expect(release).toHaveBeenCalledTimes(1);
  });

  // The store's fallback is bounded, then waits for the creator (owner rule):
  // a card whose watch paused says so, with the library's Refresh.
  test('a paused watch says so on the card; Refresh resumes once, keeps focus, never re-registers', async () => {
    // As the real store: resume() leaves 'paused' at once, for a reconnect.
    statusSocket.resume.mockImplementation(() => {
      socketState.connection = 'reconnecting';
    });
    remote.getMediaItem.mockImplementation((id: string) =>
      fakeQuery({
        id,
        title: 'Raw cut',
        mediaType: 'video',
        status: id === CHOSEN ? 'transcoding' : 'ready',
      })
    );
    render({ value: CHOSEN });
    // One status, mounted from the start and quiet while live, so its
    // later words are announced (one inserted with its text may not be).
    const status = () =>
      document.querySelector<HTMLElement>('.field-live[role="status"]');
    const mounted = status();
    expect(mounted?.textContent).toBe('');

    socketState.connection = 'paused';
    flushSync();
    expect(status()).toBe(mounted);
    expect(status()?.textContent).toBe(m.media_live_paused());
    // The button is beside the status, so it is never read as part of it.
    expect(status()?.querySelector('button')).toBeNull();

    const refresh = button(m.media_live_resume());
    refresh.focus();
    refresh.click();
    await settle();
    expect(statusSocket.resume).toHaveBeenCalledTimes(1);
    expect(status()?.textContent).toBe(m.media_live_reconnecting());
    expect(() => button(m.media_live_resume())).toThrow();
    // Refresh went: focus is on the status it changed, never <body>.
    expect(document.activeElement).toBe(mounted);
    expect(statusSocket.register).toHaveBeenCalledTimes(1);

    // The session ended: no Refresh can bring it back.
    socketState.connection = 'stopped';
    flushSync();
    expect(status()?.textContent).toBe(m.media_live_stopped());
    expect(() => button(m.media_live_resume())).toThrow();

    // A ready item never watched here: its status says nothing.
    props.value = OTHER;
    flushSync();
    expect(status()?.textContent).toBe('');
  });

  // The re-read Refresh schedules is the likeliest to find the item done:
  // the status it focused must outlive the settle, and say what happened.
  /** A watched item, paused, then Refreshed with focus on Refresh: what the re-read will change. */
  async function refreshedWatch() {
    statusSocket.resume.mockImplementation(() => {
      socketState.connection = 'reconnecting';
    });
    const reading = $state<{
      item: Record<string, unknown> & { status: string };
      error: unknown;
    }>({
      item: {
        id: CHOSEN,
        title: 'Raw cut',
        mediaType: 'video',
        status: 'transcoding',
      },
      error: undefined,
    });
    remote.getMediaItem.mockImplementation(() => ({
      get current() {
        return reading.item;
      },
      get error() {
        return reading.error;
      },
      refresh: vi.fn(async () => {}),
    }));
    render({ value: CHOSEN });
    socketState.connection = 'paused';
    flushSync();
    const status = document.querySelector<HTMLElement>(
      '.field-live[role="status"]'
    );
    const refresh = button(m.media_live_resume());
    refresh.focus();
    refresh.click();
    await settle();
    expect(document.activeElement).toBe(status);
    return { reading, status };
  }

  test('after Refresh, the item reaching ready keeps focus on the status and says so, by name', async () => {
    const { reading, status } = await refreshedWatch();
    reading.item = { ...reading.item, status: 'ready' };
    flushSync();
    await settle();
    expect(document.querySelector('.field-live[role="status"]')).toBe(status);
    expect(document.activeElement).toBe(status);
    // Heard, not shown: the pill already shows "Ready".
    expect(status?.textContent).toBe(
      m.media_picker_ready_named({ name: 'Raw cut' })
    );
    expect(status?.querySelector('.sr-only')?.textContent).toBe(
      m.media_picker_ready_named({ name: 'Raw cut' })
    );
  });

  test('after Refresh, the item failing is never announced as ready: its alert says so', async () => {
    const { reading, status } = await refreshedWatch();
    reading.item = { ...reading.item, status: 'failed' };
    flushSync();
    await settle();
    expect(document.activeElement).toBe(status);
    expect(status?.textContent).toBe('');
    expect(document.querySelector('.field-card [role="alert"]')).not.toBeNull();
  });

  test('after Refresh, a re-read that fails moves focus to the field’s button, never <body>', async () => {
    const { reading } = await refreshedWatch();
    reading.error = Object.assign(new Error('down'), { status: 503 });
    flushSync();
    // The handoff is a microtask after the removal: settle past it.
    await settle();
    expect(text()).toContain(m.media_picker_chosen_failed());
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.getAttribute('aria-label')).toBe(
      'Change Intro film'
    );
  });

  /**
   * Run as in Chrome, measured headless: it blurs a focused node it is about
   * to remove, still connected, with activeElement already <body>. jsdom
   * (like WebKit) fires nothing on removal; its blur() gives that state.
   */
  async function inChrome(run: () => Promise<void>) {
    const remove = Element.prototype.remove;
    let blurs = 0;
    Element.prototype.remove = function (this: Element) {
      const active = document.activeElement;
      if (active instanceof HTMLElement && this.contains(active)) {
        blurs += 1;
        active.blur();
      }
      return remove.call(this);
    };
    try {
      await run();
    } finally {
      Element.prototype.remove = remove;
    }
    // Otherwise the emulation never ran, and this was the jsdom test again.
    expect(blurs).toBeGreaterThan(0);
  }

  test('the same holds in Chrome, which blurs a focused node while still connected, just before removing it', () =>
    inChrome(async () => {
      const { reading } = await refreshedWatch();
      reading.error = Object.assign(new Error('down'), { status: 503 });
      flushSync();
      await settle();
      expect(document.activeElement?.getAttribute('aria-label')).toBe(
        'Change Intro film'
      );
    }));

  test('after Refresh, a window or tab blur (focus never moved) keeps the handoff', async () => {
    const { reading, status } = await refreshedWatch();
    // Switching tab blurs the focused node but leaves it activeElement.
    status?.dispatchEvent(new FocusEvent('blur'));
    await settle();
    expect(document.activeElement).toBe(status);
    reading.error = Object.assign(new Error('down'), { status: 503 });
    flushSync();
    await settle();
    expect(document.activeElement?.getAttribute('aria-label')).toBe(
      'Change Intro film'
    );
  });

  /** The chosen item's read failed (503); its alert's Try again, focused and pressed, re-reads to `next`. */
  async function retriedAlert(next: unknown) {
    const reading = $state<{ error: unknown }>({
      error: Object.assign(new Error('down'), { status: 503 }),
    });
    remote.getMediaItem.mockImplementation(() => ({
      current: {
        id: CHOSEN,
        title: 'Raw cut',
        mediaType: 'video',
        status: 'ready',
      },
      get error() {
        return reading.error;
      },
      refresh: vi.fn(async () => {
        reading.error = next;
      }),
    }));
    render({ value: CHOSEN });
    flushSync();
    const retry = button(m.common_try_again());
    retry.focus();
    retry.click();
    await settle();
  }

  const gone = () => Object.assign(new Error('gone'), { status: 404 });

  for (const [engine, run] of [
    ['jsdom', (fn: () => Promise<void>) => fn()],
    ['Chrome', inChrome],
  ] as const) {
    test(`the alert’s Try again, when the re-read works, moves focus to the field’s button, never <body> (${engine})`, () =>
      run(async () => {
        await retriedAlert(undefined);
        expect(text()).not.toContain(m.media_picker_chosen_failed());
        expect(document.activeElement?.getAttribute('aria-label')).toBe(
          'Change Intro film'
        );
      }));

    test(`the alert’s Try again, when the re-read finds the item gone, moves focus to the field’s button (${engine})`, () =>
      run(async () => {
        await retriedAlert(gone());
        expect(text()).toContain(m.media_picker_chosen_gone());
        expect(document.activeElement?.getAttribute('aria-label')).toBe(
          'Change Intro film'
        );
      }));
  }

  test('a value cleared from outside while the status holds focus hands it on at once, and nothing pulls it later', async () => {
    await refreshedWatch();
    // jsdom drops focus to <body> on the removal without a blur, as WebKit does.
    props.value = null;
    flushSync();
    await settle();
    expect(document.activeElement?.getAttribute('aria-label')).toBe(
      'Intro film'
    );
    // The creator moves on; refilling the field later takes nothing back.
    (document.activeElement as HTMLElement).blur();
    props.value = CHOSEN;
    flushSync();
    await settle();
    expect(document.activeElement).toBe(document.body);
  });

  test('Refresh, focused while the socket recovers by itself, hands focus on as it goes', async () => {
    remote.getMediaItem.mockImplementation((id: string) =>
      fakeQuery({
        id,
        title: 'Raw cut',
        mediaType: 'video',
        status: 'transcoding',
      })
    );
    render({ value: CHOSEN });
    socketState.connection = 'paused';
    flushSync();
    button(m.media_live_resume()).focus();
    socketState.connection = 'live';
    flushSync();
    await settle();
    expect(document.activeElement?.getAttribute('aria-label')).toBe(
      'Change Intro film'
    );
  });

  test('Remove, pressed from the keyboard, leaves focus on the field’s button, never <body>', async () => {
    remote.getMediaItem.mockImplementation((id: string) =>
      fakeQuery({ id, title: 'Raw cut', mediaType: 'video', status: 'ready' })
    );
    onchange.mockImplementation((id: string | null) => {
      props.value = id;
    });
    render({ value: CHOSEN });
    const clear = button(m.media_picker_clear());
    clear.focus();
    clear.click();
    await settle();
    expect(onchange).toHaveBeenLastCalledWith(null);
    expect(document.activeElement?.getAttribute('aria-label')).toBe(
      'Intro film'
    );
  });

  test('after Refresh, focus the user moved elsewhere is never pulled back to the field', async () => {
    const { reading, status } = await refreshedWatch();
    status?.blur();
    expect(document.activeElement).toBe(document.body);
    // The failed re-read is a network reply: a later task than the blur.
    await settle();
    reading.error = Object.assign(new Error('down'), { status: 503 });
    flushSync();
    // Past the handoff's microtask: it must not fire for a node left behind.
    await settle();
    expect(document.activeElement).toBe(document.body);
  });

  test('without a Refresh, a re-read that fails leaves focus where it was', async () => {
    const reading = $state<{ error: unknown }>({ error: undefined });
    remote.getMediaItem.mockImplementation(() => ({
      current: {
        id: CHOSEN,
        title: 'Raw cut',
        mediaType: 'video',
        status: 'transcoding',
      },
      get error() {
        return reading.error;
      },
      refresh: vi.fn(async () => {}),
    }));
    render({ value: CHOSEN });
    flushSync();
    expect(document.activeElement).toBe(document.body);
    reading.error = Object.assign(new Error('down'), { status: 503 });
    flushSync();
    await settle();
    expect(text()).toContain(m.media_picker_chosen_failed());
    expect(document.activeElement).toBe(document.body);
  });

  test('an upload left mid-way turns stopped when it passes the stall line, without a re-read', async () => {
    const { MEDIA_UPLOAD_STALLED_AFTER_MS } = await import('@codex/constants');
    vi.useFakeTimers();
    try {
      remote.getMediaItem.mockImplementation((id: string) =>
        fakeQuery({
          id,
          title: 'Raw cut',
          mediaType: 'video',
          status: 'uploading',
          createdAt: new Date(
            Date.now() - MEDIA_UPLOAD_STALLED_AFTER_MS + 5_000
          ).toISOString(),
        })
      );
      render({ value: CHOSEN });
      const card = () =>
        document.querySelector('.field-card')?.getAttribute('data-status');
      expect(card()).not.toBe('stopped');
      vi.advanceTimersByTime(6_000);
      flushSync();
      expect(card()).toBe('stopped');
    } finally {
      vi.useRealTimers();
    }
  });

  test('the stall line still lands when the wall clock fell behind the timer', async () => {
    const { MEDIA_UPLOAD_STALLED_AFTER_MS } = await import('@codex/constants');
    vi.useFakeTimers();
    try {
      remote.getMediaItem.mockImplementation((id: string) =>
        fakeQuery({
          id,
          title: 'Raw cut',
          mediaType: 'video',
          status: 'uploading',
          createdAt: new Date(
            Date.now() - MEDIA_UPLOAD_STALLED_AFTER_MS + 5_000
          ).toISOString(),
        })
      );
      render({ value: CHOSEN });
      // An NTP step back after the timer was set: it fires on its own
      // clock, a little before the wall clock reaches the line.
      vi.setSystemTime(Date.now() - 2_000);
      vi.advanceTimersByTime(6_000);
      flushSync();
      expect(
        document.querySelector('.field-card')?.getAttribute('data-status')
      ).toBe('stopped');
    } finally {
      vi.useRealTimers();
    }
  });

  test('a stall line past setTimeout’s limit arms no timer, so nothing fires early as "stopped"', async () => {
    vi.useFakeTimers();
    try {
      remote.getMediaItem.mockImplementation((id: string) =>
        fakeQuery({
          id,
          title: 'Raw cut',
          mediaType: 'video',
          status: 'uploading',
          // A client clock far behind the server's: 30 days before createdAt.
          createdAt: new Date(
            Date.now() + 30 * 24 * 60 * 60 * 1000
          ).toISOString(),
        })
      );
      render({ value: CHOSEN });
      vi.advanceTimersByTime(5);
      flushSync();
      expect(
        document.querySelector('.field-card')?.getAttribute('data-status')
      ).toBe('uploading');
    } finally {
      vi.useRealTimers();
    }
  });

  test('a failed list read is logged with what it asked for, never the search text', async () => {
    const { logger } = await import('$lib/observability');
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    remote.listMedia.mockImplementation(() =>
      fakeQuery(Object.assign(new Error('down'), { status: 503 }))
    );
    render();
    openDialog();
    flushSync();
    expect(error).toHaveBeenCalledWith(
      'media_picker.list_failed',
      expect.objectContaining({
        status: 503,
        listStatus: 'ready',
        mediaType: 'video',
        sortBy: 'createdAt',
        page: 1,
        searched: false,
      })
    );

    error.mockClear();
    const box = document.querySelector<HTMLInputElement>(
      'input[type="search"]'
    );
    if (!box) throw new Error('no search');
    box.value = 'secret cut';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    flushSync();
    expect(lastListArgs()).toMatchObject({ search: 'secret cut' });
    expect(error).toHaveBeenCalledWith(
      'media_picker.list_failed',
      expect.objectContaining({ searched: true })
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain('secret');
    error.mockRestore();
  });

  test('a failed refresh keeps the rows and says they may be stale, with a Try again', () => {
    const stale = {
      ...fakeQuery(page(ROWS)),
      error: Object.assign(new Error('down'), { status: 503 }),
    };
    remote.listMedia.mockImplementation(() => stale);
    render();
    openDialog();
    expect(document.querySelectorAll('label.picker-row')).toHaveLength(2);
    expect(text()).toContain(m.media_picker_list_stale());
    button(m.common_try_again()).click();
    expect(stale.refresh).toHaveBeenCalledTimes(1);
  });
});

// Ports media-picker-dropdown-bounds.test.ts: the list scrolls inside the
// dialog (ui Dialog.Body), and a flick past its end stays there.
describe('MediaPickerDialog: the list scrolls in place', () => {
  const source = readFileSync(
    join(import.meta.dirname, 'MediaPickerDialog.svelte'),
    'utf8'
  );

  test('the list is the dialog body, which scrolls, and contains its overscroll', () => {
    expect(source).toMatch(/<Dialog\.Body class="picker-list"/);
    expect(source).toMatch(
      /:global\(\.media-picker \.picker-list\)\s*\{[^}]*overscroll-behavior:\s*contain/
    );
  });

  test('the form carries the panel’s capped column, so only the list scrolls', () => {
    expect(source).toMatch(
      /\.picker-form\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*0/
    );
  });
});
