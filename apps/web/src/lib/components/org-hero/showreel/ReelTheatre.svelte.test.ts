/**
 * ReelTheatre (Codex-1yd58.8) as a visitor meets it: a preview with sound
 * in the hero, its bar, its keys, focus in and back out, the shader held
 * while it is paused, a recording's cover and waveform, and the one rule
 * that keeps a recording audible: never tap a stream the page may not read.
 * The player is a stand-in with the core's own exports (ReelTheatreCore).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shaderTone } from '$lib/components/ui/ShaderHero/shader-tone';
import type { TheatreItem } from '$lib/org-hero/showreel/theatre';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock('$lib/observability', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
const loader = vi.hoisted(() => ({
  loaded: null as unknown,
  load: (): Promise<unknown> => Promise.reject(new Error('unset')),
}));
vi.mock('$lib/components/player/load-core', () => ({
  loadedPlayerCore: () => loader.loaded,
  loadPlayerCore: () => loader.load(),
}));
const scroll = vi.hoisted(() => ({ release: vi.fn(), lockScroll: vi.fn() }));
vi.mock('$lib/utils/scroll-lock', () => ({ lockScroll: scroll.lockScroll }));

const { default: Stub } = await import('./ReelTheatreCore.test.svelte');
const { core, PAUSED, resetCore, seen } = await import(
  './theatre-core-stub.svelte'
);
const { default: ReelTheatre } = await import('./ReelTheatre.svelte');

const FILM: TheatreItem = {
  kind: 'video',
  src: 'http://localhost:4100/org/hls/film/preview/preview.m3u8',
  title: 'Of Blood & Bones',
  still: 'http://localhost:4100/org/media-thumbnails/film/lg.webp',
};
const RECORDING: TheatreItem = {
  kind: 'audio',
  src: 'http://localhost:4100/org/hls/drum/preview/preview.m3u8',
  title: 'Drum Journey',
  still: 'http://localhost:4100/org/thumbnails/drum/lg.webp',
};
const PLAYING = {
  ...PAUSED,
  offerPlay: false,
  ready: true,
  wanted: true,
  duration: 30,
};

let app: ReturnType<typeof mount> | null = null;
let frames: FrameRequestCallback[] = [];
let media = { desktop: true, reduced: false };

/** A stand-in AudioContext that says what was wired to what. */
class FakeContext extends EventTarget {
  static made: FakeContext[] = [];
  /** How a new context starts: a browser may leave one suspended. */
  static starts: AudioContextState = 'running';
  /** WebKit's own 'interrupted' too (a call, the lock screen). */
  state: AudioContextState | 'interrupted' = FakeContext.starts;
  readonly destination = { node: 'speakers' };
  readonly wired: string[] = [];
  readonly tapped: HTMLMediaElement[] = [];
  closed = false;
  /** Each resume asked for. */
  resumes = 0;
  constructor() {
    super();
    FakeContext.made.push(this);
  }
  resume() {
    this.resumes += 1;
    return Promise.resolve();
  }
  /** The system takes it, as an iPhone's call does ('interrupted' there). */
  interrupt() {
    this.state = 'suspended';
    this.dispatchEvent(new Event('statechange'));
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
  createMediaElementSource(element: HTMLMediaElement) {
    this.tapped.push(element);
    return {
      connect: (to: unknown) =>
        this.wired.push(
          to === this.destination ? 'source→speakers' : 'source→analyser'
        ),
      disconnect: () => {},
    };
  }
  createAnalyser() {
    return {
      fftSize: 0,
      smoothingTimeConstant: 0,
      frequencyBinCount: 128,
      getByteFrequencyData: (into: Uint8Array) => into.fill(200),
      connect: () => {},
      disconnect: () => {},
    };
  }
}

function render(
  item: TheatreItem,
  over: {
    caption?: (seconds: number | null) => string;
  } = {}
) {
  const onclose = vi.fn();
  app = mount(ReelTheatre, {
    target: document.body,
    props: { item, onclose, ...over },
  });
  flushSync();
  return onclose;
}
const q = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector);
const button = (role: string) =>
  q<HTMLButtonElement>(
    `.theatre__round[data-role="${role}"]`
  ) as HTMLButtonElement;
const video = () =>
  q<HTMLVideoElement>('.theatre__player video') as HTMLVideoElement;
const key = (k: string, shiftKey = false) =>
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: k, shiftKey, cancelable: true })
  );
function frame() {
  const due = frames;
  frames = [];
  for (const callback of due) callback(performance.now());
}
/** The stand-in's element says where it plays from, as a real one does. */
function playsFrom(currentSrc: string) {
  Object.defineProperty(video(), 'currentSrc', {
    configurable: true,
    value: currentSrc,
  });
  core.clock = PLAYING;
  flushSync();
  video().dispatchEvent(new Event('playing'));
  flushSync();
}
const levels = () =>
  [...document.querySelectorAll<HTMLElement>('.theatre__wave span')].map(
    (bar) => bar.style.getPropertyValue('--_l')
  );

