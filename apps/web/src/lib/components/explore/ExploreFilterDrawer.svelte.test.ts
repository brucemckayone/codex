import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import ExploreFilterDrawer from './ExploreFilterDrawer.svelte';

/**
 * ExploreFilterDrawer integration tests.
 *
 * Verifies the config wrapper forwards filter changes correctly through the
 * shared FilterDrawer shell:
 *   • Renders the three sections (Sort, Type, Featured) with the expected
 *     option counts.
 *   • Clicking a Type pill calls onFilterChange with `{ type, featured }`.
 *   • Featured toggle uses aria-pressed and flips on click.
 *   • activeCount prop forwards to the shell badge.
 *
 * Default jsdom matchMedia returns matches=false → desktop write-through.
 */

function stubDesktopMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn(() => ({
      matches: false,
      media: '(max-width: 40rem)',
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
      onchange: null,
    })),
  });
}

const sortOptions = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'popular', label: 'Popular' },
] as const;

const typeOptions = [
  { value: '', label: 'All' },
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio' },
  { value: 'article', label: 'Article' },
] as const;

describe('ExploreFilterDrawer', () => {
  let component: ReturnType<typeof mount> | null = null;

  beforeEach(() => {
    stubDesktopMatchMedia();
  });

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders Sort + Type + Featured sections with expected option counts', () => {
    component = mount(ExploreFilterDrawer, {
      target: document.body,
      props: {
        open: true,
        filters: { type: '', featured: false },
        sort: 'newest',
        sortOptions,
        typeOptions,
        onOpenChange: () => {},
        onFilterChange: () => {},
        onSortChange: () => {},
        onClearAll: () => {},
      },
    });
    flushSync();

    // 3 sections; the third section has its own list — assert the sections exist.
    const sections = document.querySelectorAll('.filter-drawer__section');
    expect(sections.length).toBe(3);

    // Sort options (3) inside the first section's list.
    const sortOpts = sections[0].querySelectorAll('.filter-drawer__option');
    expect(sortOpts.length).toBe(3);

    // Type pills (4) inside the second section.
    const typePills = sections[1].querySelectorAll('.filter-drawer__pill');
    expect(typePills.length).toBe(4);

    // Featured toggle (1) inside the third section.
    const featuredOption = sections[2].querySelector('.filter-drawer__option');
    expect(featuredOption).toBeTruthy();
  });

  test('clicking a Type pill calls onFilterChange with merged {type, featured}', () => {
    const onFilterChange = vi.fn();
    component = mount(ExploreFilterDrawer, {
      target: document.body,
      props: {
        open: true,
        filters: { type: '', featured: false },
        sort: 'newest',
        sortOptions,
        typeOptions,
        onOpenChange: () => {},
        onFilterChange,
        onSortChange: () => {},
        onClearAll: () => {},
      },
    });
    flushSync();

    const sections = document.querySelectorAll('.filter-drawer__section');
    const typePills = sections[1].querySelectorAll<HTMLButtonElement>(
      '.filter-drawer__pill'
    );
    // Pill index 1 = "video"
    typePills[1].click();
    flushSync();

    expect(onFilterChange).toHaveBeenCalledTimes(1);
    expect(onFilterChange).toHaveBeenCalledWith({
      type: 'video',
      featured: false,
    });
  });

  test('Featured toggle uses aria-pressed and flips on click', () => {
    const onFilterChange = vi.fn();
    component = mount(ExploreFilterDrawer, {
      target: document.body,
      props: {
        open: true,
        filters: { type: '', featured: false },
        sort: 'newest',
        sortOptions,
        typeOptions,
        onOpenChange: () => {},
        onFilterChange,
        onSortChange: () => {},
        onClearAll: () => {},
      },
    });
    flushSync();

    const sections = document.querySelectorAll('.filter-drawer__section');
    const featuredBtn = sections[2].querySelector<HTMLButtonElement>(
      '.filter-drawer__option'
    );

    expect(featuredBtn?.getAttribute('aria-pressed')).toBe('false');

    featuredBtn?.click();
    flushSync();

    expect(onFilterChange).toHaveBeenCalledWith({
      type: '',
      featured: true,
    });
  });

  test('clicking a Sort option calls onSortChange with the value', () => {
    const onSortChange = vi.fn();
    component = mount(ExploreFilterDrawer, {
      target: document.body,
      props: {
        open: true,
        filters: { type: '', featured: false },
        sort: 'newest',
        sortOptions,
        typeOptions,
        onOpenChange: () => {},
        onFilterChange: () => {},
        onSortChange,
        onClearAll: () => {},
      },
    });
    flushSync();

    const sortRow = document
      .querySelector('.filter-drawer__section')
      ?.querySelectorAll<HTMLButtonElement>('.filter-drawer__option');
    // Pick "oldest" (index 1).
    sortRow?.[1].click();
    flushSync();

    expect(onSortChange).toHaveBeenCalledTimes(1);
    expect(onSortChange).toHaveBeenCalledWith('oldest');
  });

  test('activeCount forwards through to the shell header badge', () => {
    component = mount(ExploreFilterDrawer, {
      target: document.body,
      props: {
        open: true,
        filters: { type: '', featured: false },
        sort: 'newest',
        sortOptions,
        typeOptions,
        onOpenChange: () => {},
        onFilterChange: () => {},
        onSortChange: () => {},
        onClearAll: () => {},
        activeCount: 3,
      },
    });
    flushSync();

    const badge = document.querySelector('.filter-drawer__badge');
    expect(badge?.textContent?.trim()).toBe('3');
  });
});
