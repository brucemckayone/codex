/**
 * RevenueSplitPie unit tests.
 *
 * Verifies prop-driven rendering, keyboard nudge, numeric input clamping,
 * over-allocation warning, mode-driven anonymisation, and idempotent onChange.
 *
 * The bar is the POST-PLATFORM pool (Codex-2hxff.20 AGR-11): 100% is what's
 * left after Codex's fee, there is no fee slice, and the budget for the
 * slices is the whole 100%. These tests used to pass a 10% fee and assert
 * against a 90% budget, the defect itself.
 *
 * Pointer-drag and full axe sweeps run in Playwright (see e2e).
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
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

  test('renders one slice per provided slice, and no platform-fee slice', () => {
    component = mount(RevenueSplitPie, {
      target: document.body,
      props: {
        mode: 'owner',
        slices: makeSlices(),
      },
    });
    const slices = document.body.querySelectorAll('.revenue-split-pie__slice');
    expect(slices.length).toBe(2);
    expect(document.body.textContent).not.toContain('Platform fee');
  });

  test("says what the bar is: what is left after Codex's fee", () => {
    component = mount(RevenueSplitPie, {
      target: document.body,
      props: { mode: 'owner', slices: makeSlices(), readOnly: true },
    });
    expect(
      document.body.querySelector('.revenue-split-pie__basis')?.textContent
    ).toBe(m.agreement_split_basis());
  });

  test('a slice is drawn at its own share of the bar', () => {
    component = mount(RevenueSplitPie, {
      target: document.body,
      props: { mode: 'owner', slices: makeSlices(), readOnly: true },
    });
    const first = document.body.querySelector(
      '.revenue-split-pie__slice'
    ) as HTMLElement;
    // 30% of the pool is 30% of the bar (it used to start 10% in, after
    // the fee slice, and read as 30% of the whole sale).
    expect(first.getAttribute('style')).toContain('--slice-width: 30%');
  });

  test('renders one slider handle per slice', () => {
    component = mount(RevenueSplitPie, {
      target: document.body,
      props: {
        mode: 'owner',
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
    // Owner @ 2000bp, creator @ 5000bp → 3000bp headroom.
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
      props: { mode: 'owner', slices, onChange },
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
      props: { mode: 'owner', slices, onChange },
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
        percent: 6000,
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
    // 60 % + 40 % = 100 % of the pool. No room for "a" to grow.
    component = mount(RevenueSplitPie, {
      target: document.body,
      props: { mode: 'owner', slices, onChange },
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
    // 60 % + 60 % = 120 % of the pool → over by 20 %.
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
      props: { mode: 'owner', slices },
    });
    const root = document.body.querySelector('.revenue-split-pie');
    expect(root?.getAttribute('data-state')).toBe('over');
    const warning = document.body.querySelector('.revenue-split-pie__warning');
    expect(warning).toBeTruthy();
  });

  /** Two creators on the subscription pool, at `a` and `b` basis points. */
  function twoShares(a: number, b: number): RevenueSplitSlice[] {
    return [
      {
        id: 'maya',
        label: 'Maya',
        percent: a,
        color: 'var(--color-info-600)',
        locked: true,
        anonymous: false,
      },
      {
        id: 'tom',
        label: 'Tom',
        percent: b,
        color: 'var(--color-success-600)',
        locked: true,
        anonymous: false,
      },
    ];
  }
  const warningText = () =>
    document.body
      .querySelector('.revenue-split-pie__warning')
      ?.textContent?.replace(/\s+/g, ' ')
      .trim();

  test('60% + 35% = 95% of the pool is valid: no warning', () => {
    // Against the old 90% budget this was "Splits exceed available budget
    // by 5%".
    component = mount(RevenueSplitPie, {
      target: document.body,
      props: { mode: 'owner', slices: twoShares(6000, 3500), readOnly: true },
    });
    const root = document.body.querySelector('.revenue-split-pie');
    expect(root?.getAttribute('data-state')).toBe('under');
    expect(
      document.body.querySelector('.revenue-split-pie__warning')
    ).toBeNull();
  });

  test('exactly 100% of the pool is balanced, with no warning', () => {
    component = mount(RevenueSplitPie, {
      target: document.body,
      props: { mode: 'owner', slices: twoShares(6000, 4000), readOnly: true },
    });
    expect(
      document.body
        .querySelector('.revenue-split-pie')
        ?.getAttribute('data-state')
    ).toBe('balanced');
    expect(
      document.body.querySelector('.revenue-split-pie__warning')
    ).toBeNull();
  });

  test('a sum just past 100% never reads "0.0% more": the over figure rounds UP', () => {
    // 3334 × 3 = 10 002 bp. One decimal would print "100.0% …, 0.0% more".
    const third = (id: string) => ({
      id,
      label: id,
      percent: 3334,
      color: 'var(--color-info-600)',
      locked: true,
      anonymous: false,
    });
    component = mount(RevenueSplitPie, {
      target: document.body,
      props: {
        mode: 'owner',
        slices: [third('a'), third('b'), third('c')],
        readOnly: true,
        canAmend: false,
      },
    });
    expect(warningText()).toBe(
      m.agreement_split_over({ total: '100.1%', over: '0.1%' })
    );
  });

  test('the total moves with the rounded over figure, so the two agree', () => {
    // 6000 + 4015 = 10 015 bp: over 0.15% rounds up to 0.2%, total 100.2%.
    component = mount(RevenueSplitPie, {
      target: document.body,
      props: {
        mode: 'owner',
        slices: twoShares(6000, 4015),
        readOnly: true,
        canAmend: false,
      },
    });
    expect(warningText()).toBe(
      m.agreement_split_over({ total: '100.2%', over: '0.2%' })
    );
  });

  test('past 100%, the owner is told by how much, and to amend', () => {
    component = mount(RevenueSplitPie, {
      target: document.body,
      props: { mode: 'owner', slices: twoShares(6000, 4500), readOnly: true },
    });
    expect(warningText()).toBe(
      `${m.agreement_split_over({ total: '105%', over: '5%' })} ${m.agreement_split_over_amend()}`
    );
  });

  test('a viewer who cannot amend gets the first sentence only', () => {
    component = mount(RevenueSplitPie, {
      target: document.body,
      props: {
        mode: 'owner',
        slices: twoShares(6000, 4500),
        readOnly: true,
        canAmend: false,
      },
    });
    expect(warningText()).toBe(
      m.agreement_split_over({ total: '105%', over: '5%' })
    );
  });

  test('the creator page gets the first sentence only', () => {
    component = mount(RevenueSplitPie, {
      target: document.body,
      props: { mode: 'creator', slices: twoShares(6000, 4500), readOnly: true },
    });
    expect(warningText()).toBe(
      m.agreement_split_over({ total: '105%', over: '5%' })
    );
  });

  test('an aggregate peer slice is named from its count, never its label', () => {
    component = mount(RevenueSplitPie, {
      target: document.body,
      props: {
        mode: 'creator',
        readOnly: true,
        slices: [
          {
            id: '__me__',
            label: 'Your share',
            percent: 2500,
            color: 'var(--color-interactive)',
            locked: true,
            anonymous: false,
          },
          {
            id: '__peers__',
            label: 'Maya Okafor',
            percent: 3000,
            color: 'var(--color-info-600)',
            locked: true,
            anonymous: true,
            peerCount: 2,
          },
        ],
      },
    });
    const labels = Array.from(
      document.body.querySelectorAll('.revenue-split-pie__legend-label')
    ).map((el) => el.textContent?.trim());
    // It used to read "Other creator 2": a per-peer numbering that made two
    // people sound like one.
    expect(labels).toEqual(['Your share', 'Other creators (2)']);
    expect(document.body.textContent).not.toContain('Maya Okafor');
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
      props: { mode: 'creator', slices },
    });
    const labels = Array.from(
      document.body.querySelectorAll('.revenue-split-pie__legend-label')
    ).map((el) => el.textContent?.trim());
    expect(labels).toContain('Me');
    expect(labels).not.toContain('Hidden Peer');
    expect(labels).not.toContain('Other Hidden');
    // Anonymised replacements, numbered per peer slice from paraglide.
    expect(labels).toEqual([
      'Me',
      m.agreement_split_other_creator_numbered({ number: '2' }),
      m.agreement_split_other_creator_numbered({ number: '3' }),
    ]);
  });

  test('readOnly mode hides numeric inputs', () => {
    component = mount(RevenueSplitPie, {
      target: document.body,
      props: {
        mode: 'owner',
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
    // Owner=2000, creator=5000 → max for owner = 10000-5000 = 5000bp = 50%.
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
    // 95% requested, but only 50% available → clamps to 5000bp.
    expect(owner?.percent).toBe(5000);
  });

  test('onChange is idempotent when next value equals current', () => {
    const onChange = vi.fn();
    // 30 % + 70 % fills the pool.
    const slices = makeSlices().map((s) =>
      s.id === 'creator-1' ? { ...s, percent: 7000 } : s
    );
    component = mount(RevenueSplitPie, {
      target: document.body,
      props: {
        mode: 'owner',
        slices,
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
      props: { mode: 'owner', slices },
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
        slices: makeSlices(),
      },
    });
    const root = document.body.querySelector(
      '.revenue-split-pie'
    ) as HTMLElement;
    expect(root.className.includes('undefined')).toBe(false);
  });
});
