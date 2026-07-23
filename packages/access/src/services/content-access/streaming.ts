/**
 * Streaming-media resolution and HLS URL building for ContentAccessService.
 *
 * Extracted from ContentAccessService (Codex-2pryk.1.1) — behaviour-preserving.
 * Holds everything downstream of the access decision: verifying the media item
 * is ready, minting the short-lived HLS playlist-proxy URL, and the two HLS
 * playlist-proxy read/rewrite helpers (WP-14).
 */

import { MEDIA_STATUS, MEDIA_TYPES } from '@codex/constants';
import { toIso } from '@codex/database';
import type { ObservabilityClient } from '@codex/observability';
import {
  getHlsMasterKey,
  getHlsVariantKey,
  getHlsVariantSegmentKey,
} from '@codex/transcoding';
import {
  InvalidContentTypeError,
  MediaNotReadyForStreamingError,
  R2SigningError,
} from '../../errors';
import {
  collectVariantSegments,
  rewriteMasterPlaylist,
  rewriteVariantPlaylist,
} from '../../hls-rewrite';
import { signHlsToken } from '../../hls-token';
import type { R2Signer } from './r2-signer';

/**
 * Result of resolving a content record to its streamable target.
 * Written content (articles) has no media stream — the `'written'` variant
 * signals "access granted, nothing to sign".
 */
export type StreamingTarget =
  | {
      r2Key: null;
      creatorId: null;
      mediaId: null;
      mediaType: 'written';
      waveformKey: null;
      readyVariants: null;
    }
  | {
      r2Key: string;
      creatorId: string;
      mediaId: string;
      mediaType: 'video' | 'audio';
      waveformKey: string | null;
      readyVariants: string[] | null;
    };

/** The subset of the content record the media resolver reads. */
interface MediaResolutionContent {
  mediaItem: {
    id: string;
    status: string;
    hlsMasterPlaylistKey: string | null;
    mediaType: string;
    creatorId: string;
    waveformKey: string | null;
    readyVariants: string[] | null;
  } | null;
}

/**
 * Response returned by `buildStreamingResponse`.
 *
 * `streamingUrl` is null for written content (articles) — access is still
 * verified, but there is no media stream to sign.
 */
export interface StreamingResponse {
  streamingUrl: string | null;
  waveformUrl: string | null;
  expiresAt: Date;
  contentType: 'video' | 'audio' | 'written';
  readyVariants?: string[];
}

/**
 * Resolve an access-granted content record to its streamable target. Assumes
 * the access decision has already passed. Returns the `'written'` variant when
 * the content has no media item (an article), otherwise validates the media is
 * ready for streaming and returns the descriptor used to mint the URL.
 *
 * Synchronous — reads only the already-loaded `mediaItem` relation.
 *
 * @throws {MediaNotReadyForStreamingError} media status !== 'ready'
 * @throws {R2SigningError} media ready but HLS master playlist key missing
 * @throws {InvalidContentTypeError} media type is neither video nor audio
 */
