import { messageForLog } from '@codex/database';
import { ObservabilityClient } from '@codex/observability';
import type { Bindings } from '@codex/shared-types';
import { createWebhookServices } from '@codex/worker-utils';

/**
 * The daily purge of deleted media's files (Codex-6sbn1): a media delete
 * keeps the files 30 days, so support can bring an item back; this removes
 * them after (`MediaItemService.purgeDueFiles`), never for an item something
 * live still uses.
 *
 * Rides the EXISTING hourly production cron, at 03:00 UTC only: no new
 * trigger (the per-account cap), and it runs inside the Neon wake the hourly
 * maintenance already pays for, never on a cadence of its own. The trigger is
 * defined only in the production env, so local and test never run it.
 *
 * NEVER throws, the same contract as the other scheduled jobs.
 */
const MEDIA_FILES_PURGE_HOUR_UTC = 3;
const MEDIA_FILES_PURGE_BUDGET_MS = 3 * 60 * 1000; // after the maintenance's 10

/** Whether a cron tick at `scheduledTime` (epoch ms) runs the purge. */
export function isMediaFilesPurgeHour(scheduledTime: number): boolean {
  return new Date(scheduledTime).getUTCHours() === MEDIA_FILES_PURGE_HOUR_UTC;
}

export async function runMediaFilesPurge(
  env: Bindings,
  ctx: ExecutionContext
): Promise<void> {
  const obs = new ObservabilityClient(
    'media-api-cron',
    env.ENVIRONMENT ?? 'development'
  );

  if (!env.DATABASE_URL) {
    obs.error('media.files_purge_skipped', {
      reason: 'missing required env vars',
    });
    return;
  }

  let release: (() => void) | undefined;
  try {
    const webhook = await createWebhookServices(env, ctx, { obs });
    release = webhook.release;
    await webhook.services.media.purgeDueFiles({
      deadline: Date.now() + MEDIA_FILES_PURGE_BUDGET_MS,
    });
  } catch (error) {
    obs.error('media.files_purge_failed_to_start', {
      error: messageForLog(error),
    });
  } finally {
    release?.();
  }
}
