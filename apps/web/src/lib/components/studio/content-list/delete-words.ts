/**
 * What the Delete dialog says (Codex-a6ofh.6, mockup leaving-notice.html
 * LN1 and LN2). A piece nobody owns is deleted at once, as before. A piece
 * people own, bought or given, through the piece or a course that holds it
 * (the list's `holderCount`), goes off sale and leaves on a date 30 days on,
 * its owners emailed and keeping it until then; the creator can keep it any
 * time before. The row menu and the editor's Delete say so for their one
 * piece, with Unpublish instead where unpublishing keeps it for them; the
 * bulk bar's names the ones that leave. The server judges each piece again.
 *
 * A piece only the org's delete holds is already leaving: the creator's
 * "Delete it too" adds theirs, so it leaves even if the org keeps it. Its
 * owners were told when the org deleted it, and are not emailed again
 * (owner 2026-11-20).
 *
 * Unpublishing a Free piece ends it for them too (Codex-dz997, owner
 * 2026-11-13), since a Free piece is nobody's purchase: that one is not
 * offered, and the dialog says why.
 */
import { CONTENT_STATUS } from '@codex/constants';
import type { ContentDeleteOutcome, ContentWithRelations } from '$lib/types';
import { formatSentenceDate } from '$lib/utils/format';
import * as m from '$paraglide/messages';
import { joinNames } from '../plan-picker/select-from-tier';
import { isHeld, keepsWhenUnpublished } from './row-facts';

/** A piece the dialog weighs, as the list (or the editor) holds it. */
export type DeletePiece = Pick<
  ContentWithRelations,
  | 'id'
  | 'title'
  | 'slug'
  | 'status'
  | 'holderCount'
  | 'courseOnly'
  | 'isTeamOnly'
  | 'isFollowerGated'
  | 'isTierGated'
  | 'priceCents'
  | 'ownersCanDownload'
>;

/** One piece people own (LN1): who, what the delete does for them, and the ways out. */
export interface OneNotice {
  /** "57 people own it." */
  title: string;
  /** It goes off sale now and leaves on its date; they are emailed. */
  body: string;
  /** Under it: Keep it any time before, and what Unpublish instead does. */
  aside: string;
  /** Unpublish instead is offered: it is live, and its owners keep it unpublished. */
  unpublish: boolean;
}

/** The row menu's or the editor's one piece, leaving on `leavesOn`; null when nobody owns it. */
export function oneNotice(
  piece: DeletePiece,
  leavesOn: Date
): OneNotice | null {
  if (!isHeld(piece)) return null;
  const people = piece.holderCount ?? 0;
  const date = formatSentenceDate(leavesOn);
  const live = piece.status === CONTENT_STATUS.PUBLISHED;
  const unpublish = live && keepsWhenUnpublished(piece);
  const aside = [m.studio_leaving_delete_keep_any_time({ date })];
  if (unpublish) aside.push(m.studio_leaving_delete_unpublish_instead());
  else if (live) aside.push(m.studio_content_delete_unpublish_ends_it());
  return {
    title:
      people === 1
        ? m.studio_leaving_delete_owners_one()
        : m.studio_leaving_delete_owners({ count: people }),
    body:
      piece.ownersCanDownload === false
        ? m.studio_leaving_delete_body_watch({ date })
        : m.studio_leaving_delete_body_download({ date }),
    aside: aside.join(' '),
    unpublish,
  };
}

/** "Delete it too" (a leave only the org's delete holds): its owners were already told. */
export function tooWords(leavesAt: string): string {
  return m.studio_leaving_delete_too_body({
    date: formatSentenceDate(leavesAt),
  });
}

/**
 * A piece whose owners are not known (`holderCount` absent: a content-api
 * older than the studio's): what a delete does either way, never that
 * nobody owns it.
 */
