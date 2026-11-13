/**
 * What the Delete dialog offers for the pieces it leaves alone, because
 * people have them (Codex-a6ofh.3.5, owner D-b4): Unpublish instead takes
 * down the live ones whose people keep them, and the dialog says so. It
 * also says when unpublishing would end their playback too, since a Free
 * piece is nobody's purchase (Codex-dz997, owner 2026-11-13): that one is
 * not offered.
 */
import { CONTENT_STATUS } from '@codex/constants';
import type { ContentWithRelations } from '$lib/types';
import * as m from '$paraglide/messages';
import { keepsWhenUnpublished } from './row-facts';

/** A piece the dialog weighs, as the list holds it. */
export type DeletePiece = Pick<
  ContentWithRelations,
  | 'id'
  | 'title'
  | 'status'
  | 'holderCount'
  | 'courseOnly'
  | 'isTeamOnly'
  | 'isFollowerGated'
  | 'isTierGated'
  | 'priceCents'
>;

export interface UnpublishOffer {
  /** The live pieces Unpublish instead takes down: their people keep them. */
  ids: string[];
  /** What unpublishing does for the people who have them; null when none is live. */
  words: string | null;
}

/** The dialog's Unpublish instead, for the pieces it leaves alone. */
export function unpublishOffer(kept: readonly DeletePiece[]): UnpublishOffer {
  const live = kept.filter(
    (piece) => piece.status === CONTENT_STATUS.PUBLISHED
  );
  const keeps = live.filter(keepsWhenUnpublished);
  const ends = live.length - keeps.length;
  const parts: string[] = [];
  if (keeps.length > 0) {
    parts.push(
      keeps.length === 1
        ? m.studio_content_delete_unpublish_keeps_it()
        : m.studio_content_delete_unpublish_keeps_them()
    );
  }
  if (ends > 0) {
    // "It" only when it is the one piece left alone; "them" when it is all
    // of them; else how many, since the others are offered.
    if (kept.length === 1) {
      parts.push(m.studio_content_delete_unpublish_ends_it());
    } else if (ends === kept.length) {
      parts.push(m.studio_content_delete_unpublish_ends_them());
    } else {
      parts.push(
        ends === 1
          ? m.studio_content_delete_unpublish_ends_some_one()
          : m.studio_content_delete_unpublish_ends_some({ count: ends })
      );
    }
  }
  return {
    ids: keeps.map((piece) => piece.id),
    words: parts.length > 0 ? parts.join(' ') : null,
  };
}

/** The dialog's warning for the pieces people have: who, and what each way does. */
export interface HeldNotice {
  title: string;
  body: string;
}

/**
 * The warning, by how the dialog was opened: the row menu's one piece says
 * by how many people; the bulk bar's names the one it leaves alone, or
 * counts them. Null when nobody has any of them.
 */
export function heldNotice(
  mode: 'one' | 'many',
  kept: readonly DeletePiece[],
  unpublishWords: string | null
): HeldNotice | null {
  const [only] = kept;
  if (!only) return null;
  const withUnpublish = (text: string) =>
    unpublishWords ? `${text} ${unpublishWords}` : text;
  const people = only.holderCount ?? 0;
  if (mode === 'one') {
    return {
      title:
        people === 1
          ? m.studio_content_delete_bought_title_one()
          : m.studio_content_delete_bought_title({ count: people }),
      body: withUnpublish(m.studio_content_delete_bought_body()),
    };
  }
  if (kept.length === 1) {
    return {
      title: m.studio_content_delete_kept_one_title({ title: only.title }),
      body: withUnpublish(
        people === 1
          ? m.studio_content_delete_kept_one_body_single()
          : m.studio_content_delete_kept_one_body({ count: people })
      ),
    };
  }
  return {
    title: m.studio_content_delete_kept_title({ count: kept.length }),
    body: withUnpublish(m.studio_content_delete_kept_body()),
  };
}
