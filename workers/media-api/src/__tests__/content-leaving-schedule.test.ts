/**
 * The leaving notice's sweep (Codex-a6ofh.6.4) rides the hourly cron. When
 * the maintenance run can't run (RunPod or the database not set up), the
 * sweep is asked for on its own: it needs neither, since content-api does
 * the work, and owners' emails and the day-30 deletes must not stop for a
 * transcoding config fault. (With them set up, it is the run's first step:
 * the maintenance suite pins that, and its failedSteps.)
 *
 * The call to content-api is intercepted. The secret is one no dev stack on
 * this machine holds, so an interception that failed could only be refused.
 */
import {
  createExecutionContext,
  createScheduledController,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import type { ContentLeavingSweepReport } from '@codex/validation';
import { CONTENT_LEAVING_SWEEP_ROUTE } from '@codex/worker-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../index';

const REPORT: ContentLeavingSweepReport = {
  claimed: 1,
  sent: 1,
  failed: 0,
  unknown: 0,
  abandoned: 0,
  cancelled: 0,
  givenBack: 0,
  notRecorded: 0,
  errors: 0,
  librariesBumped: 1,
  remindersAdded: 0,
  completed: 0,
  more: false,
};

/** The hourly cron, with RunPod not set up. */
async function runCron(overrides: Record<string, unknown> = {}) {
  const ctx = createExecutionContext();
  await worker.scheduled(
    createScheduledController({
      cron: '0 * * * *',
      // Not 03:00 UTC: no media file purge.
      scheduledTime: Date.parse('2026-11-20T10:00:00Z'),
    }),
    {
      ...env,
      RUNPOD_API_KEY: undefined,
      WORKER_SHARED_SECRET: 'not-a-dev-stack-secret',
      ...overrides,
    } as never,
    ctx
  );
  await waitOnExecutionContext(ctx);
}

/** A spy's calls, whatever it spies on. */
type Spied = { mock: { calls: ReadonlyArray<readonly unknown[]> } };

/** The fetches the cron made to the leaving route. */
function sweepCalls(fetch: Spied) {
  return fetch.mock.calls.filter(([input]) =>
    String(input instanceof Request ? input.url : input).endsWith(
      CONTENT_LEAVING_SWEEP_ROUTE
    )
  );
}

/** Whether a log line with this message went out. */
const logged = (spy: Spied, message: string) =>
  spy.mock.calls.some(([line]) => String(line).includes(message));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the leaving sweep on the hourly cron (Codex-a6ofh.6.4)', () => {
  it('is asked for, signed, even when RunPod is not set up', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ data: REPORT }), { status: 200 })
      );
    const info = vi.spyOn(console, 'info');

    await runCron();

    const calls = sweepCalls(fetch);
    expect(calls).toHaveLength(1);
    const init = calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('X-Worker-Signature')).toBeTruthy();
    expect(logged(info, 'content_leaving.swept_alone')).toBe(true);
  });

  it('a failed call is logged as the step failing, and the cron still ends', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('connection refused')
    );
    const error = vi.spyOn(console, 'error');

    await expect(runCron()).resolves.toBeUndefined();

    expect(logged(error, 'transcoding.maintenance_step_failed')).toBe(true);
    expect(
      error.mock.calls.some(([line]) => String(line).includes('contentLeaving'))
    ).toBe(true);
  });

  it('without the shared secret it asks nothing, and says why', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const error = vi.spyOn(console, 'error');

    await runCron({ WORKER_SHARED_SECRET: undefined });

    expect(sweepCalls(fetch)).toHaveLength(0);
    expect(logged(error, 'content_leaving.sweeper_unavailable')).toBe(true);
  });
});
