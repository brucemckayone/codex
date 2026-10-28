/**
 * `formatPurchasesForClient` carries a purchase's dispute mark to the account
 * payment history (Codex-2hxff.60, proposal P1).
 *
 * The page reads "a dispute is open" as `status === 'completed'` with
 * `disputedAt` set, so both fields must reach it as the row holds them: a win
 * clears the mark, and a loss keeps it on a row that is now `refunded`.
 *
 * Unit: the method is a pure mapper over what `getPurchaseHistory` returns.
 */

import type { PaginatedListResponse } from '@codex/shared-types';
import { createTestMoneyDeps } from '@codex/test-utils';
import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { PurchaseService } from '../services/purchase-service';
import type { PurchaseWithItem } from '../types';

const service = new PurchaseService(
  { db: {} as never, environment: 'test', ...createTestMoneyDeps() },
  {} as Stripe
);

/** A content purchase as `getPurchaseHistory` returns it. */
function row(overrides: Partial<PurchaseWithItem>): PurchaseWithItem {
  return {
    id: 'purchase_1',
    customerId: 'user_1',
    createdAt: new Date('2026-10-01T10:00:00.000Z'),
    contentId: 'content_1',
    courseId: null,
    amountPaidCents: 1500,
    status: 'completed',
    disputedAt: null,
    content: {
      id: 'content_1',
      title: 'Morning practice',
      slug: 'morning-practice',
      thumbnailUrl: null,
      contentType: 'video',
    },
    course: null,
    ...overrides,
  } as PurchaseWithItem;
}

function history(
  ...items: PurchaseWithItem[]
): PaginatedListResponse<PurchaseWithItem> {
  return {
    items,
    pagination: {
      page: 1,
      limit: 20,
      total: items.length,
      totalPages: 1,
    },
  };
}

describe('formatPurchasesForClient — disputedAt (Codex-2hxff.60)', () => {
  it('an open dispute: still completed, with the mark as an ISO string', () => {
    const [item] = service.formatPurchasesForClient(
      history(row({ disputedAt: new Date('2026-10-20T08:30:00.000Z') }))
    ).items;

    expect(item?.status).toBe('completed');
    expect(item?.disputedAt).toBe('2026-10-20T08:30:00.000Z');
  });

  it('no dispute, or one won (the mark cleared): null', () => {
    const [item] = service.formatPurchasesForClient(
      history(row({ disputedAt: null }))
    ).items;

    expect(item?.status).toBe('completed');
    expect(item?.disputedAt).toBeNull();
  });

  it('a lost dispute: refunded, and the mark kept', () => {
    const [item] = service.formatPurchasesForClient(
      history(
        row({
          status: 'refunded',
          disputedAt: new Date('2026-10-20T08:30:00.000Z'),
        })
      )
    ).items;

    expect(item?.status).toBe('refunded');
    expect(item?.disputedAt).toBe('2026-10-20T08:30:00.000Z');
  });
});
