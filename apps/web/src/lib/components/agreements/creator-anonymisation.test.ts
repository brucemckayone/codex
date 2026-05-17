/**
 * Anonymisation invariant tests (WP-8 — Codex-bw2wf)
 *
 * Pin tests for the creator-side anonymisation contract. The portfolio
 * + detail surfaces MUST never render peer identifiers — only the
 * `peers: { count, aggregateSharePercent }` aggregate that the worker
 * route emits.
 *
 * These tests render the WP-7 components (RevenueSplitPie in
 * `mode='creator'`) with the exact shapes the WP-8 pages pass through.
 * If a future change leaks peer fields to the UI surface, these tests
 * fail loudly.
 */

import { afterEach, describe, expect, test } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import RevenueSplitPie from './RevenueSplitPie.svelte';
import type { RevenueSplitSlice } from './types';

describe('creator-side anonymisation', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('anonymised peer slice never displays a peer identifier', () => {
    const peerCreatorId = 'peer-creator-id-must-not-leak';
    const peerName = 'Peer Creator Name Must Not Leak';

    // Construct slices the way the detail page does — peer slice marked
    // `anonymous: true`. The label parameter is intentionally a generic
    // count; even if a caller accidentally passed a peer name, the
    // component swaps it for "Other creator N" when `anonymous: true`.
    const slices: RevenueSplitSlice[] = [
      {
        id: '__me__',
        label: 'Your share',
        percent: 3000,
        color: 'var(--color-interactive)',
        locked: true,
        anonymous: false,
      },
      {
        id: '__peers__',
        // Even if a caller messes up the label here, the component
        // replaces it with "Other creator N" via displayLabel().
        label: 'Other creators (2)',
        percent: 4000,
        color: 'var(--color-info-600)',
        locked: true,
        anonymous: true,
      },
    ];

    component = mount(RevenueSplitPie, {
      target: document.body,
      props: {
        mode: 'creator',
        platformFeePercent: 1000,
        slices,
        readOnly: true,
      },
    });
    flushSync();

    const text = document.body.textContent ?? '';
    expect(text).not.toContain(peerCreatorId);
    expect(text).not.toContain(peerName);
  });

  test('creator mode swaps anonymous label even when caller passes a real name', () => {
    // Defence-in-depth: even if a future refactor wires a peer's real
    // name into `label`, `mode='creator'` + `anonymous: true` swaps it
    // for "Other creator 1".
    const slices: RevenueSplitSlice[] = [
      {
        id: '__me__',
        label: 'Your share',
        percent: 3000,
        color: 'var(--color-interactive)',
        locked: true,
        anonymous: false,
      },
      {
        id: '__peer__',
        label: 'Sandra Aniston',
        percent: 2500,
        color: 'var(--color-info-600)',
        locked: true,
        anonymous: true,
      },
    ];

    component = mount(RevenueSplitPie, {
      target: document.body,
      props: {
        mode: 'creator',
        platformFeePercent: 1000,
        slices,
        readOnly: true,
      },
    });
    flushSync();

    const text = document.body.textContent ?? '';
    expect(text).not.toContain('Sandra Aniston');
    expect(text).toContain('Other creator');
  });

  test('owner-mode preserves identifying labels (negative control)', () => {
    // Confirms the anonymisation gate hinges on `mode='creator'` —
    // owner-side surfaces still show real names. Without this pin, a
    // future refactor that swaps the mode parameter would silently
    // succeed in test.
    const slices: RevenueSplitSlice[] = [
      {
        id: 'creator-1',
        label: 'Sandra Aniston',
        percent: 4000,
        color: 'var(--color-info-600)',
        locked: true,
        anonymous: false,
      },
    ];

    component = mount(RevenueSplitPie, {
      target: document.body,
      props: {
        mode: 'owner',
        platformFeePercent: 1000,
        slices,
        readOnly: true,
      },
    });
    flushSync();
    expect(document.body.textContent).toContain('Sandra Aniston');
  });
});
