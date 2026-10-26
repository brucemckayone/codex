/**
 * Where a media item's lifecycle changes are published (Codex-l2c48.9):
 * media-api's MediaStatusObject, which pushes them to the creator's studio
 * tabs. Postgres stays the source of truth; the object mirrors it.
 *
 * A service publishes only after its guarded UPDATE returned the row, so a
 * webhook delivered three times publishes once. Publishing never fails the
 * write: implementations log a lost publish, and the hourly resync heals it.
 */

import { messageForLog } from '@codex/database';
import type {
  MediaProgressTick,
  MediaStatusChange,
  MediaStatusResync,
} from '@codex/validation';
import type { MediaStatus } from './types';

/** What content-api and media-api's services both publish. */
export interface MediaStatusPublisher {
  /** A guarded write returned this row. Never throws, never awaited by it. */
  changed(change: MediaStatusChange): void;
  /** The creator deleted the item. Never throws. */
  removed(mediaId: string, creatorId: string): void;
}

/** What only media-api feeds the object: progress and the hourly resync. */
export interface MediaStatusFeed extends MediaStatusPublisher {
  /**
   * A progress webhook. The object is its only store (Postgres no longer
   * holds progress); a webhook without the creator routes to shard 0.
   * Never rejects: a lost tick is logged, and the next one supersedes it.
   */
  progress(tick: MediaProgressTick, creatorId: string | null): Promise<void>;
  /** Every non-terminal row, for the objects to correct themselves against. */
  resync(resync: MediaStatusResync): Promise<void>;
}

/** The columns of a media_items row that the object mirrors. */
export interface MediaStatusRow {
  id: string;
  creatorId: string;
  /** varchar in drizzle; media_items' CHECK holds it to MediaStatus. */
  status: string;
  transcodingErrorCode: string | null;
  transcodingAttempts: number;
  runpodJobId: string | null;
  updatedAt: Date;
}

/** A row a guarded write returned, as the object is told it. */
export function toMediaStatusChange(row: MediaStatusRow): MediaStatusChange {
  return {
    mediaId: row.id,
    creatorId: row.creatorId,
    lifecycle: row.status as MediaStatus,
    errorCode: row.transcodingErrorCode,
    attempts: row.transcodingAttempts,
    jobId: row.runpodJobId,
    at: row.updatedAt.getTime(),
  };
}

/** Where publishMediaStatus logs a lost publish: any service's `obs`. */
interface PublishLog {
  error(message: string, metadata?: Record<string, unknown>): void;
}

/**
 * Publish a row a guarded write returned. Never throws: the write it reports
 * has committed, so a fault here may cost the studio a live update (the
 * hourly resync heals it), never the caller its answer.
 */
export function publishMediaStatus(
  publisher: MediaStatusPublisher | undefined,
  row: MediaStatusRow,
  log?: PublishLog
): void {
  if (!publisher) return;
  try {
    publisher.changed(toMediaStatusChange(row));
  } catch (error) {
    log?.error('media_status.publish_failed', {
      mediaId: row.id,
      error: messageForLog(error),
    });
  }
}
