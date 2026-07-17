import type { ComponentProps } from 'svelte';
import { afterEach, describe, expect, type Mock, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import BrowseModule from './BrowseModule.svelte';
import type {
  BrowseCategory,
  BrowseItem,
  BrowseType,
} from './browse-module.types';

/**
 * BrowseModule unit tests (WP-10).
 *
 * Run under jsdom, which does NOT apply `<style>` rules — so we assert the DOM
 * CONTRACT (rails-vs-grid structure, tab `aria-selected`, the chip label, the
 * `data-shape`/`data-chrome` a real `ContentCard` emits) rather than geometry.
 * Because the module is CONTROLLED, interactions are verified by the callback
 * they fire, not by a re-render — the owner (WP-11) feeds new props back in.
 *
 * `browser` is `true` under Vitest, so the child `ContentCard`/`Carousel`
 * mount fully and their `data-*` attributes are observable.
 */

type TypeFn = (type: BrowseType) => void;
type CategoryFn = (slug: string | null) => void;

const categories: BrowseCategory[] = [
  { slug: 'somatics', name: 'Somatics' },
  { slug: 'neuroscience', name: 'Neuroscience' },
];

/** Full mixed catalogue. Every item carries `categorySlugs` (WP-11's field). */
const items: BrowseItem[] = [
  {
    id: 'v1',
    title: 'Video One',
    href: '/c/v1',
    contentType: 'video',
    categorySlugs: ['somatics'],
  },
  {
    id: 'v2',
    title: 'Video Two',
    href: '/c/v2',
    contentType: 'video',
    categorySlugs: ['neuroscience'],
  },
  {
    id: 'a1',
    title: 'Audio One',
    href: '/c/a1',
    contentType: 'audio',
    categorySlugs: ['somatics'],
  },
  {
    id: 'ar1',
    title: 'Article One',
    href: '/c/ar1',
    contentType: 'article',
    categorySlugs: ['neuroscience'],
  },
];

const base = {
  items,
  categories,
  type: 'all',
  category: null,
  onTypeChange: () => {},
  onCategoryChange: () => {},
} satisfies ComponentProps<typeof BrowseModule>;

let component: ReturnType<typeof mount> | null = null;

function render(props: Partial<ComponentProps<typeof BrowseModule>> = {}) {
  component = mount(BrowseModule, {
    target: document.body,
    props: { ...base, ...props },
  });
  flushSync();
}

afterEach(() => {
  if (component) {
    unmount(component);
    component = null;
  }
  document.body.innerHTML = '';
});

const tabByLabel = (label: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
    (b) => b.textContent?.trim() === label
  );

function pressKey(el: Element, key: string) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  flushSync();
}

describe('BrowseModule — unfiltered (grid)', () => {
  test('unfiltered renders one grid of every item (no per-type rails)', () => {
    render();
    // Review-round R1 replaced the per-type rails with a single uniform grid,
    // so the rails container must be absent and the grid must hold every item.
    expect(document.querySelector('.browse__rails')).toBeNull();
    const grid = document.querySelector('.content-grid');
    expect(grid).not.toBeNull();
    expect(grid?.querySelectorAll('.cc').length).toBe(items.length);
  });

  test('the unfiltered grid spans every type present in the catalogue', () => {
    render();
    const types = new Set(
      Array.from(document.querySelectorAll('.content-grid .cc')).map((c) =>
        c.getAttribute('data-content-type')
      )
    );
    expect(types).toEqual(new Set(['video', 'audio', 'article']));
  });

  test('every unfiltered grid card carries the 1:1 catalogue shape', () => {
    render();
    const cards = Array.from(
      document.querySelectorAll<HTMLElement>('.content-grid .cc')
    );
    expect(cards.length).toBe(items.length);
    for (const card of cards) {
      expect(card.getAttribute('data-shape')).toBe('1:1');
    }
  });

  test('every browse card is chrome="transparent"', () => {
    render();
    const cards = Array.from(document.querySelectorAll<HTMLElement>('.cc'));
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.getAttribute('data-chrome')).toBe('transparent');
    }
  });

  test('the active tab is "All" and marked aria-selected', () => {
    render();
    expect(tabByLabel('All')?.getAttribute('aria-selected')).toBe('true');
    expect(tabByLabel('Videos')?.getAttribute('aria-selected')).toBe('false');
  });
});

