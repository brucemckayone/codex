/**
 * Account → Payments purchase history (Codex-2hxff.21, mockup C1).
 *
 * Content and course purchases share one list. A course row shows its
 * `courseTitle` with a small neutral "Course" badge beside it; a content row
 * is unchanged.
 *
 * Mounts the real `+page.svelte`; `$app/navigation`, `$app/state` and the
 * account remote module (it imports `$app/server`) are mocked.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import type { PurchaseListItem } from '$lib/types';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
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

function mountPage(items: PurchaseListItem[]) {
  component = mount(PaymentPage, {
    target: document.body,
    props: {
      data: {
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
      },
    } as never,
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
