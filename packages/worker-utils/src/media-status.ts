/**
 * Reaching media-api's MediaStatusObject (Codex-l2c48.9).
 *
 * Every caller addresses the object through `statusObjectFor`, which spreads
 * creators over MEDIA_STATUS_SHARD_COUNT objects. Calls are `fetch` with a
 * small JSON protocol, not RPC, so the same code works from a `wrangler dev`
 * session of its own.
 *
 * Two publishers implement the services' MediaStatusPublisher:
 * - media-api, which binds the object: DurableObjectMediaStatusFeed;
 * - a worker without the binding (content-api): WorkerMediaStatusPublisher,
 *   which POSTs to media-api's /internal/media-status with worker HMAC.
 * Neither ever fails the write it reports: a lost publish is logged, and the
 * hourly resync puts the object right.
 */

import { messageForLog } from '@codex/database';
import type { ObservabilityClient } from '@codex/observability';
import { workerFetch } from '@codex/security';
import { InternalServiceError } from '@codex/service-errors';
import type { MediaStatusFeed, MediaStatusPublisher } from '@codex/transcoding';
import type {
  MediaProgressTick,
  MediaStatusChange,
  MediaStatusEvent,
  MediaStatusResync,
} from '@codex/validation';

/**
 * How many objects the status is spread over. One object handles roughly
 * 200-1,000 requests/s; raise this only when that is near. A deploy already
 * drops every socket, and the object holds nothing Postgres can't rebuild,
 * so re-sharding loses at most a progress tick.
 */
export const MEDIA_STATUS_SHARD_COUNT = 1;

/** The object's routes. Only media-api's Worker can reach them. */
export const MEDIA_STATUS_OBJECT_PATHS = {
  connect: '/connect',
  publish: '/publish',
  removed: '/removed',
  progress: '/progress',
  resync: '/resync',
} as const;

/** Set on /connect by the media-api Worker once it has verified the ticket. */
export const MEDIA_STATUS_CONNECT_HEADERS = {
  creatorId: 'X-Media-Status-Creator',
  sessionExpiresAt: 'X-Media-Status-Session-Expires-At',
} as const;

/** media-api's route for a worker that does not bind the object. */
export const MEDIA_STATUS_INTERNAL_ROUTE = '/internal/media-status';

/**
 * The shard a creator's items live on (FNV-1a of the id). A progress webhook
 * from a handler that predates the creator echo has no creator: it goes to
 * shard 0, which is only right while MEDIA_STATUS_SHARD_COUNT is 1 (a test
 * pins that).
 */
