/**
 * Access & Streaming Response Types
 *
 * Canonical home for content access, playback, and library response types.
 * Previously in @codex/shared-types — moved here for domain ownership.
 */

import type { PublicContentRow } from '@codex/content';
import type { ContentBodySource, ProgressData } from '@codex/shared-types';

// Defined in @codex/shared-types, which the in-course payload also carries it
// through; re-exported so this package's consumers keep one import.
export type { ContentBodySource };

/**
 * Response for GET /api/access/content/:id/stream
 *
 * `streamingUrl` is null for written content (articles) — access is still
 * verified, but there is no media stream to sign. The client uses a null
 * streamingUrl together with a successful response as a "has access, body
 * unlocks" signal.
 */
export interface StreamingUrlResponse {
  streamingUrl: string | null;
  waveformUrl: string | null;
  expiresAt: string; // ISO 8601 timestamp
  contentType: string;
  /**
   * HLS quality variants that finished transcoding for this media item
   * (e.g. `['1080p', '720p', '480p', '360p']`). Omitted when the media has
   * no transcoding output (pre-transcode, or written content). The client
   * uses this to render a manual quality picker over HLS.js's adaptive
   * bitrate default — the actual variant URLs stay inside the HLS master
   * playlist, so this array is purely a menu-population signal.
   */
  readyVariants?: string[];
  /**
   * The content's body, present only when the request asked for it
   * (`?include=body`), access was granted, and the row is released (published
   * now, or once). It is the body source for an entitled reader of a gated
   * piece, whose public row carries none (Codex-039vo). Absent means it was
   * not returned; a piece with no body comes back as
   * `{ contentBody: null, contentBodyJson: null }`.
   */
  body?: ContentBodySource;
}

/**
 * Response for GET /api/access/courses/:courseId/films/:film/stream (owner
 * P10): a course sales film's signed FULL stream, or `null` (in the `data`
 * envelope) when the film may only play its 30-second preview.
 */
export interface CourseFilmStreamResponse {
  /** The film master-proxy URL, carrying its film token. */
  playlistUrl: string;
  /** ISO 8601. The token's expiry: after it no playlist under it loads. */
  expiresAt: string;
}

/**
 * Response for GET /api/access/orgs/:organizationId/film/stream (Codex-376dl):
 * the org intro film's signed FULL stream, or `null` when it may only play its
 * 30-second preview. The course film's shape, under the org film's proxies.
 */
export type OrgFilmStreamResponse = CourseFilmStreamResponse;

/**
 * Response for GET /api/media/:id/preview (Codex-a6ofh.1.5): a creator's OWN
 * media, signed for the studio's player whatever uses it, paid content
 * included. The content stream's shape, under the preview proxies.
 */
export interface MediaPreviewResponse {
  /** The preview master-proxy URL, carrying its preview token. */
  playlistUrl: string;
  /** An audio item's presigned waveform, for the player's scrubber; else null. */
  waveformUrl: string | null;
  /** ISO 8601. The token's expiry: after it no playlist under it loads. */
  expiresAt: string;
  mediaType: 'video' | 'audio';
  /** The rungs the transcode wrote, for the quality menu; omitted if none recorded. */
  readyVariants?: string[];
}

/**
 * How a reader still holds an item that has left the storefront: it decides
 * the note the detail page shows them (Codex-ov2ii). Mapped from the arm of
 * the access decision that granted, so the note can never give a reason the
 * gate did not use.
 */
export type ContentHeld =
  | { by: 'purchase' | 'entitlement' | 'course'; until: null }
  | {
      by: 'subscription';
      /**
       * ISO 8601 end of the granting subscription's current period, when the
       * item stops being covered. Always set: the date is the note's point.
       */
      until: string;
    };

export type ContentHeldBy = ContentHeld['by'];

