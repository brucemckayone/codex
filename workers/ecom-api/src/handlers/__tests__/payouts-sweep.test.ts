/**
 * ecom-api payouts-sweep — handler tests (Codex-vv77x)
 *
 * Asserts the scheduled handler:
 *   - constructs SubscriptionService.sweepUnresolvedPayouts via injected deps
 *   - does NOT throw when the service rejects (cron crash protection)
 *   - exits cleanly when required env vars are missing
 *   - forwards `olderThanMinutes` override to the service
 *   - then retries failed refund clawbacks, isolated from the sweep
 *     (Codex-2hxff.8)
 *
 * Consolidated into workers/ecom-api 2026-05-13. Lives alongside the Stripe
 * webhook handlers because the cron + the Stripe webhooks share an owner.
 */

import { SubscriptionService } from '@codex/subscription';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest';

import { runPayoutsSweep, runScheduledPayoutsSweep } from '../payouts-sweep';

/** A real instance whose sweep each test stubs on the prototype. */
function sweepService(): SubscriptionService {
  return new SubscriptionService(
    { db: {} as never, environment: 'test' },
    {} as never
  );
}

function fakeCtx() {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext & { waitUntil: ReturnType<typeof vi.fn> };
}

// Construct a minimal-ish Bindings stub. The handler reads DATABASE_URL,
// STRIPE_SECRET_KEY and ENVIRONMENT; the composition root it builds needs a
// valid DB_METHOD too (the pool is constructed, never dialled).
function makeEnv(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    DB_METHOD: 'NEON_BRANCH',
    DATABASE_URL: 'postgres://test',
    STRIPE_SECRET_KEY: 'sk_test_123',
    ENVIRONMENT: 'test',
    ...overrides,
  };
}

