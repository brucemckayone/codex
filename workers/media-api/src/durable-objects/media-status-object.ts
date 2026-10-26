/**
 * MediaStatusObject (Codex-l2c48.9): live media status for studio tabs.
 *
 * Postgres keeps every media item's lifecycle. This object mirrors the
 * in-flight ones (uploading, uploaded, transcoding) and adds what is
 * transient: upload % from the uploading tab, the transcode step and %, the
 * next automatic retry. Studio tabs hold a hibernating WebSocket each and are
 * pushed every change to their own creator's items.
 *
 * Addressed only through statusObjectFor() (@codex/worker-utils), which
 * spreads creators over MEDIA_STATUS_SHARD_COUNT objects (1 today). Reached
 * only through media-api's Worker: `fetch` with a small JSON protocol
 * (MEDIA_STATUS_OBJECT_PATHS), because a cross-session `wrangler dev` cannot
 * do RPC.
 *
 * - publish: a service's guarded write returned a row. An older change than
 *   the one held is ignored. A terminal one (ready, failed) is broadcast,
 *   then the row is deleted, so an idle object holds nothing.
 * - progress: a transcoding tick, applied only while the row is
 *   `transcoding` and holds that job (or none yet): a stale job's tick is
 *   dropped without a database read.
 * - resync: the hourly cron's every non-terminal row; rows it lacks are
 *   dropped unless they changed in the last RESYNC_GRACE_MS.
 * - alarm: an item waiting for the transcoder is retried at 1, 3 and
 *   10 minutes (RETRY_DELAYS_MS); after that the hourly cron carries on.
 */

import type {
  WebSocket as CfWebSocket,
  DurableObjectState,
} from '@cloudflare/workers-types';
import {
  isWaitingForTranscoder,
  MAX_TRANSCODING_ATTEMPTS,
  MEDIA_STATUS,
} from '@codex/constants';
import { messageForLog } from '@codex/database';
import { ObservabilityClient } from '@codex/observability';
import type { Bindings } from '@codex/shared-types';
import type { MediaStatusFeed, RetryDueReport } from '@codex/transcoding';
import {
  MEDIA_STATUS_CLIENT_MESSAGE_MAX_BYTES,
  MEDIA_STATUS_PROTOCOL_VERSION,
  MEDIA_STATUS_RESYNC_MAX_ROWS,
  MEDIA_STATUS_SUBPROTOCOL,
  type MediaItemState,
  type MediaProgressTick,
  type MediaStatusChange,
  type MediaStatusResync,
  type MediaStatusServerMessage,
  mediaProgressTickSchema,
  mediaStatusChangeSchema,
  mediaStatusClientMessageSchema,
  mediaStatusRemovedSchema,
  mediaStatusResyncSchema,
  type TranscodingStep,
} from '@codex/validation';
import {
  createWebhookServices,
  MEDIA_STATUS_CONNECT_HEADERS,
  MEDIA_STATUS_OBJECT_PATHS,
} from '@codex/worker-utils';
import { z } from 'zod';

/** Alarm retries for an item waiting on the transcoder; then the hourly cron. */
export const RETRY_DELAYS_MS = [60_000, 180_000, 600_000] as const;

/** A resync never drops a row changed this recently: a write raced its read. */
export const RESYNC_GRACE_MS = 5 * 60_000;

/** One client message a second per socket; the uploading tab sends one per 2 s. */
const CLIENT_MESSAGE_INTERVAL_MS = 1_000;

/** Close code for a socket whose session ended (4000-4999 are ours). */
const SESSION_EXPIRED_CLOSE = 4401;

/**
 * Open tabs one creator may hold. Every creator shares one object (and its
 * 32,768-socket ceiling), so one account must not be able to fill it.
 */
const MAX_TABS_PER_CREATOR = 20;

/** A resync whose rows are not yet validated one by one. */
const resyncEnvelopeSchema = mediaStatusResyncSchema.extend({
  rows: z.array(z.unknown()).max(MEDIA_STATUS_RESYNC_MAX_ROWS),
});

