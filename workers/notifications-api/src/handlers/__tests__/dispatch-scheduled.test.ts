/**
 * The 08:00 cron runs the agreement sweep, then the money sweep (Codex-2hxff.34,
 * .30; batch B design §5.2): one wake, and a failure in one never stops the
 * other.
 */

import type { Bindings } from '@codex/shared-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { order, runMoneySweep, failAgreementSweep } = vi.hoisted(() => ({
  order: [] as string[],
  runMoneySweep: vi.fn(async () => {
    order.push('money');
    return null;
  }),
  failAgreementSweep: { value: false },
}));

vi.mock('../money-notices-sweep', () => ({
  runScheduledMoneyNoticesSweep: runMoneySweep,
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
    failAgreementSweep.value = false;
  });

  it('runs the money sweep after the agreement sweep, on the same wake', async () => {
    await fire('0 8 * * *');
    expect(runMoneySweep).toHaveBeenCalledOnce();
    expect(order).toEqual(['agreements', 'money']);
  });

  it('a failing agreement sweep does not stop the money sweep', async () => {
    failAgreementSweep.value = true;
    await fire('0 8 * * *');
    expect(runMoneySweep).toHaveBeenCalledOnce();
  });

  it('another cron runs neither', async () => {
    await fire('0 * * * *');
    expect(runMoneySweep).not.toHaveBeenCalled();
  });
});
