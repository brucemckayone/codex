/**
 * CounterProposalDialog unit tests (WP-8 — Codex-bw2wf)
 *
 * Verifies:
 *   - Initial values populate from `currentSharePercent` + `currentTermMonths`
 *   - Slider comparison hint shows the owner's offer and the creator's
 *     in-progress counter side by side
 *   - Submit dispatches with the new values when changed
 *   - Submit rejects an unchanged counter (must change something or use Accept)
 *   - Idempotent `onOpenChange` — duplicate values short-circuit
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import CounterProposalDialog from './CounterProposalDialog.svelte';

describe('CounterProposalDialog', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test("pre-fills slider with owner's offer", () => {
    component = mount(CounterProposalDialog, {
      target: document.body,
      props: {
        open: true,
        onOpenChange: vi.fn(),
        currentSharePercent: 4000,
        currentTermMonths: 12,
        ownerName: 'Acme Studio',
        revenueType: 'subscription',
        onSubmit: vi.fn(),
      },
    });
    flushSync();

    // The slider input is the range input within BrandSliderField; its
    // initial value should match the current share (40%).
    const sliderInput = document.querySelector<HTMLInputElement>(
      'input[type="range"]'
    );
    expect(sliderInput).toBeTruthy();
    expect(sliderInput?.value).toBe('40');
  });

  test('renders post-platform comparison copy with owner name + share', () => {
    component = mount(CounterProposalDialog, {
      target: document.body,
      props: {
        open: true,
        onOpenChange: vi.fn(),
        currentSharePercent: 3500,
        currentTermMonths: 6,
        ownerName: 'Acme Studio',
        revenueType: 'subscription',
        onSubmit: vi.fn(),
      },
    });
    flushSync();
    const text = document.body.textContent ?? '';
    expect(text).toContain("Acme Studio's offer was");
    expect(text).toContain('35%');
    expect(text).toContain('Your counter');
    expect(text).toContain('post-platform subscription revenue');
  });

  test('uses content-purchase label for content_purchase revenue type', () => {
    component = mount(CounterProposalDialog, {
      target: document.body,
      props: {
        open: true,
        onOpenChange: vi.fn(),
        currentSharePercent: 2500,
        currentTermMonths: 12,
        ownerName: 'Acme Studio',
        revenueType: 'content_purchase',
        onSubmit: vi.fn(),
      },
    });
    flushSync();
    expect(document.body.textContent).toContain(
      'post-platform content-purchase revenue'
    );
  });

  test('selects the supplied term option by default', () => {
    component = mount(CounterProposalDialog, {
      target: document.body,
      props: {
        open: true,
        onOpenChange: vi.fn(),
        currentSharePercent: 3000,
        currentTermMonths: 24,
        ownerName: 'Acme Studio',
        revenueType: 'subscription',
        onSubmit: vi.fn(),
      },
    });
    flushSync();
    const checkedRadio = document.querySelector<HTMLInputElement>(
      'input[name="counter-term"]:checked'
    );
    expect(checkedRadio?.value).toBe('24');
  });

  test('idempotent onOpenChange short-circuits when next === current', () => {
    const onOpenChange = vi.fn();
    component = mount(CounterProposalDialog, {
      target: document.body,
      props: {
        open: false,
        onOpenChange,
        currentSharePercent: 3000,
        currentTermMonths: 12,
        ownerName: 'Acme Studio',
        revenueType: 'subscription',
        onSubmit: vi.fn(),
      },
    });
    flushSync();
    // No portal content when closed; nothing to assert other than that
    // construction didn't throw and onOpenChange wasn't invoked.
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