export function resolveStreamableMedia(
  obs: ObservabilityClient,
  contentId: string,
  contentRecord: MediaResolutionContent
): StreamingTarget {
  // Access check passed. If content has no media item, it's a
  // written article — return a null-URL response so the caller
  // knows access is granted but there's nothing to stream.
  if (!contentRecord.mediaItem) {
    return {
      r2Key: null,
      creatorId: null,
      mediaId: null,
      mediaType: 'written' as const,
      waveformKey: null,
      readyVariants: null,
    };
  }

  // Verify media is ready for streaming (status='ready' with transcoding outputs)
  const mediaStatus = contentRecord.mediaItem.status;
  if (mediaStatus !== MEDIA_STATUS.READY) {
    obs.warn('Media not ready for streaming', {
      contentId,
      mediaItemId: contentRecord.mediaItem.id,
      status: mediaStatus,
    });
    throw new MediaNotReadyForStreamingError(
      contentRecord.mediaItem.id,
      mediaStatus
    );
  }

  // Extract HLS master playlist key for streaming
  // Database constraint ensures this exists when status='ready'
  const r2Key = contentRecord.mediaItem.hlsMasterPlaylistKey;

  if (!r2Key) {
    // This should never happen due to database constraint, but defensive check
    obs.error('Media marked ready but missing HLS key', {
      contentId,
      mediaItemId: contentRecord.mediaItem.id,
    });
    throw new R2SigningError(
      'missing_hls_key',
      new Error('Media marked as ready but HLS master playlist key is missing')
    );
  }

  // Validate media type (defense-in-depth)
  const mediaType = contentRecord.mediaItem.mediaType;

  if (
    !([MEDIA_TYPES.VIDEO, MEDIA_TYPES.AUDIO] as string[]).includes(mediaType)
  ) {
    obs.error('Invalid media type', {
      mediaType,
      contentId,
      mediaItemId: contentRecord.mediaItem.id,
    });
    throw new InvalidContentTypeError(contentId, mediaType);
  }

  // Return data for R2 signing (outside transaction).
  // `readyVariants` is surfaced so the client can render a manual
  // quality picker over HLS.js adaptive selection. Falls through as
  // null when the media item has no recorded variants (e.g. during a
  // partial transcode; the HLS master still works, we just can't
  // enumerate the rungs).
  return {
    r2Key,
    // creatorId/mediaId are selected from the media item itself (not
    // parsed from the R2 key) so the minted token + R2 key builders
    // are independent of the key's exact byte shape. They feed the
    // proxy routes' R2 key construction with no extra DB hit.
    creatorId: contentRecord.mediaItem.creatorId,
    mediaId: contentRecord.mediaItem.id,
    mediaType: mediaType as 'video' | 'audio',
    waveformKey: contentRecord.mediaItem.waveformKey,
    readyVariants: contentRecord.mediaItem.readyVariants ?? null,
  };
}

/**
 * Build the streaming response from a resolved target. For written content,
 * returns a null-URL response. For media, mints a short-lived HLS token and
 * returns the master-playlist PROXY URL (NOT a direct presigned master URL) so
 * the proxy can rewrite relative child URIs and re-sign them (WP-14). The
 * waveform is a single static file with no relative children, so it is still
 * presigned directly.
 *
 * @throws {R2SigningError} proxy misconfigured, or signing failed
 */
export async function buildStreamingResponse(
  target: StreamingTarget,
  deps: {
    r2: R2Signer;
    contentApiBaseUrl: string | undefined;
    hlsTokenSecret: string | undefined;
    obs: ObservabilityClient;
  },
  userId: string,
  contentId: string,
  expirySeconds: number
): Promise<StreamingResponse> {
  const { r2, contentApiBaseUrl, hlsTokenSecret, obs } = deps;
  const { r2Key, creatorId, mediaId, mediaType, waveformKey, readyVariants } =
    target;

  // Written content: access granted, no stream to sign.
  if (mediaType === 'written' || r2Key === null) {
    const expiresAt = new Date(Date.now() + expirySeconds * 1000);
    obs.info('Access granted for written content (no stream)', {
      userId,
      contentId,
    });
    return {
      streamingUrl: null,
      waveformUrl: null,
      expiresAt,
      contentType: 'written' as const,
    };
  }

  // Step 3: Mint a short-lived HLS token and return the master-playlist
  // PROXY URL (NOT a direct presigned master URL). The proxy rewrites
  // relative child URIs (variants → variant-proxy URLs; segments →
  // presigned R2 URLs) so HLS.js never fetches an unsigned relative
  // resource. See WP-14 (Codex-fc5oh.14).
  //
  // The waveform is a single static file with no relative children, so it
  // is still presigned directly — unchanged from the prior behaviour.
  try {
    if (!contentApiBaseUrl || !hlsTokenSecret) {
      // Misconfiguration (env var unbound) — fail with a typed internal
      // error rather than emitting a token-less or broken master URL.
      throw new R2SigningError(
        r2Key,
        new Error(
          'HLS streaming proxy is not configured (contentApiBaseUrl / hlsTokenSecret missing)'
        )
      );
    }

    const exp = Math.floor(Date.now() / 1000) + expirySeconds;
    const token = await signHlsToken(
      { creatorId, mediaId, exp },
      hlsTokenSecret
    );

    const base = contentApiBaseUrl.replace(/\/+$/, '');
    const streamingUrl = `${base}/api/access/content/${encodeURIComponent(
      contentId
    )}/hls/master.m3u8?token=${encodeURIComponent(token)}`;

    const waveformUrl =
      mediaType === 'audio' && waveformKey
        ? await r2.generateSignedUrl(waveformKey, expirySeconds)
        : null;

    const expiresAt = new Date(exp * 1000);

    obs.info('Streaming URL generated successfully', {
      userId,
      contentId,
      contentType: mediaType,
      hasWaveform: !!waveformUrl,
      expiresAt: toIso(expiresAt),
    });

    return {
      streamingUrl,
      waveformUrl,
      expiresAt,
      contentType: mediaType,
      // `readyVariants` may be null on legacy / partially-transcoded items —
      // convert to `undefined` so the HTTP layer can drop it from the JSON
      // envelope via its optional() schema instead of emitting null.
      readyVariants: readyVariants ?? undefined,
    };
  } catch (err) {
    obs.error('Failed to mint HLS streaming URL', {
      errorMessage: err instanceof Error ? err.message : String(err),
      errorStack: err instanceof Error ? err.stack : undefined,
      errorName: err instanceof Error ? err.name : undefined,
      userId,
      contentId,
      r2Key,
    });
    if (err instanceof R2SigningError) throw err;
    throw new R2SigningError(r2Key, err);
  }
}

