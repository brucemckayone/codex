import { type ComponentProps, createRawSnippet } from 'svelte';
import { afterEach, describe, expect, type Mock, test, vi } from 'vitest';
import type { TopicItem } from '$lib/components/topic/topic-card.types';
import { MOBILE_QUERY } from '$lib/components/ui/FilterDrawer/breakpoint';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import TopicBar from './TopicBar.svelte';

/**
 * TopicBar ("One bar", Codex-8swlj.5) unit tests.
 *
 * jsdom applies no `<style>`, so the desktop/phone split (a CSS media query)
 * is not observable: both triggers are in the DOM, and each test presses the
 * one it means. The bar is CONTROLLED, so a pick is verified by the
 * `onSelect` it fires, and a test feeds `active` back in when it needs to.
 *
 * Reduced motion is ON here, so a closed popover or sheet leaves the DOM at
 * once (with motion, jsdom never ends the fly-out and the panel lingers,
 * inert). That also proves the bar works under reduced motion.
 */

vi.mock('svelte/motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('svelte/motion')>()),
  prefersReducedMotion: { current: true },
}));

type SelectFn = (slug: string | null) => void;

const topics: TopicItem[] = [
  {
    id: 't1',
    slug: 'somatics',
    name: 'Somatics',
    coverImageUrl: 'https://cdn.example/topics/t1/md.webp',
    contentCount: 12,
  },
  { id: 't2', slug: 'neuroscience', name: 'Neuroscience', contentCount: 1 },
  // A topic whose response predates the count.
  { id: 't3', slug: 'ritual', name: 'Ritual' },
];

let component: ReturnType<typeof mount> | null = null;

