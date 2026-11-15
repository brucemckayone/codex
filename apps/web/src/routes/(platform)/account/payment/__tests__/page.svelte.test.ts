/**
 * Account → Payments purchase history (Codex-2hxff.21, mockup C1).
 *
 * Content and course purchases share one list. A course row shows its
 * `courseTitle` with a small neutral "Course" badge beside it; a content row
 * is unchanged.
 *
 * Mounts the real `+page.svelte`; `$app/navigation`, `$app/state` and the
 * account remote module (it imports `$app/server`) are mocked. A Retry test
 * runs `invalidate` as kit does (`kitInvalidate`).
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  type KitInvalidate,
  kitInvalidate,
} from '$lib/components/studio/__fixtures__/kit-invalidate.mock.svelte';
import type { PurchaseListItem } from '$lib/types';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

// Not a `vi.fn`: a spy attaches handlers to the promises it returns.
const { nav } = vi.hoisted(() => ({
  nav: { invalidate: (_key: string): Promise<void> => Promise.resolve() },
}));
vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
  invalidate: (key: string) => nav.invalidate(key),
}));
vi.mock('$app/state', () => ({
  page: {
    get url() {
      return new URL('https://revelations.studio/account/payment');
    },
  },
}));
vi.mock('$lib/remote/account.remote', () => ({
  portalSessionForm: { method: 'POST', action: '?/portal', pending: 0 },
}));

import PaymentPage from '../+page.svelte';

const CONTENT: PurchaseListItem = {
  id: 'p1',
  customerId: 'ellie',
  createdAt: '2026-10-16T10:00:00.000Z',
  kind: 'content',
  contentId: 'c1',
  contentTitle: 'Kettlebell Foundations',
  courseId: null,
  courseTitle: null,
  amountCents: 1500,
  status: 'completed',
  disputedAt: null,
};
const COURSE: PurchaseListItem = {
  id: 'p2',
  customerId: 'ellie',
  createdAt: '2026-10-08T10:00:00.000Z',
  kind: 'course',
  contentId: null,
  contentTitle: null,
  courseId: 'k1',
  courseTitle: 'Mindful Running: Eight-Week Course',
  amountCents: 4900,
  status: 'completed',
  disputedAt: null,
};

let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

/** The load's data, a new object each time, as each run of the load is. */
function pageData(items: PurchaseListItem[], loadFailed = false) {
  return {
    purchases: {
      items,
      pagination: {
        page: 1,
        limit: 20,
        total: items.length,
        totalPages: 1,
      },
    },
    filters: { status: null },
    loadFailed,
  };
}

function mountPage(items: PurchaseListItem[], loadFailed = false) {
  component = mount(PaymentPage, {
    target: document.body,
    props: { data: pageData(items, loadFailed) } as never,
  });
  flushSync();
}

const contentCell = (row: Element) => row.querySelectorAll('td')[1];
const clean = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

describe('purchase history', () => {
  test('a course row shows its title with a Course badge; a content row is unchanged', () => {
    mountPage([CONTENT, COURSE]);

    const [contentRow, courseRow] = [...document.querySelectorAll('tbody tr')];

    const course = contentCell(courseRow);
    expect(clean(course.querySelector('.content-title'))).toBe(
      'Mindful Running: Eight-Week Course'
    );
    const badge = course.querySelector('.content-title-row .badge');
    expect(clean(badge)).toBe(m.account_payments_kind_course());
    expect(badge?.getAttribute('data-variant')).toBe('neutral');

    const content = contentCell(contentRow);
    expect(clean(content)).toBe('Kettlebell Foundations');
    expect(content.querySelector('.badge')).toBeNull();
    expect(content.querySelector('.content-title-row')).toBeNull();

    // The other columns are untouched: the course row's amount and status.
    expect(clean(courseRow)).toContain('£49.00');
    expect(clean(courseRow)).toContain(m.account_payments_status_complete());
  });
});

