/**
 * Creator Studio → Sales (Codex-2hxff.21, mockup B1–B2).
 *
 * The solo creator's own orgless sales: populated (KPIs, the ledger table,
 * one block per sale for phones, pagination, Export CSV) and first run (zero
 * KPIs, the filters, "No sales yet" with Publish content / Set up payouts and
 * no Export CSV). A stream that failed resolves to `null` and must render an
 * error, never the empty state.
 *
 * Mounts the real `+page.svelte` with the streamed promises the server load
 * returns; only `$app/navigation` and `$app/state` are mocked.
 */

import type { SaleListItem, SalesStats } from '@codex/purchase';
import type { PaginatedListResponse } from '@codex/shared-types';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const navigation = vi.hoisted(() => ({
  goto: vi.fn(async (_url: string, _opts?: unknown) => {}),
  invalidate: vi.fn(async (_dep: string) => {}),
}));
vi.mock('$app/navigation', () => navigation);
vi.mock('$app/state', () => ({
  page: {
    get url() {
      return new URL('https://creators.revelations.studio/studio/sales');
    },
  },
}));

import SalesPage from '../+page.svelte';

type SalesList = PaginatedListResponse<SaleListItem>;

function sale(overrides: Partial<SaleListItem>): SaleListItem {
  return {
    id: 'sale',
    purchasedAt: '2026-10-20T10:00:00.000Z',
    createdAt: '2026-10-20T10:00:00.000Z',
    customerId: 'cust',
    customerName: 'Maya Lindqvist',
    customerEmail: 'maya.lindqvist@example.com',
    contentId: 'content',
    contentTitle: 'Breathwork for Deep Sleep',
    contentSlug: 'breathwork-for-deep-sleep',
    amountPaidCents: 1200,
    currency: 'gbp',
    status: 'completed',
    platformFeeCents: 120,
    organizationFeeCents: 0,
    creatorPayoutCents: 1080,
    refundedAt: null,
    refundAmountCents: null,
    refundReason: null,
    disputedAt: null,
    disputeReason: null,
    stripePaymentIntentId: 'pi_1',
    ...overrides,
  };
}

const MAYA = sale({ id: 's1' });
const HANNAH = sale({
  id: 's2',
  customerName: 'Hannah Reid',
  customerEmail: 'hannah.reid@example.com',
  contentTitle: 'Restorative Yoga: Full Series',
  contentSlug: 'restorative-yoga',
  amountPaidCents: 2400,
  creatorPayoutCents: 2160,
  status: 'refunded',
  refundAmountCents: 2400,
});
const SAM = sale({
  id: 's3',
  customerName: null,
  customerEmail: 'sam.k@example.com',
  status: 'pending',
});

const STATS: SalesStats = {
  grossCents: 81300,
  netCents: 69900,
  refundedCents: 3600,
  count: 43,
  currency: 'gbp',
};
const ZERO: SalesStats = {
  grossCents: 0,
  netCents: 0,
  refundedCents: 0,
  count: 0,
  currency: 'gbp',
};

function list(items: SaleListItem[], total = items.length): SalesList {
  return {
    items,
    pagination: {
      page: 1,
      limit: 20,
      total,
      totalPages: Math.max(1, Math.ceil(total / 20)),
    },
  };
}

type Filters = {
  page: number;
  range: '7' | '30' | '90' | 'all';
  status: 'all' | 'completed' | 'refunded' | 'disputed' | 'failed' | 'pending';
};

let component: ReturnType<typeof mount> | null = null;

function mountPage(
  sales: Promise<SalesList | null>,
  stats: Promise<SalesStats | null>,
  filters: Filters = { page: 1, range: '30', status: 'all' }
) {
  component = mount(SalesPage, {
    target: document.body,
    props: {
      data: {
        filters,
        sales,
        stats,
        creator: {
          id: 'rowan',
          name: 'Rowan Ellis',
          username: 'rowan',
          avatarUrl: null,
        },
      },
    } as never,
  });
  flushSync();
}

const clean = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

const kpiValues = () =>
  [...document.querySelectorAll('.kpi-card')].map((card) => [
    clean(card.querySelector('.kpi-card__label')),
    clean(card.querySelector('.kpi-card__value')),
  ]);

const exportButton = () =>
  [...document.querySelectorAll('button')].find(
    (b) => clean(b) === m.sales_export_csv()
  );