/**
 * What `getWithdrawnContent` returns (Codex-ov2ii): an item that was published
 * once, is not now, and that this reader still has access to. `content` is the
 * public row's shape with no body (the body comes from `/stream?include=body`,
 * as for any gated piece). Every other case is a 404.
 *
 * The public list's row (`PublicContentRow`, Codex-ve5eh): the same media and
 * org columns, never the whole rows. NOT the wire shape: the route builds the
 * public list's wire item from it (`toPublicItem`), resolving the media's R2
 * keys to CDN URLs. The response is typed where it is read, in the web's
 * `WithdrawnContentItem`, as `PublicContentListItem` is.
 */
export interface WithdrawnContent {
  content: PublicContentRow;
  held: ContentHeld;
  /** Set while the piece is leaving (Codex-a6ofh.6.7), else null. */
  leaving: WithdrawnLeaving | null;
}

/** What an owner of a leaving piece may take: its file, or a print view. */
export type LeavingDownloadKind = 'file' | 'print';

/**
 * A leaving piece as its reader's page shows it (design section 8, LN7): the
 * day it goes, and what this reader may keep. `download` is the leaving
 * download's own eligibility (`leavingDownloadOf`), so the page offers exactly
 * what the download route and the print view would give: `null` for a reader
 * who is not an owner (a subscriber), or where the creator turned downloads
 * off, or a video whose media is gone.
 */
export interface WithdrawnLeaving {
  /** ISO 8601: the day-30 delete. */
  leavesAt: string;
  download: LeavingDownloadKind | null;
  /** The original's size for `'file'`, when one was recorded; else null. */
  sizeBytes: number | null;
}

/**
 * Response for GET /api/access/courses/:courseId/can-enter.
 *
 * `disputeHold` is set only when `canEnter` is false and an open payment
 * dispute holds back the user's grant to the course while nothing else
 * opens it (Codex-2hxff.60), so the course page shows the dispute notice
 * instead of Buy or Join. The same predicate as the course shelf's
 * `EnrolledCourseSummary.disputeHold`. The kind only, never a date.
 */
export interface CourseEntryResponse {
  canEnter: boolean;
  disputeHold: 'purchase_dispute' | 'subscription_dispute' | null;
}

/**
 * Response for GET /api/access/content/:id/progress
 * Returns current playback progress or null if not started
 */
export interface PlaybackProgressResponse {
  progress: ProgressData | null;
}

/**
 * Response for GET `/api/access/user/library`.
 *
 * RE-EXPORTED from the service that produces it rather than re-declared here.
 * This file used to hand-declare a parallel copy, and the two drifted badly:
 * the copy listed `accessType: 'purchased' | 'membership' | 'subscription'`
 * long after the service started returning `'free'` and `'followers'` too, and
 * it never gained the `journeys` provenance field. TypeScript could not catch
 * it — the service's richer object is structurally assignable to the narrower
 * declaration, so nothing cross-checked them, and every frontend consumer
 * (which imports this barrel, not the service internals) was typed against
 * values the API had stopped restricting itself to.
 *
 * Deriving it makes that class of drift impossible rather than merely fixed.
 */
export type {
  UserLibraryItem,
  UserLibraryResponse,
} from './services/content-access/library';

/**
 * Response for POST /api/access/content/:id/progress
 * Returns null (204 No Content)
 */
export type UpdatePlaybackProgressResponse = null;

/**
 * Response for GET /api/access/content/:id/download (Codex-a6ofh.6.5): an
 * owner's copy of a video or audio piece that is leaving, the original upload.
 * Every refusal is the same 404.
 */
export interface LeavingDownloadResponse {
  /** A 15-minute signed GET of the original that saves as `filename`. */
  url: string;
  /** The piece's slug and the original's extension, ASCII only. */
  filename: string;
  /** The original's size, or null when none was recorded at upload. */
  sizeBytes: number | null;
  /** ISO 8601. After it the link no longer opens. */
  expiresAt: string;
}

/**
 * Response for GET /api/access/content/print (Codex-a6ofh.6.5): a leaving
 * article an owner may save as a PDF, for its print view. The body is the
 * stored one, never rendered here. Every refusal is the same 404.
 */
export interface LeavingPrintResponse {
  contentId: string;
  title: string;
  /** The creator's public name, for the byline. */
  creatorName: string;
  body: ContentBodySource;
}