interface Row extends Record<string, string | number | null> {
  media_id: string;
  creator_id: string;
  lifecycle: string;
  error_code: string | null;
  attempts: number;
  job_id: string | null;
  step: string | null;
  progress: number | null;
  upload_pct: number | null;
  /** Null with a % held: the uploading tab closed ("Upload stopped"). */
  upload_socket: string | null;
  retry_at: number | null;
  retries: number;
  version: number;
  updated_at: number;
}

interface SocketAttachment {
  creatorId: string;
  sessionExpiresAt: number;
  socketId: string;
  lastMessageAt: number;
}

const TERMINAL: ReadonlySet<string> = new Set([
  MEDIA_STATUS.READY,
  MEDIA_STATUS.FAILED,
]);

function creatorTag(creatorId: string): string {
  return `creator:${creatorId}`;
}

/** What `socketId`'s tab is shown of a row. */
function itemState(row: Row, socketId: string): MediaItemState {
  return {
    mediaId: row.media_id,
    lifecycle: row.lifecycle as MediaItemState['lifecycle'],
    errorCode: row.error_code,
    attemptsLeft: Math.max(0, MAX_TRANSCODING_ATTEMPTS - row.attempts),
    step: row.step as TranscodingStep | null,
    progress: row.progress,
    upload:
      row.upload_pct === null
        ? null
        : {
            pct: row.upload_pct,
            here: row.upload_socket === socketId,
            stopped: row.upload_socket === null,
          },
    retryAt: row.retry_at,
    version: row.version,
  };
}

/** WebSocket.OPEN: the socket can still be sent to. */
const WEBSOCKET_OPEN = 1;

/** A header's number, or NaN when it is absent (Number(null) would be 0). */
function numberOrNaN(value: string | null): number {
  return value === null ? Number.NaN : Number(value);
}

/** A change the held row already reflects. */
function isSameChange(held: Row, change: MediaStatusChange): boolean {
  return (
    change.at === held.updated_at &&
    held.lifecycle === change.lifecycle &&
    held.error_code === change.errorCode &&
    held.attempts === change.attempts &&
    held.job_id === change.jobId
  );
}

/** The row a change leaves. */
function nextRow(held: Row | null, change: MediaStatusChange): Row {
  return {
    media_id: change.mediaId,
    creator_id: change.creatorId,
    lifecycle: change.lifecycle,
    error_code: change.errorCode,
    attempts: change.attempts,
    job_id: change.jobId,
    ...progressOf(held, change),
    ...uploadOf(held, change),
    retry_at: nextRetryAt(held, change),
    retries: held?.retries ?? 0,
    version: (held?.version ?? 0) + 1,
    updated_at: change.at,
  };
}

/** A new claim starts at 0; the job-id write keeps the ticks so far. */
function progressOf(
  held: Row | null,
  change: MediaStatusChange
): Pick<Row, 'step' | 'progress'> {
  if (change.lifecycle !== MEDIA_STATUS.TRANSCODING) {
    return { step: null, progress: null };
  }
  const sameJob =
    held?.lifecycle === MEDIA_STATUS.TRANSCODING &&
    (held.job_id === null || held.job_id === change.jobId);
  return sameJob
    ? { step: held.step, progress: held.progress ?? 0 }
    : { step: null, progress: 0 };
}

/** The uploading tab's % lasts while the item uploads. */
function uploadOf(
  held: Row | null,
  change: MediaStatusChange
): Pick<Row, 'upload_pct' | 'upload_socket'> {
  return change.lifecycle === MEDIA_STATUS.UPLOADING && held
    ? { upload_pct: held.upload_pct, upload_socket: held.upload_socket }
    : { upload_pct: null, upload_socket: null };
}

/** An alarm already due keeps its time; a new wait takes the next delay. */
function nextRetryAt(
  held: Row | null,
  change: MediaStatusChange
): number | null {
  if (!isWaitingForTranscoder(change.lifecycle, change.errorCode)) return null;
  if (held?.retry_at != null) return held.retry_at;
  const delay = RETRY_DELAYS_MS[held?.retries ?? 0];
  return delay === undefined ? null : Date.now() + delay;
}

