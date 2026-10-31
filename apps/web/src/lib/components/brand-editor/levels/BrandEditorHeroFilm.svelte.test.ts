/**
 * The brand studio's Film control (Codex-376dl), in the four states of the
 * mockup the owner reviewed: no film yet, choosing, a film that plays in
 * full, and one that plays only its preview. Plus what it must never do:
 * claim "No film yet" when the read failed, or read the library while a film
 * is chosen and nobody is changing it.
 *
 * The remote queries are fakes with the shape the control reads (`current`,
 * `error`, `refresh`), held in `$state` so a test can change them.
 */

import type { StudioIntroFilm } from '@codex/shared-types';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

interface FakeQuery<T> {
  current: T | undefined;
  error: unknown;
  refresh: () => Promise<void>;
}

function fakeQuery<T>(current: T | undefined, error: unknown = undefined) {
  const query = $state<FakeQuery<T>>({
    current,
    error,
    refresh: vi.fn(async () => {}),
  });
  return query;
}

const VIDEO = '7f666666-6666-4666-8666-666666666666';
const OTHER = '8a777777-7777-4777-8777-777777777777';
const ORG_ID = '6e555555-5555-4555-8555-555555555555';
const CDN = 'http://localhost:4100/creator-1';

let film = fakeQuery<StudioIntroFilm | null>(null);
let library = fakeQuery<{ items: unknown[] }>({ items: [] });
const linkIntroVideo = vi.fn();
const unlinkIntroVideo = vi.fn();
const listMedia = vi.fn();

vi.mock('$lib/remote/branding.remote', () => ({
  getIntroFilm: () => film,
  linkIntroVideo: (input: unknown) => linkIntroVideo(input),
  unlinkIntroVideo: (orgId: string) => unlinkIntroVideo(orgId),
}));
vi.mock('$lib/remote/media.remote', () => ({
  listMedia: (input: unknown) => listMedia(input),
}));

const { brandEditor } = await import('$lib/brand-editor');
const { default: BrandEditorHeroFilm } = await import(
  './BrandEditorHeroFilm.svelte'
);

const CHOSEN: StudioIntroFilm = {
  mediaItemId: VIDEO,
  title: 'Why we teach',
  posterUrl: `${CDN}/media-thumbnails/${VIDEO}/md.webp`,
  durationSeconds: 134,
  plays: 'full',
};

const ROWS = [
  {
    id: VIDEO,
    title: 'Why we teach',
    mediaType: 'video',
    durationSeconds: 134,
    fileSizeBytes: 1_000_000,
    thumbnailUrl: `${CDN}/media-thumbnails/${VIDEO}/md.webp`,
  },
  {
    id: OTHER,
    title: 'Studio tour',
    mediaType: 'video',
    durationSeconds: 91,
    fileSizeBytes: 900_000,
    thumbnailUrl: null,
  },
];

/** Layout-free jsdom: floating-ui's autoUpdate needs an observer to exist. */
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let component: ReturnType<typeof mount> | null = null;
const onsaved = vi.fn();
const realResizeObserver = globalThis.ResizeObserver;

beforeEach(() => {
  globalThis.ResizeObserver =
    NoopResizeObserver as unknown as typeof ResizeObserver;
  film = fakeQuery<StudioIntroFilm | null>(null);
  library = fakeQuery<{ items: unknown[] }>({ items: ROWS });
  listMedia.mockImplementation(() => library);
  linkIntroVideo.mockResolvedValue({});
  unlinkIntroVideo.mockResolvedValue({});
  brandEditor.close();
  brandEditor.open(ORG_ID, {
    primaryColor: '#3B82F6',
    secondaryColor: null,
    accentColor: null,
    backgroundColor: null,
    fontBody: null,
    fontHeading: null,
    radius: 0.5,
    density: 1,
    logoUrl: null,
    tokenOverrides: {},
    darkOverrides: null,
    darkTokenOverrides: null,
    heroLayout: 'default',
  });
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  globalThis.ResizeObserver = realResizeObserver;
  vi.clearAllMocks();
});

