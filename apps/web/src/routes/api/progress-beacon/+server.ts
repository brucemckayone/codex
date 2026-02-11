import type { RequestEvent } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { createServerApi } from '$lib/server/api';

const progressEntrySchema = z.object({
  contentId: z.string().uuid(),
  positionSeconds: z.number().min(0),
  durationSeconds: z.number().positive(),
});

const beaconPayloadSchema = z.array(progressEntrySchema).min(1).max(50);

/**
 * POST /api/progress-beacon
 *
 * Receives batched playback progress from navigator.sendBeacon().
 * Authenticates via session cookie (included automatically by sendBeacon)
 * and forwards each entry to the content-api worker.
 */
export const POST = async ({ request, platform, cookies }: RequestEvent) => {
  const body = await request.json();

  const parsed = beaconPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'Invalid payload' }, { status: 400 });
  }

  const api = createServerApi(platform, cookies);
  const entries = parsed.data;

  // Fire all progress saves concurrently
  const results = await Promise.allSettled(
    entries.map((entry) => {
      const completed =
        entry.durationSeconds > 0 &&
        entry.positionSeconds / entry.durationSeconds > 0.9;

      return api.access.saveProgress(entry.contentId, {
        positionSeconds: entry.positionSeconds,
        durationSeconds: entry.durationSeconds,
        completed,
      });
    })
  );

  const failed = results.filter((r) => r.status === 'rejected').length;

  return json({ synced: entries.length - failed, failed });
};
