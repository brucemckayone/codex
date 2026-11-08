/**
 * The studio's preview of a piece as visitors will see it (Codex-a6ofh.2.11).
 *
 * Owner decisions (2026-11-08): inside the studio, a bar that says it is a
 * preview and goes back to editing; the piece as someone who can watch it,
 * whole, never the locked page. So the visitor page mounts in its preview
 * mode with access, plays video and audio in the creator's own player (on
 * their preview token), never the content stream, and says what stands in
 * the player's place when there is nothing to play yet. Each visit reads
 * afresh: an answer from before the editor's last save is never shown.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { tileReason } from '../media-library/tile-copy';

const nav = $state({
  url: new URL('https://alpha.test/studio/content/c1/preview'),
});
vi.mock('$app/state', () => ({
  page: {
    get url() {
      return nav.url;
    },
    params: { slug: 'alpha', contentId: 'c1' },
  },
}));

// The piece's query, as kit's behaves: `current` holds the last answer, a
// refresh keeps it until a new one lands, and each read answers or fails
// only when a test says so (`answer`, `fail`).
type Read = { resolve: () => void; reject: (reason: unknown) => void };
const q = $state({
  current: undefined as unknown,
  error: undefined as unknown,
  ready: false,
  loading: true,
});
const reads: Read[] = [];
const startRead = () =>
  new Promise<void>((resolve, reject) => reads.push({ resolve, reject }));
const refresh = vi.fn(() => {
  q.loading = true;
  return startRead();
});
function makeQuery() {
  const firstRead = startRead();
  return {
    get current() {
      return q.current;
    },
    get error() {
      return q.error;
    },
    get ready() {
      return q.ready;
    },
    get loading() {
      return q.loading;
    },
    refresh,
    // biome-ignore lint/suspicious/noThenProperty: a thenable stands in for kit's query
    then: (ok: () => unknown, fail: (reason: unknown) => unknown) =>
      firstRead.then(ok, fail),
  };
}
const cache = {
  query: null as ReturnType<typeof makeQuery> | null,
  evicted: false,
};
vi.mock('$lib/remote/content.remote', () => ({
  getContentPreview: () => {
    if (cache.evicted || !cache.query) {
      cache.evicted = false;
      cache.query = makeQuery();
    }
    return cache.query;
  },
}));

vi.mock('$lib/components/content', async () => ({
  ContentDetailView: (
    await import('./__fixtures__/ContentDetailViewProbe.svelte')
  ).default,
}));
vi.mock(
  '$lib/components/studio/media-library/MediaPreviewPlayer.svelte',
  async () => ({
    default: (await import('./__fixtures__/MediaPreviewPlayerProbe.svelte'))
      .default,
  })
);
const told = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }));
vi.mock('$lib/observability', () => ({
  logger: { warn: told.warn, error: told.error },
}));

const ContentPreview = (await import('./ContentPreview.svelte')).default;
const { describeTile } = await import('../media-library/tile-state');

const LONG_AGO = '2026-01-01T00:00:00.000Z';
const ready = {
  id: 'm1',
  status: 'ready',
  deletedAt: null,
  createdAt: LONG_AGO,
};

function piece(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    title: 'Svelte runes deep dive',
    contentType: 'video',
    status: 'draft',
    thumbnailUrl: 'https://cdn.test/cover.webp',
    creator: { id: 'u1', name: 'Alex Creator' },
    mediaItem: ready,
    ...overrides,
  };
}
const answerOf = (content: unknown, body: string | null = null) => ({
  content,
  contentBodyHtml: body,
  contentBodyUnavailable: false,
});

function answer(index: number, value: unknown) {
  q.current = value;
  q.error = undefined;
  q.ready = true;
  q.loading = false;
  reads[index]?.resolve();
}

function fail(index: number, reason: unknown) {
  q.error = reason;
  q.loading = false;
  reads[index]?.reject(reason);
}

async function settle() {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
  flushSync();
}

let component: ReturnType<typeof mount> | null = null;
function render() {
  component = mount(ContentPreview, {
    target: document.body,
    props: {
      contentId: 'c1',
      titleSuffix: 'Studio Alpha',
      authorName: 'Studio user',
    },
  });
  flushSync();
}

const visitorPage = () =>
  document.querySelector<HTMLElement>('[data-probe="visitor-page"]');
const mediaPlayer = () =>
  document.querySelector<HTMLElement>('[data-probe="media-player"]');
const barText = () =>
  document.querySelector('.preview-status')?.textContent?.trim();
const backHref = () =>
  document.querySelector('.preview-bar a')?.getAttribute('href');
const text = () => document.body.textContent ?? '';

beforeEach(() => {
  nav.url = new URL('https://alpha.test/studio/content/c1/preview');
  q.current = undefined;
  q.error = undefined;
  q.ready = false;
  q.loading = true;
  reads.length = 0;
  cache.query = null;
  cache.evicted = false;
  refresh.mockClear();
  told.warn.mockClear();
  told.error.mockClear();
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

describe('a draft, as someone who can watch it', () => {
  test('the visitor page in its preview mode, playing in the creator’s own player', async () => {
    render();
    answer(0, answerOf(piece()));
    await settle();

    const view = visitorPage();
    expect(view?.dataset.preview).toBe('true');
    expect(view?.dataset.access).toBe('true');
    expect(view?.dataset.stream).toBe('');
    expect(view?.dataset.suffix).toBe('Studio Alpha');
    expect(view?.dataset.creator).toBe('Alex Creator');
    expect(mediaPlayer()?.dataset.mediaId).toBe('m1');
    expect(mediaPlayer()?.dataset.poster).toBe('https://cdn.test/cover.webp');
    expect(barText()).toBe(m.studio_preview_draft());
    expect(backHref()).toBe('/studio/content/c1/edit');
  });

  test('opened from Publish it goes back there; a live piece says it is live', async () => {
    nav.url = new URL(
      'https://alpha.test/studio/content/c1/preview?step=publish'
    );
    render();
    answer(0, answerOf(piece({ status: 'published' })));
    await settle();

    expect(backHref()).toBe('/studio/content/c1/edit?step=publish');
    expect(barText()).toBe(m.studio_preview_live());
  });

  test('an article: its words, and no player handed in', async () => {
    render();
    answer(
      0,
      answerOf(
        piece({ contentType: 'written', mediaItem: null }),
        '<p>All the words</p>'
      )
    );
    await settle();

    expect(visitorPage()?.dataset.hasPlayer).toBe('false');
    expect(text()).toContain('<p>All the words</p>');
    expect(mediaPlayer()).toBeNull();
  });

  test('the author, when the read names none, is the studio user', async () => {
    render();
    answer(0, answerOf(piece({ creator: null })));
    await settle();

    expect(visitorPage()?.dataset.creator).toBe('Studio user');
  });
});

describe('nothing it can play yet: the player’s place says why', () => {
  const noted = async (mediaItem: unknown) => {
    render();
    answer(0, answerOf(piece({ mediaItem })));
    await settle();
    expect(mediaPlayer()).toBeNull();
    expect(visitorPage()?.dataset.hasPlayer).toBe('true');
    return document.querySelector('.preview-media-note')?.textContent?.trim();
  };

  test('no video chosen yet', async () => {
    expect(await noted(null)).toBe(
      m.studio_preview_media_none({ type: m.studio_editor_type_video() })
    );
  });

  test('an upload that stopped, in the library’s own words', async () => {
    const stopped = {
      id: 'm1',
      status: 'uploading',
      deletedAt: null,
      createdAt: LONG_AGO,
    };
    expect(tileReason(describeTile(stopped, undefined, 0))).not.toBeNull();
    expect(await noted(stopped)).toBe(
      tileReason(describeTile(stopped, undefined, 0))
    );
  });

  test('one still on its way', async () => {
    const fresh = {
      id: 'm1',
      status: 'transcoding',
      deletedAt: null,
      createdAt: new Date().toISOString(),
    };
    expect(await noted(fresh)).toBe(
      m.studio_preview_media_preparing({ type: m.studio_editor_type_video() })
    );
  });

  test('one deleted', async () => {
    const gone = { ...ready, deletedAt: LONG_AGO };
    expect(await noted(gone)).toBe(
      m.studio_publish_gap_media_deleted({ type: m.studio_editor_type_video() })
    );
  });
});

describe('reads', () => {
  test('an answer from an earlier visit is never shown: it reads afresh first', async () => {
    // Kit still holds the query from a visit before the editor's last save.
    q.current = answerOf(piece({ title: 'Before the last save' }));
    q.ready = true;
    q.loading = false;
    render();
    await settle();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(visitorPage()).toBeNull();

    answer(1, answerOf(piece({ title: 'After it' })));
    await settle();
    expect(visitorPage()?.dataset.title).toBe('After it');
  });

  test('another creator’s piece, or one deleted: said, with no page', async () => {
    render();
    fail(0, { status: 404, body: { message: 'Content not found' } });
    await settle();

    expect(visitorPage()).toBeNull();
    expect(text()).toContain(m.studio_editor_not_found());
    expect(barText()).toBe(m.studio_preview_region());
    expect(told.warn).toHaveBeenCalledWith(
      'studio_content_preview.read_failed',
      expect.objectContaining({ contentId: 'c1', status: 404 })
    );
  });

  test('signed out: a sign-in that comes back here', async () => {
    render();
    fail(0, { status: 401, body: { message: 'Unauthorized' } });
    await settle();

    const signIn = [...document.querySelectorAll('a')].find(
      (a) => a.textContent === m.common_sign_in()
    );
    expect(signIn?.getAttribute('href')).toBe(
      `/login?redirect=${encodeURIComponent('/studio/content/c1/preview')}`
    );
  });

  test('an outage offers Try again, which reads anew and shows the page', async () => {
    render();
    fail(0, new TypeError('Failed to fetch'));
    await settle();
    expect(told.error).toHaveBeenCalledWith(
      'studio_content_preview.read_failed',
      expect.anything()
    );

    // Never answered: kit drops the query, so Try again asks for a new one.
    cache.evicted = true;
    const retry = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes(m.common_try_again())
    );
    retry?.click();
    await settle();
    answer(1, answerOf(piece()));
    await settle();

    expect(visitorPage()).not.toBeNull();
    expect(text()).not.toContain(m.studio_editor_read_failed());
  });
});
