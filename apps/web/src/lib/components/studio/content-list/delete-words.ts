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
import { joinNames } from '../plan-picker/select-from-tier';
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

/**
 * The dialog's Unpublish instead, for the pieces it leaves alone. Only the
 * live ones are weighed: a draft is not on sale. In a mix, the ones that
 * would lose it come first and are said to stay up; then the ones the
 * button takes down, last, beside the button, so its "it" or "them" can
 * only be those. Pieces are named, never counted: two counts read alike
 * and name nothing, and a bulk action holds at most CONTENT_BULK_MAX.
 */
export function unpublishOffer(kept: readonly DeletePiece[]): UnpublishOffer {
  const live = kept.filter(
    (piece) => piece.status === CONTENT_STATUS.PUBLISHED
  );
  const keeps = live.filter(keepsWhenUnpublished);
  const ends = live.filter((piece) => !keepsWhenUnpublished(piece));
  const parts: string[] = [];
  if (ends.length > 0) {
    parts.push(
      keeps.length > 0
        ? // A mix: some of several, so always by name.
          named(ends, {
            named: m.studio_content_delete_unpublish_ends_named_stays,
            namedMany: m.studio_content_delete_unpublish_ends_named_many_stays,
          })
        : whichOf(kept, ends, {
            it: m.studio_content_delete_unpublish_ends_it,
            them: m.studio_content_delete_unpublish_ends_them,
            named: m.studio_content_delete_unpublish_ends_named,
            namedMany: m.studio_content_delete_unpublish_ends_named_many,
          })
    );
  }
  if (keeps.length > 0) {
    parts.push(
      whichOf(kept, keeps, {
        it: m.studio_content_delete_unpublish_keeps_it,
        them: m.studio_content_delete_unpublish_keeps_them,
        named: m.studio_content_delete_unpublish_keeps_named,
        namedMany: m.studio_content_delete_unpublish_keeps_named_many,
      })
    );
  }
  return {
    ids: keeps.map((piece) => piece.id),
    words: parts.length > 0 ? parts.join(' ') : null,
  };
}

interface NamedWords {
  named: (args: { title: string }) => string;
  namedMany: (args: { titles: string }) => string;
}

/**
 * Words for some of the pieces left alone, so the creator can tell which:
 * "it" when it is the only one, "them" when it is all of them, else by name.
 */
function whichOf(
  kept: readonly DeletePiece[],
  these: readonly DeletePiece[],
  words: NamedWords & { it: () => string; them: () => string }
): string {
  if (kept.length === 1) return words.it();
  if (these.length === kept.length) return words.them();
  return named(these, words);
}

/** One piece by its title; several by theirs ("“A”, “B” and “C”"). */
function named(these: readonly DeletePiece[], words: NamedWords): string {
  const [only] = these;
  if (only && these.length === 1) return words.named({ title: only.title });
  return words.namedMany({
    titles: joinNames(these.map((piece) => `“${piece.title}”`)),
  });
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
