/**
 * The immersive player opens as a native modal `<dialog>` (Codex-vlphc.4,
 * review cycle 1, M2). jsdom has no `showModal`, so each test gives the
 * prototype the one it needs; a throw from it must close the player cleanly,
 * never escape into the page's updates.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const { logger } = vi.hoisted(() => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('$lib/observability', () => ({ logger }));
vi.mock('$lib/components/ui/ShaderHero/load-renderer', () => ({
  loadRenderer: vi.fn(async () => null),
}));

import { loadRenderer } from '$lib/components/ui/ShaderHero/load-renderer';
import type { ShaderRenderer } from '$lib/components/ui/ShaderHero/renderer-types';
import { lockScroll } from '$lib/utils/scroll-lock';
import ImmersiveShaderPlayer from './ImmersiveShaderPlayer.svelte';
import { canShowImmersive } from './immersive-support';

/** The app's one page scroll lock marks <body> while it holds. */
const held = () => document.body.hasAttribute('data-melt-scroll-lock');
const proto = HTMLDialogElement.prototype as Partial<HTMLDialogElement>;
const realShowModal = proto.showModal;
const realClose = proto.close;
let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  proto.showModal = realShowModal;
  proto.close = realClose;
  document.body.innerHTML = '';
  logger.warn.mockClear();
});

function mountPlayer(onclose: () => void, opener: HTMLElement | null = null) {
  component = mount(ImmersiveShaderPlayer, {
    target: document.body,
    props: {
      audioElement: document.createElement('audio'),
      shaderPreset: 'aurora',
      onclose,
      opener,
    },
  });
  flushSync();
}

describe('opening the immersive player', () => {
  test('opens modal and holds the page still (the calibration)', () => {
    proto.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    proto.close = function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
    const onclose = vi.fn();

    mountPlayer(onclose);

    expect(document.querySelector('dialog.immersive[open]')).not.toBeNull();
    expect(held()).toBe(true);
    expect(onclose).not.toHaveBeenCalled();
  });

  test('shares the counted lock: closing never lets go of a dialog opened over it', () => {
    proto.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    proto.close = function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
    mountPlayer(vi.fn());
    const dialog = lockScroll();

    if (component) unmount(component);
    component = null;
    expect(held()).toBe(true);

    dialog();
    expect(held()).toBe(false);
  });

  test('a showModal that throws lets go, removes it and says it has closed', () => {
    proto.showModal = () => {
      throw new DOMException('The dialog is already open', 'InvalidStateError');
    };
    const onclose = vi.fn();

    expect(() => mountPlayer(onclose)).not.toThrow();

    expect(onclose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('dialog.immersive')).toBeNull();
    expect(held()).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      'immersive.open_failed',
      expect.anything()
    );
  });
});

describe('closing the immersive player', () => {
  test('gives focus back to its opener, though the press never focused it', () => {
    proto.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    proto.close = function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
    // A click or a tap in WebKit focuses no button: <body> has focus.
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    expect(document.activeElement).toBe(document.body);

    mountPlayer(vi.fn(), opener);
    expect(document.activeElement).toBe(
      document.querySelector('dialog.immersive')
    );
    if (component) unmount(component);
    component = null;

    expect(document.activeElement).toBe(opener);
  });
});

describe('where immersive mode is offered', () => {
  test('only where a modal dialog can open', () => {
    proto.showModal = undefined;
    expect(canShowImmersive()).toBe(false);

    proto.showModal = () => {};
    expect(canShowImmersive()).toBe(true);
  });
});