export class MediaStatusObject {
  private readonly state: DurableObjectState;
  private readonly env: Bindings;
  private readonly obs: ObservabilityClient;

  constructor(state: DurableObjectState, env: Bindings) {
    this.state = state;
    this.env = env;
    this.obs = new ObservabilityClient(
      'media-status-object',
      env.ENVIRONMENT ?? 'development'
    );
    const sql = state.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS items (
      media_id TEXT PRIMARY KEY,
      creator_id TEXT NOT NULL,
      lifecycle TEXT NOT NULL,
      error_code TEXT,
      attempts INTEGER NOT NULL,
      job_id TEXT,
      step TEXT,
      progress INTEGER,
      upload_pct INTEGER,
      upload_socket TEXT,
      retry_at INTEGER,
      retries INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    sql.exec('CREATE INDEX IF NOT EXISTS items_creator ON items (creator_id)');
    sql.exec(
      'CREATE INDEX IF NOT EXISTS items_retry ON items (retry_at) WHERE retry_at IS NOT NULL'
    );
    // Tickets already presented, until they expire: a ticket is single-use,
    // so one copied out of a request log is dead once its tab has used it.
    sql.exec(`CREATE TABLE IF NOT EXISTS used_tickets (
      id TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    )`);
    // A heartbeat answered without waking the object.
    state.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('ping', 'pong')
    );
  }

  // ==========================================================================
  // Routes (media-api's Worker only)
  // ==========================================================================

