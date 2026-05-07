/**
 * Progress Cache Wiring
 *
 * Helper extracted from the `POST /api/access/content/:id/progress` route so
 * the bump-on-first-engagement conditional is unit-testable without spinning
 * up a full Hono + workerd test app.
 *
 * Contract:
 *   1. When `firstEngagement === true`, fire `invalidateUserLibrary` so the
 *      user's library KV version key bumps. The engaged-free + engaged-followers
 *      library buckets treat first engagement as a membership event, so the
 *      version bump is what makes other devices/tabs see the new library row
 *      on next staleness check.
 *   2. When `firstEngagement === false` (heartbeat updates of an existing
 *      `videoPlayback` row), do nothing. KV writes per heartbeat would be
 *      ~120/hour per active user with no benefit — library membership doesn't
 *      change on subsequent saves.
 *   3. KV failures must not surface — `invalidateUserLibrary` already swallows
 *      via `.catch()`, this helper just dispatches.
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import {
  type InvalidationLogger,
  invalidateUserLibrary,
  type WaitUntilFn,
} from '@codex/cache';

export interface BumpUserLibraryOnFirstEngagementArgs {
  firstEngagement: boolean;
  kv: KVNamespace | undefined;
  waitUntil: WaitUntilFn;
  userId: string;
  logger?: InvalidationLogger;
}

/**
 * Bump the user's library cache version IFF this save was the first
 * engagement on the content (videoPlayback row was created, not updated).
 *
 * Pure pass-through — does not return a value, does not throw, does not
 * await. Suitable for direct invocation from a route handler.
 */
export function bumpUserLibraryOnFirstEngagement(
  args: BumpUserLibraryOnFirstEngagementArgs
): void {
  if (!args.firstEngagement) return;
  invalidateUserLibrary({
    kv: args.kv,
    waitUntil: args.waitUntil,
    userId: args.userId,
    logger: args.logger,
  });
}