export function unknownWords(leavesOn: Date): string {
  return m.studio_leaving_delete_unknown({
    date: formatSentenceDate(leavesOn),
  });
}

/**
 * What one delete did, in words: deleted, or leaving on its date with its
 * owners emailed. One that started nothing (`started` false) emailed nobody
 * again: beside the org's delete it leaves even if the org keeps it; a
 * repeat of the creator's own (a second tab) was already leaving. Null
 * `outcome` is a piece already gone (another tab), which is what was asked
 * for.
 */
export function deletedWords(
  title: string,
  outcome: ContentDeleteOutcome | null
): string {
  if (outcome?.outcome !== 'leaving')
    return m.studio_content_deleted_one({ title });
  const date = formatSentenceDate(outcome.leavesAt);
  if (!outcome.started) {
    return outcome.leavingByOrg
      ? m.studio_leaving_deleted_too({ title, date })
      : m.studio_leaving_deleted_again({ title, date });
  }
  return outcome.holders === 1
    ? m.studio_leaving_deleted_one_owner({ title, date })
    : m.studio_leaving_deleted({ title, date, count: outcome.holders });
}

/** The bulk bar's pieces (LN2): the ones deleted now, and the ones that leave. */
export interface ManyNotice {
  /** The ones nobody owns, deleted now; null when there are none. */
  going: string | null;
  /** The banner for the ones people own; null when there are none. */
  leaving: { title: string; body: string } | null;
}

export function manyNotice(
  pieces: readonly DeletePiece[],
  leavesOn: Date
): ManyNotice {
  const held = pieces.filter(isHeld);
  const going = goingWords(pieces.length - held.length, held.length > 0);
  const [only] = held;
  if (!only) return { going, leaving: null };
  const date = formatSentenceDate(leavesOn);
  const nameOf = namer(pieces);
  // A download only where every one of them offers it; watching is true of
  // all. Owners are never counted: one course's buyers are in each lesson's.
  const download = held.every((piece) => piece.ownersCanDownload !== false);
  if (held.length === 1) {
    const words = download
      ? m.studio_leaving_delete_leave_one_download
      : m.studio_leaving_delete_leave_one_watch;
    return {
      going,
      leaving: {
        title: m.studio_leaving_delete_leave_title_one({ date }),
        body: words({ name: nameOf(only) }),
      },
    };
  }
  const words = download
    ? m.studio_leaving_delete_leave_many_download
    : m.studio_leaving_delete_leave_many_watch;
  return {
    going,
    leaving: {
      title: m.studio_leaving_delete_leave_title({ count: held.length, date }),
      body: words({ titles: joinNames(held.map(nameOf)) }),
    },
  };
}

/**
 * The ones nobody owns: deleted now. Beside ones that leave, the mockup's
 * "3 are deleted now. Nobody owns them"; alone, today's words.
 */
function goingWords(count: number, besideLeaving: boolean): string | null {
  if (count === 0) return null;
  if (besideLeaving) {
    return count === 1
      ? m.studio_leaving_delete_going_one()
      : m.studio_leaving_delete_going({ count });
  }
  return count === 1
    ? m.studio_content_delete_many_body_one()
    : m.studio_content_delete_many_body({ count });
}

/**
 * How the dialog names a piece: its title, quoted. Titles are not unique,
 * and two pieces of one name can go opposite ways (one deleted now, one
 * leaving), so a title any two of the dialog's pieces share also gives each
 * its address: “Introduction” (/intro). The table shows it under the title;
 * the grid shows titles only.
 */
function namer(pieces: readonly DeletePiece[]): (piece: DeletePiece) => string {
  const uses = new Map<string, number>();
  for (const piece of pieces) {
    uses.set(piece.title, (uses.get(piece.title) ?? 0) + 1);
  }
  return (piece) =>
    (uses.get(piece.title) ?? 0) > 1
      ? `“${piece.title}” (/${piece.slug})`
      : `“${piece.title}”`;
}
