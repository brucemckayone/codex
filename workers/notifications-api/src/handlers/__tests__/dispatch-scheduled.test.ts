/**
 * The 08:00 cron runs the agreement sweep, then the money sweep (Codex-2hxff.34,
 * .30; batch B design §5.2), then the fee step (Codex-2hxff.33): one wake,
 * and a failure in one never stops the next.
 */

import type { Bindings } from '@codex/shared-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { order, runMoneySweep, runFeeStep, failAgreementSweep, failMoney } =
  vi.hoisted(() => ({
    order: [] as string[],
    runMoneySweep: vi.fn(async () => {
      if (failMoney.value) throw new Error('money sweep blew up');
      order.push('money');
      return null;
    }),
    runFeeStep: vi.fn(async () => {
      order.push('fees');
      return null;
    }),
    failAgreementSweep: { value: false },
    failMoney: { value: false },
  }));

vi.mock('../money-notices-sweep', () => ({
  runScheduledMoneyNoticesSweep: runMoneySweep,
}));
vi.mock('../fee-notices-sweep', () => ({
  runScheduledFeeNoticesSweep: runFeeStep,
}));

// The agreement sweep's first act is building its logger; with no env it
// then logs "missing required env vars" and returns. Throwing here makes it
// reject instead.
vi.mock('@codex/observability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/observability')>();
  class ObservabilityClient extends actual.ObservabilityClient {
    constructor(
      ...args: ConstructorParameters<typeof actual.ObservabilityClient>
    ) {
      if (failAgreementSweep.value) throw new Error('agreement sweep blew up');
      super(...args);
      order.push('agreements');
    }
  }
  return { ...actual, ObservabilityClient };
});

import { dispatchScheduled } from '../agreement-expiring-sweep';

async function fire(cron: string) {
  const waits: Promise<unknown>[] = [];
  dispatchScheduled(
    { cron } as ScheduledController,
    {} as Bindings,
    {
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    } as unknown as ExecutionContext
  );
  await Promise.all(waits);
}

describe('dispatchScheduled at 08:00', () => {
  beforeEach(() => {
    order.length = 0;
    runMoneySweep.mockClear();
    runFeeStep.mockClear();
    failAgreementSweep.value = false;
    failMoney.value = false;
  });

  it('runs the money sweep after the agreement sweep, then the fee step, on the same wake', async () => {
    await fire('0 8 * * *');
    expect(runMoneySweep).toHaveBeenCalledOnce();
    expect(runFeeStep).toHaveBeenCalledOnce();
    expect(order).toEqual(['agreements', 'money', 'fees']);
  });

  it('a failing money sweep does not stop the fee step', async () => {
    failMoney.value = true;
    await fire('0 8 * * *');
    expect(runFeeStep).toHaveBeenCalledOnce();
  });

  it('a failing agreement sweep does not stop the money sweep', async () => {
    failAgreementSweep.value = true;
    await fire('0 8 * * *');
    expect(runMoneySweep).toHaveBeenCalledOnce();
  });

  it('another cron runs none of them', async () => {
    await fire('0 * * * *');
    expect(runMoneySweep).not.toHaveBeenCalled();
    expect(runFeeStep).not.toHaveBeenCalled();
  });
});
