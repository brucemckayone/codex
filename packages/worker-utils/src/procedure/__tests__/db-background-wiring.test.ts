/**
 * Background work that touches the DATABASE is registered with procedure()'s
 * tracker, not plain `executionCtx.waitUntil` (Codex-2hxff.2 review, H1).
 *
 * procedure() runs `pool.end()` once the tracker's tasks settle. A task handed
 * to plain `waitUntil` is invisible to that ordering, so cleanup wins the race
 * and the task's queries fail after the response: ownership emails (two
 * recipient lookups), agreement emails, and the course-plan and tier price
 * fan-outs (one subscriber read per interval) all died that way, logging at
 * most a warning. Unit tests could not see it — their pool is never torn down.
 *
 * So this pins the WIRE: each service's deferral hook must land on the tracker
 * the registry was given. DATABASE-FREE: the DB client is constructed, never
 * queried (same env shape as orphan-producer-wiring.test.ts).
 */
import type { Bindings } from '@codex/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { createServiceRegistry } from '../service-registry';
import { createBackgroundTracker } from '../upload-shared';

function testEnv(): Bindings {
  return {
    DB_METHOD: 'NEON_BRANCH',
    DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/never-connected',
    ENVIRONMENT: 'production',
    WEB_APP_URL: 'https://app.example.test',
  } as unknown as Bindings;
}

function fakeExecutionCtx() {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext & { waitUntil: ReturnType<typeof vi.fn> };
}

/** Read a private field without widening the production type. */
function waitUntilOf(service: object): (promise: Promise<unknown>) => void {
  const hook = (service as { waitUntil?: (p: Promise<unknown>) => void })
    .waitUntil;
  if (!hook) throw new Error('service was built without a waitUntil hook');
  return hook;
}

describe('DB background work is tracked, not plain waitUntil (H1)', () => {
  for (const name of [
    'organization',
    'agreements',
    'courseSubscription',
  ] as const) {
    it(`registry.${name} defers onto the tracker`, async () => {
      const ctx = fakeExecutionCtx();
      const tracker = createBackgroundTracker();
      const background = vi.spyOn(tracker, 'background');
      const { registry, cleanup } = await createServiceRegistry(
        testEnv(),
        undefined,
        undefined,
        ctx,
        undefined,
        tracker.background
      );
      try {
        waitUntilOf(registry[name])(Promise.resolve('task'));
        expect(background).toHaveBeenCalledTimes(1);
        expect(ctx.waitUntil).not.toHaveBeenCalled();
      } finally {
        await cleanup();
      }
    });
  }

  it('a rejected background task is logged, never an unhandled rejection', async () => {
    const ctx = fakeExecutionCtx();
    const tracker = createBackgroundTracker();
    const obs = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
    const { registry, cleanup } = await createServiceRegistry(
      testEnv(),
      obs as never,
      undefined,
      ctx,
      undefined,
      tracker.background
    );
    try {
      waitUntilOf(registry.organization)(Promise.reject(new Error('boom')));
      await tracker.settled();
      expect(obs.error).toHaveBeenCalledWith(
        'Background task failed after the response',
        { error: 'boom' }
      );
    } finally {
      await cleanup();
    }
  });
});

describe('createBackgroundTracker().settled()', () => {
  it('also waits for a task registered while it is already waiting', async () => {
    const tracker = createBackgroundTracker();
    const order: string[] = [];
    let releaseLate: () => void = () => {};

    tracker.background(
      (async () => {
        await Promise.resolve();
        // A fan-out deferring more DB work after the response.
        tracker.background(
          new Promise<void>((resolve) => {
            releaseLate = () => {
              order.push('late task');
              resolve();
            };
          })
        );
      })()
    );

    const settled = tracker.settled().then(() => order.push('settled'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseLate();
    await settled;

    expect(order).toEqual(['late task', 'settled']);
  });
});
