import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  screen,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import ActiveFiltersStrip from './ActiveFiltersStrip.svelte';

/**
 * ActiveFiltersStrip unit tests.
 *
 * Verifies:
 *   • Renders nothing when chips array empty.
 *   • One button per chip with label text and accessible name.
 *   • Click dispatches onRemove with the chip object.
 *   • Trailing clear-all button visibility gated on chips.length ≥ 1 by
 *     default, or ≥ 2 with requireMultipleForClear.
 *   • Container has aria-live="polite".
 */

describe('ActiveFiltersStrip', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders nothing when chips is empty', () => {
    component = mount(ActiveFiltersStrip, {
      target: document.body,
      props: {
        chips: [],
        onRemove: () => {},
        onClearAll: () => {},
        clearAllLabel: 'Clear all',
      },
    });

    flushSync();
    expect(screen.getByTestId('active-filters-strip')).toBeNull();
  });

  test('renders one chip button per entry with its label', () => {
    component = mount(ActiveFiltersStrip, {
      target: document.body,
      props: {
        chips: [
          { key: 'type:video', label: 'Video' },
          { key: 'access:purchased', label: 'Purchased' },
        ],
        onRemove: () => {},
        onClearAll: () => {},
        clearAllLabel: 'Clear all',
      },
    });

    const strip = screen.getByTestId('active-filters-strip');
    expect(strip).toBeTruthy();

    const chips = strip!.querySelectorAll('.active-filters__chip');
    expect(chips.length).toBe(2);
    expect(chips[0].textContent).toContain('Video');
    expect(chips[1].textContent).toContain('Purchased');
  });

  test('per-chip click dispatches onRemove with the exact chip object', () => {
    const onRemove = vi.fn();
    const chips = [
      { key: 'type:video', label: 'Video' },
      { key: 'access:purchased', label: 'Purchased' },
    ];

    component = mount(ActiveFiltersStrip, {
      target: document.body,
      props: {
        chips,
        onRemove,
        onClearAll: () => {},
        clearAllLabel: 'Clear all',
      },
    });

    const buttons = document.querySelectorAll<HTMLButtonElement>(
      '.active-filters__chip'
    );
    buttons[1].click();
    flushSync();

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith(chips[1]);
  });

  test('clear-all rendered with verbatim label when chips.length ≥ 1', () => {
    component = mount(ActiveFiltersStrip, {
      target: document.body,
      props: {
        chips: [{ key: 'x', label: 'X' }],
        onRemove: () => {},
        onClearAll: () => {},
        clearAllLabel: 'Wipe everything',
      },
    });

    const clear = document.querySelector('.active-filters__clear');
    expect(clear).toBeTruthy();
    expect(clear?.textContent?.trim()).toBe('Wipe everything');
  });

  test('clear-all click dispatches onClearAll', () => {
    const onClearAll = vi.fn();
    component = mount(ActiveFiltersStrip, {
      target: document.body,
      props: {
        chips: [{ key: 'x', label: 'X' }],
        onRemove: () => {},
        onClearAll,
        clearAllLabel: 'Clear all',
      },
    });

    const clear = document.querySelector<HTMLButtonElement>(
      '.active-filters__clear'
    );
    clear?.click();
    flushSync();

    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  test('requireMultipleForClear=true → clear hidden at 1 chip, shown at 2', () => {
    component = mount(ActiveFiltersStrip, {
      target: document.body,
      props: {
        chips: [{ key: 'x', label: 'X' }],
        onRemove: () => {},
        onClearAll: () => {},
        clearAllLabel: 'Clear all',
        requireMultipleForClear: true,
      },
    });

    expect(document.querySelector('.active-filters__clear')).toBeNull();

    unmount(component);
    document.body.innerHTML = '';

    component = mount(ActiveFiltersStrip, {
      target: document.body,
      props: {
        chips: [
          { key: 'x', label: 'X' },
          { key: 'y', label: 'Y' },
        ],
        onRemove: () => {},
        onClearAll: () => {},
        clearAllLabel: 'Clear all',
        requireMultipleForClear: true,
      },
    });

    expect(document.querySelector('.active-filters__clear')).toBeTruthy();
  });

  test('container has aria-live="polite"', () => {
    component = mount(ActiveFiltersStrip, {
      target: document.body,
      props: {
        chips: [{ key: 'x', label: 'X' }],
        onRemove: () => {},
        onClearAll: () => {},
        clearAllLabel: 'Clear all',
      },
    });

    const strip = screen.getByTestId('active-filters-strip');
    expect(strip?.getAttribute('aria-live')).toBe('polite');
  });

  test('each chip has accessible "Remove filter" aria-label', () => {
    component = mount(ActiveFiltersStrip, {
      target: document.body,
      props: {
        chips: [{ key: 'type:video', label: 'Video' }],
        onRemove: () => {},
        onClearAll: () => {},
        clearAllLabel: 'Clear all',
      },
    });

    const chip = document.querySelector('.active-filters__chip');
    expect(chip?.getAttribute('aria-label')).toBe('Remove filter: Video');
  });
});