export function mediaStatusShardOf(creatorId: string | null): number {
  if (creatorId === null) return 0;
  let hash = 0x811c9dc5;
  for (let i = 0; i < creatorId.length; i++) {
    hash ^= creatorId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % MEDIA_STATUS_SHARD_COUNT;
}

function shardStub(
  namespace: DurableObjectNamespace,
  shard: number
): DurableObjectStub {
  return namespace.get(namespace.idFromName(`media-status:${shard}`));
}

/** The ONLY way to address a creator's status object. */
export function statusObjectFor(
  namespace: DurableObjectNamespace,
  creatorId: string | null
): DurableObjectStub {
  return shardStub(namespace, mediaStatusShardOf(creatorId));
}

/** POST a JSON body to one of the object's routes; throws unless 2xx. */
async function postToObject(
  stub: DurableObjectStub,
  path: string,
  body: unknown
): Promise<void> {
  // A stub routes on the path alone; the host is never resolved.
  const response = await stub.fetch(`https://media-status.internal${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new InternalServiceError(
      `media status object answered ${response.status}`
    );
  }
}

/**
 * Deliver one lifecycle event to its creator's object, awaited. Throws
 * unless the object took it. media-api's /internal/media-status calls this.
 */
export async function deliverMediaStatusEvent(
  namespace: DurableObjectNamespace,
  event: MediaStatusEvent
): Promise<void> {
  if (event.event === 'changed') {
    await postToObject(
      statusObjectFor(namespace, event.change.creatorId),
      MEDIA_STATUS_OBJECT_PATHS.publish,
      event.change
    );
    return;
  }
  await postToObject(
    statusObjectFor(namespace, event.creatorId),
    MEDIA_STATUS_OBJECT_PATHS.removed,
    { mediaId: event.mediaId, creatorId: event.creatorId }
  );
}

type WaitUntil = (promise: Promise<unknown>) => void;

/** A publish after the response: it never fails the write, a loss is logged. */
function publishInBackground(
  waitUntil: WaitUntil,
  obs: ObservabilityClient | undefined,
  event: MediaStatusEvent,
  deliver: () => Promise<void>
): void {
  waitUntil(
    deliver().catch((error: unknown) => {
      obs?.error('media_status.publish_failed', {
        event: event.event,
        mediaId:
          event.event === 'changed' ? event.change.mediaId : event.mediaId,
        error: messageForLog(error),
      });
    })
  );
}

/** media-api's publisher: straight to the object through its binding. */
export class DurableObjectMediaStatusFeed implements MediaStatusFeed {
  constructor(
    private readonly namespace: DurableObjectNamespace,
    private readonly waitUntil: WaitUntil,
    private readonly obs?: ObservabilityClient
  ) {}

  changed(change: MediaStatusChange): void {
    this.publish({ event: 'changed', change });
  }

  removed(mediaId: string, creatorId: string): void {
    this.publish({ event: 'removed', mediaId, creatorId });
  }

  async progress(
    tick: MediaProgressTick,
    creatorId: string | null
  ): Promise<boolean> {
    try {
      await postToObject(
        statusObjectFor(this.namespace, creatorId),
        MEDIA_STATUS_OBJECT_PATHS.progress,
        tick
      );
      return true;
    } catch (error) {
      // Advisory: the next tick, or the completion, supersedes it.
      this.obs?.warn('media_status.progress_not_delivered', {
        mediaId: tick.mediaId,
        error: messageForLog(error),
      });
      return false;
    }
  }

  /** Every shard hears its rows, even none: an empty list clears it. Throws. */
  async resync(resync: MediaStatusResync): Promise<void> {
    for (let shard = 0; shard < MEDIA_STATUS_SHARD_COUNT; shard++) {
      await postToObject(
        shardStub(this.namespace, shard),
        MEDIA_STATUS_OBJECT_PATHS.resync,
        {
          ...resync,
          rows: resync.rows.filter(
            (row) => mediaStatusShardOf(row.creatorId) === shard
          ),
        }
      );
    }
  }

  private publish(event: MediaStatusEvent): void {
    publishInBackground(this.waitUntil, this.obs, event, () =>
      deliverMediaStatusEvent(this.namespace, event)
    );
  }
}

/** A worker without the binding: through media-api, with worker HMAC. */
export class WorkerMediaStatusPublisher implements MediaStatusPublisher {
  constructor(
    private readonly mediaApiUrl: string,
    private readonly workerSecret: string,
    private readonly waitUntil: WaitUntil,
    private readonly obs?: ObservabilityClient
  ) {}

  changed(change: MediaStatusChange): void {
    this.publish({ event: 'changed', change });
  }

  removed(mediaId: string, creatorId: string): void {
    this.publish({ event: 'removed', mediaId, creatorId });
  }

  private publish(event: MediaStatusEvent): void {
    publishInBackground(this.waitUntil, this.obs, event, async () => {
      const response = await workerFetch(
        `${this.mediaApiUrl}${MEDIA_STATUS_INTERNAL_ROUTE}`,
        {
          method: 'POST',
          body: JSON.stringify(event),
          signal: AbortSignal.timeout(5_000),
        },
        this.workerSecret
      );
      if (!response.ok) {
        throw new InternalServiceError(`media-api answered ${response.status}`);
      }
    });
  }
}
