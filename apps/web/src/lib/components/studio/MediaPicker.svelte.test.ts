/**
 * MediaPicker: opening the menu must not touch the PAGE scroll (Codex-1g5lh.8).
 *
 * THE BUG. `createCombobox` inherits Melt's listbox defaults, and one of them is
 * `preventScroll: true`. On open, Melt runs its `removeScroll()` helper, which
 * assigns `overflow: hidden` to `document.body` and stamps it with
 * `data-melt-scroll-lock`. In most apps that is a harmless no-op on the document
 * scroll; in this one it is not, because `global.css` gives BOTH `html` and
 * `body` `height: 100%`. A body that is exactly one viewport tall AND clips its
 * overflow stops propagating scroll to the viewport, so the document collapses
 * to viewport height, the browser clamps `scrollY` to 0, and the page snaps to
 * the top with no way to scroll back. The picker lives near the bottom of the
 * studio content form, so the menu the creator had just opened ended up below
 * the fold and unreachable.
 *
 * WHAT THIS FILE CAN AND CANNOT PROVE. jsdom has no layout: every element
 * reports zero width and height and `window.scrollY` never moves, so the actual
 * page jump is NOT observable here. What IS observable — and is the whole
 * mechanism behind it — is whether Melt applied its body scroll lock. That is a
 * real DOM side effect with a stable public marker, so this file asserts it
 * directly. Verified to FAIL against the pre-fix component (see the PR body).
 *
 * The geometry half of the bead (bounded max-height, internal overflow) is
 * asserted structurally in `media-picker-dropdown-bounds.test.ts` beside this
 * file, for the reason given there: Vitest stubs component CSS, so
 * `getComputedStyle` cannot see a `<style>` block in a `.svelte` file.
 *
 * EVERY open-state assertion is preceded by a LIVENESS WITNESS (the listbox is
 * really in the DOM, the trigger really says `aria-expanded="true"`). Without
 * one, a "no scroll lock" assertion would also pass in the world where the click
 * never opened anything at all.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import MediaPicker from './MediaPicker.svelte';

/**
 * jsdom gap, not a convenience: floating-ui's `autoUpdate` — which Melt's
 * `usePopper` starts for the anchored menu — observes the reference element with
 * `ResizeObserver`, and jsdom implements neither. Without this stub the popper
 * setup rejects inside a microtask and the open path never completes. A no-op
 * observer is faithful in a layout-free environment: there are no resizes.
 */
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const MEDIA_ITEMS = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Morning breathwork',
    mediaType: 'audio',
    durationSeconds: 600,
    fileSizeBytes: 4_200_000,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    title: 'Evening wind-down',
    mediaType: 'video',
    durationSeconds: 1800,
    fileSizeBytes: 92_000_000,
  },
];

/** The combobox trigger — an `<input>` while nothing is selected. */
function trigger(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[role="combobox"]');
  if (!el) throw new Error('combobox trigger not rendered');
  return el;
}

function clickTrigger(): HTMLElement {
  const el = trigger();
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  flushSync();
  return el;
}

/** Melt's `removeScroll()` marker + the style it actually assigns. */
function pageScrollIsLocked(): boolean {
  return (
    document.body.hasAttribute('data-melt-scroll-lock') ||
    document.body.style.overflow === 'hidden'
  );
}

describe('MediaPicker — the menu leaves the page scroll alone', () => {
  let component: ReturnType<typeof mount> | null = null;
  let originalResizeObserver: unknown;

  beforeEach(() => {
    originalResizeObserver = (globalThis as { ResizeObserver?: unknown })
      .ResizeObserver;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver =
      NoopResizeObserver;
    // The scroll lock is applied to `document.body`, which outlives the DOM
    // reset in `tests/setup.ts` (that only clears innerHTML). Start clean so a
    // leak from another test cannot make this one pass OR fail spuriously.
    document.body.removeAttribute('data-melt-scroll-lock');
    document.body.style.removeProperty('overflow');
  });

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver =
      originalResizeObserver;
    document.body.removeAttribute('data-melt-scroll-lock');
    document.body.removeAttribute('style');
  });

  test('the page is not scroll-locked before the menu opens', () => {
    component = mount(MediaPicker, {
      target: document.body,
      props: { mediaItems: MEDIA_ITEMS },
    });
    flushSync();

    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(pageScrollIsLocked()).toBe(false);
  });

  test('opening the menu does not lock the page scroll', () => {
    component = mount(MediaPicker, {
      target: document.body,
      props: { mediaItems: MEDIA_ITEMS },
    });
    flushSync();

    const el = clickTrigger();

    // ── Liveness witness: the menu really opened. ──
    expect(
      el.getAttribute('aria-expanded'),
      'the trigger never reported itself expanded — the click did not open the menu, so nothing below is meaningful'
    ).toBe('true');
    expect(
      document.querySelector('[role="listbox"]'),
      'no listbox in the DOM — the click did not open the menu'
    ).not.toBeNull();

    // ── The claim. ──
    expect(
      document.body.hasAttribute('data-melt-scroll-lock'),
      "Melt stamped its scroll-lock marker on <body> — with global.css's height:100% body that snaps the page to the top (Codex-1g5lh.8)"
    ).toBe(false);
    expect(
      document.body.style.overflow,
      '<body> was given overflow:hidden while the menu was open — the page can no longer scroll'
    ).not.toBe('hidden');
  });

  test('every option is reachable from the open menu', () => {
    // The bug's user-visible cost was an unreachable list, so pin that the menu
    // renders one option per item plus the "No media" sentinel — a menu that
    // silently rendered nothing would satisfy a scroll assertion on its own.
    component = mount(MediaPicker, {
      target: document.body,
      props: { mediaItems: MEDIA_ITEMS },
    });
    flushSync();

    clickTrigger();

    const options = document.querySelectorAll('[role="option"]');
    expect(options.length).toBe(MEDIA_ITEMS.length + 1);
    expect(pageScrollIsLocked()).toBe(false);
  });

  test('closing the menu leaves no scroll lock behind', () => {
    component = mount(MediaPicker, {
      target: document.body,
      props: { mediaItems: MEDIA_ITEMS },
    });
    flushSync();

    const el = clickTrigger();
    expect(el.getAttribute('aria-expanded')).toBe('true');

    clickTrigger();
    expect(el.getAttribute('aria-expanded')).toBe('false');
    expect(pageScrollIsLocked()).toBe(false);
  });
});
