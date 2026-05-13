/**
 * payouts-sweep — handler tests (Codex-vv77x)
 *
 * Asserts the scheduled handler:
 *   - constructs SubscriptionService.sweepUnresolvedPayouts via injected deps
 *   - does NOT throw when the service rejects (cron crash protection)
 *   - exits cleanly when required env vars are missing
 *   - forwards `olderThanMinutes` override to the service
 */

import { describe, expect, it, vi } from 'vitest';

import { runPayoutsSweep, runScheduledSweep } from '../sweep';

// Construct a minimal-ish Bindings stub. The handler only reads
// DATABASE_URL, STRIPE_SECRET_KEY, and ENVIRONMENT.
function makeEnv(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
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

describe('payouts-sweep handler', () => {
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
      db: {} as never,
      stripe: {} as never,
      obs: obs as never,
      environment: 'test',
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
      db: {} as never,
      stripe: {} as never,
      obs: obs as never,
      environment: 'test',
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

  it('runScheduledSweep exits cleanly when DATABASE_URL is missing and never touches the service', async () => {
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

    await runScheduledSweep(env as never, { obs: obs as never });

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

  it('runScheduledSweep invokes sweepUnresolvedPayouts when env is configured', async () => {
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

    // Pass pre-built db + stripe stubs so we don't need real connections.
    await runScheduledSweep(makeEnv() as never, {
      db: {} as never,
      stripe: {} as never,
      obs: obs as never,
    });

    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });
});
