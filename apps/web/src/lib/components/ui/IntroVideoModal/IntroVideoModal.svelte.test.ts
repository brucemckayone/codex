/**
 * The theatre (owner P2): the same player as a framed film, with sound from
 * the press that opened it. Escape and the close button dismiss it, Tab
 * stays inside, focus goes back to what opened it, and the poster returns
 * with "Watch again" at the end. The org landing page's call (a manifest and
 * nothing else) still opens it.
 */
import type { ComponentProps } from 'svelte';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';
import * as m from '$paraglide/messages';
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

import { loadPlayerCore } from '$lib/components/player/load-core';
import IntroVideoModal from './IntroVideoModal.svelte';

const SRC = '/films/f1/preview/preview.m3u8';
const POSTER = '/films/f1/poster.jpg';

let app: ReturnType<typeof mount> | null = null;

// Fetched ahead, as a kit play button does (`preloadPlayer`).
beforeAll(async () => {
  await loadPlayerCore();
});

beforeEach(() => {
  attached.length = 0;
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

/** Open it as a press does: from a focused button. */
function openFrom(props: Partial<ComponentProps<typeof IntroVideoModal>> = {}) {
  const opener = document.createElement('button');
  opener.textContent = 'Watch the film';
  document.body.appendChild(opener);
  opener.focus();
  const onclose = vi.fn();
  app = mount(IntroVideoModal, {
    target: document.body,
    props: { open: true, src: SRC, onclose, ...props },
  });
  flushSync();
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!dialog) throw new Error('no theatre opened');
  return { opener, onclose, dialog };
}

const key = (target: Element, init: KeyboardEventInit) =>
  target.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, ...init })
  );

describe('the theatre', () => {
  test('plays the film in the shared player, with sound, and its name on top', () => {
    const { dialog } = openFrom({ title: 'Slow Mornings', poster: POSTER });
    const video = dialog.querySelector<HTMLVideoElement>('.player video');
    expect(video).not.toBeNull();
    expect(video?.muted).toBe(false);
    expect(video?.getAttribute('poster')).toBe(POSTER);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    expect(attached).toEqual([SRC]);
    expect(dialog.getAttribute('aria-label')).toBe('Slow Mornings');
    expect(dialog.textContent).toContain('Slow Mornings');
    // The player's play button has the focus, so its keys work at once.
    expect(document.activeElement?.classList.contains('player__play')).toBe(
      true
    );
  });

  test('carries a sales page’s own brand when it moves out to the org layout', () => {
    // The org layout holds the org's brand; a sales page sets its own over
    // it on a nested root, which the move to `.org-layout` would leave behind.
    const layout = document.createElement('div');
    layout.className = 'org-layout';
    layout.dataset.orgBrand = '';
    const page = document.createElement('div');
    page.dataset.orgBrand = '';
    page.setAttribute('style', '--brand-color: #E4572E');
    layout.appendChild(page);
    document.body.appendChild(layout);

    app = mount(IntroVideoModal, {
      target: page,
      props: { open: true, src: SRC, onclose: vi.fn() },
    });
    flushSync();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.parentElement).toBe(layout);
    expect(dialog?.dataset.orgBrand).toBe('');
    expect(dialog?.getAttribute('style')).toBe('--brand-color: #E4572E');
  });

  test('takes no brand of its own on a page that sets none', () => {
    const layout = document.createElement('div');
    layout.className = 'org-layout';
    layout.dataset.orgBrand = '';
    document.body.appendChild(layout);

    app = mount(IntroVideoModal, {
      target: layout,
      props: { open: true, src: SRC, onclose: vi.fn() },
    });
    flushSync();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.hasAttribute('data-org-brand')).toBe(false);
    expect(dialog?.getAttribute('style')).toBeNull();
  });

  test('Escape and the close button dismiss it', () => {
    const { dialog, onclose } = openFrom();
    key(dialog.querySelector('.player__play') ?? dialog, { key: 'Escape' });
    expect(onclose).toHaveBeenCalledTimes(1);
    dialog
      .querySelector<HTMLButtonElement>(
        `button[aria-label="${m.player_close()}"]`
      )
      ?.click();
    expect(onclose).toHaveBeenCalledTimes(2);
  });

  test('focus goes back to what opened it', () => {
    const { opener } = openFrom();
    expect(document.activeElement).not.toBe(opener);
    if (app) unmount(app);
    app = null;
    expect(document.activeElement).toBe(opener);
  });

  test('Tab stays inside, from the last control to the first and back', () => {
    const { dialog } = openFrom();
    const stops = [
      ...dialog.querySelectorAll<HTMLElement>('button:not([disabled])'),
    ];
    const first = stops[0];
    const last = stops.at(-1);
    last?.focus();
    key(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    key(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  test('at the end the poster returns with "Watch again", which plays it over', () => {
    const { dialog } = openFrom({ poster: POSTER });
    dialog.querySelector('video')?.dispatchEvent(new Event('ended'));
    flushSync();
    const again = [...dialog.querySelectorAll('button')].find((button) =>
      button.textContent?.includes(m.player_watch_again())
    );
    expect(again).toBeDefined();
    expect(
      dialog.querySelector('.player__ended img')?.getAttribute('src')
    ).toBe(POSTER);
    expect(dialog.querySelector('.player__bar')).toBeNull();
    again?.click();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    expect(dialog.querySelector('.player__ended')).toBeNull();
    expect(document.activeElement?.classList.contains('player__play')).toBe(
      true
    );
  });

  test('the org landing page’s call: a manifest and nothing else', () => {
    const { dialog } = openFrom();
    expect(dialog.getAttribute('aria-label')).toBe(m.player_intro_video());
    expect(dialog.querySelector('.intro-modal__name')).toBeNull();
    expect(dialog.querySelector('.player video')).not.toBeNull();
  });
});
