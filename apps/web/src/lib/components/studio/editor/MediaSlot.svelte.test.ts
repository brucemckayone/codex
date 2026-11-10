/**
 * The Write canvas's player (Codex-a6ofh.2.3, mockups W2/W3): the shared
 * picker's field, drawn at the player's size. Each state the creator can meet
 * there, and a dropped file going up through the studio's queue.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const MEDIA_ID = '6b000000-0000-4000-8000-000000000001';

// The by-id read the slot's picker makes: what `library.items` holds reads
// back; an id it lacks is a 404, as a deleted item is.
const library = vi.hoisted(() => ({ items: [] as Record<string, unknown>[] }));
vi.mock('$lib/remote/media.remote', () => ({
  getMediaItem: (id: string) => {
    const item = library.items.find((entry) => entry.id === id);
    return item
      ? { current: item, error: undefined, refresh: async () => {} }
      : { current: undefined, error: { status: 404 }, refresh: async () => {} };
  },
  listMedia: () => ({
    current: undefined,
    error: undefined,
    refresh: async () => {},
  }),
  getMediaPreview: vi.fn(),
}));

// A chosen item on its way registers on the studio's status socket: a stub,
// so no socket opens in jsdom.
vi.mock('$lib/client/media-status.svelte', () => ({
  mediaStatus: {
    items: new Map(),
    now: 0,
    connection: 'idle',
    register: () => () => {},
    resume: () => {},
  },
}));

// The studio's upload queue. Its rows change IN PLACE as they upload, as the
// real queue's do.
type QueueRow = {
  key: string;
  id: string | null;
  status: 'queued' | 'uploading' | 'completing' | 'done' | 'error';
  title: string;
  progress: number;
  mediaType: 'video' | 'audio';
  failure: null;
};
const queue = $state<{ items: QueueRow[]; rejections: never[] }>({
  items: [],
  rejections: [],
});
const add = vi.fn((files: File[]) => {
  const file = files[0];
  if (!file) return [];
  queue.items.push({
    key: 'k1',
    id: null,
    status: 'uploading',
    title: file.name,
    progress: 40,
    mediaType: 'video',
    failure: null,
  });
  return ['k1'];
});
const cancel = vi.fn();
vi.mock('$lib/client/upload-queue.svelte', () => ({
  uploadQueue: {
    get items() {
      return queue.items;
    },
    get rejections() {
      return queue.rejections;
    },
    add: (files: File[]) => add(files),
    cancel: (key: string) => cancel(key),
    retry: vi.fn(),
    remove: vi.fn(),
  },
}));

const MediaSlot = (await import('./MediaSlot.svelte')).default;

let component: ReturnType<typeof mount> | null = null;
const onchange = vi.fn();
const props = $state<{ value: string | null }>({ value: null });

function render(init: Partial<typeof props> = {}, readyOnly = false) {
  Object.assign(props, { value: null }, init);
  component = mount(MediaSlot, {
    target: document.body,
    props: {
      mediaType: 'video',
      get value() {
        return props.value;
      },
      onchange,
      readyOnly,
    },
  });
  flushSync();
}

const text = () => document.body.textContent ?? '';
const button = (name: string) =>
  [...document.querySelectorAll('button')].find(
    (node) =>
      node.getAttribute('aria-label') === name ||
      node.textContent?.trim() === name
  );

/** jsdom has no DragEvent: a drop event carrying the files. */
function drop(files: File[]) {
  const slot = document.querySelector('.slot');
  if (!slot) throw new Error('no slot');
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files } });
  slot.dispatchEvent(event);
  flushSync();
}

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  library.items = [];
  queue.items = [];
  vi.clearAllMocks();
});

describe('MediaSlot · empty', () => {
  test('is the drop zone: choose from the library, or upload', () => {
    render();
    expect(text()).toContain('Add the video');
    expect(text()).toContain(
      'Drop a file here, or choose one you’ve already uploaded'
    );
    expect(button('Choose from library')).toBeDefined();
    expect(button('Upload')).toBeDefined();
  });

  test("Upload opens the picker's own file chooser, for video only", () => {
    render();
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('no file input');
    const chooser = vi.spyOn(input, 'click').mockImplementation(() => {});
    button('Upload')?.click();
    expect(chooser).toHaveBeenCalledOnce();
    expect(document.querySelectorAll('input[type="file"]')).toHaveLength(1);
    expect(input.accept).toContain('video/');
    expect(input.accept).not.toContain('audio/');
  });

  test('a file chosen there goes up as a dropped one does', () => {
    render();
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('no file input');
    Object.defineProperty(input, 'files', {
      value: [new File(['x'], 'clip.mp4', { type: 'video/mp4' })],
    });
    // Svelte delegates `onchange` to the root: the event has to bubble there.
    input.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(add).toHaveBeenCalledOnce();
    expect(text()).toContain('Uploading clip.mp4 · keep writing');
  });
});

