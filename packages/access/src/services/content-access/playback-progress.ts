/**
 * Playback-progress read/write for ContentAccessService.
 *
 * Extracted from ContentAccessService (Codex-2pryk.1.1) — behaviour-preserving.
 */

import { VIDEO_PROGRESS } from '@codex/constants';
import type { DatabaseClient } from '@codex/database';
import { content, videoPlayback } from '@codex/database/schema';
import type { ObservabilityClient } from '@codex/observability';
import { ForbiddenError } from '@codex/service-errors';
import type {
  GetPlaybackProgressInput,
  SavePlaybackProgressInput,
} from '@codex/validation';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { AccessRevocation } from '../access-revocation';

/**
 * Save playback progress (upsert pattern).
 *
 * Access gate (MANDATORY — see docs/subscription-cache-audit/phase-2-followup.md Phase 4.1):
 *   1. Resolve content's organizationId.
 *   2. If `AccessRevocation.isRevoked(userId, orgId)` returns a revocation,
 *      throw `ForbiddenError('Access revoked', { reason })`. This closes
 *      the window where a cancelled/refunded user continues to POST
 *      heartbeats and accidentally restores "continue watching" entries
 *      after their subscription ends.
 *   3. If `checkAccess(userId, contentId)` is false, throw
 *      `ForbiddenError('No active access for this content')`.
 *   4. Only then run the upsert.
 *
 * The two checks are independent — either can reject. Revocation is checked
 * first because it's a cheap KV read and catches the common case (webhook just
 * fired, DB subscription row may still look ACTIVE for up to 30s of replication
 * lag) without any DB round-trip.
 *
 * @throws {ForbiddenError} Access revoked, or user lacks access to content
 */
export async function savePlaybackProgress(
  deps: {
    db: DatabaseClient;
    obs: ObservabilityClient;
    revocation: AccessRevocation | undefined;
    checkAccess: (userId: string, contentId: string) => Promise<boolean>;
  },
  userId: string,
  input: SavePlaybackProgressInput
): Promise<void> {
  const { db, obs, revocation, checkAccess } = deps;

  // ── Access gate ────────────────────────────────────────────────────
  // (1) KV revocation check — if revocation helper is wired, fetch the
  // content's orgId and check the block list before doing any DB writes.
  // The orgId lookup uses `db` (the per-request client) and reads
  // only the two columns the check needs.
  if (revocation) {
    const contentRow = await db.query.content.findFirst({
      where: and(eq(content.id, input.contentId), isNull(content.deletedAt)),
      columns: { organizationId: true },
    });

    // Personal content (no organizationId) can't be revoked at the org
    // scope; fall through to the DB-level access check below.
    const orgId = contentRow?.organizationId ?? null;
    if (orgId) {
      const revoked = await revocation.isRevoked(userId, orgId);
      if (revoked) {
        obs.warn('savePlaybackProgress blocked — access revoked', {
          userId,
          contentId: input.contentId,
          organizationId: orgId,
          reason: revoked.reason,
        });
        throw new ForbiddenError('Access revoked', {
          reason: revoked.reason,
          contentId: input.contentId,
          organizationId: orgId,
        });
      }
    }
  }

  // (2) DB-level access check — covers cancelled subscriptions, expired
  // periods, content the user never had access to in the first place,
  // and any path the revocation list doesn't cover (e.g. personal content).
  const hasAccess = await checkAccess(userId, input.contentId);
  if (!hasAccess) {
    obs.warn('savePlaybackProgress blocked — no active access', {
      userId,
      contentId: input.contentId,
    });
    throw new ForbiddenError('No active access for this content', {
      contentId: input.contentId,
    });
  }

  // Auto-complete if watched >= completion threshold
  const completionThreshold =
    input.durationSeconds * VIDEO_PROGRESS.COMPLETION_THRESHOLD;
  const isCompleted = input.positionSeconds >= completionThreshold;

  obs.info('Saving playback progress', {
    userId,
    contentId: input.contentId,
    positionSeconds: input.positionSeconds,
    durationSeconds: input.durationSeconds,
    completed: isCompleted,
  });

  // Upsert using unique constraint with optimistic concurrency control
  // Only update if new position is greater (prevents backwards seeking overwrites)
  await db
    .insert(videoPlayback)
    .values({
      userId,
      contentId: input.contentId,
      positionSeconds: input.positionSeconds,
      durationSeconds: input.durationSeconds,
      completed: isCompleted || input.completed,
    })
    .onConflictDoUpdate({
      target: [videoPlayback.userId, videoPlayback.contentId],
      set: {
        positionSeconds: sql`GREATEST(${videoPlayback.positionSeconds}, ${input.positionSeconds})`,
        durationSeconds: input.durationSeconds,
        completed: sql`${videoPlayback.completed} OR ${isCompleted || input.completed}`,
        updatedAt: new Date(),
      },
    });

  obs.info('Playback progress saved', {
    userId,
    contentId: input.contentId,
    completed: isCompleted,
  });
}

/**
 * Get playback progress for specific content.
 *
 * @returns Progress object or null
 */
export async function getPlaybackProgress(
  deps: { db: DatabaseClient },
  userId: string,
  input: GetPlaybackProgressInput
): Promise<{
  positionSeconds: number;
  durationSeconds: number;
  completed: boolean;
  updatedAt: Date;
} | null> {
  const { db } = deps;
  const progress = await db.query.videoPlayback.findFirst({
    where: and(
      eq(videoPlayback.userId, userId),
      eq(videoPlayback.contentId, input.contentId)
    ),
  });

  if (!progress) {
    return null;
  }

  return {
    positionSeconds: progress.positionSeconds,
    durationSeconds: progress.durationSeconds,
    completed: progress.completed,
    updatedAt: progress.updatedAt,
  };
}
