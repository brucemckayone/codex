/**
 * 02 Media says when a draft's media was deleted (Codex-6sbn1, mockup
 * draft-after M1). The draft keeps its link, so the picker reads empty; the
 * section says why, and names the deleted item.
 */
import type { ComponentProps } from 'svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { createFakeRemoteForm } from '$tests/utils/fake-remote-form.svelte';

vi.mock('$lib/remote/library.remote', () => ({
  getStreamingUrl: vi.fn(() => ({
    current: undefined,
    error: undefined,
    loading: true,
  })),
}));

// The by-id read the media picker and the media section share
// (Codex-a6ofh.1.8): what `library.items` holds reads back; anything else
// is a 404, as a deleted item is.
const library = vi.hoisted(() => ({ items: [] as { id: string }[] }));
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
}));

// A chosen item still processing registers on the studio's status socket: a
// stub, so no socket opens in jsdom.
vi.mock('$lib/client/media-status.svelte', () => ({
  mediaStatus: { items: new Map(), now: 0, register: () => () => {} },
}));

const MediaSection = (await import('./MediaSection.svelte')).default;
const DELETED_ID = '6b000000-0000-4000-8000-000000000001';

let component: ReturnType<typeof mount> | null = null;

type Props = ComponentProps<typeof MediaSection>;

function render(
  props: Partial<Pick<Props, 'deletedMedia' | 'live'>>,
  mediaItemId: string = DELETED_ID
) {
  // The fake stands in for kit's remote form: the fields MediaSection reads.
  const form = createFakeRemoteForm({
    initial: { mediaItemId },
  }) as unknown as Props['form'];
  component = mount(MediaSection, {
    target: document.body,
    props: { form, mediaType: 'video', ...props },
  });
  flushSync();
}

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  library.items = [];
});

describe('MediaSection · media missing', () => {
  test('a deleted media item: the warning and the struck-through card', () => {
    render({
      deletedMedia: {
        title: 'Winter Light (rough cut)',
        deletedAt: '2026-10-30T09:00:00.000Z',
      },
    });
    const alert = document.querySelector('[role="status"]');
    expect(alert?.textContent).toContain('This draft’s media was deleted.');
    expect(alert?.textContent).toContain(
      'Choose another media item before you publish.'
    );
    expect(document.querySelector('.missing-card__title')?.textContent).toBe(
      'Winter Light (rough cut)'
    );
    // `toContain`: from next year the date carries its year.
    expect(
      document.querySelector('.missing-card__meta')?.textContent
    ).toContain('Deleted from your library on 30 October');
  });

  test('no deleted media: no warning', () => {
    // The item is still in the library, so its own read finds it.
    library.items = [
      {
        id: DELETED_ID,
        title: 'Winter Light',
        mediaType: 'video',
        status: 'ready',
      } as { id: string },
    ];
    render({ deletedMedia: null });
    expect(document.querySelector('.missing-card')).toBeNull();
    expect(document.body.textContent).not.toContain('was deleted');
  });
});

// THE BUG E1.8 CLOSES. The old picker found the saved item in the 50 newest
// it had loaded, so one further back showed as an empty "Select media...".
describe('MediaSection · the chosen media, read by id (Codex-a6ofh.1.8)', () => {
  const SAVED = '6b000000-0000-4000-8000-000000000002';

  test('a saved item shows by its own read, wherever it sits in the library', () => {
    library.items = [
      {
        id: SAVED,
        title: 'Spring session, take two',
        mediaType: 'video',
        status: 'ready',
        durationSeconds: 754,
      } as { id: string },
    ];
    render({ deletedMedia: null }, SAVED);
    const text = document.body.textContent ?? '';
    expect(text).toContain('Spring session, take two');
    expect(text).toContain('12:34');
    // The form still carries it.
    expect(
      document.querySelector<HTMLInputElement>('input[name="mediaItemId"]')
        ?.value
    ).toBe(SAVED);
  });

  test('a draft may hold an item still processing: it says so', () => {
    library.items = [
      {
        id: SAVED,
        title: 'Raw upload',
        mediaType: 'video',
        status: 'transcoding',
      } as { id: string },
    ];
    render({ deletedMedia: null }, SAVED);
    expect(document.body.textContent).toContain('Processing');
  });
});

// The service refuses a non-ready item for content that is live or was ever
// released (`ContentService.update`, requireReady), so its picker must not
// offer one (review, Codex-a6ofh.1.8).
describe('MediaSection · live content offers ready media only', () => {
  const SAVED = '6b000000-0000-4000-8000-000000000003';

  function openPicker() {
    const trigger = [...document.querySelectorAll('button')].find((el) =>
      el.getAttribute('aria-label')?.startsWith('Change')
    );
    if (!trigger) throw new Error('no picker trigger');
    trigger.click();
    flushSync();
  }

  test('live: ready only, and no upload', () => {
    library.items = [
      {
        id: SAVED,
        title: 'Live film',
        mediaType: 'video',
        status: 'ready',
      } as { id: string },
    ];
    render({ deletedMedia: null, live: true }, SAVED);
    openPicker();
    const text = document.body.textContent ?? '';
    expect(text).toContain("Only media that's ready to play is shown.");
    expect(text).not.toContain('Upload a new video');
  });

  test('a draft: processing media and an upload are offered', () => {
    library.items = [
      {
        id: SAVED,
        title: 'Draft film',
        mediaType: 'video',
        status: 'ready',
      } as { id: string },
    ];
    render({ deletedMedia: null, live: false }, SAVED);
    openPicker();
    expect(document.body.textContent).toContain('Upload a new video');
  });
});
