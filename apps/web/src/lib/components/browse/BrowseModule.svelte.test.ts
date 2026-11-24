import type { ComponentProps } from 'svelte';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  type Mock,
  test,
  vi,
} from 'vitest';
import type { TopicItem } from '$lib/components/topic/topic-card.types';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

// Mutable, so a test can stand in for the server render (`browser: false`).
const appEnv = vi.hoisted(() => ({ browser: true, dev: true }));
vi.mock('$app/environment', () => appEnv);
vi.mock(
  '$lib/remote/content.remote',
  () => import('./__fixtures__/public-content.mock.svelte')
);

import {
  getPublicContent,
  resetPublicContent,
  topicPage,
} from './__fixtures__/public-content.mock.svelte';
import BrowseModule from './BrowseModule.svelte';
import type {
  BrowseItem,
  BrowseType,
  PublicContentRow,
} from './browse-module.types';

/**
 * BrowseModule unit tests (WP-10, host since Codex-8swlj.4).
 *
 * Run under jsdom, which does NOT apply `<style>` rules — so we assert the DOM
 * CONTRACT (grid structure, tab `aria-selected`, the result head, the
 * `data-shape`/`data-chrome` a real `ContentCard` emits) rather than geometry.
 * Because the module is CONTROLLED, interactions are verified by the callback
 * they fire, not by a re-render — the owner feeds new props back in.
 *
 * The server-backed topic filter reads `getPublicContent` through kit's query
 * double, so a test lands or fails the read itself.
 */

type TypeFn = (type: BrowseType) => void;
type CategoryFn = (slug: string | null) => void;

