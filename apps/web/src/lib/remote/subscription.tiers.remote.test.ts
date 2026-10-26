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
 * A failure that is NOT an `ApiError` had no worker answer behind it (the
 * fetch threw, the success body would not parse), so the worker may still have
 * made the tier. Returning it skips the server's `handleError` hook, so the
 * command logs it itself and answers with fixed copy, never the raw message
 * (Codex-2hxff.66 review, silent MED-4).
 *
 * `$app/server` is stubbed so a command is just its handler.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/errors';
import { logger } from '$lib/observability';

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

describe('createTier with no API answer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs the cause on the server and sends fixed copy, never the raw message', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    tiersApi.create.mockRejectedValueOnce(
      new TypeError('fetch failed: http://organization-api.internal/tiers')
    );

    const result = (await run(INPUT)) as { message: string };

    expect(result).toEqual({
      success: false,
      code: undefined,
      detailsCode: undefined,
      message: 'An unexpected error occurred',
      status: 500,
    });
    expect(result.message).not.toContain('fetch failed');
    expect(error).toHaveBeenCalledWith(
      'subscription command createTier failed with no API answer',
      expect.objectContaining({
        organizationId: ORG_ID,
        errorName: 'TypeError',
        reason: 'fetch failed: http://organization-api.internal/tiers',
      })
    );
  });

  it('does not log a worker refusal, which the worker logged itself', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    tiersApi.create.mockRejectedValueOnce(
      new ApiError(409, 'refused', 'CONFLICT', {
        code: 'SUBMISSION_IN_PROGRESS',
      })
    );

    await run(INPUT);

    expect(error).not.toHaveBeenCalled();
  });
});
