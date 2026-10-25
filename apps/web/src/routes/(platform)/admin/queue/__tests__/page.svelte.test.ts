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
// The tabs are a list within the page: aria-current="true", not "page".
const current = () =>
  [...document.querySelectorAll('a[aria-current="true"]')].map((a) =>
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
    // Our own words, not the server's pasted into the sentence.
    expect(text()).toContain(m.support_try_again_soon());
    expect(text()).not.toContain('An unexpected error occurred');
  });

  test('a later page left empty goes back a page, never "nothing waiting"', () => {
    mountAt('/admin/queue?page=2');
    failedSlot(2).current = {
      items: [],
      pagination: { page: 2, limit: 20, total: 20, totalPages: 1 },
    };
    flushSync();
    expect(navigation.goto).toHaveBeenCalledWith('/admin/queue?page=1', {
      keepFocus: true,
      replaceState: true,
    });
    expect(text()).not.toContain(m.support_queue_failed_empty_title());
  });

  test('an empty queue says so', () => {
    mountAt('/admin/queue');
    failedSlot().current = list([]);
    flushSync();
    expect(text()).toContain(m.support_queue_failed_empty_title());
  });
});

/** Melt restores focus a tick and a millisecond after the dialog closes. */
const afterFocus = () => new Promise((resolve) => setTimeout(resolve, 20));
const rowButton = (label: string) =>
  [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[data-testid="failed-refund-row"] button'
    ),
  ].find((b) => b.textContent?.includes(label));

// Melt ignores a keydown whose target isn't an element: press it in the dialog.
const pressEscape = () =>
  document
    .querySelector('[role="dialog"]')
    ?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );

describe('the settle dialog', () => {
  test('Cancel puts focus back on the row’s button', async () => {
    mountAt('/admin/queue');
    failedSlot().current = list([failedRefund()]);
    flushSync();
    const button = rowButton(m.support_action_elsewhere());
    button?.focus();
    button?.click();
    flushSync();
    // A keyboard user moves to Cancel and presses it; it leaves with the dialog.
    const cancel = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((b) => b.textContent?.trim() === m.support_confirm_cancel());
    cancel?.focus();
    cancel?.click();
    flushSync();
    await afterFocus();
    expect(document.activeElement).toBe(button);
  });

  test('while its request runs, Escape and the close button do nothing', async () => {
    let answer: (value: unknown) => void = () => {};
    resolveFailedRefund.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }) as never
    );
    mountAt('/admin/queue');
    failedSlot().current = list([failedRefund()]);
    flushSync();
    rowButton(m.support_action_elsewhere())?.click();
    flushSync();
    document
      .querySelector<HTMLButtonElement>('[data-testid="settle-submit"]')
      ?.click();
    flushSync();

    pressEscape();
    flushSync();
    await afterFocus();
    expect(
      document.querySelector('[data-testid="settle-submit"]')
    ).not.toBeNull();
    expect(
      document.querySelector<HTMLButtonElement>(
        '[role="dialog"] [aria-label="Close"]'
      )?.disabled
    ).toBe(true);

    answer({ outcome: 'failed', status: 500, code: null, detailsCode: null });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    flushSync();
    // Idle again: Escape closes it.
    pressEscape();
    flushSync();
    await afterFocus();
    expect(document.querySelector('[data-testid="settle-submit"]')).toBeNull();
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
        accessNotRestoredReason: null,
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

    // The notice takes focus, so it is read out.
    await afterFocus();
    expect(document.activeElement).toBe(
      document.querySelector('[data-testid="settle-notice"]')
    );
  });
});
