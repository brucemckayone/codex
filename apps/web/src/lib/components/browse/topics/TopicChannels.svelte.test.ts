/**
 * TopicChannels: a tab row over a page-per-topic pager. The tabs and the pager
 * follow each other; only a page's button filters (`onSelect`); an outside
 * `active` turns the pager; each page shows its topic's real count (or none)
 * and its three newest loaded pieces.
 *
 * jsdom lays nothing out, so the pager is given a width (400) and a scroll
 * position by hand, its `scrollTo` is recorded rather than run, and a swipe is
 * a scroll position plus a `scroll` event. The component reads the pager once
 * a frame, so a swipe waits one frame.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { TopicItem } from '$lib/components/topic/topic-card.types';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import type { BrowseItem } from '../browse-module.types';
import TopicChannels from './TopicChannels.svelte';
import {
  browseLabel,
  buildChannelPages,
  kickerLabel,
  topicInitial,
  typeMixLabel,
} from './topic-channels';

const PAGE_WIDTH = 400;

/*
 * `prefersReducedMotion` reads `matchMedia` once, at import, so a test flips
 * the preference here instead.
 */
const motion = vi.hoisted(() => ({ reduce: false }));
vi.mock('svelte/motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('svelte/motion')>()),
  prefersReducedMotion: {
    get current() {
      return motion.reduce;
    },
  },
}));

const topics: TopicItem[] = [
  {
    id: 't1',
    name: 'Somatics',
    slug: 'somatics',
    description: 'Body first.',
    coverImageUrl: 'https://cdn.test/somatics.webp',
    contentCount: 5,
  },
  { id: 't2', name: 'The Breath', slug: 'breath', coverImageUrl: null },
  { id: 't3', name: 'Neuroscience', slug: 'neuro', contentCount: 40 },
];

const item = (
  id: string,
  contentType: BrowseItem['contentType'],
  categorySlugs: string[]
): BrowseItem => ({
  id,
  title: `Title ${id}`,
  href: `/content/${id}`,
  contentType,
  categorySlugs,
});

/** Newest first, as the landing hands them over. */
const items: BrowseItem[] = [
  item('s1', 'video', ['somatics']),
  item('s2', 'audio', ['somatics', 'breath']),
  item('s3', 'video', ['somatics']),
  item('x1', 'article', ['neuro']),
  item('s4', 'article', ['somatics']),
  item('s5', 'video', ['somatics']),
  item('b1', 'video', ['breath']),
];

// ── Layout stand-ins ──────────────────────────────────────────────────

const scrollLeftOf = new WeakMap<Element, number>();
const scrolls: { el: Element; left?: number; behavior?: ScrollBehavior }[] = [];
let scrollToDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  scrolls.length = 0;
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(
    function (this: Element) {
      return this.classList.contains('channels__pager') ? PAGE_WIDTH : 0;
    }
  );
  vi.spyOn(Element.prototype, 'scrollLeft', 'get').mockImplementation(function (
    this: Element
  ) {
    return scrollLeftOf.get(this) ?? 0;
  });
  scrollToDescriptor = Object.getOwnPropertyDescriptor(
    Element.prototype,
    'scrollTo'
  );
  Object.defineProperty(Element.prototype, 'scrollTo', {
    configurable: true,
    writable: true,
    value(this: Element, options: ScrollToOptions) {
      scrolls.push({ el: this, ...options });
    },
  });
});

let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  motion.reduce = false;
  vi.restoreAllMocks();
  if (scrollToDescriptor)
    Object.defineProperty(Element.prototype, 'scrollTo', scrollToDescriptor);
  else Reflect.deleteProperty(Element.prototype, 'scrollTo');
});

// ── Helpers ───────────────────────────────────────────────────────────

/** Props held in state, so a test can change `active` the way the host does. */
function render(initial: { active?: string | null } = {}) {
  const onSelect = vi.fn<(slug: string | null) => void>();
  const props = $state({
    topics,
    items,
    active: initial.active ?? null,
    onSelect,
  });
  component = mount(TopicChannels, { target: document.body, props });
  flushSync();
  return { props, onSelect };
}

const tabs = () =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
const pages = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[role="tabpanel"]'));
const pager = () =>
  document.querySelector<HTMLElement>('.channels__pager') as HTMLElement;
const selectedTab = () =>
  tabs().findIndex((t) => t.getAttribute('aria-selected') === 'true');
/**
 * The pages that are not inert. Svelte sets `inert` as a property, which a
 * browser reflects to the attribute and jsdom keeps as a plain field.
 */
const openPages = () =>
  pages()
    .map((p, i) => (p.inert || p.hasAttribute('inert') ? -1 : i))
    .filter((i) => i >= 0);