describe('BrowseModule — type tabs', () => {
  test('clicking a type tab calls onTypeChange with that type', () => {
    const onTypeChange: Mock<TypeFn> = vi.fn<TypeFn>();
    render({ onTypeChange });

    tabByLabel('Videos')?.click();
    flushSync();

    expect(onTypeChange).toHaveBeenCalledTimes(1);
    expect(onTypeChange).toHaveBeenCalledWith('video');
  });

  test('ArrowRight on the active tab activates the next type (automatic activation)', () => {
    const onTypeChange: Mock<TypeFn> = vi.fn<TypeFn>();
    render({ onTypeChange });

    const allTab = tabByLabel('All');
    if (!allTab) throw new Error('All tab not found');
    pressKey(allTab, 'ArrowRight');

    expect(onTypeChange).toHaveBeenCalledWith('video');
  });

  test.each([
    ['ArrowLeft'],
    ['ArrowUp'],
  ] as const)('%s moves backward and wraps from the first tab to the last', (key) => {
    const onTypeChange: Mock<TypeFn> = vi.fn<TypeFn>();
    render({ onTypeChange });

    const allTab = tabByLabel('All');
    if (!allTab) throw new Error('All tab not found');
    pressKey(allTab, key);

    // From 'all' (index 0), backward wraps to 'article' (last tab).
    expect(onTypeChange).toHaveBeenCalledWith('article');
  });

  test('ArrowLeft moves backward without wrapping when not on the first tab', () => {
    const onTypeChange: Mock<TypeFn> = vi.fn<TypeFn>();
    render({ type: 'video', onTypeChange });

    const videoTab = tabByLabel('Videos');
    if (!videoTab) throw new Error('Videos tab not found');
    pressKey(videoTab, 'ArrowLeft');

    expect(onTypeChange).toHaveBeenCalledWith('all');
  });

  test('Home activates + focuses the first tab; End the last', () => {
    const onTypeChange: Mock<TypeFn> = vi.fn<TypeFn>();
    render({ onTypeChange });

    const lastTab = tabByLabel('Articles');
    if (!lastTab) throw new Error('Articles tab not found');
    pressKey(lastTab, 'Home');
    expect(onTypeChange).toHaveBeenLastCalledWith('all');
    expect(document.activeElement).toBe(tabByLabel('All'));

    const firstTab = tabByLabel('All');
    if (!firstTab) throw new Error('All tab not found');
    pressKey(firstTab, 'End');
    expect(onTypeChange).toHaveBeenLastCalledWith('article');
    expect(document.activeElement).toBe(tabByLabel('Articles'));
  });

  test('roving tabindex: only the active tab is tabbable (0), the rest are -1', () => {
    render({ type: 'audio' });
    const byIndex = (label: string) =>
      tabByLabel(label)?.getAttribute('tabindex');
    expect(byIndex('Audio')).toBe('0');
    expect(byIndex('All')).toBe('-1');
    expect(byIndex('Videos')).toBe('-1');
    expect(byIndex('Articles')).toBe('-1');
  });
});

describe('BrowseModule — filtered (grid)', () => {
  test('setting a type switches from rails to a 1:1 grid', () => {
    render({ type: 'audio' });
    expect(document.querySelector('.browse__rails')).toBeNull();
    expect(document.querySelector('.content-grid')).not.toBeNull();
    // Only the single audio item; rendered at 1:1.
    const cards = document.querySelectorAll<HTMLElement>('.content-grid .cc');
    expect(cards.length).toBe(1);
    expect(cards[0]?.getAttribute('data-content-type')).toBe('audio');
    expect(cards[0]?.getAttribute('data-shape')).toBe('1:1');
  });

  test('an active category shows the chip with the category NAME and a grid', () => {
    render({ category: 'somatics' });
    expect(document.querySelector('.browse__rails')).toBeNull();
    const chip = document.querySelector('.browse__chip');
    expect(chip).not.toBeNull();
    expect(chip?.querySelector('.browse__chip-label')?.textContent).toContain(
      'Somatics'
    );
    // type='all' + category → both content types tagged 'somatics' (v1, a1).
    expect(document.querySelectorAll('.content-grid .cc').length).toBe(2);
  });

  test('the grid contains only items matching BOTH the type AND the category', () => {
    // video + somatics → only v1 (v2 is neuroscience; a1 is audio).
    render({ type: 'video', category: 'somatics' });
    const cards = Array.from(
      document.querySelectorAll<HTMLElement>('.content-grid .cc')
    );
    expect(cards.length).toBe(1);
    expect(cards[0]?.getAttribute('data-content-type')).toBe('video');
    expect(
      document.querySelector('.browse__chip-label')?.textContent
    ).toContain('Somatics');
  });

  test('no matches renders the empty message, no cards', () => {
    // audio + neuroscience → the one audio item is tagged somatics → empty.
    render({ type: 'audio', category: 'neuroscience' });
    expect(document.querySelector('.browse__empty')).not.toBeNull();
    expect(document.querySelectorAll('.content-grid .cc').length).toBe(0);
  });

  test('clicking the chip clears the topic via onCategoryChange(null)', () => {
    const onCategoryChange: Mock<CategoryFn> = vi.fn<CategoryFn>();
    render({ category: 'somatics', onCategoryChange });

    document.querySelector<HTMLButtonElement>('.browse__chip')?.click();
    flushSync();

    expect(onCategoryChange).toHaveBeenCalledTimes(1);
    expect(onCategoryChange).toHaveBeenCalledWith(null);
  });

  test('a slug with no matching category falls back to the raw slug on the chip', () => {
    render({ category: 'unmapped-slug' });
    expect(
      document.querySelector('.browse__chip-label')?.textContent
    ).toContain('unmapped-slug');
  });
});

describe('BrowseModule — a11y wiring + empty catalogue', () => {
  test('the tabpanel is aria-labelledby the active tab and is not a tab stop', () => {
    render({ type: 'video' });
    const panel = document.querySelector('[role="tabpanel"]');
    const videoTab = tabByLabel('Videos');
    expect(videoTab?.id).toBeTruthy();
    expect(panel?.getAttribute('aria-labelledby')).toBe(videoTab?.id);
    // No redundant tab stop: the panel always holds focusable children.
    expect(panel?.hasAttribute('tabindex')).toBe(false);
  });

  test('an empty catalogue (unfiltered, no items) shows a message, not a blank body', () => {
    render({ items: [] });
    const empty = document.querySelector('.browse__empty');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain('No content yet.');
    // Neither the rails wrapper nor the grid renders when there is nothing.
    expect(document.querySelector('.browse__rails')).toBeNull();
    expect(document.querySelector('.content-grid')).toBeNull();
  });
});