function makeObs(): {
  obs: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
} {
  return {
    obs: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
}

describe('ecom-api payouts-sweep handler', () => {
  // The cron also retries failed clawbacks after the sweep. These tests are
  // about the sweep, so the retry is a no-op here; its own tests are below.
  let clawbackRetry: MockInstance<SubscriptionService['retryFailedClawbacks']>;
  beforeEach(() => {
    clawbackRetry = vi
      .spyOn(SubscriptionService.prototype, 'retryFailedClawbacks')
      .mockResolvedValue({ charges: 0, retried: 0, stillFailing: 0 });
  });
  afterEach(() => {
    clawbackRetry.mockRestore();
  });

  it('runPayoutsSweep delegates to SubscriptionService.sweepUnresolvedPayouts and logs the result', async () => {
    // Build a SubscriptionService-shaped stub by passing a pre-built db
    // that the real SubscriptionService constructor won't actually touch
    // (the service's sweep method makes drizzle calls — we don't reach
    // those because we're stubbing sweepUnresolvedPayouts directly).
    //
    // Easier: spy on SubscriptionService.prototype.sweepUnresolvedPayouts.
    const { SubscriptionService } = await import('@codex/subscription');
    const spy = vi
      .spyOn(SubscriptionService.prototype, 'sweepUnresolvedPayouts')
      .mockResolvedValue({
        groupsScanned: 3,
        groupsResolved: 2,
        groupsSkipped: 1,
        errors: 0,
      });

    const { obs } = makeObs();
    const result = await runPayoutsSweep({
      subscription: sweepService(),
      obs: obs as never,
      olderThanMinutes: 30,
    });

    expect(result).toEqual({
      groupsScanned: 3,
      groupsResolved: 2,
      groupsSkipped: 1,
      errors: 0,
    });
    expect(spy).toHaveBeenCalledWith(30);
    expect(obs.info).toHaveBeenCalledWith(
      'payouts-sweep cron completed',
      expect.objectContaining({
        olderThanMinutes: 30,
        groupsScanned: 3,
        groupsResolved: 2,
        groupsSkipped: 1,
        errors: 0,
      })
    );
    expect(obs.error).not.toHaveBeenCalled();

    spy.mockRestore();
  });

  it('runPayoutsSweep swallows service-level errors and logs via obs.error (cron crash protection)', async () => {
    const { SubscriptionService } = await import('@codex/subscription');
    const spy = vi
      .spyOn(SubscriptionService.prototype, 'sweepUnresolvedPayouts')
      .mockRejectedValue(new Error('catastrophic failure (test)'));

    const { obs } = makeObs();
    const result = await runPayoutsSweep({
      subscription: sweepService(),
      obs: obs as never,
    });

    expect(result).toBeNull();
    expect(obs.error).toHaveBeenCalledWith(
      'payouts-sweep cron failed at top level',
      expect.objectContaining({
        error: 'catastrophic failure (test)',
      })
    );

    spy.mockRestore();
  });

  it('runScheduledPayoutsSweep exits cleanly when DATABASE_URL is missing and never touches the service', async () => {
    const { SubscriptionService } = await import('@codex/subscription');
    const spy = vi
      .spyOn(SubscriptionService.prototype, 'sweepUnresolvedPayouts')
      .mockResolvedValue({
        groupsScanned: 0,
        groupsResolved: 0,
        groupsSkipped: 0,
        errors: 0,
      });

    const { obs } = makeObs();
    const env = makeEnv({ DATABASE_URL: undefined });

    await runScheduledPayoutsSweep(env as never, fakeCtx(), {
      obs: obs as never,
    });

    expect(spy).not.toHaveBeenCalled();
    expect(obs.error).toHaveBeenCalledWith(
      'payouts-sweep: missing required env vars, skipping',
      expect.objectContaining({
        hasDatabaseUrl: false,
        hasStripeSecret: true,
      })
    );

    spy.mockRestore();
  });

  it('runScheduledPayoutsSweep invokes sweepUnresolvedPayouts when env is configured', async () => {
    const { SubscriptionService } = await import('@codex/subscription');
    const spy = vi
      .spyOn(SubscriptionService.prototype, 'sweepUnresolvedPayouts')
      .mockResolvedValue({
        groupsScanned: 0,
        groupsResolved: 0,
        groupsSkipped: 0,
        errors: 0,
      });

    const { obs } = makeObs();

    // A Stripe stub so no real client is built; the pool is constructed by
    // the composition root but never queried (the sweep is stubbed).
    const ctx = fakeCtx();
    await runScheduledPayoutsSweep(makeEnv() as never, ctx, {
      stripe: {} as never,
      obs: obs as never,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    // Codex-2hxff.54: the sweep runs on the registry's SubscriptionService,
    // so a drained payout is split with configured fees and its payee gets
    // the payout-released email (Codex-2hxff.7, .13). It used to be built
    // with only { db, environment }.
    const sweptBy = spy.mock.contexts[0] as {
      feeConfig?: unknown;
      payoutMailer?: unknown;
    };
    expect(sweptBy.feeConfig).toBeDefined();
    expect(sweptBy.payoutMailer).toBeTypeOf('function');
    // The pool is handed back after the sweep, on waitUntil.
    expect(ctx.waitUntil).toHaveBeenCalledOnce();

    spy.mockRestore();
  });

  // ─────────────────────────────────────────────────────────────────────
  // Production edge cases (Codex-0pqnv)
  //
  // These tests lock the handler contract against three production scenarios
  // that the service tests cover at the impl level but the handler must
  // surface faithfully:
  //   - large-scale sweep (no truncation, no transform of large counters)
  //   - mixed-outcome batches (errors > 0 alongside resolved > 0 = success
  //     path, NOT obs.error — the service caught + counted the failures)
  //   - mid-batch Stripe timeout (per-group failure surfaces as result.errors
  //     and a successful-info log, not a top-level rejection)
  //
  // Per-row/per-group impl-level isolation is verified in
  // subscription-service.test.ts vv77x block — DO NOT duplicate it here.
  // ─────────────────────────────────────────────────────────────────────

  it('propagates large-scale sweep counters faithfully (500 groups, no truncation)', async () => {
    // Production scenario: a Connect-account outage backed up ~500 pending
    // groups, the sweep cron drained them all. Verify the handler does not
    // truncate, transform, or sample the counters before logging/returning.
    const { SubscriptionService } = await import('@codex/subscription');
    const largeCounters = {
      groupsScanned: 500,
      groupsResolved: 487,
      groupsSkipped: 10,
      errors: 3,
    };
    const spy = vi
      .spyOn(SubscriptionService.prototype, 'sweepUnresolvedPayouts')
      .mockResolvedValue(largeCounters);

    const { obs } = makeObs();
    const result = await runPayoutsSweep({
      subscription: sweepService(),
      obs: obs as never,
      olderThanMinutes: 15,
    });

    // Counters returned verbatim — no clamping, no shape change
    expect(result).toEqual(largeCounters);
    // Logged on the success path (obs.info), not the failure path (obs.error)
    expect(obs.info).toHaveBeenCalledWith(
      'payouts-sweep cron completed',
      expect.objectContaining({
        olderThanMinutes: 15,
        groupsScanned: 500,
        groupsResolved: 487,
        groupsSkipped: 10,
        errors: 3,
      })
    );
    expect(obs.error).not.toHaveBeenCalled();

    spy.mockRestore();
  });

  it('treats mixed-outcome batches (errors > 0 AND resolved > 0) as the success path — service already isolated per-group failures', async () => {
    // Production scenario: 10 groups, one group's Stripe call threw, the
    // other 9 resolved. The service caught + counted the one failure and
    // returned normally. The handler MUST log via obs.info (success path)
    // — NOT obs.error — because the sweep itself did not fail; it
    // partially completed, which is the documented contract.
    const { SubscriptionService } = await import('@codex/subscription');
    const mixed = {
      groupsScanned: 10,
      groupsResolved: 9,
      groupsSkipped: 0,
      errors: 1,
    };
    const spy = vi
      .spyOn(SubscriptionService.prototype, 'sweepUnresolvedPayouts')
      .mockResolvedValue(mixed);

    const { obs } = makeObs();
    const result = await runPayoutsSweep({
      subscription: sweepService(),
      obs: obs as never,
    });

    // result.errors AND result.groupsResolved both surface accurately
    expect(result).toEqual(mixed);
    expect(result?.errors).toBe(1);
    expect(result?.groupsResolved).toBe(9);
    // Critical: NOT routed to obs.error — the handler-level error path is
    // reserved for top-level rejections (DB outage, etc.), not per-group
    // failures the service already handled.
    expect(
      vi
        .mocked(obs.info)
        .mock.calls.filter(([m]) => m === 'payouts-sweep cron completed')
    ).toHaveLength(1);
    expect(obs.error).not.toHaveBeenCalled();

    spy.mockRestore();
  });

  it('surfaces mid-batch Stripe timeout — sweep returns errors > 0 without throwing, handler returns counters and logs info', async () => {
    // Production scenario: mid-batch, a single stripe.transfers.create or
    // accounts.retrieve rejects with a timeout. The service catches at the
    // per-group try/catch, increments `errors`, and proceeds. The handler
    // must:
    //   1. NOT see a thrown Error (service swallowed it)
    //   2. Return the partial-success counters
    //   3. Log on the success path with errors > 0 visible
    const { SubscriptionService } = await import('@codex/subscription');
    const timeoutOutcome = {
      groupsScanned: 5,
      groupsResolved: 4,
      groupsSkipped: 0,
      errors: 1, // the one group whose Stripe call timed out
    };
    const spy = vi
      .spyOn(SubscriptionService.prototype, 'sweepUnresolvedPayouts')
      .mockResolvedValue(timeoutOutcome);

    const { obs } = makeObs();
    const result = await runPayoutsSweep({
      subscription: sweepService(),
      obs: obs as never,
      olderThanMinutes: 30,
    });

    // Partial success — counters returned verbatim
    expect(result).toEqual(timeoutOutcome);
    // Success-path logging includes the error count so on-call can alert
    expect(obs.info).toHaveBeenCalledWith(
      'payouts-sweep cron completed',
      expect.objectContaining({
        olderThanMinutes: 30,
        errors: 1,
        groupsResolved: 4,
      })
    );
    // Top-level obs.error is reserved for sweep-itself-rejected, not
    // per-group timeouts that the service handled internally.
    expect(obs.error).not.toHaveBeenCalled();

    spy.mockRestore();
  });

  it('then retries failed refund clawbacks with the same age threshold, and logs the result (Codex-2hxff.8)', async () => {
    const sweep = vi
      .spyOn(SubscriptionService.prototype, 'sweepUnresolvedPayouts')
      .mockResolvedValue({
        groupsScanned: 0,
        groupsResolved: 0,
        groupsSkipped: 0,
        errors: 0,
      });
    clawbackRetry.mockResolvedValue({
      charges: 2,
      retried: 1,
      stillFailing: 1,
    });
    const { obs } = makeObs();

    await runPayoutsSweep({
      subscription: sweepService(),
      obs: obs as never,
      olderThanMinutes: 30,
    });

    expect(clawbackRetry).toHaveBeenCalledWith(30);
    expect(sweep.mock.invocationCallOrder[0] ?? 0).toBeLessThan(
      clawbackRetry.mock.invocationCallOrder[0] ?? 0
    );
    expect(obs.info).toHaveBeenCalledWith(
      'payouts-sweep cron retried failed clawbacks',
      expect.objectContaining({ charges: 2, retried: 1, stillFailing: 1 })
    );
    sweep.mockRestore();
  });

  it('a clawback retry that throws is logged and never fails the cron: the sweep result is still returned', async () => {
    const counters = {
      groupsScanned: 1,
      groupsResolved: 1,
      groupsSkipped: 0,
      errors: 0,
    };
    const sweep = vi
      .spyOn(SubscriptionService.prototype, 'sweepUnresolvedPayouts')
      .mockResolvedValue(counters);
    clawbackRetry.mockRejectedValue(new Error('database unavailable (test)'));
    const { obs } = makeObs();

    const result = await runPayoutsSweep({
      subscription: sweepService(),
      obs: obs as never,
    });

    expect(result).toEqual(counters);
    expect(obs.error).toHaveBeenCalledWith(
      'payouts-sweep cron could not retry failed clawbacks',
      expect.objectContaining({ error: 'database unavailable (test)' })
    );
    expect(obs.error).not.toHaveBeenCalledWith(
      'payouts-sweep cron failed at top level',
      expect.anything()
    );
    sweep.mockRestore();
  });
});