const pagerScrolls = () => scrolls.filter((s) => s.el === pager());
const lastPagerScroll = () => pagerScrolls().at(-1);

function press(el: Element, key: string) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  flushSync();
}

/** The pager comes to rest at `left`, as after a swipe. */
async function scrollPagerTo(left: number) {
  scrollLeftOf.set(pager(), left);
  pager().dispatchEvent(new Event('scroll'));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  flushSync();
}

// ── The component ─────────────────────────────────────────────────────

describe('TopicChannels: tabs over a page per topic', () => {
  test('a tab per topic, each controlling its own page; the first is open', () => {
    render();
    expect(tabs().map((t) => t.textContent?.trim())).toEqual([
      'Somatics',
      'The Breath',
      'Neuroscience',
    ]);
    tabs().forEach((tab, i) => {
      const panel = document.getElementById(
        tab.getAttribute('aria-controls') ?? ''
      );
      expect(panel).toBe(pages()[i]);
      expect(panel?.getAttribute('aria-labelledby')).toBe(tab.id);
    });
    expect(selectedTab()).toBe(0);
    expect(openPages()).toEqual([0]);
    // Roving tabindex: only the selected tab is in the tab order.
    expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1, -1]);
  });

  test('clicking a tab turns the pager to its page, without filtering', () => {
    const { onSelect } = render();
    tabs()[2].click();
    flushSync();
    expect(selectedTab()).toBe(2);
    expect(openPages()).toEqual([2]);
    expect(lastPagerScroll()).toMatchObject({
      left: 2 * PAGE_WIDTH,
      behavior: 'smooth',
    });
    expect(onSelect).not.toHaveBeenCalled();
  });

  test('arrow keys move, select and focus the next tab, wrapping at both ends', () => {
    render();
    press(tabs()[0], 'ArrowRight');
    expect(selectedTab()).toBe(1);
    expect(document.activeElement).toBe(tabs()[1]);
    expect(lastPagerScroll()?.left).toBe(PAGE_WIDTH);

    press(tabs()[1], 'ArrowLeft');
    press(tabs()[0], 'ArrowLeft');
    expect(selectedTab()).toBe(2);
    expect(document.activeElement).toBe(tabs()[2]);

    press(tabs()[2], 'Home');
    expect(selectedTab()).toBe(0);
    press(tabs()[0], 'End');
    expect(selectedTab()).toBe(2);
  });

  test('the ← → steps turn the pager a page, wrapping', () => {
    render();
    const [previous, next] = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.channels__step')
    );
    next.click();
    flushSync();
    expect(selectedTab()).toBe(1);
    previous.click();
    previous.click();
    flushSync();
    expect(selectedTab()).toBe(2);
  });

  test('a swipe selects the tab of the page the pager comes to rest on', async () => {
    const { onSelect } = render();
    await scrollPagerTo(2 * PAGE_WIDTH);
    expect(selectedTab()).toBe(2);
    expect(openPages()).toEqual([2]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  test('a turn in flight does not drag the tabs through the pages it passes', async () => {
    render();
    tabs()[2].click();
    flushSync();
    // Passing page 2 on the way to page 3.
    await scrollPagerTo(PAGE_WIDTH);
    expect(selectedTab()).toBe(2);
    await scrollPagerTo(2 * PAGE_WIDTH);
    expect(selectedTab()).toBe(2);
    // Arrived: a swipe from here is followed again.
    await scrollPagerTo(PAGE_WIDTH);
    expect(selectedTab()).toBe(1);
  });

  test('a sideways wheel takes a turn over; a wheel scrolling the page does not', async () => {
    render();
    tabs()[2].click();
    flushSync();
    pager().dispatchEvent(new WheelEvent('wheel', { deltaY: 40 }));
    await scrollPagerTo(PAGE_WIDTH);
    expect(selectedTab()).toBe(2);
    pager().dispatchEvent(new WheelEvent('wheel', { deltaX: 40 }));
    await scrollPagerTo(PAGE_WIDTH);
    expect(selectedTab()).toBe(1);
  });

  test('reduced motion turns the pager instantly', () => {
    motion.reduce = true;
    render();
    tabs()[1].click();
    flushSync();
    expect(lastPagerScroll()).toMatchObject({
      left: PAGE_WIDTH,
      behavior: 'instant',
    });
  });

  test('renders nothing with no topics', () => {
    component = mount(TopicChannels, {
      target: document.body,
      props: { topics: [], items, active: null, onSelect: () => {} },
    });
    flushSync();
    expect(document.querySelector('.channels')).toBeNull();
  });
});

describe('TopicChannels: the active topic, from outside', () => {
  test('a deep-linked topic opens on its page, placed at once', () => {
    render({ active: 'neuro' });
    expect(selectedTab()).toBe(2);
    expect(openPages()).toEqual([2]);
    expect(lastPagerScroll()).toMatchObject({
      left: 2 * PAGE_WIDTH,
      behavior: 'instant',
    });
  });

  test('a change of `active` turns the pager to that topic', () => {
    const { props } = render();
    props.active = 'breath';
    flushSync();
    expect(selectedTab()).toBe(1);
    expect(lastPagerScroll()).toMatchObject({
      left: PAGE_WIDTH,
      behavior: 'smooth',
    });
  });

  test('a swipe away from the active topic is not pulled back to it', async () => {
    const { props } = render({ active: 'somatics' });
    await scrollPagerTo(2 * PAGE_WIDTH);
    expect(selectedTab()).toBe(2);
    // Clearing the filter leaves the pager where the visitor put it.
    props.active = null;
    flushSync();
    expect(selectedTab()).toBe(2);
  });
});

describe('TopicChannels: what a page shows', () => {
  test("the button filters the grid to its page's topic", () => {
    const { onSelect } = render();
    pages()[1].querySelector<HTMLButtonElement>('.channels__cta')?.click();
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('breath');
  });

  test('the button carries the real count, and no number when it is absent', () => {
    render();
    const cta = (i: number) =>
      pages()[i].querySelector('.channels__cta')?.textContent?.trim();
    expect(cta(0)).toBe('Browse 5 pieces');
    expect(cta(1)).toBe('Browse this topic');
    expect(cta(1)).not.toMatch(/\d/);
    expect(cta(2)).toBe('Browse 40 pieces');
  });

  test("minis are the topic's own pieces, newest first, three at most", () => {
    render();
    const minis = (i: number) =>
      Array.from(
        pages()[i].querySelectorAll<HTMLAnchorElement>('.channels__mini')
      ).map((a) => a.getAttribute('href'));
    // Somatics has five loaded pieces: the newest three show.
    expect(minis(0)).toEqual(['/content/s1', '/content/s2', '/content/s3']);
    expect(minis(1)).toEqual(['/content/s2', '/content/b1']);
    expect(minis(2)).toEqual(['/content/x1']);
  });

  test('kicker, blurb and type mix; a coverless page shows its initial', () => {
    render();
    const text = (i: number, cls: string) =>
      pages()[i].querySelector(cls)?.textContent?.trim() ?? null;
    expect(text(0, '.channels__kicker')).toBe('Topic 01 of 03');
    expect(text(0, '.channels__desc')).toBe('Body first.');
    expect(text(1, '.channels__desc')).toBeNull();
    expect(text(0, '.channels__mix')).toBe('3 videos · 1 audio · 1 article');
    expect(pages()[0].querySelector('img.channels__art')).not.toBeNull();
    expect(text(1, '.channels__mark')).toBe('B');
  });
});

// ── The page model ────────────────────────────────────────────────────

describe('topic-channels page model', () => {
  const inTopic = (slug: string) =>
    items.filter((i) => i.categorySlugs?.includes(slug));

  test('the type mix counts only when the loaded pieces are the whole topic', () => {
    expect(typeMixLabel(inTopic('somatics'), 5)).toBe(
      '3 videos · 1 audio · 1 article'
    );
    // 40 published, 1 loaded: a tally would be wrong, so name the types only.
    expect(typeMixLabel(inTopic('neuro'), 40)).toBe('Articles');
    // No count to check against: types only, video first.
    expect(typeMixLabel(inTopic('breath'), undefined)).toBe('Videos · Audio');
    expect(typeMixLabel([], 3)).toBeNull();
    expect(typeMixLabel([item('v', 'video', ['z'])], 1)).toBe('1 video');
  });

  test('labels: the button, the kicker, the initial', () => {
    expect(browseLabel(1)).toBe('Browse 1 piece');
    expect(browseLabel(12)).toBe('Browse 12 pieces');
    expect(browseLabel(undefined)).toBe('Browse this topic');
    expect(kickerLabel(1, 12)).toBe('Topic 02 of 12');
    expect(topicInitial('The Body')).toBe('B');
    expect(topicInitial('  yoga ')).toBe('Y');
  });

  test('pages follow the topics, each capped at three minis', () => {
    const many = Array.from({ length: 6 }, (_, n) =>
      item(`m${n}`, 'video', ['somatics'])
    );
    const built = buildChannelPages(topics, many);
    expect(built.map((p) => p.topic.slug)).toEqual([
      'somatics',
      'breath',
      'neuro',
    ]);
    expect(built[0].minis.map((m) => m.id)).toEqual(['m0', 'm1', 'm2']);
    expect(built[1].minis).toEqual([]);
  });
});
