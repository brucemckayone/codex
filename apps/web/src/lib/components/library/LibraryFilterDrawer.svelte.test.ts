import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import LibraryFilterDrawer from './LibraryFilterDrawer.svelte';

/**
 * LibraryFilterDrawer integration tests.
 *
 * Verifies the library config wrapper renders three pill-grid facets
 * (contentType / progressStatus / accessType) plus a Sort list, and that:
 *   • Clicking a facet pill calls onFilterChange with that facet keyed.
 *   • Clicking the "All" pill resets that facet to the ALL ('all') sentinel.
 *   • activeCount forwards to the shell header badge.
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
  { value: 'recent', label: 'Recent' },
  { value: 'alphabetical', label: 'A → Z' },
];

const initialFilters = {
  contentType: 'all',
  progressStatus: 'all',
  accessType: 'all',
};

describe('LibraryFilterDrawer', () => {
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

  test('renders 4 sections (Sort + 3 facets) with correct pill counts', () => {
    component = mount(LibraryFilterDrawer, {
      target: document.body,
      props: {
        open: true,
        filters: initialFilters,
        sort: 'recent',
        sortOptions,
        onOpenChange: () => {},
        onFilterChange: () => {},
        onSortChange: () => {},
        onClearAll: () => {},
      },
    });
    flushSync();

    const sections = document.querySelectorAll('.filter-drawer__section');
    expect(sections.length).toBe(4);

    // Section[0] = Sort (list rows, not pills).
    expect(sections[0].querySelectorAll('.filter-drawer__option').length).toBe(
      2
    );

    // Section[1] = contentType pills: 1 "All" + 3 options = 4.
    expect(sections[1].querySelectorAll('.filter-drawer__pill').length).toBe(4);

    // Section[2] = progressStatus pills: 1 "All" + 3 options = 4.
    expect(sections[2].querySelectorAll('.filter-drawer__pill').length).toBe(4);

    // Section[3] = accessType pills: 1 "All" + 5 options = 6.
    expect(sections[3].querySelectorAll('.filter-drawer__pill').length).toBe(6);
  });

  test('clicking a contentType pill calls onFilterChange with contentType set', () => {
    const onFilterChange = vi.fn();
    component = mount(LibraryFilterDrawer, {
      target: document.body,
      props: {
        open: true,
        filters: initialFilters,
        sort: 'recent',
        sortOptions,
        onOpenChange: () => {},
        onFilterChange,
        onSortChange: () => {},
        onClearAll: () => {},
      },
    });
    flushSync();

    const sections = document.querySelectorAll('.filter-drawer__section');
    const contentTypePills = sections[1].querySelectorAll<HTMLButtonElement>(
      '.filter-drawer__pill'
    );
    // [0]=All, [1]=video, [2]=audio, [3]=written.
    contentTypePills[1].click();
    flushSync();

    expect(onFilterChange).toHaveBeenCalledTimes(1);
    expect(onFilterChange).toHaveBeenCalledWith({
      ...initialFilters,
      contentType: 'video',
    });
  });

  test('clicking a progressStatus pill calls onFilterChange with progressStatus set', () => {
    const onFilterChange = vi.fn();
    component = mount(LibraryFilterDrawer, {
      target: document.body,
      props: {
        open: true,
        filters: initialFilters,
        sort: 'recent',
        sortOptions,
        onOpenChange: () => {},
        onFilterChange,
        onSortChange: () => {},
        onClearAll: () => {},
      },
    });
    flushSync();

    const sections = document.querySelectorAll('.filter-drawer__section');
    const progressPills = sections[2].querySelectorAll<HTMLButtonElement>(
      '.filter-drawer__pill'
    );
    // [0]=All, [1]=not_started, [2]=in_progress, [3]=completed.
    progressPills[2].click();
    flushSync();

    expect(onFilterChange).toHaveBeenCalledWith({
      ...initialFilters,
      progressStatus: 'in_progress',
    });
  });

  test('clicking an accessType pill calls onFilterChange with accessType set', () => {
    const onFilterChange = vi.fn();
    component = mount(LibraryFilterDrawer, {
      target: document.body,
      props: {
        open: true,
        filters: initialFilters,
        sort: 'recent',
        sortOptions,
        onOpenChange: () => {},
        onFilterChange,
        onSortChange: () => {},
        onClearAll: () => {},
      },
    });
    flushSync();

    const sections = document.querySelectorAll('.filter-drawer__section');
    const accessPills = sections[3].querySelectorAll<HTMLButtonElement>(
      '.filter-drawer__pill'
    );
    // [0]=All, [1]=purchased, [2]=subscription, [3]=membership, [4]=free, [5]=followers.
    accessPills[1].click();
    flushSync();

    expect(onFilterChange).toHaveBeenCalledWith({
      ...initialFilters,
      accessType: 'purchased',
    });
  });

  test('clicking "All" pill resets that facet to the ALL sentinel', () => {
    const onFilterChange = vi.fn();
    component = mount(LibraryFilterDrawer, {
      target: document.body,
      props: {
        open: true,
        filters: {
          contentType: 'video',
          progressStatus: 'in_progress',
          accessType: 'purchased',
        },
        sort: 'recent',
        sortOptions,
        onOpenChange: () => {},
        onFilterChange,
        onSortChange: () => {},
        onClearAll: () => {},
      },
    });
    flushSync();

    const sections = document.querySelectorAll('.filter-drawer__section');
    // contentType section's first pill is "All".
    const allPill = sections[1].querySelector<HTMLButtonElement>(
      '.filter-drawer__pill'
    );
    allPill?.click();
    flushSync();

    expect(onFilterChange).toHaveBeenCalledTimes(1);
    expect(onFilterChange).toHaveBeenCalledWith({
      contentType: 'all',
      progressStatus: 'in_progress',
      accessType: 'purchased',
    });
  });

  test('a facet whose current value is ALL marks the "All" pill is-active', () => {
    component = mount(LibraryFilterDrawer, {
      target: document.body,
      props: {
        open: true,
        filters: {
          contentType: 'all',
          progressStatus: 'in_progress',
          accessType: 'all',
        },
        sort: 'recent',
        sortOptions,
        onOpenChange: () => {},
        onFilterChange: () => {},
        onSortChange: () => {},
        onClearAll: () => {},
      },
    });
    flushSync();

    const sections = document.querySelectorAll('.filter-drawer__section');
    // contentType section — "All" pill (first) should be active.
    const contentTypeAll = sections[1].querySelector('.filter-drawer__pill');
    expect(contentTypeAll?.classList.contains('is-active')).toBe(true);

    // progressStatus section — "All" pill (first) NOT active; "in_progress"
    // (index 2) IS active.
    const progressPills = sections[2].querySelectorAll('.filter-drawer__pill');
    expect(progressPills[0].classList.contains('is-active')).toBe(false);
    expect(progressPills[2].classList.contains('is-active')).toBe(true);
  });

  test('activeCount forwards through to the shell header badge', () => {
    component = mount(LibraryFilterDrawer, {
      target: document.body,
      props: {
        open: true,
        filters: initialFilters,
        sort: 'recent',
        sortOptions,
        onOpenChange: () => {},
        onFilterChange: () => {},
        onSortChange: () => {},
        onClearAll: () => {},
        activeCount: 4,
      },
    });
    flushSync();

    const badge = document.querySelector('.filter-drawer__badge');
    expect(badge?.textContent?.trim()).toBe('4');
  });
});
