/**
 * RevenueSplitPie unit tests.
 *
 * Verifies prop-driven rendering, keyboard nudge, numeric input clamping,
 * over-allocation warning, mode-driven anonymisation, and idempotent onChange.
 *
 * Pointer-drag and full axe sweeps run in Playwright (see e2e).
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import RevenueSplitPie from './RevenueSplitPie.svelte';
import type { RevenueSplitSlice } from './types';

function makeSlices(): RevenueSplitSlice[] {
  return [
    {
      id: 'owner',
      label: 'Org owner',
      percent: 3000,
      color: 'var(--color-info-600)',
      locked: false,
      anonymous: false,
    },
    {
      id: 'creator-1',
      label: 'Alex Rivera',
      percent: 6000,
      color: 'var(--color-primary-500)',
      locked: false,
      anonymous: false,
    },
  ];
}

describe('RevenueSplitPie', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders platform fee slice + each provided slice', () => {
    component = mount(RevenueSplitPie, {
      target: document.body,
      props: {
        mode: 'owner',
        platformFeePercent: 1000,
        slices: makeSlices(),
      },
    });
    const slices = document.body.querySelectorAll('.revenue-split-pie__slice');
    // platform + 2 supplied
    expect(slices.length).toBe(3);
  });

  test('renders one slider handle per non-platform slice', () => {
    component = mount(RevenueSplitPie, {
      target: document.body,
      props: {
        mode: 'owner',
        platformFeePercent: 1000,
        slices: makeSlices(),
      },
    });
    const handles = document.body.querySelectorAll('[role="slider"]');
    expect(handles.length).toBe(2);
  });

  test('handle exposes correct aria-valuenow as percent', () => {
    component = mount(RevenueSplitPie, {
      target: document.body,
      props: {
        mode: 'owner',
        platformFeePercent: 1000,
        slices: makeSlices(),
      },
    });
    const handles = document.body.querySelectorAll('[role="slider"]');
    // First non-platform = owner @ 3000bp = 30
    expect(handles[0]?.getAttribute('aria-valuenow')).toBe('30');
    // Second = creator-1 @ 6000bp = 60
    expect(handles[1]?.getAttribute('aria-valuenow')).toBe('60');
  });

  test('ArrowRight nudges a slice by 100 basis points (1 %)', () => {
    const onChange = vi.fn();
    // Owner @ 2000bp, creator @ 5000bp, platform @ 1000bp → 2000bp headroom.
    const slices: RevenueSplitSlice[] = [
      {
        id: 'owner',
        label: 'Org owner',
        percent: 2000,
        color: 'var(--color-info-600)',
        locked: false,
        anonymous: false,
      },
      {
        id: 'creator-1',
        label: 'Alex Rivera',
        percent: 5000,
        color: 'var(--color-primary-500)',
        locked: false,
        anonymous: false,
      },
    ];
    component = mount(RevenueSplitPie, {
      target: document.body,
      props: {
        mode: 'owner',
        platformFeePercent: 1000,
        slices,
        onChange,
      },
    });
    const ownerHandle = document.body.querySelectorAll(
      '[role="slider"]'
    )[0] as HTMLElement;
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });
    ownerHandle.dispatchEvent(event);
    flushSync();
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as RevenueSplitSlice[];
    const owner = next.find((s) => s.id === 'owner');
    expect(owner?.percent).toBe(2100);
  });

  test('Shift+ArrowRight nudges by 1000 basis points (10 %)', () => {
    const onChange = vi.fn();
    const slices: RevenueSplitSlice[] = [
      {
        id: 'owner',
        label: 'Owner',
        percent: 2000,
        color: 'var(--color-info-600)',
        locked: false,
        anonymous: false,
      },
      {
        id: 'c1',
        label: 'C1',
        percent: 1000,
        color: 'var(--color-primary-500)',
        locked: false,
        anonymous: false,
      },
    ];
    component = mount(RevenueSplitPie, {
      target: document.body,
      props: { mode: 'owner', platformFeePercent: 1000, slices, onChange },
    });
    const ownerHandle = document.body.querySelectorAll(
      '[role="slider"]'
    )[0] as HTMLElement;
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    ownerHandle.dispatchEvent(event);
    flushSync();
    const owner = (onChange.mock.calls[0][0] as RevenueSplitSlice[]).find(
      (s) => s.id === 'owner'
    );
    expect(owner?.percent).toBe(3000);
  });

  test('ArrowLeft cannot drop below zero', () => {
    const onChange = vi.fn();
    const slices: RevenueSplitSlice[] = [
      {
        id: 'owner',
        label: 'Owner',
        percent: 0,
        color: 'var(--color-info-600)',
        locked: false,
        anonymous: false,
      },
    ];
    component = mount(RevenueSplitPie, {
      target: document.body,
      props: { mode: 'owner', platformFeePercent: 1000, slices, onChange },
    });
    const handle = document.body.querySelector(
      '[role="slider"]'
    ) as HTMLElement;
    handle.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true })
    );
    flushSync();
    // Already at zero — idempotent guard suppresses callback.
    expect(onChange).not.toHaveBeenCalled();
  });

  test('ArrowRight cannot exceed available budget', () => {
    const onChange = vi.fn();
    const slices: RevenueSplitSlice[] = [
      {
        id: 'a',
        label: 'A',
        percent: 5000,
        color: 'var(--color-primary-500)',
        locked: false,
        anonymous: false,
      },
      {
        id: 'b',
        label: 'B',
        percent: 4000,
        color: 'var(--color-info-600)',
        locked: false,
        anonymous: false,
      },
    ];
    // platform 10 % + 50 % + 40 % = 100 %. No room for "a" to grow.
    component = mount(RevenueSplitPie, {
      target: document.body,
      props: { mode: 'owner', platformFeePercent: 1000, slices, onChange },
    });
    const handle = document.body.querySelectorAll(
      '[role="slider"]'
    )[0] as HTMLElement;
    handle.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true })
    );
    flushSync();
    expect(onChange).not.toHaveBeenCalled();
  });

  test('warning state appears when slices over-allocate', () => {
    // 10 % platform + 60 % + 60 % = 130 % total → over by 30 %.
    const slices: RevenueSplitSlice[] = [
      {
        id: 'a',
        label: 'A',
        percent: 6000,
        color: 'var(--color-primary-500)',
        locked: false,
        anonymous: false,
      },
      {
        id: 'b',
        label: 'B',
        percent: 6000,
        color: 'var(--color-info-600)',
        locked: false,
        anonymous: false,
      },
    ];
    component = mount(RevenueSplitPie, {
      target: document.body,
      props: { mode: 'owner', platformFeePercent: 1000, slices },
    });
    const root = document.body.querySelector('.revenue-split-pie');
    expect(root?.getAttribute('data-state')).toBe('over');
    const warning = document.body.querySelector('.revenue-split-pie__warning');
    expect(warning).toBeTruthy();
  });

  test('creator mode anonymises peers but keeps the owning slice visible', () => {
    const slices: RevenueSplitSlice[] = [
      {
        id: 'me',
        label: 'Me',
        percent: 4000,
        color: 'var(--color-primary-500)',
        locked: false,
        anonymous: false,
      },
      {
        id: 'peer-1',
        label: 'Hidden Peer',
        percent: 3000,
        color: 'var(--color-info-600)',
        locked: false,
        anonymous: true,
      },
      {
        id: 'peer-2',
        label: 'Other Hidden',
        percent: 2000,
        color: 'var(--color-success-600)',
        locked: false,
        anonymous: true,
      },
    ];
    component = mount(RevenueSplitPie, {
      target: document.body,
      props: { mode: 'creator', platformFeePercent: 1000, slices },
    });
    const labels = Array.from(
      document.body.querySelectorAll('.revenue-split-pie__legend-label')
    ).map((el) => el.textContent?.trim());
    expect(labels).toContain('Me');
    expect(labels).not.toContain('Hidden Peer');
    expect(labels).not.toContain('Other Hidden');
    // Anonymised replacements present
    expect(labels.some((l) => l?.startsWith('Other creator'))).toBe(true);
  });

  test('readOnly mode hides numeric inputs', () => {
    component = mount(RevenueSplitPie, {
      target: document.body,
      props: {
        mode: 'owner',
        platformFeePercent: 1000,
        slices: makeSlices(),
        readOnly: true,
      },
    });
    const numericInputs = document.body.querySelectorAll(
      '.revenue-split-pie__legend-input input'
    );
    expect(numericInputs.length).toBe(0);
  });

  test('readOnly mode disables handle interactivity', () => {
    component = mount(RevenueSplitPie, {
      target: document.body,
      props: {
        mode: 'owner',
        platformFeePercent: 1000,
        slices: makeSlices(),
        readOnly: true,
      },
    });
    const handle = document.body.querySelector(
      '[role="slider"]'
    ) as HTMLElement;
    expect(handle.getAttribute('data-interactive')).toBe('false');
    expect(handle.getAttribute('tabindex')).toBe('-1');
  });

  test('numeric input dispatches onChange with clamped basis points', () => {
    const onChange = vi.fn();
    component = mount(RevenueSplitPie, {
      target: document.body,
      props: {
        mode: 'owner',
        platformFeePercent: 1000,
        slices: makeSlices(),
        onChange,
      },
    });
    const ownerInput = document.body.querySelectorAll(
      '.revenue-split-pie__legend-input input'
    )[0] as HTMLInputElement;
    ownerInput.value = '25';
    ownerInput.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(onChange).toHaveBeenCalledTimes(1);
    const owner = (onChange.mock.calls[0][0] as RevenueSplitSlice[]).find(
      (s) => s.id === 'owner'
    );
    expect(owner?.percent).toBe(2500);
  });

  test('numeric input over the budget is clamped to available max', () => {
    const onChange = vi.fn();
    // Owner=2000, creator=5000, platform=1000 → max for owner = 10000-1000-5000 = 4000bp = 40%.
    const slices: RevenueSplitSlice[] = [
      {
        id: 'owner',
        label: 'Org owner',
        percent: 2000,
        color: 'var(--color-info-600)',
        locked: false,
        anonymous: false,
      },
      {
        id: 'creator-1',
        label: 'Alex Rivera',
        percent: 5000,
        color: 'var(--color-primary-500)',
        locked: false,
        anonymous: false,
      },
    ];
    component = mount(RevenueSplitPie, {
      target: document.body,
      props: {
        mode: 'owner',
        platformFeePercent: 1000,
        slices,
        onChange,
      },
    });
    const ownerInput = document.body.querySelectorAll(
      '.revenue-split-pie__legend-input input'
    )[0] as HTMLInputElement;
    ownerInput.value = '95';
    ownerInput.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(onChange).toHaveBeenCalledTimes(1);
    const owner = (onChange.mock.calls[0][0] as RevenueSplitSlice[]).find(
      (s) => s.id === 'owner'
    );
    // 95% requested, but only 40% available → clamps to 4000bp.
    expect(owner?.percent).toBe(4000);
  });

  test('onChange is idempotent when next value equals current', () => {
    const onChange = vi.fn();
    component = mount(RevenueSplitPie, {
      target: document.body,
      props: {
        mode: 'owner',
        platformFeePercent: 1000,
        slices: makeSlices(),
        onChange,
      },
    });
    // Owner is at 30, hitting End jumps to its max (which is 30 because the rest fills available).
    const handle = document.body.querySelectorAll(
      '[role="slider"]'
    )[0] as HTMLElement;
    handle.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', cancelable: true })
    );
    flushSync();
    expect(onChange).not.toHaveBeenCalled();
  });

  test('locked slices render with pattern marker and no handle interactivity', () => {
    const slices: RevenueSplitSlice[] = [
      {
        id: 'fixed',
        label: 'System reserve',
        percent: 2000,
        color: 'var(--color-text-muted)',
        locked: true,
        anonymous: false,
      },
      {
        id: 'a',
        label: 'A',
        percent: 5000,
        color: 'var(--color-primary-500)',
        locked: false,
        anonymous: false,
      },
    ];
    component = mount(RevenueSplitPie, {
      target: document.body,
      props: { mode: 'owner', platformFeePercent: 1000, slices },
    });
    const handles = document.body.querySelectorAll('[role="slider"]');
    // First handle follows the locked 'fixed' slice — non-interactive.
    expect(handles[0]?.getAttribute('data-interactive')).toBe('false');
    expect(handles[1]?.getAttribute('data-interactive')).toBe('true');
  });

  test('forwards optional class to root', () => {
    component = mount(RevenueSplitPie, {
      target: document.body,
      props: {
        mode: 'owner',
        platformFeePercent: 1000,
        slices: makeSlices(),
        class: 'agreements-pie',
      },
    });
    const root = document.body.querySelector('.revenue-split-pie');
    expect(root?.classList.contains('agreements-pie')).toBe(true);
  });

  test('omitting class does NOT stringify undefined into class attribute (R13)', () => {
    component = mount(RevenueSplitPie, {
      target: document.body,
      props: {
        mode: 'owner',
        platformFeePercent: 1000,
        slices: makeSlices(),
      },
    });
    const root = document.body.querySelector(
      '.revenue-split-pie'
    ) as HTMLElement;
    expect(root.className.includes('undefined')).toBe(false);
  });
});
