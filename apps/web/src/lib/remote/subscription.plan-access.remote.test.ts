// @vitest-environment node

/**
 * The tier commands and reads plan access adds (Codex-2hxff.91).
 *
 * - `createTier` passes "Include everything from…" (`copyAccessFromTierId`).
 * - `deleteTier` sends the creator's choice for what is only in the tier, and
 *   RETURNS a refusal with its `details.code` instead of throwing it: the
 *   dialog acts on `TIER_HAS_ONLY_ITEMS` and `TIER_HAS_SUBSCRIBERS`, and a
 *   thrown 4xx reaches the browser as a sanitised 500 with no code.
 * - `setTierItems` sends the checklist's delta and returns a refusal
 *   (`CREATOR_CONNECT_REQUIRED`) the same way.
 * - `listTierItems` passes the checklist's query.
 *
 * `$app/server` is stubbed so a command or query is its schema + handler.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/errors';

const tiersApi = vi.hoisted(() => ({
  create: vi.fn(),
  delete: vi.fn(),
  setItems: vi.fn(),
  items: vi.fn(),
}));

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({ tiers: tiersApi })),
}));
vi.mock('$app/server', () => {
  const remoteFn =
    (type: string) =>
    (
      schema: { parse: (raw: unknown) => unknown },
      fn: (arg: unknown) => unknown
    ) =>
      Object.assign(async (raw: unknown) => fn(schema.parse(raw)), {
        __: { type, id: '', name: '' },
      });
  return {
    command: remoteFn('command'),
    query: remoteFn('query'),
    getRequestEvent: () => ({ platform: { env: {} }, cookies: {} }),
  };
});

import {
  createTier,
  deleteTier,
  listTierItems,
  setTierItems,
} from './subscription.remote';

const ORG = '00000000-0000-4000-8000-000000000001';
const TIER = '00000000-0000-4000-8000-0000000000a1';
const PRO = '00000000-0000-4000-8000-0000000000a2';
const FILM = '00000000-0000-4000-8000-0000000000f1';

const call = (fn: unknown, input: unknown) =>
  (fn as (input: unknown) => Promise<unknown>)(input);

beforeEach(() => {
  for (const fn of Object.values(tiersApi)) fn.mockReset();
});

describe('createTier', () => {
  it('passes the copy source with the tier', async () => {
    tiersApi.create.mockResolvedValueOnce({ id: 'new' });
    await call(createTier, {
      orgId: ORG,
      submissionId: '7c1e2b9a-4f3d-4c8e-9a61-2d5b8e0f1a37',
      name: 'Premium',
      priceMonthly: 2000,
      priceAnnual: 20000,
      copyAccessFromTierId: PRO,
    });
    expect(tiersApi.create).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ copyAccessFromTierId: PRO })
    );
  });
});

describe('deleteTier', () => {
  it('sends the choice', async () => {
    tiersApi.delete.mockResolvedValueOnce(undefined);
    await expect(
      call(deleteTier, {
        orgId: ORG,
        tierId: TIER,
        choice: { onlyHere: 'move', moveTo: [PRO] },
      })
    ).resolves.toEqual({ success: true });
    expect(tiersApi.delete).toHaveBeenCalledWith(ORG, TIER, {
      onlyHere: 'move',
      moveTo: [PRO],
    });
  });

  it('refuses a move with no tier before any call', async () => {
    await expect(
      call(deleteTier, {
        orgId: ORG,
        tierId: TIER,
        choice: { onlyHere: 'move', moveTo: [] },
      })
    ).rejects.toThrow();
    expect(tiersApi.delete).not.toHaveBeenCalled();
  });

  it.each([
    'TIER_HAS_ONLY_ITEMS',
    'TIER_HAS_SUBSCRIBERS',
  ])('returns a %s refusal with its code, never throws it', async (code) => {
    tiersApi.delete.mockRejectedValueOnce(
      new ApiError(409, 'refused', 'CONFLICT', { code, tierId: TIER })
    );
    await expect(
      call(deleteTier, { orgId: ORG, tierId: TIER })
    ).resolves.toMatchObject({
      success: false,
      status: 409,
      detailsCode: code,
    });
  });
});

describe('setTierItems', () => {
  const delta = {
    add: { contentIds: [FILM], courseIds: [] },
    remove: { contentIds: [], courseIds: [] },
  };

  it('sends the delta and answers with the new totals', async () => {
    const result = { films: 19, courses: 2, closedNow: { contentIds: [] } };
    tiersApi.setItems.mockResolvedValueOnce(result);
    await expect(
      call(setTierItems, { orgId: ORG, tierId: TIER, delta })
    ).resolves.toEqual({
      success: true,
      result,
    });
    expect(tiersApi.setItems).toHaveBeenCalledWith(ORG, TIER, delta);
  });

  it('returns a payouts refusal with its code', async () => {
    tiersApi.setItems.mockRejectedValueOnce(
      new ApiError(422, 'refused', 'BUSINESS_LOGIC_ERROR', {
        code: 'CREATOR_CONNECT_REQUIRED',
      })
    );
    await expect(
      call(setTierItems, { orgId: ORG, tierId: TIER, delta })
    ).resolves.toMatchObject({
      success: false,
      detailsCode: 'CREATOR_CONNECT_REQUIRED',
    });
  });

  it('refuses an empty delta before any call', async () => {
    await expect(
      call(setTierItems, {
        orgId: ORG,
        tierId: TIER,
        delta: {
          add: { contentIds: [], courseIds: [] },
          remove: { contentIds: [], courseIds: [] },
        },
      })
    ).rejects.toThrow();
    expect(tiersApi.setItems).not.toHaveBeenCalled();
  });
});

describe('listTierItems', () => {
  it('passes the checklist query', async () => {
    tiersApi.items.mockResolvedValueOnce({ items: [], pagination: {} });
    await call(listTierItems, {
      orgId: ORG,
      tierId: TIER,
      query: { filter: 'missing', cheaperTierId: PRO, page: 2, limit: 50 },
    });
    expect(tiersApi.items).toHaveBeenCalledWith(
      ORG,
      TIER,
      expect.objectContaining({
        filter: 'missing',
        cheaperTierId: PRO,
        page: 2,
        limit: 50,
      })
    );
  });
});