function render(props: Partial<ComponentProps<typeof TopicBar>> = {}) {
  component = mount(TopicBar, {
    target: document.body,
    props: { topics, active: null, onSelect: () => {}, ...props },
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

// Melt sets a panel up a tick after it opens and moves focus a moment after
// it closes; let each settle, as a person's presses never share a microtask.
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const chips = () =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('.topic-bar__chip'));
const chip = (name: string) =>
  chips().find(
    (c) => c.querySelector('.topic-bar__chip-name')?.textContent === name
  );
const allChip = () =>
  document.querySelector<HTMLButtonElement>('.topic-bar__chip--all');

// The round-1 mock's ONE bar: the host's type tabs ride in the band, first.
describe('TopicBar — lead', () => {
  test('renders the lead first in the band, before the topic controls', () => {
    const lead = createRawSnippet(() => ({
      render: () => '<div role="tablist" aria-label="Types"></div>',
    }));
    render({ lead });
    const bar = document.querySelector('.topic-bar');
    expect(bar?.hasAttribute('data-lead')).toBe(true);
    expect(
      bar?.firstElementChild?.querySelector('[role="tablist"]')
    ).not.toBeNull();
  });

  test('without a lead the band holds only the topic controls', () => {
    render();
    const bar = document.querySelector('.topic-bar');
    expect(bar?.hasAttribute('data-lead')).toBe(false);
    expect(bar?.querySelector('.topic-bar__lead')).toBeNull();
  });
});

describe('TopicBar — chips', () => {
  test('an "All topics" chip and one chip per topic, in a named group', () => {
    render();
    const group = document.querySelector('[role="group"]');
    expect(group?.getAttribute('aria-label')).toBe('Filter by topic');
    expect(allChip()?.textContent?.trim()).toBe('All topics');
    expect(chips()).toHaveLength(topics.length + 1);
  });

  test('aria-pressed marks the active topic, and All when none is', () => {
    render();
    expect(allChip()?.getAttribute('aria-pressed')).toBe('true');
    expect(chip('Somatics')?.getAttribute('aria-pressed')).toBe('false');

    unmount(component as ReturnType<typeof mount>);
    component = null;
    render({ active: 'somatics' });
    expect(allChip()?.getAttribute('aria-pressed')).toBe('false');
    expect(chip('Somatics')?.getAttribute('aria-pressed')).toBe('true');
  });

  test('pressing a chip selects its topic', () => {
    const onSelect: Mock<SelectFn> = vi.fn<SelectFn>();
    render({ onSelect });
    chip('Neuroscience')?.click();
    expect(onSelect).toHaveBeenCalledWith('neuroscience');
  });

  test('pressing the active chip clears it (a toggle)', () => {
    const onSelect: Mock<SelectFn> = vi.fn<SelectFn>();
    render({ active: 'somatics', onSelect });
    chip('Somatics')?.click();
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  test('"All topics" clears the topic', () => {
    const onSelect: Mock<SelectFn> = vi.fn<SelectFn>();
    render({ active: 'somatics', onSelect });
    allChip()?.click();
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  test('a chip shows its count badge, and says it to a screen reader', () => {
    render();
    const somatics = chip('Somatics');
    expect(somatics?.querySelector('.topic-bar__count')?.textContent).toBe(
      '12'
    );
    expect(somatics?.querySelector('.sr-only')?.textContent).toBe('12 pieces');
    expect(chip('Neuroscience')?.querySelector('.sr-only')?.textContent).toBe(
      '1 piece'
    );
  });

  test('a missing count is HIDDEN, never shown as 0', () => {
    render();
    const ritual = chip('Ritual');
    expect(ritual?.querySelector('.topic-bar__count')).toBeNull();
    expect(ritual?.querySelector('.sr-only')).toBeNull();
    expect(ritual?.textContent).not.toContain('0');
  });

  test('a cover becomes the dot (the small variant, its own colour); no cover shows the initial', () => {
    render();
    const img = chip('Somatics')?.querySelector<HTMLImageElement>(
      '.topic-bar__dot img'
    );
    expect(img?.getAttribute('src')).toBe(
      'https://cdn.example/topics/t1/sm.webp'
    );
    expect(
      chip('Ritual')?.querySelector('.topic-bar__dot')?.textContent?.trim()
    ).toBe('R');
  });
});

describe('TopicBar — desktop popover', () => {
  const trigger = () =>
    document.querySelector<HTMLButtonElement>('.topic-bar__more');
  const panel = () => document.querySelector<HTMLElement>('.topic-bar__pop');

  test('"See all N" opens a named grid of every topic', async () => {
    render();
    expect(trigger()?.textContent).toContain('See all 3');
    expect(panel()).toBeNull();

    trigger()?.click();
    flushSync();
    await settle();

    expect(panel()?.getAttribute('role')).toBe('dialog');
    expect(panel()?.getAttribute('aria-label')).toBe('Topics');
    expect(panel()?.querySelectorAll('.topic-bar__tile')).toHaveLength(
      topics.length
    );
  });

  test('picking a topic selects it and closes the popover', async () => {
    const onSelect: Mock<SelectFn> = vi.fn<SelectFn>();
    render({ onSelect });
    trigger()?.click();
    flushSync();
    await settle();

    const tile = Array.from(
      panel()?.querySelectorAll<HTMLButtonElement>('.topic-bar__tile') ?? []
    ).find((t) => t.textContent?.includes('Neuroscience'));
    tile?.click();
    flushSync();
    await settle();

    expect(onSelect).toHaveBeenCalledWith('neuroscience');
    expect(panel()).toBeNull();
    expect(trigger()?.getAttribute('aria-expanded')).toBe('false');
  });

  test('a grid pick of the ACTIVE topic keeps it (selects, never toggles)', async () => {
    const onSelect: Mock<SelectFn> = vi.fn<SelectFn>();
    render({ active: 'somatics', onSelect });
    trigger()?.click();
    flushSync();
    await settle();

    const tile = panel()?.querySelector<HTMLButtonElement>(
      '.topic-bar__tile[aria-pressed="true"]'
    );
    expect(tile?.textContent).toContain('Somatics');
    tile?.click();
    flushSync();

    expect(onSelect).toHaveBeenCalledWith('somatics');
  });
});

describe('TopicBar — phone sheet', () => {
  function stubPhone() {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn((query: string) => ({
        matches: query === MOBILE_QUERY,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => true,
        onchange: null,
      })),
    });
  }

  const sheetBtn = () =>
    document.querySelector<HTMLButtonElement>('.topic-bar__sheet-btn');
  const sheet = () => document.querySelector<HTMLElement>('.filter-drawer');
  const sheetTiles = () =>
    Array.from(
      sheet()?.querySelectorAll<HTMLButtonElement>('.topic-bar__tile') ?? []
    );

  test('"Topics" opens a sheet with every topic', async () => {
    stubPhone();
    render();
    expect(sheet()).toBeNull();

    sheetBtn()?.click();
    flushSync();
    await settle();

    expect(sheetBtn()?.getAttribute('aria-expanded')).toBe('true');
    expect(sheetTiles()).toHaveLength(topics.length);
  });

  test('picking a topic selects it and closes the sheet', async () => {
    stubPhone();
    const onSelect: Mock<SelectFn> = vi.fn<SelectFn>();
    render({ onSelect });
    sheetBtn()?.click();
    flushSync();
    await settle();

    sheetTiles()
      .find((t) => t.textContent?.includes('Somatics'))
      ?.click();
    flushSync();
    await settle();

    expect(onSelect).toHaveBeenCalledWith('somatics');
    expect(sheet()).toBeNull();
    expect(sheetBtn()?.getAttribute('aria-expanded')).toBe('false');
  });

  test('the sheet\'s "All topics" stages a clear, and Apply commits it', async () => {
    stubPhone();
    const onSelect: Mock<SelectFn> = vi.fn<SelectFn>();
    render({ active: 'somatics', onSelect });
    sheetBtn()?.click();
    flushSync();
    await settle();

    sheet()?.querySelector<HTMLButtonElement>('.filter-drawer__clear')?.click();
    flushSync();

    // Staged, as FilterDrawer stages on a phone: the grid shows it, the page
    // has not been told yet.
    expect(onSelect).not.toHaveBeenCalled();
    expect(
      sheet()?.querySelector('.topic-bar__tile[aria-pressed="true"]')
    ).toBeNull();

    sheet()
      ?.querySelector<HTMLButtonElement>('.filter-drawer__btn--primary')
      ?.click();
    flushSync();

    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
