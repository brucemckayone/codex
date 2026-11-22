/**
 * A theatre whose preview fails says so ONCE (Codex-1yd58.8, WP-7 review r5),
 * with the REAL PreviewPlayerCore inside it, as the page loads it.
 *
 * A film's player sits in the accessible tree, and its own live region
 * (MediaLiveRegion) announces the failure. A recording's player is hidden and
 * inert (its picture is the cover), and with no player at all (its code failed
 * to load) there is nothing else to say it. So the theatre's line is the alert
 * only then; for a film it is plain visible text.
 *
 * "In the tree" is what Playwright's `getByRole` keeps: not under
 * aria-hidden, not display:none or visibility:hidden. `.sr-only` stays.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HlsErrorKind } from '$lib/components/VideoPlayer/hls';
import type { TheatreItem } from '$lib/org-hero/showreel/theatre';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

/** The stream's fatal error report (`onError`), as the core's own test holds it. */
let broke: ((message: string, kind: HlsErrorKind) => void) | undefined;
/** Whether the player's code loads; false is a failed chunk. */
let coreLoads = true;

vi.mock('$lib/observability', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('$lib/utils/scroll-lock', () => ({ lockScroll: () => () => {} }));
vi.mock('$lib/components/VideoPlayer/hls', () => ({
  createHlsPlayer: vi.fn(
    async ({
      onError,
    }: {
      onError?: (message: string, kind: HlsErrorKind) => void;
    }) => {
      broke = onError;
      return { hls: null, cleanup: () => {} };
    }
  ),
}));
vi.mock('$lib/components/player/load-core', async () => {
  const { default: Core } = await import(
    '$lib/components/player/PreviewPlayerCore.svelte'
  );
  return {
    loadedPlayerCore: () => (coreLoads ? Core : null),
    loadPlayerCore: async () => {
      if (!coreLoads) throw new Error('chunk failed');
      return Core;
    },
    preloadPlayerOnIntent: () => {},
  };
});

const { default: ReelTheatre } = await import('./ReelTheatre.svelte');

const FILM: TheatreItem = {
  kind: 'video',
  src: 'http://localhost:4100/org/hls/film/preview/preview.m3u8',
  title: 'Of Blood & Bones',
  still: 'http://localhost:4100/org/media-thumbnails/film/lg.webp',
};
const RECORDING: TheatreItem = {
  kind: 'audio',
  src: 'http://localhost:4100/org/hls/sound/preview/preview.m3u8',
  title: 'Sound Therapy',
  still: 'http://localhost:4100/org/media-thumbnails/sound/lg.webp',
};

let app: ReturnType<typeof mount> | null = null;

async function settle() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  flushSync();
}

/** The alerts in the accessible tree, as Playwright's `getByRole('alert')` finds them. */
function alertsIn(root: Element): Element[] {
  return [...root.querySelectorAll('[role="alert"]')].filter(
    (el) =>
      !el.closest('[aria-hidden="true"]') &&
      getComputedStyle(el).display !== 'none' &&
      getComputedStyle(el).visibility !== 'hidden'
  );
}

async function failed(item: TheatreItem): Promise<Element> {
  app = mount(ReelTheatre, {
    target: document.body,
    props: { item, onclose: vi.fn() },
  });
  flushSync();
  await settle();
  if (coreLoads) {
    expect(broke, 'the real core attached its stream').toBeTypeOf('function');
    broke?.('An unexpected playback error occurred.', 'unknown');
    flushSync();
  }
  const theatre = document.querySelector('[role="dialog"]');
  expect(theatre).not.toBeNull();
  return theatre as Element;
}

beforeEach(() => {
  broke = undefined;
  coreLoads = true;
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a theatre whose preview fails says so once', () => {
  it("a film: the player's own alert, and the theatre's line is plain text", async () => {
    const theatre = await failed(FILM);
    const alerts = alertsIn(theatre);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.textContent?.trim()).toBe(m.player_error());
    expect(alerts[0]?.closest('.theatre__player')).not.toBeNull();
    const line = theatre.querySelector('.theatre__error');
    expect(line?.textContent?.trim()).toBe(m.player_error());
    expect(line?.getAttribute('role')).toBeNull();
  });

  it("a recording: its player is hidden, so the theatre's line is the alert", async () => {
    const theatre = await failed(RECORDING);
    const alerts = alertsIn(theatre);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.classList.contains('theatre__error')).toBe(true);
    expect(alerts[0]?.textContent?.trim()).toBe(m.player_error());
  });

  it("a film whose player never loads: the theatre's line is the alert", async () => {
    coreLoads = false;
    const theatre = await failed(FILM);
    const alerts = alertsIn(theatre);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.classList.contains('theatre__error')).toBe(true);
    expect(alerts[0]?.textContent?.trim()).toBe(m.player_error());
  });
});
