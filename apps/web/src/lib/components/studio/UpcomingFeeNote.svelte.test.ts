/**
 * UpcomingFeeNote (Codex-2hxff.33 F5; batch C1 Part B page 1): which read it
 * makes, and what it shows for each state of that read. The words are
 * upcoming-fee-view's, tested there.
 *
 * The remote query answers with a fixed slot shaped like kit's `Query`. A
 * test of Try again takes the read as kit hands it (`kitQuery`): a failed
 * first read is dropped, so Try again hands the note a NEW query, still
 * loading (Codex-if444).
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
  /** Set by a Try again test: the read as kit hands it, in place of the slot. */
  kit: null as null | { get(): unknown },
}));

vi.mock('$lib/remote/billing.remote', () => ({
  getUpcomingFees: vi.fn(() => fees.kit?.get() ?? fees.slot),
}));

import { getUpcomingFees } from '$lib/remote/billing.remote';
import {
  type KitQuery,
  type KitRead,
  kitQuery,
} from './__fixtures__/kit-query.mock.svelte';
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
  fees.kit = null;
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

  test('Try again keeps focus while it reads: busy, never disabled (W6)', async () => {
    fees.slot.loading = false;
    fees.slot.error = { status: 500, body: { message: 'Internal Error' } };
    let land: () => void = () => {};
    fees.slot.refresh.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          land = resolve;
        })
    );
    render({ organizationId: ORG });
    const retry = failedLine()?.querySelector('button');
    retry?.focus();
    retry?.click();
    flushSync();
    expect(retry?.getAttribute('aria-busy')).toBe('true');
    expect(retry?.disabled).toBe(false);
    expect(document.activeElement).toBe(retry);
    // A second press while it reads asks nothing more.
    retry?.click();
    expect(fees.slot.refresh).toHaveBeenCalledTimes(1);
    land();
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

/**
 * Try again as kit runs it (Codex-if444). A failed first read is dropped, so
 * Try again hands the note a NEW query, still loading. The note used to
 * await the refreshed query's stray read while it held the new one: the line,
 * with the focused Try again inside it, unmounted for the round trip, and the
 * busy mark followed the stray read, not the answer.
 */
describe('Try again, as kit runs it', () => {
  let kit: KitQuery<UpcomingFeeChange[]>;

  const tryAgainButton = () =>
    failedLine()?.querySelector('button') as HTMLButtonElement | null;
  const checkedNone = () =>
    [...document.querySelectorAll('[role="status"]')].find(
      (node) => node.textContent?.trim() === m.fee_note_check_none()
    ) ?? null;
  /** Lets reads settle and Try again run on from them, focus moves included. */
  const settle = async () => {
    for (let turn = 0; turn < 3; turn++) {
      await new Promise((r) => setTimeout(r, 0));
    }
    flushSync();
  };

  function renderFailed() {
    kit = kitQuery<UpcomingFeeChange[]>();
    fees.kit = kit;
    render({ organizationId: ORG });
    kit.fail();
    flushSync();
  }

  /** Presses Try again; returns the refreshed query WRAPPED (it is thenable). */
  async function pressTryAgain(): Promise<{
    refreshed: KitRead<UpcomingFeeChange[]>;
  }> {
    const refreshed = kit.held();
    tryAgainButton()?.focus();
    tryAgainButton()?.click();
    await settle();
    expect(kit.refreshes(refreshed)).toBe(1);
    expect(kit.held()).not.toBe(refreshed);
    expect(kit.held().loading).toBe(true);
    return { refreshed };
  }

  test('keeps the line and its focused Try again, busy, while the new read loads', async () => {
    renderFailed();
    await pressTryAgain();

    expect(failedLine()?.textContent).toContain(m.fee_note_check_failed());
    expect(document.activeElement).toBe(tryAgainButton());
    expect(tryAgainButton()?.getAttribute('aria-busy')).toBe('true');
    expect(tryAgainButton()?.disabled).toBe(false);
  });

  test('a read that fails again keeps the line and puts focus on it, so it is read out again', async () => {
    renderFailed();
    const { refreshed } = await pressTryAgain();

    // The stray fetch's failure is not the answer: still busy.
    kit.fail(undefined, refreshed);
    await settle();
    expect(tryAgainButton()?.getAttribute('aria-busy')).toBe('true');

    kit.fail();
    await settle();
    expect(failedLine()?.textContent).toContain(m.fee_note_check_failed());
    expect(document.activeElement).toBe(failedLine());
    expect(tryAgainButton()?.getAttribute('aria-busy')).toBeNull();
  });

  test('a read that lands with a rise shows the note and moves focus to it', async () => {
    renderFailed();
    const { refreshed } = await pressTryAgain();

    kit.land([RISE]);
    await settle();

    // Judged on the held read: the stray fetch is still out.
    expect(refreshed.loading).toBe(true);
    expect(failedLine()).toBeNull();
    expect(note()?.getAttribute('role')).toBe('note');
    expect(document.activeElement).toBe(note());
  });

  test('a read that lands with nothing coming shows nothing (N12), and says so where focus goes', async () => {
    renderFailed();
    await pressTryAgain();

    kit.land([]);
    await settle();

    expect(failedLine()).toBeNull();
    expect(note()).toBeNull();
    expect(checkedNone()?.classList.contains('sr-only')).toBe(true);
    expect(document.activeElement).toBe(checkedNone());
  });

  /** Somewhere else on the page, for focus moved on during the read. */
  function elsewhere(): HTMLButtonElement {
    const button = document.createElement('button');
    button.textContent = 'Elsewhere';
    document.body.appendChild(button);
    return button;
  }
  /** The hidden line that says a Try again found nothing coming. */
  const noneLine = () =>
    document.querySelector<HTMLElement>('p.sr-only[role="status"]');
  /** The failed line's words, the node `{#key repeats}` re-inserts. */
  const failedWords = () =>
    [...(failedLine()?.childNodes ?? [])].find(
      (node) =>
        node.nodeType === Node.TEXT_NODE &&
        node.textContent?.includes(m.fee_note_check_failed())
    ) ?? null;

  test('the "nothing coming" line is in place before the answer, so its words are read out', async () => {
    renderFailed();
    const line = noneLine();
    expect(line).not.toBeNull();
    expect(line?.textContent?.trim()).toBe('');

    await pressTryAgain();
    kit.land([]);
    await settle();

    expect(noneLine()).toBe(line);
    expect(line?.textContent?.trim()).toBe(m.fee_note_check_none());
  });

  test('focus moved on during it stays put on a repeat failure, and the line is read out again', async () => {
    renderFailed();
    const outside = elsewhere();
    await pressTryAgain();
    const before = failedWords();

    outside.focus();
    kit.fail();
    await settle();

    expect(document.activeElement).toBe(outside);
    expect(failedWords()).not.toBeNull();
    expect(failedWords()).not.toBe(before);
  });

  test('focus moved on during it stays put when a rise lands', async () => {
    renderFailed();
    const outside = elsewhere();
    await pressTryAgain();

    outside.focus();
    kit.land([RISE]);
    await settle();

    expect(note()).not.toBeNull();
    expect(document.activeElement).toBe(outside);
  });

  test('focus moved on during it stays put when nothing is coming, and the hidden line says so', async () => {
    renderFailed();
    const outside = elsewhere();
    await pressTryAgain();

    outside.focus();
    kit.land([]);
    await settle();

    expect(note()).toBeNull();
    expect(noneLine()?.textContent?.trim()).toBe(m.fee_note_check_none());
    expect(document.activeElement).toBe(outside);
  });
});