function render() {
  component = mount(BrandEditorHeroFilm, {
    target: document.body,
    props: { onsaved },
  });
  flushSync();
}

const text = () => document.body.textContent ?? '';

function openPicker() {
  const trigger = document.querySelector<HTMLElement>(
    'input.picker-input, button.trigger-preview'
  );
  if (!trigger) throw new Error('no picker');
  trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  flushSync();
}

function option(title: string): HTMLElement {
  const found = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((el) => el.textContent?.includes(title));
  if (!found) throw new Error(`no option ${title}`);
  return found;
}

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(
    (el) => el.textContent?.trim() === label
  );
  if (!found) throw new Error(`no button ${label}`);
  return found;
}

describe('the Film control', () => {
  test('no film yet: says so, and offers your finished videos with their posters', () => {
    render();
    expect(text()).toContain(m.branding_film_empty());
    expect(listMedia).toHaveBeenCalledWith({
      status: 'ready',
      mediaType: 'video',
      limit: 100,
    });

    openPicker();
    expect(
      option('Why we teach').querySelector('img')?.getAttribute('src')
    ).toBe(`${CDN}/media-thumbnails/${VIDEO}/sm.webp`);
    // A video with no poster keeps its icon.
    expect(option('Studio tour').querySelector('img')).toBeNull();
  });

  test('says nothing about the film until the studio knows its org', () => {
    // The store opens once the studio's branding read lands; until then the
    // film is unknown, which is not "No film yet".
    brandEditor.close();
    render();
    expect(text()).not.toContain(m.branding_film_empty());
    expect(document.querySelector('.media-picker')).toBeNull();
    expect(listMedia).not.toHaveBeenCalled();
  });

  test('choosing a video links it, re-reads the film, and reloads the preview', async () => {
    render();
    openPicker();
    option('Studio tour').dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    );
    flushSync();

    await vi.waitFor(() => expect(onsaved).toHaveBeenCalledTimes(1));
    expect(linkIntroVideo).toHaveBeenCalledWith({
      orgId: ORG_ID,
      mediaItemId: OTHER,
    });
    // The command answers the write alone: the control re-reads the film.
    expect(film.refresh).toHaveBeenCalledTimes(1);
  });

  test('while the library loads, it shows no empty picker', () => {
    library = fakeQuery<{ items: unknown[] }>(undefined);
    listMedia.mockImplementation(() => library);
    render();
    expect(
      document.querySelector('input.picker-input, button.trigger-preview')
    ).toBeNull();
  });

  test('says when it shows only the first of many videos', () => {
    library = fakeQuery<{ items: unknown[]; pagination: { total: number } }>({
      items: ROWS,
      pagination: { total: 140 },
    });
    listMedia.mockImplementation(() => library);
    render();
    expect(text()).toContain(
      m.branding_film_library_capped({ shown: ROWS.length, total: 140 })
    );
  });

  test('a film that plays in full says so, and reads no library', () => {
    film = fakeQuery<StudioIntroFilm | null>(CHOSEN);
    render();
    expect(text()).toContain('Why we teach');
    expect(text()).toContain('2:14');
    expect(text()).toContain(m.branding_film_plays_full());
    expect(text()).not.toContain(m.branding_film_empty());
    expect(listMedia).not.toHaveBeenCalled();
  });

  test('a film paid content uses says visitors get its preview', () => {
    film = fakeQuery<StudioIntroFilm | null>({
      ...CHOSEN,
      plays: 'preview',
      reason: 'paid',
    });
    render();
    expect(text()).toContain(m.branding_film_plays_preview());
  });

  test('says why visitors see no film', () => {
    const cases: Array<[StudioIntroFilm['reason'], string]> = [
      ['paid', m.branding_film_none_paid()],
      ['not-ready', m.branding_film_none_not_ready()],
      // Not "until it has finished processing": it never will.
      ['failed', m.branding_film_none_failed()],
      ['not-video', m.branding_film_none_not_video()],
      ['creator-left', m.branding_film_none_creator_left()],
    ];
    for (const [reason, note] of cases) {
      film = fakeQuery<StudioIntroFilm | null>({
        ...CHOSEN,
        plays: 'none',
        reason,
      });
      render();
      expect(text()).toContain(note);
      if (component) unmount(component);
      component = null;
    }
  });

  test('Change film opens the picker; Keep this film puts it away', () => {
    film = fakeQuery<StudioIntroFilm | null>(CHOSEN);
    render();
    button(m.branding_film_change()).click();
    flushSync();
    expect(listMedia).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.media-picker')).not.toBeNull();

    button(m.branding_film_keep()).click();
    flushSync();
    expect(document.querySelector('.media-picker')).toBeNull();
  });

  test('Remove takes the film off the landing, and says the video stays', async () => {
    film = fakeQuery<StudioIntroFilm | null>(CHOSEN);
    render();
    expect(text()).toContain(m.branding_film_remove_note());

    button(m.branding_film_remove()).click();
    await vi.waitFor(() => expect(onsaved).toHaveBeenCalledTimes(1));
    expect(unlinkIntroVideo).toHaveBeenCalledWith(ORG_ID);
  });

  test('a refused pick says why, and reloads nothing', async () => {
    linkIntroVideo.mockRejectedValue({
      status: 422,
      body: {
        message: 'This video is still processing. Pick it once it is ready.',
      },
    });
    render();
    openPicker();
    option('Studio tour').dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    );

    await vi.waitFor(() =>
      expect(text()).toContain('This video is still processing.')
    );
    expect(onsaved).not.toHaveBeenCalled();
  });

  test('a failed read says so, never "No film yet", and offers a retry', () => {
    film = fakeQuery<StudioIntroFilm | null>(undefined, {
      status: 500,
      body: { message: 'Internal Error' },
    });
    render();
    expect(text()).toContain(m.branding_film_load_failed());
    expect(text()).not.toContain(m.branding_film_empty());

    button(m.common_try_again()).click();
    expect(film.refresh).toHaveBeenCalledTimes(1);
  });

  test('a retry that fails again is logged, never left unhandled', async () => {
    const { logger } = await import('$lib/observability');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    film = fakeQuery<StudioIntroFilm | null>(undefined, {
      status: 500,
      body: { message: 'Internal Error' },
    });
    film.refresh = vi.fn(async () => {
      throw new Error('network down');
    });
    render();

    button(m.common_try_again()).click();
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        'brand_film.refresh_failed',
        expect.objectContaining({ what: 'film', error: 'network down' })
      )
    );
    warn.mockRestore();
  });
});