/**
 * Read the HLS MASTER playlist from R2 and rewrite each child variant URI to
 * an absolute variant-proxy URL carrying the SAME token (WP-14).
 *
 * Auth is the verified token (checked at the route via `verifyHlsToken`) —
 * this function does NOT re-run the DB access decision. `creatorId`/`mediaId`
 * come from the verified token payload, so the R2 key is built with no DB
 * round-trip.
 *
 * @returns Rewritten master playlist text, or `null` when the master object
 *          is absent in R2 (route maps to 404).
 */
export async function getHlsMasterPlaylist(
  deps: { r2: R2Signer; contentApiBaseUrl: string | undefined },
  input: {
    contentId: string;
    creatorId: string;
    mediaId: string;
    token: string;
  }
): Promise<string | null> {
  const { r2, contentApiBaseUrl } = deps;
  if (!contentApiBaseUrl) {
    throw new R2SigningError(
      getHlsMasterKey(input.creatorId, input.mediaId),
      new Error('HLS streaming proxy is not configured (contentApiBaseUrl)')
    );
  }

  const masterKey = getHlsMasterKey(input.creatorId, input.mediaId);
  const text = await r2.getObjectText(masterKey);
  if (text === null) return null;

  return rewriteMasterPlaylist(text, {
    contentApiBaseUrl,
    contentId: input.contentId,
    token: input.token,
  });
}

/**
 * Read an HLS VARIANT playlist from R2 and rewrite each relative segment URI
 * to an absolute SigV4-presigned R2 URL (WP-14).
 *
 * Segments are presigned lazily — only this variant's segments are signed,
 * bounding the per-invocation SigV4 work to the rungs actually requested.
 * Segments load direct R2 → client (no further token / worker hop).
 *
 * @returns Rewritten variant playlist text, or `null` when the variant
 *          object is absent in R2 (route maps to 404).
 */
export async function getHlsVariantPlaylist(
  deps: { r2: R2Signer },
  input: {
    creatorId: string;
    mediaId: string;
    variant: string;
    expirySeconds: number;
  }
): Promise<string | null> {
  const { r2 } = deps;
  const variantKey = getHlsVariantKey(
    input.creatorId,
    input.mediaId,
    input.variant
  );
  const text = await r2.getObjectText(variantKey);
  if (text === null) return null;

  // Lazily presign exactly the segments this playlist references.
  const filenames = collectVariantSegments(text);
  const presignedByFilename = new Map<string, string>();
  await Promise.all(
    filenames.map(async (filename) => {
      const segmentKey = getHlsVariantSegmentKey(
        input.creatorId,
        input.mediaId,
        input.variant,
        filename
      );
      const url = await r2.generateSignedUrl(segmentKey, input.expirySeconds);
      presignedByFilename.set(filename, url);
    })
  );

  return rewriteVariantPlaylist(text, {
    presignSegment: (filename) => {
      const url = presignedByFilename.get(filename);
      if (!url) {
        // Should never happen — collectVariantSegments + presign cover every
        // relative line. Defensive: surface as a typed signing error.
        throw new R2SigningError(
          getHlsVariantSegmentKey(
            input.creatorId,
            input.mediaId,
            input.variant,
            filename
          ),
          new Error('Segment was not presigned before rewrite')
        );
      }
      return url;
    },
  });
}
