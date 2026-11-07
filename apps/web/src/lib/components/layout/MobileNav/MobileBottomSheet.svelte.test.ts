/**
 * The More sheet's pull-to-dismiss (Codex-vlphc.4). A pull down closes the
 * sheet only when it starts with the sheet at its top. Scrolled down, the
 * same finger movement scrolls the list back up, and it used to close the
 * sheet instead.
 *
 * jsdom has no layout and no scrolling, so each test sets the scroller's
 * scrollTop and dispatches the touches itself. The real gesture was proven in
 * headless Chrome at 390x500: scrolled to its end, a 300px touch scroll back
 * up closed the old sheet and leaves this one open.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock(
  '$app/state',
  () => import('$lib/components/support/__fixtures__/app-state.mock.svelte')
);

// The reduced-motion gate the dialog's panel reads, set per test. Off by
// default: jsdom never ends the sheet's rise, so a closing sheet stays.
const motion = vi.hoisted(() => ({ reduce: false }));
vi.mock('svelte/motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('svelte/motion')>()),
  prefersReducedMotion: {
    get current() {
      return motion.reduce;
    },
  },
}));

import { setPage } from '$lib/components/support/__fixtures__/app-state.mock.svelte';
import MobileBottomSheet from './MobileBottomSheet.svelte';

let component: ReturnType<typeof mount> | null = null;
let open = $state(false);

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  motion.reduce = false;
});

function mountSheet() {
  component = mount(MobileBottomSheet, {
    target: document.body,
    props: {
      get open() {
        return open;
      },
      set open(next: boolean) {
        open = next;
      },
      variant: 'platform',
      user: {
        name: 'Jordan Reid',
        email: 'jordan@example.com',
        role: 'creator',
      },
    },
  });
  flushSync();
}

function openSheet() {
  setPage('/');
  open = true;
  mountSheet();
}

const panel = () => {
  const el = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!el) throw new Error('sheet not rendered');
  return el;
};

// What scrolls: the box around the sheet's column.
const scroller = () =>
  document.querySelector<HTMLElement>('.sheet__content')?.parentElement ??
  panel();

function scrollListTo(top: number) {
  Object.defineProperty(scroller(), 'scrollTop', {
    configurable: true,
    value: top,
  });
}

// A touch on the first link; `clientY` is where the finger is.
function touch(
  type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
  clientY?: number
) {
  const target = panel().querySelector('a') ?? panel();
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', {
    value: clientY === undefined ? [] : [{ clientY }],
  });
  target.dispatchEvent(event);
  flushSync();
}

function pull(from: number, to: number) {
  touch('touchstart', from);
  touch('touchmove', to);
  touch('touchend');
}

describe('pulling the More sheet down', () => {
  test('from its top closes it (the calibration)', () => {
    openSheet();
    scrollListTo(0);

    pull(160, 460);

    expect(open).toBe(false);
  });

  test('while it is pulled, the sheet follows the finger', () => {
    openSheet();
    scrollListTo(0);

    touch('touchstart', 160);
    touch('touchmove', 220);

    expect(panel().style.transform).toBe('translateY(60px)');
    touch('touchend');
    expect(panel().style.transform).toBe('');
    expect(open).toBe(true);
  });

  test('scrolled down, it scrolls the list back up and leaves the sheet open', () => {
    openSheet();
    scrollListTo(92);

    pull(160, 460);

    expect(open).toBe(true);
    expect(panel().style.transform).toBe('');
  });

  test('a tap after a short pull leaves it open', () => {
    openSheet();
    scrollListTo(0);
    pull(360, 420);

    // No move: the tap must not read the pull's last position as its own.
    touch('touchstart', 154);
    touch('touchend');

    expect(open).toBe(true);
  });

  // Review cycle 1 (Codex-vlphc.4): N2 and L2.
  test('a pull that closes it keeps its offset as the sheet drops away', () => {
    openSheet();
    scrollListTo(0);

    pull(160, 460);

    expect(open).toBe(false);
    expect(panel().style.transform).toBe('translateY(300px)');
  });

  test('reopened before it has dropped away, the panel loses that offset', () => {
    openSheet();
    scrollListTo(0);
    pull(160, 460);

    open = true;
    flushSync();

    expect(panel().style.transform).toBe('');
  });

  test('a pull the system cancels puts the sheet back and leaves it open', () => {
    openSheet();
    scrollListTo(0);

    touch('touchstart', 160);
    touch('touchmove', 400);
    expect(panel().style.transform).toBe('translateY(240px)');
    touch('touchcancel');

    expect(panel().style.transform).toBe('');
    // The touch it cancelled never ends, and a stray end closes nothing.
    touch('touchend');
    expect(open).toBe(true);
  });
});

describe('closing the More sheet', () => {
  // WebKit focuses no button on a click or a tap: <body> keeps focus.
  test('gives focus back to the button a press opened it from', async () => {
    // A closing sheet that jsdom never takes away would keep focus in it.
    motion.reduce = true;
    setPage('/');
    open = false;
    const more = document.createElement('button');
    document.body.appendChild(more);
    more.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    mountSheet();
    // Melt moves focus a tick after the open and after the close.
    const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

    open = true;
    flushSync();
    await settle();
    expect(panel().contains(document.activeElement)).toBe(true);
    open = false;
    flushSync();
    await settle();

    expect(document.activeElement).toBe(more);
  });
});
