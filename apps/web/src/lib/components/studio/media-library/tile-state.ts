/**
 * What a studio media tile shows (Codex-l2c48.7), from its list row and the
 * live state the status object pushed for it, if any.
 *
 * Pure, so every state of the approved mockup
 * (docs/handover/live-media-status/index.html) is pinned by a unit test
 * rather than by eye. MediaTile words the result; this decides it.
 *
 * The live state wins whenever there is one: it is newer than the list, and
 * after a Try again it is the only source that knows the item left `failed`.
 * Without one (no socket yet, or the item finished), the list row decides.
 */

import {
  isWaitingForTranscoder,
  MAX_TRANSCODING_ATTEMPTS,
  transcodingErrorInfo,
} from '@codex/constants';
import type { MediaItemState, TranscodingStep } from '@codex/validation';

/** The list row's columns a tile reads. */
export interface TileMedia {
  status: string;
  transcodingErrorCode?: string | null;
  transcodingAttempts?: number | null;
}

/** Why a failed tile failed: one sentence each. */
export type TileFailure =
  | 'internal'
  | 'timeout'
  | 'file'
  | 'upload'
  | 'exhausted';

export type TileView =
  /** `pct` null: no tab has reported yet. `elsewhere`: not this tab's upload. */
  | { kind: 'uploading'; pct: number | null; elsewhere: boolean }
  /** The uploading tab closed mid-upload. */
  | { kind: 'stopped' }
  /** Claimed for the transcoder; its first progress report is pending. */
  | { kind: 'starting' }
  /** `retryInSeconds` null: no retry is scheduled soon (the hourly cron). */
  | { kind: 'waiting'; cause: 'service'; retryInSeconds: number | null }
  /** The transcoder is set up wrong; it resumes once the owner fixes it. */
  | { kind: 'waiting'; cause: 'config' }
  /**
   * RunPod accepted the job but no worker has started it (Codex-t359w).
   * `overdue`: still so at the last ask, and the team has been told.
   */
  | { kind: 'waiting'; cause: 'transcoder'; overdue: boolean }
  | { kind: 'processing'; step: TranscodingStep | null; pct: number | null }
  | { kind: 'ready' }
  | {
      kind: 'failed';
      reason: TileFailure;
      canRetry: boolean;
      attemptsLeft: number;
    };

/** The status pill: `starting` reads as processing. */
export type TilePill = Exclude<TileView['kind'], 'starting'>;

export function tilePill(view: TileView): TilePill {
  return view.kind === 'starting' ? 'processing' : view.kind;
}

export function describeTile(
  media: TileMedia,
  live: MediaItemState | undefined,
  now: number
): TileView {
  const lifecycle = live?.lifecycle ?? media.status;
  const errorCode = live
    ? live.errorCode
    : (media.transcodingErrorCode ?? null);
  const attemptsLeft = live
    ? live.attemptsLeft
    : Math.max(0, MAX_TRANSCODING_ATTEMPTS - (media.transcodingAttempts ?? 0));

  switch (lifecycle) {
    case 'uploading': {
      const upload = live?.upload ?? null;
      if (upload?.stopped) return { kind: 'stopped' };
      return {
        kind: 'uploading',
        pct: upload?.pct ?? null,
        elsewhere: upload !== null && !upload.here,
      };
    }

    case 'uploaded': {
      if (!isWaitingForTranscoder(lifecycle, errorCode)) {
        return { kind: 'starting' };
      }
      if (transcodingErrorInfo(errorCode).category === 'config') {
        return { kind: 'waiting', cause: 'config' };
      }
      const retryAt = live?.retryAt ?? null;
      return {
        kind: 'waiting',
        cause: 'service',
        retryInSeconds:
          retryAt === null
            ? null
            : Math.max(0, Math.ceil((retryAt - now) / 1000)),
      };
    }

    case 'transcoding': {
      const step = live?.step ?? null;
      const pct = live?.progress ?? null;
      // The object tracks it but no report has come: the job is starting,
      // or RunPod has told the object it is still queued.
      if (live && step === null) {
        return live.queued
          ? {
              kind: 'waiting',
              cause: 'transcoder',
              overdue: live.queued === 'overdue',
            }
          : { kind: 'starting' };
      }
      return { kind: 'processing', step, pct };
    }

    case 'ready':
      return { kind: 'ready' };

    default:
      return failed(errorCode, attemptsLeft);
  }
}

function failed(errorCode: string | null, attemptsLeft: number): TileView {
  const info = transcodingErrorInfo(errorCode);
  const reason: TileFailure =
    info.category === 'file' || info.category === 'upload'
      ? info.category
      : attemptsLeft === 0
        ? 'exhausted'
        : info.category === 'timeout'
          ? 'timeout'
          : 'internal';
  return {
    kind: 'failed',
    reason,
    canRetry: info.retryable && attemptsLeft > 0,
    attemptsLeft,
  };
}
