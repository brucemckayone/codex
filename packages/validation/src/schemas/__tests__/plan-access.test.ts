/**
 * Plan access by ticks (Codex-2hxff.91): the tier-side input contract.
 *
 * - `createTierSchema.copyAccessFromTierId`: "Include everything from…".
 * - `deleteTierQuerySchema`: what happens to items only in the deleted tier.
 *   Nothing is preselected, so a `move` with no target is refused here.
 * - `planItemsDeltaSchema`: the checklist's capped, idempotent delta.
 * - `planItemsQuerySchema`: the checklist rows.
 */
import { describe, expect, it } from 'vitest';
import {
  createTierSchema,
  deleteTierQuerySchema,
  PLAN_ITEMS_DELTA_MAX,
  planItemsDeltaSchema,
  planItemsQuerySchema,
} from '../subscription';

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const baseTier = {
  name: 'Premium',
  priceMonthly: 2000,
  priceAnnual: 20000,
  submissionId: uuid(999),
};

describe('createTierSchema.copyAccessFromTierId', () => {
  it('accepts a source tier id', () => {
    const parsed = createTierSchema.parse({
      ...baseTier,
      copyAccessFromTierId: uuid(1),
    });
    expect(parsed.copyAccessFromTierId).toBe(uuid(1));
  });

  it('accepts null and absence as "copy nothing"', () => {
    expect(
      createTierSchema.parse({ ...baseTier, copyAccessFromTierId: null })
        .copyAccessFromTierId
    ).toBeNull();
    expect(
      createTierSchema.parse(baseTier).copyAccessFromTierId
    ).toBeUndefined();
  });

  it('refuses a source that is not an id', () => {
    expect(
      createTierSchema.safeParse({ ...baseTier, copyAccessFromTierId: 'pro' })
        .success
    ).toBe(false);
  });
});

describe('deleteTierQuerySchema', () => {
  it('accepts no choice (the service refuses it only when items are only here)', () => {
    expect(deleteTierQuerySchema.parse({})).toEqual({});
  });

  it('accepts keep', () => {
    expect(deleteTierQuerySchema.parse({ onlyHere: 'keep' })).toEqual({
      onlyHere: 'keep',
    });
  });

  it('accepts move to one tier', () => {
    expect(
      deleteTierQuerySchema.parse({ onlyHere: 'move', moveTo: uuid(2) })
    ).toEqual({ onlyHere: 'move', moveTo: [uuid(2)] });
  });

  it('accepts move to several tiers, comma-separated', () => {
    expect(
      deleteTierQuerySchema.parse({
        onlyHere: 'move',
        moveTo: `${uuid(2)},${uuid(3)}`,
      }).moveTo
    ).toEqual([uuid(2), uuid(3)]);
  });

  it('refuses move with no target', () => {
    const result = deleteTierQuerySchema.safeParse({ onlyHere: 'move' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['moveTo']);
  });

  it('refuses an empty or malformed target list', () => {
    for (const moveTo of ['', `${uuid(2)},`, 'not-a-uuid']) {
      expect(
        deleteTierQuerySchema.safeParse({ onlyHere: 'move', moveTo }).success,
        moveTo
      ).toBe(false);
    }
  });

  it('refuses a repeated target', () => {
    expect(
      deleteTierQuerySchema.safeParse({
        onlyHere: 'move',
        moveTo: `${uuid(2)},${uuid(2)}`,
      }).success
    ).toBe(false);
  });

  it('refuses a target without move', () => {
    for (const onlyHere of ['keep', undefined]) {
      expect(
        deleteTierQuerySchema.safeParse({ onlyHere, moveTo: uuid(2) }).success,
        String(onlyHere)
      ).toBe(false);
    }
  });

  it('refuses an unknown choice', () => {
    expect(deleteTierQuerySchema.safeParse({ onlyHere: 'free' }).success).toBe(
      false
    );
  });
});

describe('planItemsDeltaSchema', () => {
  it('fills the lists it was not sent', () => {
    expect(
      planItemsDeltaSchema.parse({ add: { contentIds: [uuid(1)] } })
    ).toEqual({
      add: { contentIds: [uuid(1)], courseIds: [] },
      remove: { contentIds: [], courseIds: [] },
    });
  });

  it('refuses an empty delta', () => {
    expect(planItemsDeltaSchema.safeParse({}).success).toBe(false);
    expect(
      planItemsDeltaSchema.safeParse({
        add: { contentIds: [], courseIds: [] },
        remove: { contentIds: [], courseIds: [] },
      }).success
    ).toBe(false);
  });

  it(`accepts exactly ${PLAN_ITEMS_DELTA_MAX} changes and refuses one more`, () => {
    const ids = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => uuid(from + i));
    const atCap = {
      add: { contentIds: ids(0, 100), courseIds: ids(100, 50) },
      remove: { contentIds: ids(200, 50) },
    };
    expect(planItemsDeltaSchema.safeParse(atCap).success).toBe(true);
    const overCap = {
      ...atCap,
      remove: { contentIds: ids(200, 50), courseIds: [uuid(500)] },
    };
    expect(planItemsDeltaSchema.safeParse(overCap).success).toBe(false);
  });

  it('refuses more than 100 ids in one list', () => {
    const ids = Array.from({ length: 101 }, (_, i) => uuid(i));
    expect(
      planItemsDeltaSchema.safeParse({ add: { contentIds: ids } }).success
    ).toBe(false);
  });

  it('refuses an item added and removed in one request', () => {
    expect(
      planItemsDeltaSchema.safeParse({
        add: { courseIds: [uuid(7)] },
        remove: { courseIds: [uuid(7)] },
      }).success
    ).toBe(false);
  });

  it('allows the same id as a film add and a course remove (different tables)', () => {
    expect(
      planItemsDeltaSchema.safeParse({
        add: { contentIds: [uuid(7)] },
        remove: { courseIds: [uuid(7)] },
      }).success
    ).toBe(true);
  });

  it('refuses a repeated id in one list', () => {
    expect(
      planItemsDeltaSchema.safeParse({
        remove: { contentIds: [uuid(1), uuid(1)] },
      }).success
    ).toBe(false);
  });
});

describe('planItemsQuerySchema', () => {
  it('defaults to every kind, the whole list, page 1 of 20', () => {
    expect(planItemsQuerySchema.parse({})).toEqual({
      page: 1,
      limit: 20,
      filter: 'all',
    });
  });

  it('caps the page at 50 rows', () => {
    expect(planItemsQuerySchema.safeParse({ limit: '50' }).success).toBe(true);
    expect(planItemsQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
  });

  it('pairs filter=missing with cheaperTierId, both ways', () => {
    expect(
      planItemsQuerySchema.safeParse({
        filter: 'missing',
        cheaperTierId: uuid(1),
      }).success
    ).toBe(true);
    expect(planItemsQuerySchema.safeParse({ filter: 'missing' }).success).toBe(
      false
    );
    expect(
      planItemsQuerySchema.safeParse({
        filter: 'included',
        cheaperTierId: uuid(1),
      }).success
    ).toBe(false);
  });

  it('drops NUL from the search and refuses an unknown kind', () => {
    expect(planItemsQuerySchema.parse({ search: 'sou\u0000nd' }).search).toBe(
      'sound'
    );
    expect(planItemsQuerySchema.safeParse({ kind: 'page' }).success).toBe(
      false
    );
  });
});
