/**
 * /admin/queue?tab=fees: Queue › Fee notices (Codex-2hxff.33 F4, F8; batch
 * C1 Part B page 5, F1-F10).
 *
 * - Only this tab's two reads load: the rises (cards) and the people.
 * - The skeleton shows until both land; either failing is the Queue error,
 *   never "No fee notices waiting".
 * - Told another way needs a note; done refreshes the lists and the counts;
 *   a failed save keeps the dialog and the note; a 409 closes it with why.
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
  feeChangeCard,
  feeNotice,
  JORDAN,
  list,
} from '$lib/components/support/__fixtures__/support-fixtures';
import {
  countsSlot,
  failure,
  feeChangesSlot,
  feeNoticesSlot,
  httpError,
  listFailedRefunds,
  listFeeChanges,
  listFeeNotices,
  listHeldPriceMoves,
  markToldAnotherWay,
  reset,
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
/** Melt restores focus a tick and a millisecond after the dialog closes. */
const afterFocus = () => new Promise((resolve) => setTimeout(resolve, 20));

function typeNote(value: string) {
  const area = document.querySelector<HTMLTextAreaElement>(
    '[role="dialog"] textarea'
  );
  if (!area) throw new Error('no note');
  area.value = value;
  area.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

/**
 * The last person on the list: marking them leaves nobody waiting, and the
 * next 08:00 UTC run dates the rise (never the mark: commerce delta4).
 */
const LAST_CARD = feeChangeCard({
  told: { byEmail: 411, anotherWay: 0 },
  waitingFor: 1,
  joiners: { total: 1, told: 1, waiting: 0 },
  earliestFrom: '2026-12-05T00:00:00.000Z',
});
const DATED_CARD = feeChangeCard({
  told: { byEmail: 411, anotherWay: 1 },
  waitingFor: 0,
  toldAnotherWay: [
    {
      person: feeNotice().person,
      by: JORDAN,
      at: '2026-11-04T10:42:00.000Z',
      note: 'Phoned.',
    },
  ],
  lastToldAt: '2026-11-04T10:42:00.000Z',
  effectiveFrom: '2026-12-05T00:00:00.000Z',
  earliestFrom: '2026-12-05T00:00:00.000Z',
});

function land(cards = [feeChangeCard()], notices = [feeNotice()]) {
  feeChangesSlot().current = list(cards);
  feeNoticesSlot().current = list(notices);
  flushSync();
}

function openMark() {
  document
    .querySelector<HTMLButtonElement>(
      '[data-testid="fee-notice-row"] [data-testid="fee-notice-mark"]'
    )
    ?.click();
  flushSync();
}

describe('the tab', () => {
  test('a rise’s card title is a level below the section heads, never beside them (W8)', () => {
    mountAt('/admin/queue?tab=fees');
    land([LAST_CARD], [feeNotice()]);
    const card = document.querySelector('.change-card');
    expect(card).not.toBeNull();
    expect(card?.querySelector('h3.change-card__title')).not.toBeNull();
    expect(card?.querySelector('h2')).toBeNull();
    // The rises have their own section head above them (C2-W3).
    const heads = [...document.querySelectorAll('h2, h3')].filter((h) =>
      h.matches('.queue-subhead, .change-card__title')
    );
    expect(heads.map((h) => h.tagName)).toEqual(['H2', 'H3', 'H2']);
    expect(heads[0].textContent?.trim()).toBe(
      m.support_queue_fees_subhead_rises({ count: '1' })
    );
  });

  test('only its two reads load, with its own intro', () => {
    mountAt('/admin/queue?tab=fees');
    expect(listFeeChanges).toHaveBeenCalledWith({ page: 1, limit: 20 });
    expect(listFeeNotices).toHaveBeenCalledWith({ page: 1, limit: 20 });
    expect(listFailedRefunds).not.toHaveBeenCalled();
    expect(listHeldPriceMoves).not.toHaveBeenCalled();
    expect(text()).toContain(m.support_queue_fees_intro());
    expect(
      document.querySelector('a[aria-current="true"]')?.textContent
    ).toContain(m.support_queue_tab_fees());
  });

  test('F9 the people landed but not the rises: still the skeleton', () => {
    mountAt('/admin/queue?tab=fees');
    feeNoticesSlot().current = list([feeNotice()]);
    flushSync();
    expect(
      document.querySelector('[data-testid="queue-loading"]')
    ).not.toBeNull();
    expect(document.querySelector('[data-testid="fee-notice-row"]')).toBeNull();
  });

  test('F10 the rises failed: the Queue error, never "No fee notices waiting"', () => {
    mountAt('/admin/queue?tab=fees');
    feeNoticesSlot().current = list([]);
    feeChangesSlot().error = httpError(500, 'An unexpected error occurred');
    flushSync();
    expect(
      document.querySelector('[data-testid="queue-error"]')
    ).not.toBeNull();
    expect(text()).not.toContain(m.support_queue_fees_empty_title());
    [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[data-testid="queue-error"] button'
      ),
    ]
      .find((b) => b.textContent?.includes(m.support_try_again()))
      ?.click();
    expect(feeChangesSlot().refresh).toHaveBeenCalledTimes(1);
    expect(feeNoticesSlot().refresh).not.toHaveBeenCalled();
  });

  test('F1 a card per rise, then the people not told', () => {
    mountAt('/admin/queue?tab=fees');
    land(
      [feeChangeCard()],
      [
        feeNotice(),
        feeNotice({
          noticeId: '88888888-8888-4888-8888-888888888888',
          person: {
            userId: 'u-ruth',
            name: 'Ruth Calder',
            deleted: false,
            email: 'ruth@n.studio',
          },
          state: 'unknown',
          reason: 'unknown',
        }),
      ]
    );
    const card = document.querySelector('[data-testid="fee-change-card"]');
    expect(card?.textContent).toContain("Codex's fee: 10% → 12% of each sale");
    expect(card?.textContent).toContain('Waiting for 2');
    expect(text()).toContain(m.support_queue_fees_subhead({ count: '2' }));
    expect(
      document.querySelectorAll('[data-testid="fee-notice-row"]')
    ).toHaveLength(2);
    expect(
      document.querySelector('[data-testid="fee-notice-joined"]')
    ).toBeNull();
  });

  test('F7 a joiner is tagged "Joined later"', () => {
    mountAt('/admin/queue?tab=fees');
    land([DATED_CARD], [feeNotice({ onList: false })]);
    expect(
      document.querySelector(
        '[data-testid="fee-notice-row"] [data-testid="fee-notice-joined"]'
      )?.textContent
    ).toBe(m.support_queue_fees_joined_later());
  });

  test('F7 a joiner says when they joined', () => {
    mountAt('/admin/queue?tab=fees');
    land(
      [DATED_CARD],
      [feeNotice({ onList: false, joinedAt: '2026-11-12T09:30:00.000Z' })]
    );
    expect(
      document.querySelector('[data-testid="fee-notice-row"]')?.textContent
    ).toContain("joined 12 Nov, so this doesn't hold the date");
  });

  test('F2 the card counts the emails by day', () => {
    mountAt('/admin/queue?tab=fees');
    land([
      feeChangeCard({
        told: { byEmail: 411, anotherWay: 0 },
        toldByDay: [
          { londonDate: '2026-11-03', byEmail: 410, anotherWay: 0 },
          { londonDate: '2026-11-04', byEmail: 1, anotherWay: 0 },
        ],
        waitingFor: 1,
      }),
    ]);
    expect(
      document
        .querySelector('[data-testid="fee-change-card"]')
        ?.textContent?.replace(/\s+/g, ' ')
    ).toContain('411 of 412 410 by email on 3 Nov, 1 by email on 4 Nov');
  });

  test('F8 a dated rise with nobody waiting: the card stays, the list says so', () => {
    mountAt('/admin/queue?tab=fees');
    land([DATED_CARD], []);
    expect(
      document.querySelector('[data-testid="fee-change-card"]')
    ).not.toBeNull();
    expect(text()).toContain(m.support_queue_fees_subhead({ count: '0' }));
    expect(text()).toContain(m.support_queue_fees_empty_rise_title());
    expect(text()).toContain(
      m.support_queue_fees_empty_rise_body({ date: '5 December' })
    );
  });

  test('F8 no rise waiting at all', () => {
    mountAt('/admin/queue?tab=fees');
    land([], []);
    expect(text()).toContain(m.support_queue_fees_empty_title());
    expect(text()).not.toContain(m.support_queue_fees_subhead({ count: '0' }));
  });
});