// A failed read is not "no purchases" (Codex-2hxff.22 WEB-05; owner decision
// 2026-10-26, the .45 pattern).
describe('purchase history: a failed read', () => {
  test('says it could not load them, with Retry, in place of the list and the empty state', () => {
    mountPage([], true);

    const alert = document.querySelector(
      '[data-testid="purchases-load-failed"]'
    );
    expect(clean(alert?.querySelector('.load-failed__message'))).toBe(
      m.account_payments_load_failed()
    );
    expect(clean(alert?.querySelector('button'))).toBe(
      m.money_setup_load_failed_retry()
    );
    expect(clean(document.body)).not.toContain(
      m.account_payments_none_history()
    );
    expect(document.querySelector('.filters')).toBeNull();
    expect(document.querySelector('table')).toBeNull();
  });

  test('a list that loaded empty still says no purchases yet', () => {
    mountPage([]);

    expect(
      document.querySelector('[data-testid="purchases-load-failed"]')
    ).toBeNull();
    expect(clean(document.body)).toContain(m.account_payments_none_history());
  });
});

/**
 * Retry reruns the load (`invalidate('account:purchases')`), and kit's
 * invalidate resolves late (after the page's live remote queries) or early
 * (overtaken, with the data unchanged). The page used to judge the Retry when
 * it resolved (Codex-if444): an overtaken one said "We still couldn't…" about
 * a reload that never ran, and a list that landed first unmounted the alert
 * with the focused Retry inside it, dropping focus to <body> until the other
 * queries settled. It is judged on the page's new data now (LoadFailedAlert).
 */
