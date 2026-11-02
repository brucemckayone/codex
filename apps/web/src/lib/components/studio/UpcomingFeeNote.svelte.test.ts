/**
 * UpcomingFeeNote (Codex-2hxff.33 F5; batch C1 Part B page 1): which read it
 * makes, and what it shows for each state of that read. The words are
 * upcoming-fee-view's, tested there.
 *
 * The remote query answers with a fixed slot shaped like kit's `Query`.
 */

import type { UpcomingFeeChange } from '@codex/purchase';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

interface Slot {
  current: unknown;
  loading: boolean;
  error: unknown;
  refresh: ReturnType<typeof vi.fn>;
}

const fees = vi.hoisted(() => ({
  slot: {
    current: undefined,
    loading: true,
    error: undefined,
    refresh: vi.fn(async () => {}),
  } as Slot,
}));

vi.mock('$lib/remote/billing.remote', () => ({
  getUpcomingFees: vi.fn(() => fees.slot),
}));

import { getUpcomingFees } from '$lib/remote/billing.remote';
import UpcomingFeeNote from './UpcomingFeeNote.svelte';

const ORG = '11111111-1111-4111-8111-111111111111';

const RISE: UpcomingFeeChange = {
  changeId: 'c1',
  kind: 'announce',
  scope: 'platform',
  effectiveFrom: '2026-12-05T00:00:00.000Z',
  earliestFrom: '2026-12-05T00:00:00.000Z',
  announcedAt: '2026-11-03T08:00:12.000Z',
  smallerToldAt: null,
  replaces: null,
  lines: [
    {
      organizationId: ORG,
      organizationName: 'Hollow Oak Films',
      as: 'owner',
      value: 'platformFeePercent',
      context: 'both',
      from: 1000,
      to: 1200,
      replaced: null,
      replacesFigure: null,
    },
  ],
};

let component: ReturnType<typeof mount> | null = null;

function render(props: { organizationId?: string } = {}) {
  component = mount(UpcomingFeeNote, { target: document.body, props });
  flushSync();
}

const note = () => document.querySelector('[data-testid="upcoming-fee-note"]');
const failedLine = () =>
  document.querySelector('[data-testid="upcoming-fee-check-failed"]');

beforeEach(() => {
  fees.slot = {
    current: undefined,
    loading: true,
    error: undefined,
    refresh: vi.fn(async () => {}),
  };
  vi.mocked(getUpcomingFees).mockClear();
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

describe('UpcomingFeeNote', () => {
  test('Billing and Payouts read the owner rows for their organisation', () => {
    render({ organizationId: ORG });
    expect(getUpcomingFees).toHaveBeenCalledWith({ organizationId: ORG });
  });

  test('Earnings reads the creator rows everywhere', () => {
    render();
    expect(getUpcomingFees).toHaveBeenCalledWith({});
  });

  test('N10 while the read runs, nothing shows: no placeholder', () => {
    render({ organizationId: ORG });
    expect(note()).toBeNull();
    expect(failedLine()).toBeNull();
  });

  test('N1 a rise that has a date: an information note, not a warning', () => {
    fees.slot.current = [RISE];
    fees.slot.loading = false;
    render({ organizationId: ORG });
    const shown = note();
    expect(shown?.getAttribute('role')).toBe('note');
    expect(shown?.getAttribute('data-variant')).toBe('info');
    expect(shown?.querySelector('.fee-note__lead')?.textContent).toBe(
      "From 5 December 2026, Codex's fee rises from 10% to 12% of each sale."
    );
    expect(shown?.querySelector('.fee-note__meta')?.textContent).toContain(
      'We emailed you about this on 3 November.'
    );
  });

  test('N7 a smaller rise strikes through the figure first told', () => {
    fees.slot.current = [
      {
        ...RISE,
        kind: 'smaller',
        smallerToldAt: '2026-11-06T08:00:00.000Z',
        lines: [{ ...RISE.lines[0], to: 1100, replaced: 1200 }],
      },
    ];
    fees.slot.loading = false;
    render({ organizationId: ORG });
    const meta = note()?.querySelector('.fee-note__meta');
    expect(meta?.querySelector('.fee-note__was')?.textContent).toBe('12%');
    expect(meta?.textContent).toBe(
      "That's less than the 12% we first told you about, and the date hasn't changed. We emailed you about it on 6 November."
    );
  });

  test('N8 a bigger rise says which rise it replaces', () => {
    fees.slot.current = [
      {
        ...RISE,
        changeId: 'c2',
        effectiveFrom: null,
        earliestFrom: '2026-12-07T00:00:00.000Z',
        announcedAt: '2026-11-06T08:00:00.000Z',
        replaces: { changeId: 'c1', announcedAt: '2026-11-03T08:00:12.000Z' },
        lines: [{ ...RISE.lines[0], to: 1400, replacesFigure: 1200 }],
      },
    ];
    fees.slot.loading = false;
    render({ organizationId: ORG });
    expect(note()?.querySelector('.fee-note__meta')?.textContent).toBe(
      "This replaces the rise to 12% we told you about on 3 November, so it has its own 30 days' notice. Sales before it keep today's fee. We emailed you about it on 6 November."
    );
  });

  test('N6 two changes: one line each', () => {
    fees.slot.current = [RISE, { ...RISE, changeId: 'c2' }];
    fees.slot.loading = false;
    render({ organizationId: ORG });
    expect(note()?.querySelectorAll('.fee-note__list li')).toHaveLength(2);
  });

  test('N12 nothing coming: the page is untouched', () => {
    fees.slot.current = [];
    fees.slot.loading = false;
    render({ organizationId: ORG });
    expect(note()).toBeNull();
    expect(failedLine()).toBeNull();
  });

  test('N11 a failed read is never "no change": one muted line with Try again', () => {
    fees.slot.loading = false;
    fees.slot.error = { status: 500, body: { message: 'Internal Error' } };
    render({ organizationId: ORG });
    expect(note()).toBeNull();
    const line = failedLine();
    expect(line?.getAttribute('role')).toBe('status');
    expect(line?.textContent).toContain(m.fee_note_check_failed());
    const retry = line?.querySelector('button');
    expect(retry?.textContent?.trim()).toBe(m.fee_note_try_again());
  });

  test('Try again reads once per press, and nothing re-reads by itself', async () => {
    fees.slot.loading = false;
    fees.slot.error = { status: 500, body: { message: 'Internal Error' } };
    render({ organizationId: ORG });
    expect(fees.slot.refresh).not.toHaveBeenCalled();
    failedLine()?.querySelector('button')?.click();
    await vi.waitFor(() => expect(fees.slot.refresh).toHaveBeenCalledTimes(1));
  });
});
