/**
 * A press whose player never arrives (a deploy replaced the chunk, the
 * connection dropped). The button says so beside it, as an alert, and stays
 * for another press; nothing asks for the full film until the player is
 * here to play it.
 *
 * Its own file: the loader is mocked, so the core can fail to load once.
 */
import { afterEach, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock('$lib/components/VideoPlayer/hls', () => ({
  createHlsPlayer: vi.fn(async () => ({ hls: null, cleanup: () => {} })),
}));

vi.mock('$lib/components/player/load-core', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('$lib/components/player/load-core')
  >()),
  loadedPlayerCore: () => null,
  loadPlayerCore: vi.fn(),
}));

import { loadPlayerCore } from '$lib/components/player/load-core';
import PreviewPlayerCore from '$lib/components/player/PreviewPlayerCore.svelte';
import { FILM_COPY } from './film-copy';
import Harness from './InlineFilmHarness.test.svelte';

const PREVIEW = '/m1/hls/preview/preview.m3u8';
const FULL = '/films/m1/master.m3u8?token=t';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

async function settle() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  flushSync();
}

test('the player’s code fails to arrive: the button says so, and a second press plays', async () => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.mocked(loadPlayerCore)
    .mockRejectedValueOnce(new Error('chunk gone'))
    .mockResolvedValueOnce(PreviewPlayerCore);
  const requestFilm = vi.fn(async () => ({ playlistUrl: FULL }));
  app = mount(Harness, {
    target: document.body,
    props: {
      clips: [
        { playlistUrl: PREVIEW, posterUrl: '/m1/poster.jpg', fullFilm: true },
      ],
      film: 'intro',
      requestFilm,
    },
  });
  flushSync();
  const watch = () =>
    [...document.body.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Watch film 1'
    );
  const alert = () => document.body.querySelector('[role="alert"]');
  expect(alert()).toBeNull();

  watch()?.click();
  await settle();
  expect(alert()?.textContent).toBe(FILM_COPY.failed);
  expect(watch()).toBeDefined();
  expect(document.body.querySelector('video')).toBeNull();
  // No player, so no film was asked for.
  expect(requestFilm).not.toHaveBeenCalled();

  watch()?.click();
  await settle();
  expect(alert()).toBeNull();
  expect(document.body.querySelectorAll('.lp-film video')).toHaveLength(1);
  expect(requestFilm).toHaveBeenCalledTimes(1);
});
