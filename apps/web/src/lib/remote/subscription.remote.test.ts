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
  changeSubscriptionTier,
  previewSubscriptionTierChange,
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
