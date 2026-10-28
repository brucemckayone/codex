/**
 * A press that beats the player's code (nothing fetched it ahead: no pointer,
 * no focus, the button never near the screen first). The press waits for it
 * and then plays in the frame; a browser may then start it muted, which the
 * player answers with "Tap for sound" (`PreviewPlayerCore.svelte.test.ts`).
 *
 * Its own file: the loader holds the code once fetched, and every other
 * suite fetches it before its first press.
 */
import { afterEach, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const attached: string[] = [];

vi.mock('$lib/components/VideoPlayer/hls', () => ({
  createHlsPlayer: vi.fn(async ({ src }: { src: string }) => {
    attached.push(src);
    return { hls: null, cleanup: () => {} };
  }),
}));

import {
  loadedPlayerCore,
  loadPlayerCore,
} from '$lib/components/player/load-core';
import Harness from './InlineFilmHarness.test.svelte';

const PREVIEW = '/m1/hls/preview/preview.m3u8';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

test('a press before the player’s code arrives waits for it, then plays in the frame', async () => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  app = mount(Harness, {
    target: document.body,
    props: { clips: [{ playlistUrl: PREVIEW, posterUrl: '/m1/poster.jpg' }] },
  });
  flushSync();
  expect(loadedPlayerCore()).toBeNull();
  const watch = () =>
    [...document.body.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Watch film 1'
    );
  watch()?.click();
  flushSync();
  // Waiting: the poster and its button stay, and a second press is ignored.
  expect(document.body.querySelector('video')).toBeNull();
  watch()?.click();
  await loadPlayerCore();
  flushSync();
  expect(document.body.querySelectorAll('.lp-film video')).toHaveLength(1);
  expect(attached).toEqual([PREVIEW]);
  expect(watch()).toBeUndefined();
});
