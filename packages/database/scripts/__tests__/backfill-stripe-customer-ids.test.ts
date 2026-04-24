/**
 * Unit tests for the `findCustomerForEmail` helper used by the
 * `backfill-stripe-customer-ids` script.
 *
 * We deliberately test the branching (none / single / ambiguous / multiple
 * duplicate ids) at the pure-function level — the script's outer loop is
 * exercised via the db:seed integration path, not via unit tests (no Neon
 * branch needed).
 */

import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import { findCustomerForEmail } from '../backfill-stripe-customer-ids';

interface MockStripe {
  customers: {
    list: ReturnType<typeof vi.fn>;
  };
}

function buildMockStripe(listResult: {
  data: Array<{ id: string; created: number }>;
}): MockStripe {
  return {
    customers: {
      list: vi.fn().mockResolvedValue(listResult),
    },
  };
}

function asStripe(mock: MockStripe): Stripe {
  return mock as unknown as Stripe;
}

describe('findCustomerForEmail', () => {
  it('returns { kind: "none" } when Stripe has no customer for the email', async () => {
    const stripe = buildMockStripe({ data: [] });
    const result = await findCustomerForEmail(
      asStripe(stripe),
      'unknown@test.com'
    );
    expect(result).toEqual({ kind: 'none' });
    expect(stripe.customers.list).toHaveBeenCalledWith({
      email: 'unknown@test.com',
      limit: 100,
    });
  });

  it('returns the single customer id when exactly one match exists', async () => {
    const stripe = buildMockStripe({
      data: [{ id: 'cus_solo_123', created: 1_700_000_000 }],
    });
    const result = await findCustomerForEmail(
      asStripe(stripe),
      'solo@test.com'
    );
    expect(result).toEqual({ kind: 'match', customerId: 'cus_solo_123' });
  });

  it('picks the OLDEST customer when multiple rows share the same id', async () => {
    // Stripe's list API can occasionally return the same Customer more than
    // once during eventual consistency windows — that's not ambiguity, it's
    // just duplication. We pick the oldest and move on.
    const stripe = buildMockStripe({
      data: [
        { id: 'cus_same', created: 1_800_000_000 },
        { id: 'cus_same', created: 1_500_000_000 }, // oldest
        { id: 'cus_same', created: 1_700_000_000 },
      ],
    });
    const result = await findCustomerForEmail(
      asStripe(stripe),
      'shared@test.com'
    );
    expect(result).toEqual({ kind: 'match', customerId: 'cus_same' });
  });

  it('flags as ambiguous when multiple distinct customer ids exist', async () => {
    const stripe = buildMockStripe({
      data: [
        { id: 'cus_first', created: 1_500_000_000 },
        { id: 'cus_second', created: 1_600_000_000 },
      ],
    });
    const result = await findCustomerForEmail(
      asStripe(stripe),
      'ambiguous@test.com'
    );
    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') {
      expect(result.ids.sort()).toEqual(['cus_first', 'cus_second']);
    }
  });

  it('sorts correctly — oldest wins even when Stripe returns newest-first', async () => {
    const stripe = buildMockStripe({
      data: [
        { id: 'cus_newer', created: 2_000_000_000 },
        { id: 'cus_newer', created: 1_800_000_000 },
      ],
    });
    const result = await findCustomerForEmail(
      asStripe(stripe),
      'ordering@test.com'
    );
    // Only one distinct id — not ambiguous. Oldest wins.
    expect(result).toEqual({ kind: 'match', customerId: 'cus_newer' });
  });
});
