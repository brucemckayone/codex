import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  screen,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import FilterTriggerButton from './FilterTriggerButton.svelte';

/**
 * FilterTriggerButton unit tests.
 *
 * Verifies:
 *   • Icon always renders.
 *   • Count badge gated on activeCount > 0, with "9+" cap.
 *   • .filter-trigger--active class tracks isActive.
 *   • a11y: aria-haspopup="dialog", aria-expanded mirrors prop, aria-label.
 *   • onClick dispatched on click.
 */

describe('FilterTriggerButton', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders SlidersIcon (svg) regardless of activeCount', () => {
    component = mount(FilterTriggerButton, {
      target: document.body,
      props: {
        activeCount: 0,
        onClick: () => {},
        ariaLabel: 'Filters',
      },
    });

    const trigger = screen.getByTestId('filter-trigger');
    expect(trigger).toBeTruthy();
    expect(trigger?.querySelector('svg')).toBeTruthy();
  });

  test('no badge and no --active class when activeCount === 0', () => {
    component = mount(FilterTriggerButton, {
      target: document.body,
      props: {
        activeCount: 0,
        onClick: () => {},
        ariaLabel: 'Filters',
      },
    });

    const trigger = screen.getByTestId('filter-trigger') as HTMLButtonElement;
    expect(trigger.classList.contains('filter-trigger--active')).toBe(false);
    expect(trigger.querySelector('.filter-trigger__count')).toBeNull();
  });

  test('renders exact numeric badge for activeCount 1–9 and adds --active class', () => {
    for (const n of [1, 5, 9]) {
      component = mount(FilterTriggerButton, {
        target: document.body,
        props: {
          activeCount: n,
          onClick: () => {},
          ariaLabel: 'Filters',
        },
      });

      const trigger = screen.getByTestId('filter-trigger') as HTMLButtonElement;
      expect(trigger.classList.contains('filter-trigger--active')).toBe(true);
      const badge = trigger.querySelector('.filter-trigger__count');
      expect(badge?.textContent?.trim()).toBe(String(n));

      unmount(component);
      component = null;
      document.body.innerHTML = '';
    }
  });

  test('badge shows "9+" when activeCount exceeds 9', () => {
    component = mount(FilterTriggerButton, {
      target: document.body,
      props: {
        activeCount: 12,
        onClick: () => {},
        ariaLabel: 'Filters',
      },
    });

    const badge = document.querySelector('.filter-trigger__count');
    expect(badge?.textContent?.trim()).toBe('9+');
  });

  test('badge boundary: 10 → "9+", 9 → "9"', () => {
    component = mount(FilterTriggerButton, {
      target: document.body,
      props: {
        activeCount: 10,
        onClick: () => {},
        ariaLabel: 'Filters',
      },
    });
    expect(
      document.querySelector('.filter-trigger__count')?.textContent?.trim()
    ).toBe('9+');

    unmount(component);
    document.body.innerHTML = '';

    component = mount(FilterTriggerButton, {
      target: document.body,
      props: {
        activeCount: 9,
        onClick: () => {},
        ariaLabel: 'Filters',
      },
    });
    expect(
      document.querySelector('.filter-trigger__count')?.textContent?.trim()
    ).toBe('9');
  });

  test('exposes aria-haspopup="dialog" and aria-label', () => {
    component = mount(FilterTriggerButton, {
      target: document.body,
      props: {
        activeCount: 0,
        onClick: () => {},
        ariaLabel: 'Filters & Sort',
      },
    });

    const trigger = screen.getByTestId('filter-trigger') as HTMLButtonElement;
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.getAttribute('aria-label')).toBe('Filters & Sort');
  });

  test('aria-expanded mirrors the expanded prop', () => {
    component = mount(FilterTriggerButton, {
      target: document.body,
      props: {
        activeCount: 0,
        onClick: () => {},
        ariaLabel: 'Filters',
        expanded: false,
      },
    });

    expect(
      screen.getByTestId('filter-trigger')?.getAttribute('aria-expanded')
    ).toBe('false');

    unmount(component);
    document.body.innerHTML = '';

    component = mount(FilterTriggerButton, {
      target: document.body,
      props: {
        activeCount: 0,
        onClick: () => {},
        ariaLabel: 'Filters',
        expanded: true,
      },
    });

    expect(
      screen.getByTestId('filter-trigger')?.getAttribute('aria-expanded')
    ).toBe('true');
  });

  test('onClick fires on click', () => {
    const onClick = vi.fn();
    component = mount(FilterTriggerButton, {
      target: document.body,
      props: {
        activeCount: 3,
        onClick,
        ariaLabel: 'Filters',
      },
    });

    const trigger = screen.getByTestId('filter-trigger') as HTMLButtonElement;
    trigger.click();
    flushSync();

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('title attribute is forwarded when supplied', () => {
    component = mount(FilterTriggerButton, {
      target: document.body,
      props: {
        activeCount: 0,
        onClick: () => {},
        ariaLabel: 'Filters',
        title: 'Open filters',
      },
    });

    expect(
      screen.getByTestId('filter-trigger')?.getAttribute('title')
    ).toBe('Open filters');
  });
});