  /** media-api's Worker only. Invoked by workerd, so no static caller. */
  // fallow-ignore-next-line unused-class-member
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    try {
      switch (pathname) {
        case MEDIA_STATUS_OBJECT_PATHS.connect:
          return this.connect(request);
        case MEDIA_STATUS_OBJECT_PATHS.publish:
          await this.applyChange(
            mediaStatusChangeSchema.parse(await request.json())
          );
          return new Response(null, { status: 204 });
        case MEDIA_STATUS_OBJECT_PATHS.removed: {
          const { mediaId, creatorId } = mediaStatusRemovedSchema.parse(
            await request.json()
          );
          await this.applyRemoved(mediaId, creatorId);
          return new Response(null, { status: 204 });
        }
        case MEDIA_STATUS_OBJECT_PATHS.progress:
          this.applyProgress(
            mediaProgressTickSchema.parse(await request.json())
          );
          return new Response(null, { status: 204 });
        case MEDIA_STATUS_OBJECT_PATHS.resync:
          await this.applyResync(
            this.readResync(resyncEnvelopeSchema.parse(await request.json()))
          );
          return new Response(null, { status: 204 });
        default:
          return new Response('Not found', { status: 404 });
      }
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof SyntaxError) {
        // Only our own services call these routes: a body they cannot form
        // is a bug, so it is loud.
        this.obs.error('media_status.object_bad_request', {
          path: pathname,
          error: messageForLog(error),
        });
        return new Response('Bad request', { status: 400 });
      }
      throw error;
    }
  }

  /** Accept a studio tab. The Worker has verified its ticket and origin. */
  private connect(request: Request): Response {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }
    const headers = request.headers;
    const creatorId = headers.get(MEDIA_STATUS_CONNECT_HEADERS.creatorId);
    const ticketId = headers.get(MEDIA_STATUS_CONNECT_HEADERS.ticketId);
    const sessionExpiresAt = numberOrNaN(
      headers.get(MEDIA_STATUS_CONNECT_HEADERS.sessionExpiresAt)
    );
    const ticketExpiresAt = numberOrNaN(
      headers.get(MEDIA_STATUS_CONNECT_HEADERS.ticketExpiresAt)
    );
    if (
      !creatorId ||
      !ticketId ||
      !Number.isFinite(sessionExpiresAt) ||
      !Number.isFinite(ticketExpiresAt)
    ) {
      // Only media-api's Worker calls this: a missing header is its bug.
      this.obs.error('media_status.connect_bad_headers', {
        hasCreator: Boolean(creatorId),
        hasTicket: Boolean(ticketId),
        hasSessionExpiry: Number.isFinite(sessionExpiresAt),
        hasTicketExpiry: Number.isFinite(ticketExpiresAt),
      });
      return new Response('Missing connect headers', { status: 400 });
    }
    if (!this.claimTicket(ticketId, ticketExpiresAt)) {
      return new Response('Ticket already used', { status: 401 });
    }
    if (
      this.state.getWebSockets(creatorTag(creatorId)).length >=
      MAX_TABS_PER_CREATOR
    ) {
      return new Response('Too many open tabs', { status: 429 });
    }

    const [client, server] = Object.values(new WebSocketPair());
    this.state.acceptWebSocket(server as unknown as CfWebSocket, [
      creatorTag(creatorId),
    ]);
    const attachment: SocketAttachment = {
      creatorId,
      sessionExpiresAt,
      socketId: crypto.randomUUID(),
      lastMessageAt: 0,
    };
    server.serializeAttachment(attachment);
    this.send(server, attachment, {
      v: MEDIA_STATUS_PROTOCOL_VERSION,
      type: 'snapshot',
      items: this.rowsOf(creatorId).map((row) =>
        itemState(row, attachment.socketId)
      ),
      at: Date.now(),
    });
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { 'Sec-WebSocket-Protocol': MEDIA_STATUS_SUBPROTOCOL },
    });
  }

  // ==========================================================================
  // Writes
  // ==========================================================================

  /**
   * A guarded write's row. Older than what is held: ignored. The same again
   * (the hourly resync, a repeated delivery): nothing to tell anyone.
   */
  async applyChange(change: MediaStatusChange): Promise<void> {
    const held = this.row(change.mediaId);
    if (held && !this.isNews(held, change)) return;
    const row = nextRow(held, change);
    if (TERMINAL.has(change.lifecycle)) {
      // The final state goes out, then the row: nothing to keep.
      this.state.storage.sql.exec(
        'DELETE FROM items WHERE media_id = ?',
        change.mediaId
      );
    } else {
      this.write(row);
    }
    this.broadcast(row);
    // A terminal row's retry_at is null: its alarm moves only if it had one.
    if ((held?.retry_at ?? null) !== row.retry_at) await this.rescheduleAlarm();
  }

  /** Whether a change tells the held row anything; the suspect ones logged. */
  private isNews(held: Row, change: MediaStatusChange): boolean {
    if (held.creator_id !== change.creatorId) {
      // An item never changes creator: a publisher bug, not a move.
      this.obs.error('media_status.change_creator_mismatch', {
        mediaId: change.mediaId,
      });
      return false;
    }
    if (change.at < held.updated_at) {
      // Stamped by different machines' clocks: say so when it was news.
      if (!isSameChange(held, { ...change, at: held.updated_at })) {
        this.obs.warn('media_status.change_dropped_as_stale', {
          mediaId: change.mediaId,
          skewMs: held.updated_at - change.at,
        });
      }
      return false;
    }
    return !isSameChange(held, change);
  }

  async applyRemoved(mediaId: string, creatorId: string): Promise<void> {
    const held = this.row(mediaId);
    if (held && held.creator_id === creatorId) await this.remove(held);
  }

  /** A tick for the row's own job (or one not yet stored), when it moves. */
  applyProgress(tick: MediaProgressTick): void {
    const rows = this.state.storage.sql
      .exec<Row>(
        `UPDATE items SET step = ?, progress = ?, version = version + 1
         WHERE media_id = ? AND lifecycle = ?
           AND (job_id IS NULL OR job_id = ?)
           AND (step IS NOT ? OR progress IS NOT ?)
         RETURNING *`,
        tick.step,
        tick.progress,
        tick.mediaId,
        MEDIA_STATUS.TRANSCODING,
        tick.jobId,
        tick.step,
        tick.progress
      )
      .toArray();
    for (const row of rows) this.broadcast(row);
  }

  async applyResync({
    rows,
    asOf,
    complete,
  }: MediaStatusResync): Promise<void> {
    for (const change of rows) await this.applyChange(change);
    // A capped read cannot say a row is gone.
    if (!complete) return;
    const listed = new Set(rows.map((row) => row.mediaId));
    for (const held of this.allRows()) {
      if (listed.has(held.media_id)) continue;
      if (held.updated_at > asOf - RESYNC_GRACE_MS) continue;
      // Terminal or deleted, and its publish was lost: the tab refetches.
      await this.remove(held);
    }
  }

  private async remove(held: Row): Promise<void> {
    this.state.storage.sql.exec(
      'DELETE FROM items WHERE media_id = ? AND creator_id = ?',
      held.media_id,
      held.creator_id
    );
    this.toCreator(held.creator_id, () => ({
      v: MEDIA_STATUS_PROTOCOL_VERSION,
      type: 'removed',
      mediaId: held.media_id,
    }));
    if (held.retry_at !== null) await this.rescheduleAlarm();
  }

  // ==========================================================================
  // Sockets (Hibernation API)
  // ==========================================================================

  /**
   * The uploading tab's %; everything else a tab sends is dropped. Invoked
   * by workerd (Hibernation API), so no static caller.
   */
  // fallow-ignore-next-line unused-class-member
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    const attachment = this.attachmentOf(ws);
    if (!attachment) return;
    // A session that ended stops writing, not only reading.
    if (this.closeIfExpired(ws, attachment)) return;
    if (
      typeof message !== 'string' ||
      message.length > MEDIA_STATUS_CLIENT_MESSAGE_MAX_BYTES
    ) {
      return;
    }
    const now = Date.now();
    if (now - attachment.lastMessageAt < CLIENT_MESSAGE_INTERVAL_MS) return;
    attachment.lastMessageAt = now;
    ws.serializeAttachment(attachment);

    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }
    const upload = mediaStatusClientMessageSchema.safeParse(parsed);
    if (!upload.success) return;

    // Only the creator's own item, and only while it uploads.
    const rows = this.state.storage.sql
      .exec<Row>(
        `UPDATE items SET upload_pct = ?, upload_socket = ?, version = version + 1
         WHERE media_id = ? AND creator_id = ? AND lifecycle = ?
           AND (upload_pct IS NOT ? OR upload_socket IS NOT ?)
         RETURNING *`,
        upload.data.pct,
        attachment.socketId,
        upload.data.mediaId,
        attachment.creatorId,
        MEDIA_STATUS.UPLOADING,
        upload.data.pct,
        attachment.socketId
      )
      .toArray();
    for (const row of rows) this.broadcast(row);
  }

  /** Invoked by workerd (Hibernation API), so no static caller. */
  // fallow-ignore-next-line unused-class-member
  webSocketClose(ws: WebSocket, code: number, reason: string): void {
    this.releaseUploads(ws);
    // Before compatibility date 2026-04-07 the runtime does not answer the
    // close itself. 1005/1006 are reserved: they cannot be sent back.
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {
      // Already closed.
    }
  }

  /** Invoked by workerd (Hibernation API), so no static caller. */
  // fallow-ignore-next-line unused-class-member
  webSocketError(ws: WebSocket): void {
    this.releaseUploads(ws);
  }

  /** A closed uploading tab: its items read "Upload stopped" at once (2A). */
  private releaseUploads(ws: WebSocket): void {
    const attachment = this.attachmentOf(ws);
    if (!attachment) return;
    const rows = this.state.storage.sql
      .exec<Row>(
        `UPDATE items SET upload_socket = NULL, version = version + 1
         WHERE upload_socket = ? AND lifecycle = ?
         RETURNING *`,
        attachment.socketId,
        MEDIA_STATUS.UPLOADING
      )
      .toArray();
    for (const row of rows) this.broadcast(row);
  }

  // ==========================================================================
  // Alarm: waiting uploads retried within minutes
  // ==========================================================================

  /** The earliest due retry's alarm. Invoked by workerd, so no static caller. */
  // fallow-ignore-next-line unused-class-member
  async alarm(): Promise<void> {
    const now = Date.now();
    const due = this.state.storage.sql
      .exec<{ media_id: string }>(
        'SELECT media_id FROM items WHERE retry_at IS NOT NULL AND retry_at <= ?',
        now
      )
      .toArray()
      .map((row) => row.media_id);
    if (due.length === 0) return;
    // Counted and cleared first, so a retry that throws cannot loop. One that
    // fails is the hourly cron's (its waiting step retries the same rows).
    for (const mediaId of due) {
      this.state.storage.sql.exec(
        'UPDATE items SET retry_at = NULL, retries = retries + 1 WHERE media_id = ?',
        mediaId
      );
    }
    try {
      await this.rescheduleAlarm();
    } catch (error) {
      this.obs.error('media_status.alarm_reschedule_failed', {
        due: due.length,
        error: messageForLog(error),
      });
    }
    try {
      const report = await this.retry(due);
      this.obs.info('media_status.alarm_retried', { ...report });
    } catch (error) {
      this.obs.error('media_status.alarm_retry_failed', {
        due: due.length,
        fallback: 'hourly_cron',
        error: messageForLog(error),
      });
    }
  }

  /**
   * The cron's claim and dispatch, for the due items, with the cron's stop
   * after a refusal. Its writes publish to this object directly (localFeed),
   * not back through a stub.
   */
  async retry(mediaIds: readonly string[]): Promise<RetryDueReport> {
    const webhook = await createWebhookServices(
      this.env,
      {
        waitUntil: (promise) => this.state.waitUntil(promise),
        passThroughOnException: () => {},
        props: {},
      },
      { obs: this.obs, mediaStatus: this.localFeed }
    );
    try {
      return await webhook.services.transcodingMaintenance.retryDue(mediaIds);
    } finally {
      webhook.release();
    }
  }

  /** A feed into this object, for the services the alarm runs. */
  private readonly localFeed: MediaStatusFeed = {
    changed: (change) => {
      this.publishLocally('changed', change.mediaId, this.applyChange(change));
    },
    removed: (mediaId, creatorId) => {
      this.publishLocally(
        'removed',
        mediaId,
        this.applyRemoved(mediaId, creatorId)
      );
    },
    progress: async (tick) => {
      try {
        this.applyProgress(tick);
      } catch (error) {
        this.obs.warn('media_status.progress_not_delivered', {
          mediaId: tick.mediaId,
          error: messageForLog(error),
        });
      }
    },
    resync: (resync) => this.applyResync(resync),
  };

  /** As the Worker's publishers: a loss is logged, never thrown. */
  private publishLocally(
    event: 'changed' | 'removed',
    mediaId: string,
    applied: Promise<void>
  ): void {
    this.state.waitUntil(
      applied.catch((error: unknown) => {
        this.obs.error('media_status.publish_failed', {
          event,
          mediaId,
          source: 'alarm',
          error: messageForLog(error),
        });
      })
    );
  }

  /** One alarm, at the earliest due retry. */
  private async rescheduleAlarm(): Promise<void> {
    const next = this.state.storage.sql
      .exec<{ at: number | null }>(
        'SELECT MIN(retry_at) AS at FROM items WHERE retry_at IS NOT NULL'
      )
      .one().at;
    const current = await this.state.storage.getAlarm();
    if (next === null) {
      if (current !== null) await this.state.storage.deleteAlarm();
      return;
    }
    // Each setAlarm is a row written: only when it moves.
    if (current !== next) await this.state.storage.setAlarm(next);
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private row(mediaId: string): Row | null {
    const rows = this.state.storage.sql
      .exec<Row>('SELECT * FROM items WHERE media_id = ?', mediaId)
      .toArray();
    return rows[0] ?? null;
  }

  private rowsOf(creatorId: string): Row[] {
    return this.state.storage.sql
      .exec<Row>('SELECT * FROM items WHERE creator_id = ?', creatorId)
      .toArray();
  }

  private allRows(): Row[] {
    return this.state.storage.sql.exec<Row>('SELECT * FROM items').toArray();
  }

  private write(row: Row): void {
    this.state.storage.sql.exec(
      `INSERT INTO items (media_id, creator_id, lifecycle, error_code, attempts,
         job_id, step, progress, upload_pct, upload_socket, retry_at,
         retries, version, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (media_id) DO UPDATE SET
         creator_id = excluded.creator_id, lifecycle = excluded.lifecycle,
         error_code = excluded.error_code, attempts = excluded.attempts,
         job_id = excluded.job_id, step = excluded.step,
         progress = excluded.progress, upload_pct = excluded.upload_pct,
         upload_socket = excluded.upload_socket, retry_at = excluded.retry_at,
         retries = excluded.retries, version = excluded.version,
         updated_at = excluded.updated_at`,
      row.media_id,
      row.creator_id,
      row.lifecycle,
      row.error_code,
      row.attempts,
      row.job_id,
      row.step,
      row.progress,
      row.upload_pct,
      row.upload_socket,
      row.retry_at,
      row.retries,
      row.version,
      row.updated_at
    );
  }

  private attachmentOf(ws: WebSocket): SocketAttachment | null {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    return attachment && typeof attachment.socketId === 'string'
      ? attachment
      : null;
  }

  /** One message to each of a creator's tabs, made for that tab. */
  private toCreator(
    creatorId: string,
    message: (socketId: string) => MediaStatusServerMessage
  ): void {
    for (const ws of this.state.getWebSockets(creatorTag(creatorId))) {
      const socket = ws as unknown as WebSocket;
      const attachment = this.attachmentOf(socket);
      if (attachment)
        this.send(socket, attachment, message(attachment.socketId));
    }
  }

  /** A row to its creator's tabs, each with its own `upload.here`. */
  private broadcast(row: Row): void {
    this.toCreator(row.creator_id, (socketId) => ({
      v: MEDIA_STATUS_PROTOCOL_VERSION,
      type: 'item',
      item: itemState(row, socketId),
    }));
  }

  /** Send, unless the session has ended: then say so and close. */
  private send(
    ws: WebSocket,
    attachment: SocketAttachment,
    message: MediaStatusServerMessage
  ): void {
    if (this.closeIfExpired(ws, attachment)) return;
    try {
      ws.send(JSON.stringify(message));
    } catch (error) {
      // A socket closing under us is normal: its close handler tidies up.
      // One still open that refused a message is not.
      if (ws.readyState === WEBSOCKET_OPEN) {
        this.obs.warn('media_status.send_failed', {
          type: message.type,
          error: messageForLog(error),
        });
      }
    }
  }

  /** Past its session: say so and close. True when it was closed. */
  private closeIfExpired(ws: WebSocket, attachment: SocketAttachment): boolean {
    if (Date.now() < attachment.sessionExpiresAt) return false;
    try {
      ws.send(
        JSON.stringify({
          v: MEDIA_STATUS_PROTOCOL_VERSION,
          type: 'bye',
          reason: 'session_expired',
        } satisfies MediaStatusServerMessage)
      );
      ws.close(SESSION_EXPIRED_CLOSE, 'session expired');
    } catch {
      // Already closing.
    }
    return true;
  }

  /** Mark a ticket used. False when it already was. */
  private claimTicket(id: string, expiresAt: number): boolean {
    const sql = this.state.storage.sql;
    sql.exec('DELETE FROM used_tickets WHERE expires_at <= ?', Date.now());
    return (
      sql
        .exec(
          `INSERT INTO used_tickets (id, expires_at) VALUES (?, ?)
           ON CONFLICT (id) DO NOTHING RETURNING id`,
          id,
          expiresAt
        )
        .toArray().length === 1
    );
  }

  /** Each resync row validated alone: one bad row must not stop the rest. */
  private readResync(
    resync: z.infer<typeof resyncEnvelopeSchema>
  ): MediaStatusResync {
    const rows: MediaStatusChange[] = [];
    for (const raw of resync.rows) {
      const row = mediaStatusChangeSchema.safeParse(raw);
      if (row.success) {
        rows.push(row.data);
        continue;
      }
      const mediaId = (raw as { mediaId?: unknown } | null)?.mediaId;
      this.obs.error('media_status.resync_row_invalid', {
        mediaId: typeof mediaId === 'string' ? mediaId : null,
        issues: row.error.issues.map((issue) => issue.path.join('.')),
      });
    }
    // A skipped row is not known to be gone: the read is no longer complete.
    return {
      ...resync,
      rows,
      complete: resync.complete && rows.length === resync.rows.length,
    };
  }
}
