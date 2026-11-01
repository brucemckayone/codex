/**
 * Live media status (Codex-l2c48.9): the messages between the services that
 * change a media item, media-api's MediaStatusObject, and a studio tab.
 *
 * Postgres keeps an item's lifecycle; the object mirrors it and adds what is
 * transient (upload %, transcode step and %, the next retry). A service
 * publishes a `MediaStatusChange` only after its guarded UPDATE returned the
 * row, and a tab receives `MediaItemState`s, never the raw transcoding error.
 */

import { z } from 'zod';
import { mediaStatusEnum } from '../content/content-schemas';
import { creatorIdSchema, uuidSchema } from '../primitives';
import { transcodingStepEnum } from './transcoding';

/** Bumped when a message changes shape; a client drops other versions. */
export const MEDIA_STATUS_PROTOCOL_VERSION = 1;

/** The only client message is tiny; anything larger is dropped unread. */
export const MEDIA_STATUS_CLIENT_MESSAGE_MAX_BYTES = 256;

/** The WebSocket subprotocol a studio tab asks for; the 101 names it. */
export const MEDIA_STATUS_SUBPROTOCOL = 'media-status.v1';

/**
 * The ticket rides as a second subprotocol, `ticket.<ticket>`, never in the
 * URL, which our own request logs record. Cloudflare's request logs keep
 * headers too, so a ticket is single-use: the object refuses one it has
 * already seen, and one copied out of a log is dead once its tab connected.
 */
export const MEDIA_STATUS_TICKET_PROTOCOL_PREFIX = 'ticket.';

// ============================================================================
// Service → object
// ============================================================================

/** What a guarded write left the row as. */
export const mediaStatusChangeSchema = z.object({
  mediaId: uuidSchema,
  creatorId: creatorIdSchema,
  lifecycle: mediaStatusEnum,
  /** A TRANSCODING_ERROR_CODES value; the studio words it, never the raw error. */
  errorCode: z.string().max(50).nullable(),
  attempts: z.number().int().min(0),
  /** The RunPod job the row holds: progress from any other job is stale. */
  jobId: z.string().max(255).nullable(),
  /** The write's updated_at (epoch ms): an older change never overwrites a newer one. */
  at: z.number().int(),
});

export type MediaStatusChange = z.infer<typeof mediaStatusChangeSchema>;

/** A progress webhook, which now goes to the object only, never Postgres. */
export const mediaProgressTickSchema = z.object({
  mediaId: uuidSchema,
  jobId: z.string().min(1),
  step: transcodingStepEnum,
  progress: z.number().int().min(0).max(100),
});

export type MediaProgressTick = z.infer<typeof mediaProgressTickSchema>;

/** The most rows one resync carries; a fuller read sets `complete: false`. */
export const MEDIA_STATUS_RESYNC_MAX_ROWS = 1000;

/**
 * The hourly safety net: every non-terminal row, as Postgres has it. A row
 * the object holds but this omits is gone or terminal, unless `complete` is
 * false (the read was capped) or it changed after `asOf`.
 */
export const mediaStatusResyncSchema = z.object({
  rows: z.array(mediaStatusChangeSchema).max(MEDIA_STATUS_RESYNC_MAX_ROWS),
  asOf: z.number().int(),
  complete: z.boolean(),
});

export type MediaStatusResync = z.infer<typeof mediaStatusResyncSchema>;

/** A worker without the object's binding (content-api) publishes through media-api. */
export const mediaStatusEventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('changed'), change: mediaStatusChangeSchema }),
  z.object({
    event: z.literal('removed'),
    mediaId: uuidSchema,
    creatorId: creatorIdSchema,
  }),
]);

export type MediaStatusEvent = z.infer<typeof mediaStatusEventSchema>;

/** The object's /removed body. It removes the row only if it is this creator's. */
export const mediaStatusRemovedSchema = z.object({
  mediaId: uuidSchema,
  creatorId: creatorIdSchema,
});

// ============================================================================
// Object ↔ studio tab
// ============================================================================

/** One in-flight item, as a tab shows it. */
export const mediaItemStateSchema = z.object({
  mediaId: uuidSchema,
  lifecycle: mediaStatusEnum,
  errorCode: z.string().nullable(),
  /** MAX_TRANSCODING_ATTEMPTS minus the attempts used. */
  attemptsLeft: z.number().int().min(0),
  step: transcodingStepEnum.nullable(),
  /** Transcode %, while transcoding. */
  progress: z.number().int().min(0).max(100).nullable(),
  /**
   * Upload %, as the uploading tab reports it. `here`: this tab is the
   * uploader. `stopped`: the uploader's connection closed mid-upload.
   */
  upload: z
    .object({
      pct: z.number().int().min(0).max(100),
      here: z.boolean(),
      stopped: z.boolean(),
    })
    .nullable(),
  /** Epoch ms of the next automatic retry, while waiting for the transcoder. */
  retryAt: z.number().int().nullable(),
  /**
   * A transcoding job RunPod has not started, as the early asks found it
   * (Codex-t359w). `overdue`: still queued at the last ask, and the team has
   * been told. Optional: an object on an older build never sends it.
   */
  queued: z.enum(['waiting', 'overdue']).nullable().optional(),
  /** Per item, rising: a tab ignores a state older than the one it has. */
  version: z.number().int(),
});

export type MediaItemState = z.infer<typeof mediaItemStateSchema>;

const v = z.literal(MEDIA_STATUS_PROTOCOL_VERSION);

export const mediaStatusServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    v,
    type: z.literal('snapshot'),
    items: z.array(mediaItemStateSchema),
    at: z.number().int(),
  }),
  z.object({ v, type: z.literal('item'), item: mediaItemStateSchema }),
  /**
   * The object no longer tracks the item: deleted, or finished while a
   * change was lost. A tab refetches its list to learn which.
   */
  z.object({ v, type: z.literal('removed'), mediaId: uuidSchema }),
  z.object({
    v,
    type: z.literal('bye'),
    reason: z.enum(['session_expired', 'shutting_down']),
  }),
]);

export type MediaStatusServerMessage = z.infer<
  typeof mediaStatusServerMessageSchema
>;

/** The one message a tab sends: its own upload's %, at most once a second. */
export const mediaStatusClientMessageSchema = z.object({
  v,
  type: z.literal('upload'),
  mediaId: uuidSchema,
  pct: z.number().int().min(0).max(100),
});

export type MediaStatusClientMessage = z.infer<
  typeof mediaStatusClientMessageSchema
>;

/** POST /api/media-status/ticket: where to connect, and a one-minute ticket. */
export const mediaStatusTicketSchema = z.object({
  url: z.url(),
  ticket: z.string().min(1),
  expiresAt: z.number().int(),
});

export type MediaStatusTicket = z.infer<typeof mediaStatusTicketSchema>;
