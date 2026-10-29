/**
 * `listPayoutsQuerySchema.transferredFrom` (web review r2 R2-L3): Org
 * Payouts' Held rows are filtered by when each row was transferred, so a
 * backlog sale released after a late Connect setup isn't left out.
 */
import { describe, expect, it } from 'vitest';
import { listPayoutsQuerySchema } from '../subscription';

describe('listPayoutsQuerySchema transferredFrom', () => {
  const organizationId = '11111111-1111-4111-8111-111111111111';

  it('takes an ISO datetime through, and is optional', () => {
    expect(
      listPayoutsQuerySchema.parse({
        organizationId,
        transferredFrom: '2026-10-26T08:00:00.000Z',
      }).transferredFrom
    ).toBe('2026-10-26T08:00:00.000Z');
    expect(
      listPayoutsQuerySchema.parse({ organizationId }).transferredFrom
    ).toBeUndefined();
  });

  it('refuses anything that is not an ISO datetime', () => {
    expect(
      listPayoutsQuerySchema.safeParse({
        organizationId,
        transferredFrom: 'yesterday',
      }).success
    ).toBe(false);
  });
});