describe('MediaSlot · a piece that has been live (Codex-a6ofh.2.5)', () => {
  // Its media must be ready to play: a file dropped here would put one
  // still processing under a live piece.
  test('offers no Upload, and says where a file dropped on it goes instead of taking it', () => {
    render({}, true);
    expect(button(m.studio_editor_media_upload())).toBeUndefined();
    expect(text()).toContain(m.studio_live_media_hint());

    drop([new File(['x'], 'clip.mp4', { type: 'video/mp4' })]);

    expect(add).not.toHaveBeenCalled();
    expect(text()).not.toContain('Uploading clip.mp4');
    expect(text()).toContain(m.studio_live_media_dropped());
  });

  // A live video or audio piece has its media, so a drop lands on its player.
  test('says so over the chosen media too, until the creator next chooses', () => {
    library.items = [
      {
        id: MEDIA_ID,
        title: 'Svelte runes deep dive',
        mediaType: 'video',
        status: 'ready',
        createdAt: new Date().toISOString(),
        thumbnailUrl: null,
        durationSeconds: 1660,
      },
    ];
    render({ value: MEDIA_ID }, true);

    drop([new File(['x'], 'clip.mp4', { type: 'video/mp4' })]);
    expect(add).not.toHaveBeenCalled();
    expect(text()).toContain(m.studio_live_media_dropped());

    button('Remove Svelte runes deep dive')?.click();
    flushSync();
    expect(onchange).toHaveBeenCalledWith(null);
    expect(text()).not.toContain(m.studio_live_media_dropped());
  });
});

describe('MediaSlot · a dropped file', () => {
  test('goes up through the studio queue, and its id is taken the moment it has one', () => {
    render();
    drop([new File(['x'], 'clip.mp4', { type: 'video/mp4' })]);
    expect(add).toHaveBeenCalledOnce();
    expect(text()).toContain('40%');
    expect(text()).toContain('Uploading clip.mp4 · keep writing');

    const row = queue.items[0];
    if (!row) throw new Error('no queued row');
    row.id = MEDIA_ID;
    flushSync();
    expect(onchange).toHaveBeenCalledWith(MEDIA_ID);
  });

  test('can be cancelled from the slot', () => {
    render();
    drop([new File(['x'], 'clip.mp4', { type: 'video/mp4' })]);
    button('Cancel uploading clip.mp4')?.click();
    expect(cancel).toHaveBeenCalledWith('k1');
  });
});

describe('MediaSlot · the chosen media', () => {
  const item = (status: string) => ({
    id: MEDIA_ID,
    title: 'Svelte runes deep dive',
    mediaType: 'video',
    status,
    createdAt: new Date().toISOString(),
    thumbnailUrl: null,
    durationSeconds: status === 'ready' ? 1660 : null,
  });

  test('still preparing: writing carries on, and it can be changed or removed', () => {
    library.items = [item('transcoding')];
    render({ value: MEDIA_ID });
    expect(text()).toContain(
      'Preparing your video for streaming · keep writing'
    );
    expect(button('Change Svelte runes deep dive')).toBeDefined();
    button('Remove Svelte runes deep dive')?.click();
    expect(onchange).toHaveBeenCalledWith(null);
  });

  test('removed from the keyboard: focus stays in the slot, on Choose from library', async () => {
    library.items = [item('ready')];
    onchange.mockImplementation((id: string | null) => {
      props.value = id;
    });
    render({ value: MEDIA_ID });
    const remove = button('Remove Svelte runes deep dive');
    if (!remove) throw new Error('no Remove');
    remove.focus();
    remove.click();
    flushSync();
    // The picker judges a removal blur a microtask on.
    await Promise.resolve();
    await Promise.resolve();
    expect(document.activeElement).toBe(button('Choose from library'));
  });

  test('ready: the creator can play it, as visitors will', () => {
    library.items = [item('ready')];
    render({ value: MEDIA_ID });
    expect(document.querySelector('.preview-start')).not.toBeNull();
    expect(text()).not.toContain('Preparing');
  });

  test('gone from the library: it says so, and offers another', () => {
    render({ value: MEDIA_ID });
    expect(text()).toContain("This media was deleted, or isn't yours to use.");
    expect(button('Choose another')).toBeDefined();
  });
});
