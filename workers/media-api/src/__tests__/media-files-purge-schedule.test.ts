/**
 * The daily media file purge rides the existing hourly cron (Codex-6sbn1):
 * it runs on the 03:00 UTC tick only, so there is no trigger of its own and
 * no Neon wake of its own, and like its neighbours it NEVER throws, since a
 * scheduled handler that throws crashes the invocation.
 *
 * The purge itself (`MediaItemService.purgeDueFiles`) is tested against a
 * real database in @codex/content.
 */
import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  isMediaFilesPurgeHour,
  runMediaFilesPurge,
} from '../media-files-purge';

const at = (iso: string) => new Date(iso).getTime();

describe('the media file purge step', () => {
  it('runs on the 03:00 UTC tick and no other', () => {
    expect(isMediaFilesPurgeHour(at('2026-10-30T03:00:00Z'))).toBe(true);
    // A late-fired tick is still the 03 hour.
    expect(isMediaFilesPurgeHour(at('2026-10-30T03:00:41Z'))).toBe(true);
    for (const hour of ['00', '02', '04', '12', '23']) {
      expect(isMediaFilesPurgeHour(at(`2026-10-30T${hour}:00:00Z`))).toBe(
        false
      );
    }
    // 03:00 in London summer time is 02:00 UTC: the gate is UTC.
    expect(isMediaFilesPurgeHour(at('2026-07-01T03:00:00+01:00'))).toBe(false);
  });

  it('never throws when it cannot run', async () => {
    const ctx = createExecutionContext();
    await expect(
      runMediaFilesPurge({ ...env, DATABASE_URL: undefined } as never, ctx)
    ).resolves.toBeUndefined();
    await waitOnExecutionContext(ctx);
  });
});
