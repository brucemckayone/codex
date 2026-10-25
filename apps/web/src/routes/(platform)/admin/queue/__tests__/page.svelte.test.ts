/**
 * /admin/queue (Codex-2hxff.28, mockup D1–D3).
 *
 * - The tab is the URL's `?tab=`: failed refunds by default, creator debts on
 *   `?tab=debts`. Only that list is asked for; the other loads on switching.
 * - A rejected list shows an error, never "No failed refunds".
 * - Settling refreshes the list and the counts.
 *
 * Mounts the real `+page.svelte`, tables and dialogs; `$app/*` and the remote
 * module are the reactive doubles.
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
  creatorDebt,
  failedRefund,
  list,
  NOW,
} from '$lib/components/support/__fixtures__/support-fixtures';
import {
  countsSlot,
  debtsSlot,
  failedSlot,
  httpError,
  listCreatorDebts,
  listFailedRefunds,
  reset,
  resolveFailedRefund,
} from '$lib/components/support/__fixtures__/support-remote.mock.svelte';
import QueuePage from '../+page.svelte';

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => reset());

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
const current = () =>
  [...document.querySelectorAll('a[aria-current="page"]')].map((a) =>
    a.textContent?.trim()
  );

describe('the tab', () => {
  test('failed refunds by default: only that list is asked for', () => {
    mountAt('/admin/queue');
    expect(current()[0]).toContain(m.support_queue_tab_failed());
    expect(listFailedRefunds).toHaveBeenCalledWith({ page: 1, limit: 20 });
    expect(listCreatorDebts).not.toHaveBeenCalled();
    expect(text()).toContain(m.support_queue_failed_intro());
  });

  test('?tab=debts: creator debts, and the failed list is not asked for', () => {
    mountAt('/admin/queue?tab=debts');
    expect(current()[0]).toContain(m.support_queue_tab_debts());
    expect(listCreatorDebts).toHaveBeenCalledWith({ page: 1, limit: 20 });
    expect(listFailedRefunds).not.toHaveBeenCalled();
  });

  test('switching the URL loads the other list', () => {
    mountAt('/admin/queue');
    expect(listCreatorDebts).not.toHaveBeenCalled();
    setPage('/admin/queue?tab=debts');
    flushSync();
    expect(listCreatorDebts).toHaveBeenCalledTimes(1);
    debtsSlot().current = list([creatorDebt()]);
    flushSync();
    expect(
      document.querySelectorAll('[data-testid="creator-debt-row"]')
    ).toHaveLength(1);
  });

  test('each tab carries its count once the counts land', () => {
    mountAt('/admin/queue');
    countsSlot().current = { failedRefunds: 2, creatorDebts: 3 };
    flushSync();
    const badges = [
      ...document.querySelectorAll('nav a [data-variant="warning"]'),
    ].map((b) => b.textContent);
    expect(badges).toEqual(['2', '3']);
  });
});

describe('the list', () => {
  test('a rejected list shows an error, not "No failed refunds"', () => {
    mountAt('/admin/queue');
    failedSlot().error = httpError(500, 'An unexpected error occurred');
    flushSync();
    expect(
      document.querySelector('[data-testid="queue-error"]')
    ).not.toBeNull();
    expect(text()).not.toContain(m.support_queue_failed_empty_title());
  });

  test('an empty queue says so', () => {
    mountAt('/admin/queue');
    failedSlot().current = list([]);
    flushSync();
    expect(text()).toContain(m.support_queue_failed_empty_title());
  });
});

describe('settling', () => {
  test('refreshes the list and the counts, and says what happened', async () => {
    resolveFailedRefund.mockResolvedValue({
      outcome: 'done',
      result: {
        refundId: failedRefund().refundId,
        resolution: 'refunded_elsewhere',
        resolvedAt: NOW.toISOString(),
        repaid: [],
        accessRestored: false,
      },
    });
    mountAt('/admin/queue');
    failedSlot().current = list([failedRefund()]);
    flushSync();

    [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[data-testid="failed-refund-row"] button'
      ),
    ]
      .find((b) => b.textContent?.includes(m.support_action_elsewhere()))
      ?.click();
    flushSync();
    document
      .querySelector<HTMLButtonElement>('[data-testid="settle-submit"]')
      ?.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    flushSync();

    expect(resolveFailedRefund).toHaveBeenCalledTimes(1);
    expect(failedSlot().refresh).toHaveBeenCalledTimes(1);
    expect(countsSlot().refresh).toHaveBeenCalledTimes(1);
    expect(
      document.querySelector('[data-testid="settle-notice"]')?.textContent
    ).toContain(m.support_settled_elsewhere({ buyer: 'Daniel Price' }));
  });
});