beforeEach(() => {
  resetCore();
  loader.loaded = Stub;
  frames = [];
  media = { desktop: true, reduced: false };
  FakeContext.made = [];
  FakeContext.starts = 'running';
  scroll.lockScroll.mockReset().mockReturnValue(scroll.release);
  vi.stubGlobal('AudioContext', FakeContext);
  const queued = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const at = ++id;
    const run: FrameRequestCallback = (now) => {
      queued.delete(at);
      callback(now);
    };
    queued.set(at, run);
    frames.push(run);
    return at;
  });
  vi.stubGlobal('cancelAnimationFrame', (at: number) => {
    const run = queued.get(at);
    queued.delete(at);
    frames = frames.filter((queuedRun) => queuedRun !== run);
  });
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduced-motion')
      ? media.reduced
      : query.includes('min-width')
        ? media.desktop
        : false,
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

describe('ReelTheatre, a film', () => {
  it('is a dialog named by the piece, its player started with sound and none of its own controls', () => {
    render(FILM);
    const dialog = q('[role="dialog"]');
    expect(dialog?.getAttribute('aria-label')).toBe('Of Blood & Bones');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.dataset.kind).toBe('video');
    expect(seen.read()).toMatchObject({
      src: FILM.src,
      poster: FILM.still,
      start: 'sound',
      controls: false,
    });
    // A film needs no audio graph.
    expect(FakeContext.made).toHaveLength(0);
  });

  it('takes focus on its pause button as it opens (the Showreel gives it back on close)', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    render(FILM);
    expect(document.activeElement).toBe(button('pause'));
  });

  it('closes on Escape and on its close button, and says when the preview played to its end', () => {
    const onclose = render(FILM);
    key('Escape');
    expect(onclose).toHaveBeenLastCalledWith('closed');
    button('close').click();
    expect(onclose).toHaveBeenLastCalledWith('closed');
    seen.read()?.onended?.('end');
    expect(onclose).toHaveBeenLastCalledWith('ended');
    expect(onclose).toHaveBeenCalledTimes(3);
  });

  it('keeps Tab inside: from the last control to the first, and back, never scrolling the page', () => {
    render(FILM);
    button('close').focus();
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    key('Tab');
    expect(document.activeElement).toBe(button('pause'));
    key('Tab', true);
    expect(document.activeElement).toBe(button('close'));
    // A mouse user tabbing back in from the header stays where they were (review L7).
    expect(focus.mock.calls).toEqual([
      [{ preventScroll: true }],
      [{ preventScroll: true }],
    ]);
  });

  it("brings Tab back to its bar from the player's own box, which a click focuses (review L4)", () => {
    render(FILM);
    const box = q<HTMLElement>('.theatre__player') as HTMLElement;
    box.tabIndex = -1;
    box.focus();
    key('Tab');
    expect(document.activeElement).toBe(button('pause'));
    box.focus();
    key('Tab', true);
    expect(document.activeElement).toBe(button('close'));
  });

  it('drives the player, and while it is paused holds the shader too (WCAG 2.2.2)', () => {
    render(FILM);
    core.clock = PLAYING;
    flushSync();
    expect(shaderTone.held).toBe(false);
    expect(button('pause').getAttribute('aria-label')).toBe('Pause');

    button('pause').click();
    flushSync();
    expect(core.toggles).toBe(1);
    expect(button('pause').getAttribute('aria-label')).toBe('Play');
    expect(shaderTone.held).toBe(true);

    button('pause').click();
    flushSync();
    expect(shaderTone.held).toBe(false);
  });

  it('mutes and unmutes through the player; a refused start asks for sound, and a press plays with it', () => {
    render(FILM);
    core.clock = PLAYING;
    flushSync();
    expect(button('sound').getAttribute('aria-label')).toBe('Mute');
    button('sound').click();
    flushSync();
    expect(core.mutes).toBe(1);
    expect(button('sound').getAttribute('aria-label')).toBe('Unmute');

    core.clock = { ...PAUSED, askSound: true };
    flushSync();
    expect(button('sound').getAttribute('aria-label')).toBe('Tap for sound');
    button('sound').click();
    expect(core.mutes).toBe(2);
    expect(core.toggles).toBe(1);
  });

  it('shows the time it has played of the preview, and how far along the line', () => {
    render(FILM);
    core.clock = { ...PLAYING, time: 12, duration: 30 };
    flushSync();
    expect(q('.theatre__time [aria-hidden="true"]')?.textContent).toBe(
      '0:12 / 0:30'
    );
    expect(q('.theatre__played')?.style.getPropertyValue('--_played')).toBe(
      '0.4'
    );
  });

  it('says so when the player cannot load', async () => {
    loader.loaded = null;
    loader.load = () => Promise.reject(new Error('chunk'));
    render(FILM);
    await vi.waitFor(() =>
      expect(q('[role="alert"]')?.textContent).toBe(
        'This film could not be played.'
      )
    );
  });
});

