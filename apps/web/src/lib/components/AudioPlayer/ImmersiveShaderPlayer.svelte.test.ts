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

import { lockScroll } from '$lib/utils/scroll-lock';
import ImmersiveShaderPlayer, {
  canShowImmersive,
} from './ImmersiveShaderPlayer.svelte';

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
      shaderPreset: 'nebula',
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
