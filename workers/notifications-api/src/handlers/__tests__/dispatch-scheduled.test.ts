/**
 * The 08:00 cron runs the agreement sweep, then the money sweep (Codex-2hxff.34,
 * .30; batch B design §5.2), then the fee step (Codex-2hxff.33): one wake,
 * and a failure in one never stops the next. Every step's send budget counts
 * from the wake's start (Codex-2hxff.100).
 */

import type { Bindings } from '@codex/shared-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SENDS_TIME_BUDGET_MS } from '../send-limits';

const {
  order,
  runMoneySweep,
  runFeeStep,
  failAgreementSweep,
  failMoney,
  agreementRows,
} = vi.hoisted(() => ({
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
  agreementRows: { candidates: [] as unknown[], marked: [] as string[] },
}));

vi.mock('../money-notices-sweep', () => ({
  runScheduledMoneyNoticesSweep: runMoneySweep,
}));
vi.mock('../fee-notices-sweep', () => ({
  runScheduledFeeNoticesSweep: runFeeStep,
}));

// With its config set, the agreement sweep reaches its rows: these.
vi.mock('@codex/agreements', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/agreements')>();
  return {
    ...actual,
    AgreementService: class {
      async findExpiringAgreements() {
        return agreementRows.candidates;
      }
      async getFirstActiveOwnerContact() {
        return null;
      }
      async markExpiringSoonSent(agreementId: string) {
        agreementRows.marked.push(agreementId);
      }
    },
  };
});
vi.mock('@codex/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/database')>();
  return { ...actual, createDbClient: () => ({}) };
});

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

async function fire(cron: string, env: Partial<Bindings> = {}) {
  const waits: Promise<unknown>[] = [];
  dispatchScheduled(
    { cron } as ScheduledController,
    env as Bindings,
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
    agreementRows.candidates = [];
    agreementRows.marked = [];
  });

  it('runs the money sweep after the agreement sweep, then the fee step, on the same wake', async () => {
    await fire('0 8 * * *');
    expect(runMoneySweep).toHaveBeenCalledOnce();
    expect(runFeeStep).toHaveBeenCalledOnce();
    expect(order).toEqual(['agreements', 'money', 'fees']);
  });

  it('hands the money sweep and the fee step the wake’s start, taken before the sweeps ahead of them', async () => {
    const before = Date.now();
    await fire('0 8 * * *');
    const wakeOf = (step: typeof runFeeStep) =>
      (
        step.mock.calls[0] as unknown as [
          unknown,
          { startedAt?: number } | undefined,
        ]
      )[1]?.startedAt;
    expect(wakeOf(runFeeStep)).toBeGreaterThanOrEqual(before);
    expect(wakeOf(runFeeStep)).toBeLessThanOrEqual(Date.now());
    expect(wakeOf(runMoneySweep)).toBe(wakeOf(runFeeStep));
  });

  it('the agreement sweep’s send budget counts from the wake’s start too', async () => {
    agreementRows.candidates = [
      {
        agreement: {
          id: 'agr-wake',
          organizationId: 'org-wake',
          creatorSharePercent: 3000,
          revenueType: 'subscription',
          effectiveFrom: new Date('2026-01-01'),
          effectiveUntil: new Date('2026-12-01'),
          currentProposalId: null,
        },
        creator: { id: 'creator-wake', email: 'c@example.test', name: 'C' },
        orgName: 'Org',
        orgSlug: 'org-wake',
      },
    ];
    const wake = 1_800_000_000_000;
    // The dispatcher reads the wake first; every later read is a budget on.
    const clock = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(wake)
      .mockReturnValue(wake + SENDS_TIME_BUDGET_MS);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ data: { success: true } }));
    try {
      await fire('0 8 * * *', {
        DATABASE_URL: 'postgres://unused',
        WORKER_SHARED_SECRET: 'unused',
        ENVIRONMENT: 'development',
      });
      // Spent before its first row: nothing sent, nothing marked.
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(agreementRows.marked).toEqual([]);
      expect(order).toEqual(['agreements', 'money', 'fees']);
    } finally {
      clock.mockRestore();
      fetchSpy.mockRestore();
    }
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