// Codex-1yd58.14: what immersive mode does when the shader will not start.
describe('starting the shader', () => {
  /** A renderer stand-in whose `init()` answers `starts`. */
  const stub = (starts: boolean) =>
    ({
      init: vi.fn(() => starts),
      render: vi.fn(),
      resize: vi.fn(),
      reset: vi.fn(),
      destroy: vi.fn(),
    }) satisfies ShaderRenderer;
  const warned = (event: string) =>
    logger.warn.mock.calls.filter(([name]) => name === event);

  /** Mount with a stand-in WebGL context, and let its awaits run. */
  async function mountWithContext(onclose: () => void) {
    proto.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    proto.close = function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      (() => ({
        viewport: () => {},
        getExtension: () => null,
        isContextLost: () => false,
      })) as unknown as HTMLCanvasElement['getContext']
    );
    vi.stubGlobal('requestAnimationFrame', () => 1);
    mountPlayer(onclose);
    for (let i = 0; i < 8; i++) await Promise.resolve();
  }

  afterEach(() => {
    vi.mocked(loadRenderer).mockReset();
    vi.mocked(loadRenderer).mockImplementation(async () => null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('retries once on film when the chosen shader will not start, and plays it', async () => {
    const film = stub(true);
    vi.mocked(loadRenderer)
      .mockResolvedValueOnce(stub(false))
      .mockResolvedValueOnce(film);
    const onclose = vi.fn();

    await mountWithContext(onclose);

    expect(vi.mocked(loadRenderer).mock.calls.map(([id]) => id)).toEqual([
      'aurora',
      'film',
    ]);
    expect(film.init).toHaveBeenCalledTimes(1);
    expect(warned('immersive.renderer_init_failed')).toEqual([
      [
        'immersive.renderer_init_failed',
        {
          preset: 'aurora',
          fallback: 'film',
          hasFloat: false,
          contextLost: false,
        },
      ],
    ]);
    expect(onclose).not.toHaveBeenCalled();
  });

  test('closes, saying so, when film will not start either', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    vi.mocked(loadRenderer).mockImplementation(async () => stub(false));
    const onclose = vi.fn();

    await mountWithContext(onclose);

    expect(warned('immersive.renderer_init_failed')).toEqual([
      [
        'immersive.renderer_init_failed',
        {
          preset: 'aurora',
          fallback: 'film',
          hasFloat: false,
          contextLost: false,
        },
      ],
      [
        'immersive.renderer_init_failed',
        { preset: 'film', fallback: null, hasFloat: false, contextLost: false },
      ],
    ]);
    vi.advanceTimersByTime(1200);
    expect(onclose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  test('logs a renderer that will not load, with its preset, and closes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    vi.mocked(loadRenderer).mockRejectedValueOnce(new Error('chunk gone'));
    const onclose = vi.fn();

    await mountWithContext(onclose);

    expect(warned('immersive.renderer_load_failed')).toEqual([
      [
        'immersive.renderer_load_failed',
        expect.objectContaining({ preset: 'aurora', error: 'chunk gone' }),
      ],
    ]);
    // No retry: the fallback is for a renderer that loads but will not start.
    expect(loadRenderer).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1200);
    expect(onclose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  test('logs an analyser that will not start, and plays on without it', async () => {
    vi.mocked(loadRenderer).mockResolvedValueOnce(stub(true));
    const onclose = vi.fn();

    await mountWithContext(onclose);

    // jsdom has no AudioContext, so the analyser throws as a browser might.
    expect(warned('immersive.analyser_failed')).toHaveLength(1);
    expect(onclose).not.toHaveBeenCalled();
  });
});

describe('the play button', () => {
  test('ignores a refused or interrupted play, and logs any other failure', async () => {
    proto.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    proto.close = function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockRejectedValueOnce(
        new DOMException('needs a gesture', 'NotAllowedError')
      )
      .mockRejectedValueOnce(new DOMException('paused mid-play', 'AbortError'))
      .mockRejectedValueOnce(new Error('decoder died'));
    mountPlayer(vi.fn());
    const button = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Play"]'
    );
    expect(button).not.toBeNull();

    for (let i = 0; i < 3; i++) {
      button?.click();
      await Promise.resolve();
      await Promise.resolve();
    }

    expect(play).toHaveBeenCalledTimes(3);
    const failed = logger.warn.mock.calls.filter(
      ([event]) => event === 'immersive.play_failed'
    );
    expect(failed).toEqual([
      [
        'immersive.play_failed',
        expect.objectContaining({ error: 'decoder died' }),
      ],
    ]);
    play.mockRestore();
  });
});
