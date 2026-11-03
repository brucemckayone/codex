/**
 * The Studio progress reads go through `handleError` (backend review C1,
 * F2): a failed read reaches the route as a typed ServiceError, never the
 * raw database error, whose text can carry SQL.
 *
 * No database: the db is a stub whose every query fails.
 */

import { isServiceError } from '@codex/service-errors';
import {
  createMockStripe,
  createTestMoneyDeps,
  type Database,
} from '@codex/test-utils';
import { describe, expect, it } from 'vitest';
import { CourseSubscriptionService } from '../course-subscription-service';
import { TierService } from '../tier-service';

const RAW = 'relation "price_changes" does not exist';

/** A db whose every query fails as Postgres would. */
const failingDb = new Proxy(
  {},
  {
    get: () => () => Promise.reject(new Error(RAW)),
  }
) as unknown as Database;

async function thrownBy(read: () => Promise<unknown>): Promise<unknown> {
  try {
    await read();
  } catch (error) {
    return error;
  }
  throw new Error('the read did not fail');
}

describe('price-change progress reads map a failed query (review F2)', () => {
  it('tiers: a ServiceError without the raw text', async () => {
    const service = new TierService(
      { db: failingDb, dbWs: failingDb, environment: 'test' },
      createMockStripe()
    );
    const error = await thrownBy(() =>
      service.listPriceChangeProgress('org-1')
    );
    expect(isServiceError(error)).toBe(true);
    expect((error as Error).message).not.toContain(RAW);
  });

  it('course plans: a ServiceError without the raw text', async () => {
    const service = new CourseSubscriptionService(
      { db: failingDb, environment: 'test', ...createTestMoneyDeps() },
      createMockStripe()
    );
    const error = await thrownBy(() =>
      service.listPlanPriceChangeProgress('org-1', 'course-1')
    );
    expect(isServiceError(error)).toBe(true);
    expect((error as Error).message).not.toContain(RAW);
  });
});