const topics: TopicItem[] = [
  { id: 't1', slug: 'somatics', name: 'Somatics', contentCount: 2 },
  { id: 't2', slug: 'neuroscience', name: 'Neuroscience', contentCount: 2 },
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

const ORG_ID = '00000000-0000-4000-8000-000000000001';

const base = {
  items,
  topics,
  topicStyle: 'bar',
  // Complete: every published piece is loaded, so filtering stays client-side.
  catalogueTotal: items.length,
  orgId: ORG_ID,
  // The test's server rows are browse-shaped already.
  toBrowseItem: (row: PublicContentRow) => row as unknown as BrowseItem,
  type: 'all',
  category: null,
  onTypeChange: () => {},
  onCategoryChange: () => {},
} satisfies ComponentProps<typeof BrowseModule>;

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  resetPublicContent();
});

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

  test('every browse card opts into title-in-cover so all types share the cover treatment (Codex-p7wc8)', () => {
    render();
    const cards = Array.from(
      document.querySelectorAll<HTMLElement>('.content-grid .cc')
    );
    expect(cards.length).toBe(items.length);
    // The homogenised catalogue passes `titleInCover` for EVERY type — not just
    // articles (which auto-enable it at 1:1/3:4). Before this opt-in, video and
    // audio tiles stayed plain and clashed with the flipped article tiles in the
    // same grid (and the flipped article tile overflowed its cell to the right).
    for (const card of cards) {
      expect(card.classList.contains('cc--title-in-cover')).toBe(true);
    }
    // Guard the non-article types explicitly — this is exactly what the opt-in
    // adds over the article-only auto-enable.
    const byType = (t: string) =>
      cards.find((c) => c.getAttribute('data-content-type') === t);
    expect(byType('video')?.classList.contains('cc--title-in-cover')).toBe(
      true
    );
    expect(byType('audio')?.classList.contains('cc--title-in-cover')).toBe(
      true
    );
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

  test('an active category shows the result head with the category NAME and a grid', () => {
    render({ category: 'somatics' });
    expect(document.querySelector('.browse__rails')).toBeNull();
    expect(document.querySelector('.browse__head-name')?.textContent).toContain(
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
    expect(document.querySelector('.browse__head-name')?.textContent).toContain(
      'Somatics'
    );
  });

  test('no matches renders the empty message, no cards', () => {
    // audio + neuroscience → the one audio item is tagged somatics → empty.
    render({ type: 'audio', category: 'neuroscience' });
    expect(document.querySelector('.browse__empty')).not.toBeNull();
    expect(document.querySelectorAll('.content-grid .cc').length).toBe(0);
  });

  test("the head's Clear clears the topic via onCategoryChange(null)", () => {
    const onCategoryChange: Mock<CategoryFn> = vi.fn<CategoryFn>();
    render({ category: 'somatics', onCategoryChange });

    const clear = document.querySelector<HTMLButtonElement>(
      '.browse__head-clear'
    );
    expect(clear?.getAttribute('aria-label')).toBe(
      'Clear topic filter: Somatics'
    );
    clear?.click();
    flushSync();

    expect(onCategoryChange).toHaveBeenCalledTimes(1);
    expect(onCategoryChange).toHaveBeenCalledWith(null);
  });

  test('a slug with no matching category falls back to the raw slug in the head', () => {
    render({ category: 'unmapped-slug' });
    expect(document.querySelector('.browse__head-name')?.textContent).toContain(
      'unmapped-slug'
    );
  });

  test('no active topic renders no result head', () => {
    render();
    expect(document.querySelector('.browse__head')).toBeNull();
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

describe('BrowseModule — the selector slot', () => {
  const styleOf = () =>
    document
      .querySelector('[data-topic-style]')
      ?.getAttribute('data-topic-style');

  test.each([
    ['bar', 'bar'],
    ['windows', 'windows'],
    ['channels', 'channels'],
    // Past the reader's whitelist, anything else still gets a working bar.
    ['mosaic', 'bar'],
  ])('topicStyle %s renders the %s selector', (topicStyle, expected) => {
    render({
      topicStyle: topicStyle as ComponentProps<
        typeof BrowseModule
      >['topicStyle'],
    });
    expect(styleOf()).toBe(expected);
    // Every selector gives each topic a control: One bar and Shader windows
    // as aria-pressed buttons, Channels as the tabs of an ARIA tablist.
    const controls = document.querySelectorAll(
      '[data-topic-style] button[aria-pressed], [data-topic-style] [role="tab"]'
    );
    expect(controls.length).toBeGreaterThanOrEqual(topics.length);
  });

  test('a selector pick reaches onCategoryChange with the slug', () => {
    const onCategoryChange: Mock<CategoryFn> = vi.fn<CategoryFn>();
    render({ onCategoryChange });

    const pick = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[data-topic-style] button[aria-pressed]'
      )
    ).find((b) => b.textContent?.includes('Neuroscience'));
    pick?.click();
    flushSync();

    expect(onCategoryChange).toHaveBeenCalledWith('neuroscience');
  });

  test("the active topic is the selector's pressed one", () => {
    render({ category: 'somatics' });
    const pressed = Array.from(
      document.querySelectorAll(
        '[data-topic-style] button[aria-pressed="true"]'
      )
    ).map((b) => b.textContent?.trim());
    expect(pressed.some((t) => t?.includes('Somatics'))).toBe(true);
  });

  test('no topics renders no selector', () => {
    render({ topics: [] });
    expect(document.querySelector('[data-topic-style]')).toBeNull();
  });
});

describe('BrowseModule — result head', () => {
  const countText = () =>
    document.querySelector('.browse__head-count')?.textContent?.trim() ?? null;

  test('a complete catalogue counts exactly what the grid shows, type included', () => {
    render({ category: 'somatics', type: 'video' });
    expect(countText()).toBe('1 piece');
  });

  test('"Open in Explore" links to the topic, narrowed to the active type', () => {
    render({ category: 'somatics', type: 'article' });
    const href = document
      .querySelector('.browse__head-explore')
      ?.getAttribute('href');
    const url = new URL(href ?? '', 'https://org.example');
    expect(url.pathname).toBe('/explore');
    expect(url.searchParams.get('category')).toBe('somatics');
    // Explore speaks the API vocabulary: articles are 'written'.
    expect(url.searchParams.get('type')).toBe('written');
  });

  test("a truncated catalogue shows the topic's own count until the server answers", () => {
    render({ category: 'somatics', catalogueTotal: 80 });
    expect(countText()).toBe('2 pieces');
  });

  test('a truncated catalogue with a type HIDES the count until the server answers', () => {
    // The topic's count spans every type, so it is not this grid's number.
    render({ category: 'somatics', type: 'video', catalogueTotal: 80 });
    expect(document.querySelector('.browse__head-count')).toBeNull();
  });

  test('a topic with no count is hidden, never shown as 0', () => {
    render({
      category: 'somatics',
      catalogueTotal: 80,
      topics: [{ id: 't1', slug: 'somatics', name: 'Somatics' }],
    });
    expect(document.querySelector('.browse__head-count')).toBeNull();
  });
});

describe('BrowseModule — topic filtering beyond the loaded catalogue', () => {
  // A full server page of newest-first somatics videos; the landing loaded
  // only v1 of them.
  const serverRows: BrowseItem[] = Array.from({ length: 24 }, (_, n) => ({
    id: `s${n}`,
    title: `Server ${n}`,
    href: `/c/s${n}`,
    contentType: 'video',
    categorySlugs: ['somatics'],
  }));

  const cardIds = () =>
    Array.from(
      document.querySelectorAll<HTMLAnchorElement>('.content-grid .cc a[href]')
    ).map((a) => a.getAttribute('href'));
  const cardCount = () => document.querySelectorAll('.content-grid .cc').length;

  test('a complete catalogue never asks the server', () => {
    render({ category: 'somatics' });
    expect(getPublicContent).not.toHaveBeenCalled();
  });

  test('a truncated catalogue with no topic never asks the server', () => {
    render({ catalogueTotal: 80 });
    expect(getPublicContent).not.toHaveBeenCalled();
  });

  test('a truncated catalogue asks the server for the topic and type', () => {
    render({ category: 'somatics', type: 'article', catalogueTotal: 80 });
    expect(getPublicContent).toHaveBeenCalledWith({
      orgId: ORG_ID,
      category: 'somatics',
      contentType: 'written',
      limit: 24,
    });
  });

  test('while the server reads, the grid shows the instant client subset', () => {
    render({ category: 'somatics', catalogueTotal: 80 });
    // v1 + a1 are the loaded somatics items.
    expect(cardCount()).toBe(2);
    expect(document.querySelector('.browse__empty')).toBeNull();
  });

  test('while the server reads an EMPTY subset, it says so instead of the empty state', () => {
    render({ category: 'neuroscience', type: 'audio', catalogueTotal: 80 });
    expect(cardCount()).toBe(0);
    expect(document.querySelector('.browse__status')).not.toBeNull();
    expect(document.querySelector('.browse__empty')).toBeNull();
  });

  // Review r1: a deep-linked `?category=` whose pieces are all older than the
  // loaded page. The server render makes no read, yet must not claim the
  // topic is empty: it says it is loading until the browser asks.
  test('the server render of an EMPTY subset on a truncated catalogue says loading, not empty', () => {
    appEnv.browser = false;
    try {
      render({ category: 'neuroscience', type: 'audio', catalogueTotal: 80 });
      expect(getPublicContent).not.toHaveBeenCalled();
      expect(cardCount()).toBe(0);
      expect(document.querySelector('.browse__status')).not.toBeNull();
      expect(document.querySelector('.browse__empty')).toBeNull();
    } finally {
      appEnv.browser = true;
    }
  });

  test('the landed server page replaces the subset, with its exact total and a See all link', () => {
    const kit = resetPublicContent();
    render({ category: 'somatics', type: 'video', catalogueTotal: 80 });

    kit.land(topicPage(serverRows, 31));
    flushSync();

    expect(cardCount()).toBe(24);
    expect(cardIds()[0]).toBe('/c/s0');
    expect(
      document.querySelector('.browse__head-count')?.textContent?.trim()
    ).toBe('31 pieces');
    const seeAll = document.querySelector('.browse__see-all');
    expect(seeAll?.textContent).toContain('See all 31 in Explore');
    expect(seeAll?.getAttribute('href')).toBe(
      '/explore?category=somatics&type=video'
    );
  });

  test('a landed page within 24 offers no See all link', () => {
    const kit = resetPublicContent();
    render({ category: 'somatics', catalogueTotal: 80 });

    kit.land(topicPage(serverRows.slice(0, 5), 5));
    flushSync();

    expect(cardCount()).toBe(5);
    expect(document.querySelector('.browse__see-all')).toBeNull();
  });

  test('a landed EMPTY page is a real empty result', () => {
    const kit = resetPublicContent();
    render({ category: 'somatics', type: 'audio', catalogueTotal: 80 });

    kit.land(topicPage([], 0));
    flushSync();

    expect(cardCount()).toBe(0);
    expect(document.querySelector('.browse__empty')).not.toBeNull();
  });

  test('a FAILED read keeps the client subset and offers Retry, with no empty state', () => {
    const kit = resetPublicContent();
    render({ category: 'somatics', catalogueTotal: 80 });

    kit.fail();
    flushSync();

    expect(cardCount()).toBe(2);
    expect(document.querySelector('.browse__notice-retry')).not.toBeNull();
    expect(document.querySelector('.browse__empty')).toBeNull();
  });

  test('a failed read with an EMPTY subset shows the failure, never the empty state', () => {
    const kit = resetPublicContent();
    // Nothing loaded is an audio piece in neuroscience.
    render({ category: 'neuroscience', type: 'audio', catalogueTotal: 80 });

    kit.fail();
    flushSync();

    expect(cardCount()).toBe(0);
    expect(document.querySelector('.browse__notice-retry')).not.toBeNull();
    expect(document.querySelector('.browse__empty')).toBeNull();
  });

  test('Retry reads again on the query kit hands back, and its landing replaces the subset', () => {
    const kit = resetPublicContent();
    render({ category: 'somatics', catalogueTotal: 80 });
    kit.fail();
    flushSync();
    const failed = kit.held();

    document.querySelector<HTMLButtonElement>('.browse__notice-retry')?.click();
    flushSync();

    // Kit dropped the failed query, so the module now holds a NEW one, still
    // loading: the Retry is gone, the subset stays.
    expect(kit.refreshes(failed)).toBe(1);
    expect(kit.held()).not.toBe(failed);
    expect(document.querySelector('.browse__notice-retry')).toBeNull();
    expect(cardCount()).toBe(2);

    kit.land(topicPage(serverRows.slice(0, 3), 3));
    flushSync();

    expect(cardCount()).toBe(3);
    expect(cardIds()).toEqual(['/c/s0', '/c/s1', '/c/s2']);
  });

  test('a Retry that fails again shows Retry again', () => {
    const kit = resetPublicContent();
    render({ category: 'somatics', catalogueTotal: 80 });
    kit.fail();
    flushSync();

    document.querySelector<HTMLButtonElement>('.browse__notice-retry')?.click();
    flushSync();
    kit.fail();
    flushSync();

    expect(document.querySelector('.browse__notice-retry')).not.toBeNull();
    expect(cardCount()).toBe(2);
  });
});
