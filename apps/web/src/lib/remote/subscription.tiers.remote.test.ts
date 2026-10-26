// @vitest-environment node

/**
 * `createTier` RETURNS the worker's refusal, with its `details.code`
 * (Codex-2hxff.66).
 *
 * The tier dialog decides by that code whether to keep its `submissionId`:
 * 503 `STRIPE_UNAVAILABLE` and 409 `SUBMISSION_ID_REUSED` re-mint, while 409
 * `SUBMISSION_IN_PROGRESS` keeps it. A thrown error would reach the browser as
 * a sanitised 500 with no code, so the command must return it.
 *
 * `$app/server` is stubbed so a command is just its handler.
 */

import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/errors';

const tiersApi = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({ tiers: tiersApi })),
}));
// Kit checks that every export of a .remote.ts file is a remote function,
// which it recognises by its `__` metadata.
vi.mock('$app/server', () => {
  const remoteFn =
    (type: string) => (_schema: unknown, fn: (arg: unknown) => unknown) => {
      const wrapped = ((arg: unknown) => fn(arg)) as ((
        arg: unknown
      ) => unknown) & {
        __: { type: string; id: string; name: string };
      };
      wrapped.__ = { type, id: '', name: '' };
      return wrapped;
    };
  return {
    command: remoteFn('command'),
    query: remoteFn('query'),
    getRequestEvent: () => ({ platform: { env: {} }, cookies: {} }),
  };
});

import { createTier } from './subscription.remote';

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const SUBMISSION_ID = '7c1e2b9a-4f3d-4c8e-9a61-2d5b8e0f1a37';
const INPUT = {
  orgId: ORG_ID,
  submissionId: SUBMISSION_ID,
  name: 'Inner Circle',
  priceMonthly: 499,
  priceAnnual: 4990,
};

const run = (input: unknown) =>
  (createTier as unknown as (input: unknown) => Promise<unknown>)(input);

describe('createTier', () => {
  it('sends the submissionId with the tier and answers { success: true, tier }', async () => {
    const tier = { id: 'tier-1', name: 'Inner Circle' };
    tiersApi.create.mockResolvedValueOnce(tier);

    await expect(run(INPUT)).resolves.toEqual({ success: true, tier });
    expect(tiersApi.create).toHaveBeenCalledWith(ORG_ID, {
      submissionId: SUBMISSION_ID,
      name: 'Inner Circle',
      priceMonthly: 499,
      priceAnnual: 4990,
    });
  });

  it.each([
    [409, 'CONFLICT', 'SUBMISSION_IN_PROGRESS'],
    [409, 'CONFLICT', 'SUBMISSION_ID_REUSED'],
    [503, 'SERVICE_UNAVAILABLE', 'STRIPE_UNAVAILABLE'],
  ] as const)('returns a %i %s refusal with detailsCode %s, never throws it', async (status, code, detailsCode) => {
    tiersApi.create.mockRejectedValueOnce(
      new ApiError(status, 'refused', code, {
        code: detailsCode,
        organizationId: ORG_ID,
        submissionId: SUBMISSION_ID,
      })
    );

    await expect(run(INPUT)).resolves.toMatchObject({
      success: false,
      status,
      code,
      detailsCode,
    });
  });
});
