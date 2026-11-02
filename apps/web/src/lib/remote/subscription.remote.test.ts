// @vitest-environment node

/**
 * Subscription commands: a refusal keeps the worker's `details.code`
 * (Codex-2hxff.60).
 *
 * Most subscription errors carry their own code in `details.code` under a
 * class code at the top level: a disputed plan's tier change is 'CONFLICT'
 * with 'SUBSCRIPTION_DISPUTED' inside. The pricing page maps the inner one to
 * plain copy, so the failure must carry it, as `detailsCode`, while `code`
 * stays the top-level one every older mapping reads.
 *
 * `$app/server` is stubbed so a command is just its handler.
 */

import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/errors';

const subscriptionApi = vi.hoisted(() => ({
  previewTierChange: vi.fn(),
  changeTier: vi.fn(),
  keepCurrentPlan: vi.fn(),
  cancelCourseSubscription: vi.fn(),
  reactivateCourseSubscription: vi.fn(),
}));

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({ subscription: subscriptionApi })),
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

import {
  cancelCourseSubscription,
  changeSubscriptionTier,
  keepCurrentPlan,
  previewSubscriptionTierChange,
  reactivateCourseSubscription,
} from './subscription.remote';

const INPUT = {
  organizationId: '00000000-0000-4000-8000-000000000001',
  newTierId: '00000000-0000-4000-8000-0000000000a2',
  billingInterval: 'month' as const,
};

const disputed = () =>
  new ApiError(
    409,
    'The plan cannot be changed while a payment dispute on this subscription is open.',
    'CONFLICT',
    { code: 'SUBSCRIPTION_DISPUTED', organizationId: INPUT.organizationId }
  );

describe('subscription command failures', () => {
  it.each([
    [
      'previewSubscriptionTierChange',
      previewSubscriptionTierChange,
      'previewTierChange',
    ],
    ['changeSubscriptionTier', changeSubscriptionTier, 'changeTier'],
  ] as const)('%s forwards details.code as detailsCode', async (_name, run, method) => {
    subscriptionApi[method].mockRejectedValueOnce(disputed());

    const result = await (
      run as unknown as (input: unknown) => Promise<unknown>
    )(INPUT);

    expect(result).toMatchObject({
      success: false,
      code: 'CONFLICT',
      detailsCode: 'SUBSCRIPTION_DISPUTED',
      status: 409,
    });
  });

  it('leaves detailsCode unset when the details carry no code', async () => {
    subscriptionApi.changeTier.mockRejectedValueOnce(
      new ApiError(402, 'Your card was declined.', 'PAYMENT_REQUIRED')
    );

    const result = await (
      changeSubscriptionTier as unknown as (input: unknown) => Promise<unknown>
    )(INPUT);

    expect(result).toEqual({
      success: false,
      code: 'PAYMENT_REQUIRED',
      detailsCode: undefined,
      message: 'Your card was declined.',
      status: 402,
    });
  });
});

/**
 * Keep current plan and the course commands (Codex-2hxff.16, .52): the page
 * reads their refusals by `detailsCode` too. Keep after the renewal is
 * MOVE_ALREADY_LANDED; reactivating a course no longer offered is
 * COURSE_NOT_ON_SALE. A course command answers with the card's row.
 */
describe('Keep current plan and the course commands', () => {
  const COURSE_SUBSCRIPTION_ID = '00000000-0000-4000-8000-0000000000c1';
  const call = (run: unknown, input: unknown) =>
    (run as (input: unknown) => Promise<unknown>)(input);

  it('keepCurrentPlan forwards MOVE_ALREADY_LANDED as detailsCode', async () => {
    subscriptionApi.keepCurrentPlan.mockRejectedValueOnce(
      new ApiError(
        409,
        'Your plan has already changed at your renewal.',
        'CONFLICT',
        { code: 'MOVE_ALREADY_LANDED', organizationId: INPUT.organizationId }
      )
    );

    const result = await call(keepCurrentPlan, {
      organizationId: INPUT.organizationId,
    });

    expect(subscriptionApi.keepCurrentPlan).toHaveBeenCalledWith({
      organizationId: INPUT.organizationId,
    });
    expect(result).toMatchObject({
      success: false,
      code: 'CONFLICT',
      detailsCode: 'MOVE_ALREADY_LANDED',
      status: 409,
    });
  });

  it('reactivateCourseSubscription forwards COURSE_NOT_ON_SALE as detailsCode', async () => {
    subscriptionApi.reactivateCourseSubscription.mockRejectedValueOnce(
      new ApiError(409, 'This course is no longer offered.', 'CONFLICT', {
        code: 'COURSE_NOT_ON_SALE',
        courseSubscriptionId: COURSE_SUBSCRIPTION_ID,
      })
    );

    const result = await call(reactivateCourseSubscription, {
      courseSubscriptionId: COURSE_SUBSCRIPTION_ID,
    });

    expect(subscriptionApi.reactivateCourseSubscription).toHaveBeenCalledWith(
      COURSE_SUBSCRIPTION_ID
    );
    expect(result).toMatchObject({
      success: false,
      detailsCode: 'COURSE_NOT_ON_SALE',
      status: 409,
    });
  });

  it('cancelCourseSubscription answers with the row, and no answer is a 500', async () => {
    const row = { id: COURSE_SUBSCRIPTION_ID, status: 'cancelling' };
    subscriptionApi.cancelCourseSubscription.mockResolvedValueOnce(row);
    await expect(
      call(cancelCourseSubscription, {
        courseSubscriptionId: COURSE_SUBSCRIPTION_ID,
      })
    ).resolves.toEqual({ success: true, data: row });

    subscriptionApi.cancelCourseSubscription.mockRejectedValueOnce(
      new TypeError('fetch failed')
    );
    await expect(
      call(cancelCourseSubscription, {
        courseSubscriptionId: COURSE_SUBSCRIPTION_ID,
      })
    ).resolves.toEqual({
      success: false,
      code: undefined,
      detailsCode: undefined,
      message: 'An unexpected error occurred',
      status: 500,
    });
  });
});