beforeEach(() => {
  navigation.goto.mockClear();
  navigation.invalidate.mockClear();
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

describe('populated (B1)', () => {
  test('KPIs, the table, the phone blocks, pagination and Export CSV', async () => {
    mountPage(
      Promise.resolve(list([MAYA, HANNAH, SAM], 47)),
      Promise.resolve(STATS)
    );

    expect(clean(document.querySelector('h1'))).toBe(m.sales_title());
    expect(clean(document.body)).toContain(m.studio_section_money());
    expect(clean(document.body)).toContain(m.sales_personal_description());

    await vi.waitFor(() =>
      expect(document.querySelectorAll('tbody tr')).toHaveLength(3)
    );
    expect(kpiValues()).toEqual([
      [m.sales_kpi_gross(), '£813'],
      [m.sales_kpi_share(), '£699'],
      [m.sales_kpi_refunded(), '£36'],
      [m.sales_kpi_count(), '43'],
    ]);

    const [maya, hannah, sam] = [...document.querySelectorAll('tbody tr')];
    expect(clean(maya)).toContain('Maya Lindqvist');
    expect(clean(maya)).toContain('maya.lindqvist@example.com');
    expect(clean(maya)).toContain('£12.00');
    expect(clean(maya)).toContain('£10.80');
    expect(clean(maya)).toContain(m.sales_status_completed());
    expect(maya.querySelector('a.content-link')?.getAttribute('href')).toBe(
      '/rowan/content/breathwork-for-deep-sleep'
    );
    expect(clean(hannah)).toContain(m.sales_status_refunded());
    expect(clean(hannah)).toContain('−£24.00');
    // No name: the email takes the name slot, once.
    expect(clean(sam).match(/sam\.k@example\.com/g)).toHaveLength(1);
    expect(clean(sam)).toContain(m.sales_status_pending());

    // One block per sale for phones, saying "Your share" in words.
    const blocks = [
      ...document.querySelectorAll('ul.sale-list > li.sale-item'),
    ];
    expect(blocks).toHaveLength(3);
    expect(clean(blocks[0])).toContain(
      m.sales_item_share({ amount: '£10.80' })
    );

    const nav = document.querySelector('nav.pagination');
    expect(clean(nav)).toContain(
      m.common_page_x_of_y({ current: 1, total: 3 })
    );
    expect(clean(nav)).toContain(m.sales_pagination_total_other({ count: 47 }));

    await vi.waitFor(() => expect(exportButton()).toBeTruthy());
  });

  test('Next moves to page 2 through the URL', async () => {
    mountPage(Promise.resolve(list([MAYA], 47)), Promise.resolve(STATS));
    await vi.waitFor(() =>
      expect(document.querySelector('nav.pagination')).toBeTruthy()
    );

    const next = [
      ...document.querySelectorAll<HTMLButtonElement>('nav.pagination button'),
    ].find((b) => clean(b) === m.common_next());
    next?.click();

    expect(navigation.goto).toHaveBeenCalledWith('/studio/sales?page=2', {
      replaceState: true,
      keepFocus: true,
    });
  });
});

describe('first run (B2)', () => {
  test('zero KPIs, the filters, and "No sales yet" with both CTAs', async () => {
    mountPage(Promise.resolve(list([])), Promise.resolve(ZERO));

    await vi.waitFor(() =>
      expect(clean(document.querySelector('.empty-state__title'))).toBe(
        m.sales_personal_empty_title()
      )
    );
    expect(kpiValues()).toEqual([
      [m.sales_kpi_gross(), '£0'],
      [m.sales_kpi_share(), '£0'],
      [m.sales_kpi_refunded(), '£0'],
      [m.sales_kpi_count(), '0'],
    ]);
    expect(clean(document.querySelector('.empty-state__description'))).toBe(
      m.sales_personal_empty_description()
    );

    const ctas = [...document.querySelectorAll('.empty-actions a')].map((a) => [
      clean(a),
      a.getAttribute('href'),
    ]);
    expect(ctas).toEqual([
      [m.sales_personal_empty_publish(), '/studio/content'],
      [m.sales_personal_empty_payouts(), '/studio/earnings'],
    ]);

    expect(clean(document.body)).toContain(m.sales_filter_range());
    expect(clean(document.body)).toContain(m.sales_filter_status());
    expect(document.querySelector('table')).toBeNull();
    expect(exportButton()).toBeUndefined();
  });

  test('a filtered empty list says "No sales match" instead', async () => {
    mountPage(Promise.resolve(list([])), Promise.resolve(ZERO), {
      page: 1,
      range: '7',
      status: 'all',
    });

    await vi.waitFor(() =>
      expect(clean(document.querySelector('.empty-state__title'))).toBe(
        m.sales_empty_filtered_title()
      )
    );
    expect(document.querySelector('.empty-actions')).toBeNull();
  });
});

describe('failure', () => {
  test('a failed ledger renders an error with Try again, never the empty state', async () => {
    mountPage(Promise.resolve(null), Promise.resolve(null));

    await vi.waitFor(() =>
      expect(clean(document.body)).toContain(m.sales_load_error())
    );
    expect(clean(document.body)).toContain(m.sales_kpi_load_error());
    expect(document.querySelector('.empty-state')).toBeNull();
    expect(document.querySelectorAll('.kpi-card')).toHaveLength(0);

    const retry = [...document.querySelectorAll('button')].find(
      (b) => clean(b) === m.sales_retry()
    );
    retry?.click();
    expect(navigation.invalidate).toHaveBeenCalledWith(
      'cache:studio-page:sales'
    );
  });
});
