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
  MAX_TRANSCODING_ATTEMPTS,
  MEDIA_STATUS,
  transcodingErrorInfo,
} from '@codex/constants';
import { messageForLog } from '@codex/database';
import { ObservabilityClient } from '@codex/observability';
import type { Bindings } from '@codex/shared-types';
import type { MediaStatusFeed } from '@codex/transcoding';
import {
  MEDIA_STATUS_CLIENT_MESSAGE_MAX_BYTES,
  MEDIA_STATUS_PROTOCOL_VERSION,
  MEDIA_STATUS_SUBPROTOCOL,
  type MediaItemState,
  type MediaProgressTick,
  type MediaStatusChange,
  type MediaStatusResync,
  type MediaStatusServerMessage,
  mediaProgressTickSchema,
  mediaStatusChangeSchema,
  mediaStatusClientMessageSchema,
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

const removedSchema = z.object({
  mediaId: z.string().min(1),
  creatorId: z.string().min(1),
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
  upload_socket: string | null;
  upload_stopped: number;
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
            stopped: row.upload_stopped === 1,
          },
    retryAt: row.retry_at,
    version: row.version,
  };
}

/** A waiting row is retried by the alarm while it has retries left. */
function isWaitingForTranscoder(lifecycle: string, errorCode: string | null) {
  return (
    lifecycle === MEDIA_STATUS.UPLOADED &&
    errorCode !== null &&
    transcodingErrorInfo(errorCode).transient
  );
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
      upload_stopped INTEGER NOT NULL DEFAULT 0,
      retry_at INTEGER,
      retries INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    sql.exec('CREATE INDEX IF NOT EXISTS items_creator ON items (creator_id)');
    sql.exec(
      'CREATE INDEX IF NOT EXISTS items_retry ON items (retry_at) WHERE retry_at IS NOT NULL'
    );
    // A heartbeat answered without waking the object.
    state.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('ping', 'pong')
    );
  }

  // ==========================================================================
  // Routes (media-api's Worker only)
  // ==========================================================================

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
          const { mediaId } = removedSchema.parse(await request.json());
          await this.applyRemoved(mediaId);
          return new Response(null, { status: 204 });
        }
        case MEDIA_STATUS_OBJECT_PATHS.progress:
          this.applyProgress(
            mediaProgressTickSchema.parse(await request.json())
          );
          return new Response(null, { status: 204 });
        case MEDIA_STATUS_OBJECT_PATHS.resync:
          await this.applyResync(
            mediaStatusResyncSchema.parse(await request.json())
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
    const creatorId = request.headers.get(
      MEDIA_STATUS_CONNECT_HEADERS.creatorId
    );
    const sessionExpiresAt = Number(
      request.headers.get(MEDIA_STATUS_CONNECT_HEADERS.sessionExpiresAt)
    );
    if (!creatorId || !Number.isFinite(sessionExpiresAt)) {
      return new Response('Missing creator', { status: 400 });
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

  /** A guarded write's row. Older than what is held: ignored. */
  async applyChange(change: MediaStatusChange): Promise<void> {
    const held = this.row(change.mediaId);
    if (held && change.at < held.updated_at) return;

    if (TERMINAL.has(change.lifecycle)) {
      // The final state goes out, then the row: nothing to keep.
      this.broadcast({
        ...(held ?? this.blankRow(change)),
        lifecycle: change.lifecycle,
        error_code: change.errorCode,
        attempts: change.attempts,
        job_id: change.jobId,
        step: null,
        progress: null,
        upload_pct: null,
        upload_socket: null,
        upload_stopped: 0,
        retry_at: null,
        version: (held?.version ?? 0) + 1,
        updated_at: change.at,
      });
      this.state.storage.sql.exec(
        'DELETE FROM items WHERE media_id = ?',
        change.mediaId
      );
      await this.rescheduleAlarm();
      return;
    }

    const sameJob =
      held?.lifecycle === MEDIA_STATUS.TRANSCODING &&
      (held.job_id === null || held.job_id === change.jobId);
    const transcoding = change.lifecycle === MEDIA_STATUS.TRANSCODING;
    const uploading = change.lifecycle === MEDIA_STATUS.UPLOADING;
    const retries = held?.retries ?? 0;
    let retryAt: number | null = null;
    if (isWaitingForTranscoder(change.lifecycle, change.errorCode)) {
      // An alarm already due keeps its time; a new wait takes the next delay.
      retryAt =
        held?.retry_at ??
        (retries < RETRY_DELAYS_MS.length
          ? Date.now() + RETRY_DELAYS_MS[retries]
          : null);
    }

    const row: Row = {
      ...(held ?? this.blankRow(change)),
      creator_id: change.creatorId,
      lifecycle: change.lifecycle,
      error_code: change.errorCode,
      attempts: change.attempts,
      job_id: change.jobId,
      // A new claim starts at 0; the job-id write keeps the ticks so far.
      step: transcoding && sameJob ? (held?.step ?? null) : null,
      progress: transcoding ? (sameJob ? (held?.progress ?? 0) : 0) : null,
      upload_pct: uploading ? (held?.upload_pct ?? null) : null,
      upload_socket: uploading ? (held?.upload_socket ?? null) : null,
      upload_stopped: uploading ? (held?.upload_stopped ?? 0) : 0,
      retry_at: retryAt,
      retries,
      version: (held?.version ?? 0) + 1,
      updated_at: change.at,
    };
    this.write(row);
    this.broadcast(row);
    await this.rescheduleAlarm();
  }

  async applyRemoved(mediaId: string): Promise<void> {
    const held = this.row(mediaId);
    if (!held) return;
    this.state.storage.sql.exec(
      'DELETE FROM items WHERE media_id = ?',
      mediaId
    );
    this.broadcastRemoved(held);
    await this.rescheduleAlarm();
  }

  applyProgress(tick: MediaProgressTick): void {
    const held = this.row(tick.mediaId);
    if (!held || held.lifecycle !== MEDIA_STATUS.TRANSCODING) return;
    if (held.job_id !== null && held.job_id !== tick.jobId) return;
    if (held.step === tick.step && held.progress === tick.progress) return;
    const row: Row = {
      ...held,
      step: tick.step,
      progress: tick.progress,
      version: held.version + 1,
    };
    this.write(row);
    this.broadcast(row);
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
      await this.applyRemoved(held.media_id);
    }
  }

  // ==========================================================================
  // Sockets (Hibernation API)
  // ==========================================================================

  /** The uploading tab's %; everything else a tab sends is dropped. */
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    const attachment = this.attachmentOf(ws);
    if (!attachment) return;
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

    const held = this.row(upload.data.mediaId);
    // Only the creator's own item, and only while it uploads.
    if (
      !held ||
      held.creator_id !== attachment.creatorId ||
      held.lifecycle !== MEDIA_STATUS.UPLOADING
    ) {
      return;
    }
    const row: Row = {
      ...held,
      upload_pct: upload.data.pct,
      upload_socket: attachment.socketId,
      upload_stopped: 0,
      version: held.version + 1,
    };
    this.write(row);
    this.broadcast(row);
  }

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

  webSocketError(ws: WebSocket): void {
    this.releaseUploads(ws);
  }

  /** A closed uploading tab: its items read "Upload stopped" at once (2A). */
  private releaseUploads(ws: WebSocket): void {
    const attachment = this.attachmentOf(ws);
    if (!attachment) return;
    const rows = this.state.storage.sql
      .exec<Row>(
        'SELECT * FROM items WHERE upload_socket = ? AND lifecycle = ?',
        attachment.socketId,
        MEDIA_STATUS.UPLOADING
      )
      .toArray();
    for (const held of rows) {
      const row: Row = {
        ...held,
        upload_socket: null,
        upload_stopped: 1,
        version: held.version + 1,
      };
      this.write(row);
      this.broadcast(row);
    }
  }

  // ==========================================================================
  // Alarm: waiting uploads retried within minutes
  // ==========================================================================

  async alarm(): Promise<void> {
    const now = Date.now();
    const due = this.state.storage.sql
      .exec<{ media_id: string }>(
        'SELECT media_id FROM items WHERE retry_at IS NOT NULL AND retry_at <= ?',
        now
      )
      .toArray()
      .map((row) => row.media_id);
    // Counted and cleared first, so a retry that throws cannot loop.
    for (const mediaId of due) {
      this.state.storage.sql.exec(
        'UPDATE items SET retry_at = NULL, retries = retries + 1 WHERE media_id = ?',
        mediaId
      );
    }
    await this.rescheduleAlarm();
    for (const mediaId of due) {
      try {
        await this.retry(mediaId);
      } catch (error) {
        this.obs.error('media_status.alarm_retry_failed', {
          mediaId,
          error: messageForLog(error),
        });
      }
    }
  }

  /**
   * The cron's claim and dispatch, for one item. Its writes publish to this
   * object directly (localFeed), not back through a stub.
   */
  async retry(mediaId: string): Promise<void> {
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
      await webhook.services.transcodingMaintenance.retryOne(mediaId);
    } finally {
      webhook.release();
    }
  }

  /** A feed into this object, for the services the alarm runs. */
  private readonly localFeed: MediaStatusFeed = {
    changed: (change) => {
      this.state.waitUntil(this.applyChange(change));
    },
    removed: (mediaId) => {
      this.state.waitUntil(this.applyRemoved(mediaId));
    },
    progress: async (tick) => {
      this.applyProgress(tick);
      return true;
    },
    resync: (resync) => this.applyResync(resync),
  };

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

  private blankRow(change: MediaStatusChange): Row {
    return {
      media_id: change.mediaId,
      creator_id: change.creatorId,
      lifecycle: change.lifecycle,
      error_code: null,
      attempts: 0,
      job_id: null,
      step: null,
      progress: null,
      upload_pct: null,
      upload_socket: null,
      upload_stopped: 0,
      retry_at: null,
      retries: 0,
      version: 0,
      updated_at: change.at,
    };
  }

  private write(row: Row): void {
    this.state.storage.sql.exec(
      `INSERT INTO items (media_id, creator_id, lifecycle, error_code, attempts,
         job_id, step, progress, upload_pct, upload_socket, upload_stopped,
         retry_at, retries, version, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (media_id) DO UPDATE SET
         creator_id = excluded.creator_id, lifecycle = excluded.lifecycle,
         error_code = excluded.error_code, attempts = excluded.attempts,
         job_id = excluded.job_id, step = excluded.step,
         progress = excluded.progress, upload_pct = excluded.upload_pct,
         upload_socket = excluded.upload_socket,
         upload_stopped = excluded.upload_stopped, retry_at = excluded.retry_at,
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
      row.upload_stopped,
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

  /** Every socket of the row's creator, each with its own `upload.here`. */
  private broadcast(row: Row): void {
    for (const ws of this.state.getWebSockets(creatorTag(row.creator_id))) {
      const socket = ws as unknown as WebSocket;
      const attachment = this.attachmentOf(socket);
      if (!attachment) continue;
      this.send(socket, attachment, {
        v: MEDIA_STATUS_PROTOCOL_VERSION,
        type: 'item',
        item: itemState(row, attachment.socketId),
      });
    }
  }

  private broadcastRemoved(row: Row): void {
    for (const ws of this.state.getWebSockets(creatorTag(row.creator_id))) {
      const socket = ws as unknown as WebSocket;
      const attachment = this.attachmentOf(socket);
      if (!attachment) continue;
      this.send(socket, attachment, {
        v: MEDIA_STATUS_PROTOCOL_VERSION,
        type: 'removed',
        mediaId: row.media_id,
      });
    }
  }

  /** Send, unless the session has ended: then say so and close. */
  private send(
    ws: WebSocket,
    attachment: SocketAttachment,
    message: MediaStatusServerMessage
  ): void {
    try {
      if (Date.now() >= attachment.sessionExpiresAt) {
        ws.send(
          JSON.stringify({
            v: MEDIA_STATUS_PROTOCOL_VERSION,
            type: 'bye',
            reason: 'session_expired',
          } satisfies MediaStatusServerMessage)
        );
        ws.close(SESSION_EXPIRED_CLOSE, 'session expired');
        return;
      }
      ws.send(JSON.stringify(message));
    } catch {
      // A socket closing under us: its close handler tidies up.
    }
  }
}