describe('told another way', () => {
  test('F3 the note is required: an empty one sends nothing', async () => {
    mountAt('/admin/queue?tab=fees');
    land([LAST_CARD], [feeNotice()]);
    openMark();
    expect(dialog()?.textContent).toContain(
      m.support_queue_fees_mark_title({ name: 'Jonah Reyes' })
    );
    expect(dialog()?.textContent).toContain('5 December 2026');
    document
      .querySelector<HTMLButtonElement>('[data-testid="settle-submit"]')
      ?.click();
    await answered();
    expect(markToldAnotherWay).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain(m.support_note_missing());
  });

  test('F4 marked the last one: the notice says the next 08:00 UTC run sets the date; the lists and the counts re-read once', async () => {
    markToldAnotherWay.mockResolvedValue({
      outcome: 'done',
      result: {
        notice: {
          noticeId: feeNotice().noticeId,
          state: 'told_another_way',
          toldAt: '2026-11-04T10:42:00.000Z',
          toldBy: 'user-jordan',
          note: 'Phoned Jonah.',
        },
        change: {
          changeId: LAST_CARD.changeId,
          effectiveFrom: null,
          waitingFor: 0,
        },
      },
    });
    mountAt('/admin/queue?tab=fees');
    land([LAST_CARD], [feeNotice()]);
    openMark();
    typeNote('  Phoned Jonah.  ');
    document
      .querySelector<HTMLButtonElement>('[data-testid="settle-submit"]')
      ?.click();
    await answered();
    expect(markToldAnotherWay).toHaveBeenCalledWith({
      noticeId: feeNotice().noticeId,
      body: { note: 'Phoned Jonah.' },
    });
    expect(notice()?.textContent).toContain(
      m.support_queue_fees_marked_lead({ name: 'Jonah Reyes' })
    );
    expect(notice()?.textContent).toContain(
      m.support_queue_fees_marked_dated_next_run()
    );
    expect(feeChangesSlot().refresh).toHaveBeenCalledTimes(1);
    expect(feeNoticesSlot().refresh).toHaveBeenCalledTimes(1);
    expect(countsSlot().refresh).toHaveBeenCalledTimes(1);
    // The notice takes focus, so it is read out (W2).
    await afterFocus();
    expect(document.activeElement).toBe(notice());
  });

  test('"from now" is when the dialog opens, not when the page loaded (W2)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-04T09:00:00.000Z'));
      mountAt('/admin/queue?tab=fees');
      land([LAST_CARD], [feeNotice()]);
      vi.setSystemTime(new Date('2026-11-04T10:42:00.000Z'));
      openMark();
      expect(dialog()?.textContent).toContain('10:42');
      expect(dialog()?.textContent).not.toContain('09:00');
    } finally {
      vi.useRealTimers();
    }
  });

  test('Cancel puts focus back on the row’s button (W2)', async () => {
    mountAt('/admin/queue?tab=fees');
    land([LAST_CARD], [feeNotice()]);
    const mark = document.querySelector<HTMLButtonElement>(
      '[data-testid="fee-notice-row"] [data-testid="fee-notice-mark"]'
    );
    mark?.focus();
    openMark();
    const cancel = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((b) => b.textContent?.trim() === m.support_confirm_cancel());
    cancel?.focus();
    cancel?.click();
    flushSync();
    await afterFocus();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(mark);
  });

  test('F5 the save failed: the dialog stays, with the note, and says nothing changed', async () => {
    markToldAnotherWay.mockResolvedValue(failure({ status: 500 }));
    mountAt('/admin/queue?tab=fees');
    land([LAST_CARD], [feeNotice()]);
    openMark();
    typeNote('Phoned Jonah.');
    document
      .querySelector<HTMLButtonElement>('[data-testid="settle-submit"]')
      ?.click();
    await answered();
    expect(dialog()).not.toBeNull();
    expect(
      dialog()?.querySelector('[data-testid="settle-problem"]')?.textContent
    ).toContain(m.support_queue_fees_mark_failed_lead());
    expect(dialog()?.querySelector('textarea')?.value).toBe('Phoned Jonah.');
    expect(
      document.querySelector('[data-testid="settle-submit"]')?.textContent
    ).toContain(m.support_queue_fees_try_again());
    expect(feeNoticesSlot().refresh).not.toHaveBeenCalled();
  });

  test('F6 nothing to mark: the dialog closes, the notice says why, the list re-reads', async () => {
    markToldAnotherWay.mockResolvedValue(
      failure({
        status: 409,
        code: 'CONFLICT',
        detailsCode: 'FEE_CHANGE_NOT_WAITING',
        message:
          'Nothing to mark: this fee rise has started, or was cancelled or replaced.',
        voidReason: 'cancelled',
        voidedAt: '2026-11-04T10:40:00.000Z',
      })
    );
    mountAt('/admin/queue?tab=fees');
    land([LAST_CARD], [feeNotice()]);
    openMark();
    typeNote('Phoned Jonah.');
    document
      .querySelector<HTMLButtonElement>('[data-testid="settle-submit"]')
      ?.click();
    await answered();
    expect(dialog()).toBeNull();
    expect(notice()?.getAttribute('data-variant')).toBe('warning');
    expect(notice()?.textContent).toContain(
      m.support_queue_fees_refused_cancelled_lead({ time: '10:40' })
    );
    expect(feeNoticesSlot().refresh).toHaveBeenCalledTimes(1);
  });

  test('F6 already marked by someone else: the notice names them', async () => {
    markToldAnotherWay.mockResolvedValue(
      failure({
        status: 409,
        code: 'CONFLICT',
        detailsCode: 'FEE_NOTICE_ALREADY_TOLD',
        message: 'This person has already been told.',
        state: 'told_another_way',
        toldAt: '2026-11-04T10:41:00.000Z',
        toldByName: 'Sam Ortiz',
      })
    );
    mountAt('/admin/queue?tab=fees');
    land([LAST_CARD], [feeNotice()]);
    openMark();
    typeNote('Phoned Jonah.');
    document
      .querySelector<HTMLButtonElement>('[data-testid="settle-submit"]')
      ?.click();
    await answered();
    expect(dialog()).toBeNull();
    expect(notice()?.textContent).toContain(
      'Jonah was already marked as told by Sam Ortiz at 10:41.'
    );
  });
});
