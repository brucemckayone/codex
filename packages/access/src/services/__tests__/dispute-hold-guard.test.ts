/**
 * The dispute lookup only picks a refused stream's copy (Codex-2hxff.60,
 * review F4). If it fails, the refusal stands with the decision's own reason
 * and the failure is logged at error: a refusal must never become a 500
 * because of its copy.
 *
 * DB-free: a stub transaction in which the decision succeeds and the lookup's
 * first read, the disputed-purchase read, fails. The second test shows the
 * stub reaches the lookup, so the first one tests the guard and not the stub.
 */

import type { ObservabilityClient } from '@codex/observability';
import type { PurchaseService } from '@codex/purchase';
import { createMockObservability } from '@codex/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { AccessDeniedError } from '../../errors';
import {
  assertStreamingAccess,
  type StreamingAccessContent,
} from '../content-access/access-decision';

/** Chainable empty `.select()`: the entitlement and course reads find nothing. */
function emptySelect() {
  const builder = {
    from: () => builder,
    innerJoin: () => builder,
    leftJoin: () => builder,
    where: () => builder,
    limit: () => builder,
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable — mimics Drizzle's awaitable query builder so `await db.select()...` resolves to [].
    then: (resolve: (rows: never[]) => unknown) => resolve([]),
  };
  return builder;
}

/** A paid item nobody has bought: the decision refuses it with `'paid'`. */
const paidItem: StreamingAccessContent = {
  organizationId: 'org-guard',
  status: 'published',
  isFree: false,
  isPurchasable: true,
  priceCents: 1500,
  includedInTierId: null,
  isFollowerGated: false,
  isTeamOnly: false,
  courseOnly: false,
  offSaleAt: null,
};

async function refuse(disputedPurchaseRead: () => Promise<unknown>) {
  const { obs } = createMockObservability();
  const tx = {
    query: {
      organizationMemberships: { findFirst: vi.fn(async () => undefined) },
      purchases: { findFirst: vi.fn(disputedPurchaseRead) },
    },
    select: emptySelect,
  } as unknown as Parameters<typeof assertStreamingAccess>[0];
  const purchaseService = {
    verifyPurchase: vi.fn(async () => false),
  } as unknown as PurchaseService;

  const outcome = await assertStreamingAccess(
    tx,
    { purchaseService, obs: obs as unknown as ObservabilityClient },
    'user-guard',
    'content-guard',
    paidItem
  ).catch((error: unknown) => error);
  expect(outcome).toBeInstanceOf(AccessDeniedError);
  return { reason: (outcome as AccessDeniedError).context?.reason, obs };
}

describe('a refused stream whose dispute lookup fails (Codex-2hxff.60)', () => {
  it("keeps the decision's own reason and logs the failure at error, with ids and the message only", async () => {
    const { reason, obs } = await refuse(async () => {
      throw new Error('statement timeout (test)');
    });

    expect(reason).toBe('paid');
    expect(obs.error).toHaveBeenCalledWith(
      'Access denied: the dispute lookup failed; own reason kept',
      {
        userId: 'user-guard',
        contentId: 'content-guard',
        error: 'statement timeout (test)',
      }
    );
  });

  it('a lookup that finds a disputed purchase names it, and logs no error', async () => {
    const { reason, obs } = await refuse(async () => ({ id: 'purchase-1' }));

    expect(reason).toBe('purchase_dispute');
    expect(obs.error).not.toHaveBeenCalled();
  });
});
