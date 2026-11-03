/**
 * /admin/queue?tab=moves: Queue › Price moves (Codex-2hxff.85, .86; batch C1
 * Part B page 6, M1-M11).
 *
 * - Only this tab's two reads load: the stopped changes and the held people.
 * - Retry and Restart are one request per click; the notice says when the
 *   run is, and the page re-reads once. Nothing re-checks by itself.
 * - A refusal says why, in the server's words.
 * - Close needs a reason and a note; it moves nobody.
 *
 * Mounts the real `+page.svelte`, cards, table and dialog; `$app/*` and the
 * remote module are the reactive doubles.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const navigation = vi.hoisted(() => ({
  goto: vi.fn(async (_url: string, _opts?: unknown) => {}),
  afterNavigate: vi.fn(),
}));
vi.mock('$app/navigation', () => navigation);
vi.mock(
  '$app/state',
  () => import('$lib/components/support/__fixtures__/app-state.mock.svelte')
);
vi.mock(
  '$lib/remote/support.remote',
  () =>
    import('$lib/components/support/__fixtures__/support-remote.mock.svelte')
);

import { setPage } from '$lib/components/support/__fixtures__/app-state.mock.svelte';
import {
  heldMove,
  JORDAN,
  list,
  stoppedChange,
} from '$lib/components/support/__fixtures__/support-fixtures';
import {
  closePriceMove,
  countsSlot,
  failure,
  heldMovesSlot,
  httpError,
  listFailedRefunds,
  listFeeNotices,
  listHeldPriceMoves,
  listStoppedPriceChanges,
  reset,
  restartPriceChange,
  retryPriceMove,
  stoppedChangesSlot,
} from '$lib/components/support/__fixtures__/support-remote.mock.svelte';
import QueuePage from '../+page.svelte';

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  reset();
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

function mountAt(href: string) {
  setPage(href);
  component = mount(QueuePage, { target: document.body });
  flushSync();
}

const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';
const notice = () =>
  document.querySelector<HTMLElement>('[data-testid="settle-notice"]');
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const answered = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  flushSync();
};
const rows = () => [
  ...document.querySelectorAll<HTMLElement>('[data-testid="price-move-row"]'),
];
const rowButtons = (row: HTMLElement) =>
  [...row.querySelectorAll<HTMLButtonElement>('button')].map((b) => ({
    label: b.textContent?.trim(),
    variant: b.getAttribute('data-variant'),
  }));

const OWEN = heldMove({
  moveId: '99999999-9999-4999-8999-999999999999',
  action: 'retry_move',
  subscriber: {
    userId: 'u-owen',
    name: 'Owen Clarke',
    deleted: false,
    email: 'owen@x.com',
  },
  heldReason: 'move_refused',
  noticeAt: '2026-10-30T14:02:00.000Z',
  effectiveAt: '2026-12-14T00:00:00.000Z',
});

function land(
  held = [heldMove(), OWEN],
  stopped: ReturnType<typeof stoppedChange>[] = []
) {
  stoppedChangesSlot().current = list(stopped);
  heldMovesSlot().current = list(held);
  flushSync();
}

describe('the tab', () => {
  test('only its two reads load, with its own intro', () => {
    mountAt('/admin/queue?tab=moves');
    expect(listStoppedPriceChanges).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
    });
    expect(listHeldPriceMoves).toHaveBeenCalledWith({ page: 1, limit: 20 });
    expect(listFailedRefunds).not.toHaveBeenCalled();
    expect(listFeeNotices).not.toHaveBeenCalled();
    expect(text()).toContain(m.support_queue_moves_intro());
  });

  test('M10 one list landed: still the skeleton', () => {
    mountAt('/admin/queue?tab=moves');
    heldMovesSlot().current = list([heldMove()]);
    flushSync();
    expect(
      document.querySelector('[data-testid="queue-loading"]')
    ).not.toBeNull();
  });

  test('M11 a failed list is the Queue error, never "No held price moves"', () => {
    mountAt('/admin/queue?tab=moves');
    stoppedChangesSlot().current = list([]);
    heldMovesSlot().error = httpError(500);
    flushSync();
    expect(
      document.querySelector('[data-testid="queue-error"]')
    ).not.toBeNull();
    expect(text()).not.toContain(m.support_queue_moves_empty_title());
  });

  test('M9 nobody held, nothing stopped: the empty state says what lands here', () => {
    mountAt('/admin/queue?tab=moves');
    land([], []);
    expect(text()).toContain(m.support_queue_moves_empty_title());
    expect(text()).toContain(m.support_queue_moves_empty_body());
  });

  test('M1 two actions, by kind; Close… is the quiet one', () => {
    mountAt('/admin/queue?tab=moves');
    land();
    expect(text()).toContain(
      m.support_queue_moves_subhead_held({ count: '2' })
    );
    const [leah, owen] = rows();
    expect(rowButtons(leah)).toEqual([
      { label: m.support_queue_moves_action_retry(), variant: 'secondary' },
      { label: m.support_queue_moves_action_close(), variant: 'ghost' },
    ]);
    expect(rowButtons(owen)).toEqual([
      {
        label: m.support_queue_moves_action_retry_move(),
        variant: 'secondary',
      },
      { label: m.support_queue_moves_action_close(), variant: 'ghost' },
    ]);
  });

  test('M2 a queued row waits for the run, with no buttons', () => {
    mountAt('/admin/queue?tab=moves');
    land([
      heldMove({
        status: 'queued',
        action: null,
        retry: { requestedAt: '2026-11-04T10:41:00.000Z', by: JORDAN },
        queuedFor: '2026-11-04T11:00:00.000Z',
      }),
    ]);
    const [row] = rows();
    expect(
      row.querySelector('[data-testid="price-move-queued"]')?.textContent
    ).toContain('Queued for 11:00 · Jordan Reid');
    expect(row.querySelectorAll('button')).toHaveLength(0);
  });

  test('M4 refused again after a retry: Close… first, Retry the quiet one', () => {
    mountAt('/admin/queue?tab=moves');
    land([
      heldMove({
        retry: { requestedAt: '2026-11-04T10:41:00.000Z', by: JORDAN },
      }),
    ]);
    expect(rowButtons(rows()[0])).toEqual([
      { label: m.support_queue_moves_action_close(), variant: 'secondary' },
      { label: m.support_queue_moves_action_retry(), variant: 'ghost' },
    ]);
  });

  test('a held row whose subscription ended has only Close…', () => {
    mountAt('/admin/queue?tab=moves');
    land([heldMove({ action: null, subscriptionEnded: true })]);
    expect(rowButtons(rows()[0])).toEqual([
      { label: m.support_queue_moves_action_close(), variant: 'secondary' },
    ]);
    expect(text()).toContain(m.support_queue_moves_why_ended());
  });
});

describe('Retry', () => {
  test('M2 one request; the notice says the run and when to come back; one re-read', async () => {
    retryPriceMove.mockResolvedValue({
      outcome: 'done',
      result: {
        move: { ...heldMove(), status: 'queued', action: null },
        nextRunAt: '2026-11-04T11:00:00.000Z',
      },
    });
    mountAt('/admin/queue?tab=moves');
    land();
    rows()[0]
      .querySelector<HTMLButtonElement>('[data-testid="price-move-retry"]')
      ?.click();
    await answered();
    expect(retryPriceMove).toHaveBeenCalledTimes(1);
    expect(retryPriceMove).toHaveBeenCalledWith({ moveId: heldMove().moveId });
    expect(notice()?.textContent).toContain(
      m.support_queue_moves_retried_lead({ name: 'Leah Ortiz', time: '11:00' })
    );
    expect(notice()?.textContent).toContain(
      m.support_queue_moves_retried({ time: '11:05' })
    );
    expect(heldMovesSlot().refresh).toHaveBeenCalledTimes(1);
    expect(stoppedChangesSlot().refresh).toHaveBeenCalledTimes(1);
    expect(countsSlot().refresh).toHaveBeenCalledTimes(1);
  });

  test('M6 nothing to retry: the reason, in en.json’s words (W4)', async () => {
    retryPriceMove.mockResolvedValue(
      failure({
        status: 409,
        code: 'CONFLICT',
        detailsCode: 'PRICE_MOVE_NOT_HELD',
        reason: 'superseded',
        supersededAt: '2026-11-04T10:30:00.000Z',
        message: 'Server words, not en.json.',
      })
    );
    mountAt('/admin/queue?tab=moves');
    land();
    rows()[0]
      .querySelector<HTMLButtonElement>('[data-testid="price-move-retry"]')
      ?.click();
    await answered();
    expect(notice()?.getAttribute('data-variant')).toBe('warning');
    expect(notice()?.textContent).toContain(
      m.support_queue_moves_nothing_to_retry({ name: 'Leah Ortiz' })
    );
    expect(notice()?.textContent).toContain(
      'A newer price for Pro replaced this one on 4 Nov at 10:30'
    );
    expect(notice()?.textContent).not.toContain('Server words');
    expect(heldMovesSlot().refresh).toHaveBeenCalledTimes(1);
  });

  test('a Retry that didn’t run changes nothing, so nothing re-reads', async () => {
    retryPriceMove.mockResolvedValue(failure({ status: 500 }));
    mountAt('/admin/queue?tab=moves');
    land();
    rows()[0]
      .querySelector<HTMLButtonElement>('[data-testid="price-move-retry"]')
      ?.click();
    await answered();
    expect(notice()?.textContent).toContain(
      m.support_queue_moves_action_failed()
    );
    expect(heldMovesSlot().refresh).not.toHaveBeenCalled();
  });
});

describe('Close', () => {
  const openClose = () => {
    rows()[0]
      .querySelector<HTMLButtonElement>('[data-testid="price-move-close"]')
      ?.click();
    flushSync();
  };
  const typeNote = (value: string) => {
    const area = document.querySelector<HTMLTextAreaElement>(
      '[role="dialog"] textarea'
    );
    if (!area) throw new Error('no note');
    area.value = value;
    area.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
  };

  test('M5 neither reason is chosen; pressing Close it without one sends nothing', async () => {
    mountAt('/admin/queue?tab=moves');
    land();
    openClose();
    expect(dialog()?.textContent).toContain(
      m.support_queue_moves_close_title({ name: 'Leah Ortiz' })
    );
    const radios = [
      ...document.querySelectorAll<HTMLInputElement>(
        '[role="dialog"] input[type="radio"]'
      ),
    ];
    expect(radios.map((r) => r.checked)).toEqual([false, false]);
    typeNote('Phoned Leah.');
    document
      .querySelector<HTMLButtonElement>('[data-testid="settle-submit"]')
      ?.click();
    await answered();
    expect(closePriceMove).not.toHaveBeenCalled();
    expect(
      document.querySelector('[data-testid="close-choice-missing"]')
        ?.textContent
    ).toContain(m.support_queue_moves_close_choose());
  });

  test('M5 a reason and a note: closed, and nobody moved', async () => {
    closePriceMove.mockResolvedValue({
      outcome: 'done',
      result: { ...heldMove(), status: 'closed', action: null },
    });
    mountAt('/admin/queue?tab=moves');
    land();
    openClose();
    const notNeeded = document.querySelector<HTMLInputElement>(
      '[data-testid="close-choice-not_needed"]'
    );
    notNeeded?.click();
    flushSync();
    typeNote('Leah cancelled Pro.');
    document
      .querySelector<HTMLButtonElement>('[data-testid="settle-submit"]')
      ?.click();
    await answered();
    expect(closePriceMove).toHaveBeenCalledWith({
      moveId: heldMove().moveId,
      body: { resolution: 'not_needed', note: 'Leah cancelled Pro.' },
    });
    expect(notice()?.textContent).toContain(
      m.support_queue_moves_closed_not_needed({ price: '£12.00/mo' })
    );
    expect(heldMovesSlot().refresh).toHaveBeenCalledTimes(1);
  });
});

describe('a stopped change', () => {
  test('M7 one card, with Restart; M8 Restart queues it for the run', async () => {
    restartPriceChange.mockResolvedValue({
      outcome: 'done',
      result: {
        change: stoppedChange({
          restart: {
            requestedAt: '2026-11-05T13:12:00.000Z',
            by: JORDAN,
            at: '2026-11-05T14:00:00.000Z',
          },
        }),
        nextRunAt: '2026-11-05T14:00:00.000Z',
      },
    });
    mountAt('/admin/queue?tab=moves');
    land([heldMove()], [stoppedChange()]);
    expect(text()).toContain(
      m.support_queue_moves_subhead_stopped({ count: '1' })
    );
    const card = document.querySelector('[data-testid="stopped-price-change"]');
    expect(card?.textContent).toContain(m.support_queue_moves_badge_stopped());
    expect(card?.textContent).toContain('e7f1c2a4');
    card
      ?.querySelector<HTMLButtonElement>('[data-testid="price-change-restart"]')
      ?.click();
    await answered();
    expect(restartPriceChange).toHaveBeenCalledTimes(1);
    expect(restartPriceChange).toHaveBeenCalledWith({
      changeId: stoppedChange().changeId,
    });
    expect(notice()?.textContent).toContain(
      m.support_queue_moves_restarted_lead()
    );
    expect(stoppedChangesSlot().refresh).toHaveBeenCalledTimes(1);
    expect(countsSlot().refresh).toHaveBeenCalledTimes(1);
  });

  test('M8 a restart already asked for: no Restart button, and when it restarts', () => {
    mountAt('/admin/queue?tab=moves');
    land(
      [],
      [
        stoppedChange({
          restart: {
            requestedAt: '2026-11-05T13:12:00.000Z',
            by: JORDAN,
            at: '2026-11-05T14:00:00.000Z',
          },
        }),
      ]
    );
    const card = document.querySelector('[data-testid="stopped-price-change"]');
    expect(
      card?.querySelector('[data-testid="price-change-restart"]')
    ).toBeNull();
    expect(card?.textContent).toContain('Restarts at 14:00');
  });
});