describe('purchase history: Retry, as kit runs invalidate', () => {
  let kit: KitInvalidate<ReturnType<typeof pageData>>;

  function mountFailed() {
    kit = kitInvalidate(pageData([], true));
    nav.invalidate = kit.invalidate;
    component = mount(PaymentPage, {
      target: document.body,
      props: kit.props as never,
    });
    flushSync();
  }

  const alert = () =>
    document.querySelector('[data-testid="purchases-load-failed"]');
  const retryButton = () =>
    alert()?.querySelector('button') as HTMLButtonElement | null;
  const message = () => clean(alert()?.querySelector('.load-failed__message'));
  const loadedStatus = () =>
    [...document.querySelectorAll('[role="status"]')].find(
      (node) => clean(node) === m.account_payments_load_retry_ok()
    ) ?? null;
  /** Lets the reload land and the Retry run on from it, focus included. */
  const settle = async () => {
    for (let turn = 0; turn < 3; turn++) {
      await new Promise((r) => setTimeout(r, 0));
    }
    flushSync();
  };

  /**
   * Presses Retry with focus on it. A press that `sends` reruns the purchases
   * load, by its key: a Retry that invalidated nothing would still pass the
   * tests below, as `kit.land` changes the data anyway.
   */
  async function pressRetry({ sends = true } = {}) {
    const before = kit.keys();
    retryButton()?.focus();
    retryButton()?.click();
    await settle();
    expect(kit.keys()).toEqual(
      sends ? [...before, 'account:purchases'] : before
    );
  }

  test('keeps the alert and the focused Retry while the load reruns; a second press sends nothing', async () => {
    mountFailed();
    await pressRetry();

    expect(clean(retryButton())).toBe(m.money_setup_load_failed_retrying());
    expect(alert()?.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(retryButton());

    await pressRetry({ sends: false });
  });

  test('a reload that fails again says "We still couldn\'t…" and focuses the alert', async () => {
    mountFailed();
    await pressRetry();

    kit.land(pageData([], true));
    await settle();

    expect(message()).toBe(m.account_payments_load_failed_again());
    expect(document.activeElement).toBe(document.querySelector('.load-failed'));
    expect(clean(retryButton())).toBe(m.money_setup_load_failed_retry());
  });

  test('a reload that loads shows the list and says so', async () => {
    mountFailed();
    await pressRetry();

    kit.land(pageData([CONTENT]));
    await settle();

    expect(alert()).toBeNull();
    expect(document.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(document.activeElement).toBe(loadedStatus());
  });

  test('a reload that loads an empty list says there are no purchases yet, and that it loaded', async () => {
    mountFailed();
    await pressRetry();

    kit.land(pageData([]));
    await settle();

    expect(alert()).toBeNull();
    expect(clean(document.body)).toContain(m.account_payments_none_history());
    expect(document.activeElement).toBe(loadedStatus());
  });

  test('a tab return while it runs is not its answer: another load reran, this one did not', async () => {
    mountFailed();
    await pressRetry();

    // The platform layout reruns on every tab return (`cache:versions`).
    kit.otherLoadReruns();
    await settle();
    expect(message()).toBe(m.account_payments_load_failed());
    expect(clean(retryButton())).toBe(m.money_setup_load_failed_retrying());

    kit.land(pageData([CONTENT]));
    await settle();
    expect(alert()).toBeNull();
    expect(document.activeElement).toBe(loadedStatus());
  });

  test('after an overtaken reload, a tab return says nothing: no "We still couldn\'t…" for a reload never run', async () => {
    mountFailed();
    await pressRetry();
    kit.overtake();
    await settle();

    kit.otherLoadReruns();
    await settle();
    expect(message()).toBe(m.account_payments_load_failed());
    expect(document.activeElement).toBe(retryButton());

    // Retry is offered again, and sends.
    await pressRetry();
  });

  test('a list that lands before the invalidate resolves ends the Retry then, with focus on the status line', async () => {
    mountFailed();
    await pressRetry();

    // Kit lands the data, then waits on the page's live remote queries.
    kit.landBeforeQueries(pageData([CONTENT]));
    await settle();
    expect(alert()).toBeNull();
    expect(document.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(loadedStatus());

    kit.queriesSettle();
    await settle();
    expect(loadedStatus()).not.toBeNull();
  });

  test('an overtaken reload claims nothing and offers Retry again; the run that lands later is announced', async () => {
    mountFailed();
    await pressRetry();

    // A filter click or another invalidate overtook it: the data is unchanged.
    kit.overtake();
    await settle();
    expect(message()).toBe(m.account_payments_load_failed());
    expect(clean(retryButton())).toBe(m.money_setup_load_failed_retry());
    expect(document.activeElement).toBe(retryButton());

    // The run that overtook it lands the list.
    kit.land(pageData([CONTENT]));
    await settle();
    expect(alert()).toBeNull();
    expect(document.activeElement).toBe(loadedStatus());
  });
});

// A chargeback leaves the row `completed` until the bank decides; a lost one
// refunds it and leaves `disputedAt` set (Codex-2hxff.60).
describe('purchase history: a payment dispute', () => {
  const DISPUTED_AT = '2026-10-20T09:00:00.000Z';
  const statusBadge = (row: Element) =>
    row.querySelectorAll('td')[3].querySelector('.badge');

  test('an open dispute on a completed payment shows a warning badge, "Payment dispute"', () => {
    mountPage([{ ...CONTENT, disputedAt: DISPUTED_AT }]);

    const badge = statusBadge(document.querySelector('tbody tr') as Element);
    expect(clean(badge)).toBe(m.account_payments_status_disputed());
    expect(badge?.getAttribute('data-variant')).toBe('warning');
  });

  test('a lost dispute, now refunded, shows "Refunded"', () => {
    mountPage([{ ...CONTENT, status: 'refunded', disputedAt: DISPUTED_AT }]);

    const badge = statusBadge(document.querySelector('tbody tr') as Element);
    expect(clean(badge)).toBe(m.account_payments_status_refunded());
    expect(badge?.getAttribute('data-variant')).toBe('neutral');
  });

  test('a completed payment with no dispute still shows "Complete"', () => {
    mountPage([CONTENT]);

    const badge = statusBadge(document.querySelector('tbody tr') as Element);
    expect(clean(badge)).toBe(m.account_payments_status_complete());
    expect(badge?.getAttribute('data-variant')).toBe('success');
  });
});
