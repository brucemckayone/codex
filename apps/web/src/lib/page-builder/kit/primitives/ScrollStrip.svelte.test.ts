import { createRawSnippet } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import ScrollStrip from './ScrollStrip.svelte';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** `count` list items; a raw snippet has one root, so the rest are added after it. */
function items(count: number) {
  return createRawSnippet(() => ({
    render: () => '<li data-i="0">Item 0</li>',
    setup(node: Element) {
      for (let i = count - 1; i >= 1; i--) {
        node.insertAdjacentHTML('afterend', `<li data-i="${i}">Item ${i}</li>`);
      }
    },
  }));
}

function render(count: number, extra: Record<string, unknown> = {}) {
  app = mount(ScrollStrip, {
    target: document.body,
    props: {
      id: 'gallery-pictures',
      label: 'Pictures',
      previousLabel: 'Previous picture',
      nextLabel: 'Next picture',
      count,
      children: items(count),
      ...extra,
    },
  });
  flushSync();
}

const region = () =>
  document.body.querySelector('[role="region"]') as HTMLElement;
const buttons = () =>
  [...document.body.querySelectorAll('button')] as HTMLButtonElement[];
const resting = (button: HTMLButtonElement) =>
  button.getAttribute('aria-disabled') === 'true';

function preferReducedMotion() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduce'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe('ScrollStrip', () => {
  it('is a labelled region a keyboard can focus, holding a plain list', () => {
    render(3);
    expect(region().id).toBe('gallery-pictures');
    expect(region().getAttribute('aria-label')).toBe('Pictures');
    expect(region().tabIndex).toBe(0);
    region().focus();
    expect(document.activeElement).toBe(region());
    expect(region().querySelector(':scope > ul > li')).not.toBeNull();
    expect(region().querySelectorAll('li')).toHaveLength(3);
  });

  it('holds an ordered list for a real sequence', () => {
    render(2, { ordered: true });
    expect(region().querySelector(':scope > ol')).not.toBeNull();
    expect(region().querySelector('ul')).toBeNull();
  });

  it('before it has measured the row, both buttons rest and keep their room', () => {
    render(4);
    const [previous, next] = buttons();
    expect(previous.getAttribute('aria-label')).toBe('Previous picture');
    expect(next.getAttribute('aria-label')).toBe('Next picture');
    for (const button of [previous, next]) {
      expect(button.getAttribute('aria-controls')).toBe('gallery-pictures');
      expect(resting(button)).toBe(true);
      // Resting, not disabled: a keyboard keeps its place on it.
      expect(button.disabled).toBe(false);
    }
    expect(
      document.body.querySelector('.lp-strip__nav')?.hasAttribute('data-idle')
    ).toBe(true);
  });

  describe('with a row wider than the screen, of items that differ in width', () => {
    // Items of 300 and 200 alternating, 20 apart: they start at 0, 320, 540, 860…
    const WIDTHS = [300, 200, 300, 200, 300, 200];
    const STARTS = WIDTHS.map((_, i) =>
      WIDTHS.slice(0, i).reduce((sum, w) => sum + w + 20, 0)
    );
    let scrollLeft = 0;
    const scrollTo = vi.fn();

    beforeEach(() => {
      scrollLeft = 0;
      scrollTo.mockReset();
      const isTrack = (el: Element) => el.classList.contains('lp-strip__track');
      const dimension = (name: string, value: (el: HTMLElement) => number) =>
        vi
          .spyOn(HTMLElement.prototype, name as 'scrollWidth', 'get')
          .mockImplementation(function (this: HTMLElement) {
            return value(this);
          });
      dimension('scrollWidth', (el) => (isTrack(el) ? 1900 : 0));
      dimension('clientWidth', (el) => (isTrack(el) ? 800 : 0));
      vi.spyOn(Element.prototype, 'scrollLeft', 'get').mockImplementation(
        () => scrollLeft
      );
      Object.defineProperty(Element.prototype, 'scrollTo', {
        configurable: true,
        writable: true,
        value: scrollTo,
      });
      // Each item sits at its start, less the scroll, past a 48px inset.
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
        function (this: Element) {
          const i = Number(this.getAttribute('data-i') ?? 0);
          return {
            left: 48 + STARTS[i] - scrollLeft,
            width: WIDTHS[i],
          } as DOMRect;
        }
      );
    });

    const scrolled = (value: number) => {
      scrollLeft = value;
      region().dispatchEvent(new Event('scroll'));
      flushSync();
    };

    it('moves to the next item’s own start, whatever its width, and back', () => {
      render(WIDTHS.length);
      const [previous, next] = buttons();
      expect(resting(previous)).toBe(true);
      expect(resting(next)).toBe(false);
      next.click();
      expect(scrollTo).toHaveBeenLastCalledWith({
        left: 320,
        behavior: 'smooth',
      });
      scrolled(320);
      expect(resting(previous)).toBe(false);
      next.click();
      expect(scrollTo).toHaveBeenLastCalledWith({
        left: 540,
        behavior: 'smooth',
      });
      scrolled(540);
      previous.click();
      expect(scrollTo).toHaveBeenLastCalledWith({
        left: 320,
        behavior: 'smooth',
      });
    });

    it('from between two items, goes to the nearer start on either side', () => {
      render(WIDTHS.length);
      scrolled(400);
      const [previous, next] = buttons();
      next.click();
      expect(scrollTo).toHaveBeenLastCalledWith({
        left: 540,
        behavior: 'smooth',
      });
      previous.click();
      expect(scrollTo).toHaveBeenLastCalledWith({
        left: 320,
        behavior: 'smooth',
      });
    });

    it('rests at the end, keeps the keyboard on the button, and goes nowhere', () => {
      render(WIDTHS.length);
      const next = buttons()[1];
      next.focus();
      scrolled(1100);
      expect(resting(next)).toBe(true);
      expect(document.activeElement).toBe(next);
      scrollTo.mockReset();
      next.click();
      expect(scrollTo).not.toHaveBeenCalled();
    });

    it('jumps rather than glides under reduced motion', () => {
      preferReducedMotion();
      render(WIDTHS.length);
      buttons()[1].click();
      expect(scrollTo).toHaveBeenLastCalledWith({
        left: 320,
        behavior: 'auto',
      });
    });
  });
});