/**
 * The picker reports only the creator's own choice (Codex-6sbn1). Its "No
 * media" answer is `pick(null)`, which UNLINKS, so a picker that echoed an
 * outside value it could not find as `onchange(null)` took a saved film off
 * the landing with nobody asking: a film past the list's first 100, or one
 * another tab linked while this picker was up.
 */
describe('the Film control never unlinks on its own', () => {
  const PAST_LIMIT = '9b888888-8888-4888-8888-888888888888';
  const LINKED_ELSEWHERE = 'ac999999-9999-4999-8999-999999999999';

  test('a saved film the list lacks, the list changing, then a re-read naming another: no unlink, no link', async () => {
    film = fakeQuery<StudioIntroFilm | null>({
      ...CHOSEN,
      mediaItemId: PAST_LIMIT,
    });
    render();
    button(m.branding_film_change()).click();
    flushSync();
    expect(document.querySelector('.media-picker')).not.toBeNull();

    library.current = { items: ROWS.slice(1) };
    flushSync();
    library.current = { items: ROWS };
    flushSync();
    // Another tab linked a film this list does not have.
    film.current = { ...CHOSEN, mediaItemId: LINKED_ELSEWHERE };
    flushSync();
    await Promise.resolve();

    expect(unlinkIntroVideo).not.toHaveBeenCalled();
    expect(linkIntroVideo).not.toHaveBeenCalled();
    expect(document.querySelector('.media-picker')).not.toBeNull();
  });
});
