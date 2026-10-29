/**
 * The brand studio's Player lens (`/brand-preview/player`) shows the REAL
 * film player — `PreviewPlayerCore`, in its demo state — so the chrome a
 * creator tunes there is the chrome a visitor sees (Codex-cijzb.17's first
 * cause was a hand-kept replica that drifted). No stream, nothing plays.
 */
import { afterEach, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

// The audio card's waveform draws on a canvas, which jsdom lacks.
vi.mock('$lib/components/AudioPlayer/Waveform.svelte', () => ({
  default: () => {},
}));
vi.mock('$lib/components/VideoPlayer/hls', () => ({
  createHlsPlayer: vi.fn(async () => ({ hls: null, cleanup: () => {} })),
}));

import { createHlsPlayer } from '$lib/components/VideoPlayer/hls';
import Page from '../+page.svelte';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

test('the film card is the real player at its fixed moment, with no stream', () => {
  const play = vi
    .spyOn(HTMLMediaElement.prototype, 'play')
    .mockResolvedValue(undefined);
  app = mount(Page, { target: document.body });
  flushSync();
  const film = document.querySelector<HTMLElement>('.pv-film .player');
  expect(film).not.toBeNull();
  expect(
    film
      ?.querySelector('.player__time')
      ?.textContent?.replace(/\s+/g, ' ')
      .trim()
  ).toBe('0:12 / 2:04');
  const named = (label: string) =>
    film?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(named(m.player_pause())).not.toBeNull();
  expect(named(m.player_tap_for_sound())).not.toBeNull();
  expect(named(m.player_fullscreen())).not.toBeNull();
  expect(named(m.player_captions())).toBeNull();
  named(m.player_pause())?.click();
  expect(play).not.toHaveBeenCalled();
  expect(createHlsPlayer).not.toHaveBeenCalled();
  expect(film?.querySelector('video')?.getAttribute('src')).toBeNull();
});