describe('ReelTheatre, a recording', () => {
  it('shows its cover over the shader, its name and length; its player is heard, not seen', () => {
    render(RECORDING, {
      caption: (seconds) =>
        seconds === null ? 'Preview' : `Preview, ${seconds} seconds`,
    });
    expect(
      q<HTMLImageElement>('.theatre__cover')?.getAttribute('src')
    ).toContain('drum');
    expect(q('.theatre__name')?.textContent).toBe('Drum Journey');
    expect(q('.theatre__length')?.textContent).toBe('Preview');
    core.clock = PLAYING;
    flushSync();
    expect(q('.theatre__length')?.textContent).toBe('Preview, 30 seconds');
    const player = q('.theatre__player');
    expect(player?.getAttribute('aria-hidden')).toBe('true');
    // Svelte sets `inert` as the property (jsdom does not reflect it).
    expect(player?.inert).toBe(true);
    // No poster: the cover is its picture.
    expect(seen.read()?.poster).toBeNull();
  });

  it("draws its waveform from hls.js's stream while it plays, the sound wired to the speakers first", () => {
    render(RECORDING);
    expect(FakeContext.made).toHaveLength(1);
    playsFrom('blob:http://of-blood-and-bones.lvh.me:3000/5c1d');
    const [context] = FakeContext.made;
    expect(context?.tapped).toEqual([video()]);
    expect(context?.wired).toEqual(['source→speakers', 'source→analyser']);
    frame();
    expect(levels().every((level) => Number(level) > 0.7)).toBe(true);

    // Paused, the bars rest.
    button('pause').click();
    flushSync();
    expect(levels().every((level) => level === '')).toBe(true);
  });

  it('never taps a stream the page may not read: the bars rest and the sound stays its own', () => {
    render(RECORDING);
    playsFrom(RECORDING.src);
    expect(FakeContext.made[0]?.tapped).toEqual([]);
    frame();
    expect(levels().every((level) => level === '')).toBe(true);
  });

  it('never taps through a context the browser left suspended: the sound would wait on it', () => {
    FakeContext.starts = 'suspended';
    render(RECORDING);
    playsFrom('blob:http://of-blood-and-bones.lvh.me:3000/5c1d');
    expect(FakeContext.made[0]?.tapped).toEqual([]);
    frame();
    expect(levels().every((level) => level === '')).toBe(true);
  });

  it('rests its bars under reduced motion, and makes no audio graph to tap the sound (review L6)', () => {
    media.reduced = true;
    render(RECORDING);
    expect(FakeContext.made).toHaveLength(0);
    playsFrom('blob:http://x/1');
    frame();
    expect(levels().every((level) => level === '')).toBe(true);
  });

  it('resumes a context the system interrupted: as it says so, and on each press of its bar (review M3)', () => {
    render(RECORDING);
    const [context] = FakeContext.made;
    if (!context) throw new Error('a recording makes its context');
    const made = context.resumes;
    // Running, a press asks nothing of it.
    button('pause').click();
    expect(context.resumes).toBe(made);
    // An iPhone's call takes it: it says so, and is resumed at once.
    context.interrupt();
    expect(context.resumes).toBe(made + 1);
    // Still taken (a resume waits for a gesture there): each press asks again.
    button('pause').click();
    expect(context.resumes).toBe(made + 2);
    button('sound').click();
    expect(context.resumes).toBe(made + 3);
  });

  it('resumes it when the system plays the recording again with no press in the page (the lock screen, AirPods)', () => {
    render(RECORDING);
    const [context] = FakeContext.made;
    if (!context) throw new Error('a recording makes its context');
    // Taken by the system, and its own resume refused: it stays taken.
    context.state = 'interrupted';
    const made = context.resumes;
    // The lock screen's play: the element plays again, and the context with it.
    video().dispatchEvent(new Event('play'));
    expect(context.resumes).toBe(made + 1);
  });

  it('closes its audio graph as it closes', () => {
    render(RECORDING);
    unmount(app!);
    app = null;
    expect(FakeContext.made[0]?.closed).toBe(true);
  });
});

describe('ReelTheatre on a phone', () => {
  it('takes the whole screen, and the page behind holds still', () => {
    media.desktop = false;
    render(FILM);
    expect(scroll.lockScroll).toHaveBeenCalledTimes(1);
    unmount(app!);
    app = null;
    expect(scroll.release).toHaveBeenCalledTimes(1);
  });

  it('leaves the page free on a desktop, inside the hero', () => {
    render(FILM);
    expect(scroll.lockScroll).not.toHaveBeenCalled();
    expect(q('.theatre')?.hasAttribute('data-covers-page')).toBe(false);
  });

  it("stands for the whole screen, so the page's own tab bar steps aside (review M2)", () => {
    media.desktop = false;
    render(FILM);
    expect(q('.theatre')?.hasAttribute('data-covers-page')).toBe(true);
  });

  it('draws fewer bars', () => {
    media.desktop = false;
    render(RECORDING);
    expect(document.querySelectorAll('.theatre__wave span')).toHaveLength(30);
  });
});
