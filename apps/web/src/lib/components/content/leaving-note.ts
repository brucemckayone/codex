/**
 * The note a leaving piece's page shows its reader (Codex-a6ofh.6.7, mockup
 * LN7 and LN7b): the day it leaves, who removed it, why this reader still has
 * it, and what they may keep. Words only; the view draws them.
 *
 * The offer is the worker's (`leaving.download`, the leaving download's own
 * eligibility), never decided here, so the page offers a download exactly
 * when the download route would give one.
 */
import type {
  ContentHeld,
  WithdrawnLeavingNote,
} from '$lib/server/content-detail';
import { formatFileSize, formatSentenceDate } from '$lib/utils/format';
import * as m from '$paraglide/messages';

/**
 * The query the page comes back with when its download did not start (the
 * download route's 303 after a failure that was not a refusal).
 */
export const LEAVING_DOWNLOAD_FAILED = {
  name: 'download',
  value: 'failed',
} as const;

/** What the note offers: the original's file, or the print view. */
export type LeavingOffer =
  | { kind: 'file'; label: string; hint: string }
  | { kind: 'print'; label: string; hint: string };

export interface LeavingNote {
  /** "This leaves Revelations on 17 December." */
  lead: string;
  /** "Studio Alpha has removed it.", or null with no name to give. */
  removedBy: string | null;
  /** Why the reader still has it, and until when they can play it. */
  reason: string;
  offer: LeavingOffer | null;
}

/**
 * The note for a reader who holds a leaving piece.
 *
 * A subscriber is never an owner, so the worker offers them nothing. Their
 * access ends at the earlier of their renewal and the leave date, and the
 * note says that day.
 */
export function leavingNoteOf(
  held: ContentHeld,
  leaving: WithdrawnLeavingNote,
  contentType: string,
  now: Date = new Date()
): LeavingNote {
  return {
    lead: m.content_detail_leaving_lead({
      date: formatSentenceDate(leaving.leavesAt, now),
    }),
    removedBy: leaving.removedBy
      ? m.content_detail_leaving_removed_by({ name: leaving.removedBy })
      : null,
    reason: reasonOf(held, leaving, contentType, now),
    offer: offerOf(leaving),
  };
}

function reasonOf(
  held: ContentHeld,
  leaving: WithdrawnLeavingNote,
  contentType: string,
  now: Date
): string {
  if (held.by === 'subscription') {
    const until =
      Date.parse(held.until) < Date.parse(leaving.leavesAt)
        ? held.until
        : leaving.leavesAt;
    return m.content_detail_withdrawn_subscription({
      date: formatSentenceDate(until, now),
    });
  }
  const reason = REASON[held.by]();
  if (leaving.download === 'print') {
    return m.content_detail_leaving_until_keep_print({ reason });
  }
  const action = actionOf(contentType);
  return leaving.download === 'file'
    ? m.content_detail_leaving_until_keep_file({ reason, action })
    : m.content_detail_leaving_until({ reason, action });
}

const REASON: Record<
  Exclude<ContentHeld['by'], 'subscription'>,
  () => string
> = {
  purchase: () => m.content_detail_leaving_reason_purchase(),
  entitlement: () => m.content_detail_leaving_reason_entitlement(),
  course: () => m.content_detail_leaving_reason_course(),
};

/** The verb for the piece's type: listen to audio, read text, else watch. */
function actionOf(contentType: string): string {
  if (contentType === 'audio') return m.content_detail_leaving_action_listen();
  if (contentType === 'written') return m.content_detail_leaving_action_read();
  return m.content_detail_leaving_action_watch();
}

function offerOf(leaving: WithdrawnLeavingNote): LeavingOffer | null {
  switch (leaving.download) {
    case 'file': {
      const size = formatFileSize(leaving.sizeBytes);
      return {
        kind: 'file',
        label: size
          ? m.content_detail_leaving_download_size({ size })
          : m.content_detail_leaving_download(),
        hint: m.content_detail_leaving_download_hint(),
      };
    }
    case 'print':
      return {
        kind: 'print',
        label: m.content_detail_leaving_print(),
        hint: m.content_detail_leaving_print_hint(),
      };
    case null:
      return null;
  }
}
