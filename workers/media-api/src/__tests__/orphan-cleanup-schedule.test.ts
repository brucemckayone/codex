/**
 * Codex-r85jo.3: the OrphanedFileCleanupDO sweep actually STARTS.
 *
 * The DO's alarm is only ever set from inside the DO, and the DO is only
 * instantiated by a request to its stub. Before this bead the one route to it
 * (`/internal/orphan-cleanup/*`) had no caller anywhere in the repo, so the
 * alarm never started in production. `scheduled()` now pokes
 * `POST /ensure-scheduled` on every run of the existing hourly cron.
 *
 * The constructor ALSO sets an alarm when there is none, so "an alarm exists
 * after the poke" would pass without the poke doing anything. Each test
 * therefore seeds an alarm first and asserts what the poke did TO it.
 *
 * `scheduled()` is driven with `DATABASE_URL` removed, so its other job
 * (`runRecoverStuckTranscoding`) takes its missing-env early return and never
 * touches a database.
 */
import {
  createExecutionContext,
  createScheduledController,
  env,
  runInDurableObject,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../index';

type TestEnv = typeof env & { ORPHAN_CLEANUP_DO: DurableObjectNamespace };

const HOUR = 60 * 60 * 1000;

function singleton() {
  const ns = (env as TestEnv).ORPHAN_CLEANUP_DO;
  return ns.get(ns.idFromName('singleton'));
}

async function alarmOf(stub: DurableObjectStub): Promise<number | null> {
  return runInDurableObject(stub, (_instance, state) =>
    state.storage.getAlarm()
  );
}

async function seedAlarm(stub: DurableObjectStub, at: number): Promise<void> {
  await runInDurableObject(stub, (_instance, state) =>
    state.storage.setAlarm(at)
  );
}

async function runCron(): Promise<void> {
  const ctx = createExecutionContext();
  await worker.scheduled(
    createScheduledController({ cron: '0 * * * *' }),
    { ...env, DATABASE_URL: undefined } as never,
    ctx
  );
  await waitOnExecutionContext(ctx);
}

describe('OrphanedFileCleanupDO scheduling (Codex-r85jo.3)', () => {
  it('the cron pulls a distant alarm in to run just after itself', async () => {
    const stub = singleton();
    await seedAlarm(stub, Date.now() + 2 * HOUR);

    const before = Date.now();
    await runCron();

    const alarm = await alarmOf(stub);
    expect(alarm).not.toBeNull();
    // ~60s after the cron: inside the Neon wake the cron already paid for.
    expect(alarm).toBeGreaterThanOrEqual(before);
    expect(alarm).toBeLessThanOrEqual(Date.now() + 61_000);
  });

  it('never pushes an imminent alarm LATER (a pushing poke would starve the sweep)', async () => {
    const stub = singleton();
    const imminent = Date.now() + 2 * 60 * 1000;
    await seedAlarm(stub, imminent);

    const response = await stub.fetch(
      'https://orphan-cleanup.internal/ensure-scheduled',
      { method: 'POST' }
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { pulledIn: boolean };
    expect(body.pulledIn).toBe(false);
    expect(await alarmOf(stub)).toBe(imminent);
  });

  it('the DO can see ASSETS_BUCKET, the bucket every orphan producer writes', async () => {
    const stub = singleton();
    const bound = await runInDurableObject(
      stub,
      (instance) =>
        (instance as unknown as { env: { ASSETS_BUCKET?: unknown } }).env
          .ASSETS_BUCKET !== undefined
    );
    expect(bound).toBe(true);
  });
});
