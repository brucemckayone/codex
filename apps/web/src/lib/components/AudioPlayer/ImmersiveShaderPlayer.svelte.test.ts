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

import ImmersiveShaderPlayer, {
  canShowImmersive,
} from './ImmersiveShaderPlayer.svelte';

const LOCK = 'data-immersive-player';
const proto = HTMLDialogElement.prototype as Partial<HTMLDialogElement>;
const realShowModal = proto.showModal;
const realClose = proto.close;
let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  proto.showModal = realShowModal;
  proto.close = realClose;
  document.documentElement.removeAttribute(LOCK);
  document.body.innerHTML = '';
  logger.warn.mockClear();
});

function mountPlayer(onclose: () => void) {
  component = mount(ImmersiveShaderPlayer, {
    target: document.body,
    props: {
      audioElement: document.createElement('audio'),
      shaderPreset: 'nebula',
      onclose,
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
    expect(document.documentElement.hasAttribute(LOCK)).toBe(true);
    expect(onclose).not.toHaveBeenCalled();
  });

  test('a showModal that throws lets go, removes it and says it has closed', () => {
    proto.showModal = () => {
      throw new DOMException('The dialog is already open', 'InvalidStateError');
    };
    const onclose = vi.fn();

    expect(() => mountPlayer(onclose)).not.toThrow();

    expect(onclose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('dialog.immersive')).toBeNull();
    expect(document.documentElement.hasAttribute(LOCK)).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      'immersive.open_failed',
      expect.anything()
    );
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
