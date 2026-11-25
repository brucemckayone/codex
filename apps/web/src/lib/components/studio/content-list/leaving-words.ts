/**
 * A piece that is leaving (Codex-a6ofh.6, mockup leaving-notice.html
 * LN1-LN4): off sale, with a day it leaves Revelations, its owners keeping
 * it until then. Whose delete holds it decides what the creator is offered:
 * their own they can keep (Keep it); one only their org's delete holds they
 * cannot, so they see a note, with no Keep and no Publish, and may delete it
 * too (owner 2026-11-20). The list, its row menu and the editor all ask here.
 */
import { ERROR_CODES, LEAVING_NOTICE_DAYS } from '@codex/constants';
import { remoteErrorCode } from '$lib/remote/query-result';
import type { ContentKeepOutcome, ContentWithRelations } from '$lib/types';
import { formatLocalClockTime, formatSentenceDate } from '$lib/utils/format';
import * as m from '$paraglide/messages';

/** The fields a leave is read from, as the studio's rows and single read send them. */
export type LeavingPiece = Pick<
  ContentWithRelations,
  'leavesAt' | 'leavingByCreator' | 'leavingByOrg'
>;

/** A piece's leave: the day it goes, and whose delete holds it. */
export interface Leave {
  /** ISO, as the wire sends it. */
  leavesAt: string;
  /**
   * `creator`: the creator's own delete alone. `both`: theirs and an org
   * admin's, so their Keep withdraws only theirs. Either is theirs to keep.
   * `org`: only an org admin's, so a note and "Delete it too", no Keep.
   */
  heldBy: 'creator' | 'org' | 'both';
}

/** Its leave, or null when it isn't leaving. */
export function leaveOf(piece: LeavingPiece): Leave | null {
  if (piece.leavesAt == null) return null;
  // Only a leave held by the org alone is not theirs: a row that does not
  // say is offered Keep, which the server refuses with its own code.
  const byOrg = piece.leavingByOrg === true;
  const byCreator = piece.leavingByCreator === true;
  const heldBy = !byOrg ? 'creator' : byCreator ? 'both' : 'org';
  return { leavesAt: piece.leavesAt, heldBy };
}

/** Whether the creator may Keep it: unless only their org's delete holds it. */
export function canKeep(leave: Leave): boolean {
  return leave.heldBy !== 'org';
}

/**
 * Why the download switch holds while it leaves (owner 2026-11-21): its
 * owners were told when it was deleted, by the creator, by their org, or
 * (both, or not known) by whoever did.
 */
export function downloadLockedWords(heldBy: Leave['heldBy'] | null): string {
  if (heldBy === 'creator') return m.studio_leaving_download_locked();
  if (heldBy === 'org') return m.studio_leaving_download_locked_org();
  return m.studio_leaving_download_locked_both();
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The day a delete made now leaves on: LEAVING_NOTICE_DAYS on (the server sets its own). */
export function leaveDayFrom(now: Date = new Date()): Date {
  return new Date(now.getTime() + LEAVING_NOTICE_DAYS * DAY_MS);
}

/**
 * What a delete refused as too soon says (409 CONTENT_LEAVING_TOO_SOON): its
 * owners were emailed under a day ago, and when it can go again, in the
 * creator's own time. Null for any other error, and for one whose
 * `retryAfter` is missing or unreadable (its own words are said instead).
 */
export function tooSoonWords(
  error: unknown,
  now: Date = new Date()
): string | null {
  if (remoteErrorCode(error) !== ERROR_CODES.CONTENT_LEAVING_TOO_SOON) {
    return null;
  }
  const body =
    error && typeof error === 'object'
      ? (error as { body?: { retryAfter?: unknown } }).body
      : undefined;
  return retryWords(body?.retryAfter, now);
}

/**
 * "…after 14:05" today, "…after 14:05 tomorrow" on the next calendar day,
 * and the date on any later one, in the creator's own zone. Null when it is
 * unreadable, or at or before `now` (a clock ahead of the server's, a dialog
 * left open): the server's own words are said instead.
 */
export function retryWords(at: unknown, now: Date = new Date()): string | null {
  if (typeof at !== 'string') return null;
  const when = new Date(at);
  if (Number.isNaN(when.getTime()) || when.getTime() <= now.getTime()) {
    return null;
  }
  const time = formatLocalClockTime(when);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (when.toDateString() === now.toDateString()) {
    return m.studio_leaving_too_soon({ time });
  }
  if (when.toDateString() === tomorrow.toDateString()) {
    return m.studio_leaving_too_soon_tomorrow({ time });
  }
  return m.studio_leaving_too_soon_on({
    time,
    date: formatSentenceDate(when),
  });
}

/**
 * What a Keep did, in words: kept, or (when an org admin deleted it too)
 * the creator's own delete withdrawn while the org's still stands.
 */
export function keptWords(
  title: string,
  outcome: ContentKeepOutcome,
  leavesAt: string | null
): string {
  return outcome.stillLeavingBy === 'org' && leavesAt !== null
    ? m.studio_leaving_kept_org_stands({
        title,
        date: formatSentenceDate(leavesAt),
      })
    : m.studio_leaving_kept({ title });
}

/** A Keep refused because only an org admin's delete holds it (403); null for any other error. */
export function keepRefusalWords(error: unknown, title: string): string | null {
  return remoteErrorCode(error) === ERROR_CODES.CONTENT_LEAVE_NOT_YOURS
    ? m.studio_leaving_keep_not_yours({ title })
    : null;
}
