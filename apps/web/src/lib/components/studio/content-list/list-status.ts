/**
 * A piece's status as the content lists show it (Codex-a6ofh.2, the epic
 * review). A piece that has been live and is not on sale is "Off sale", as
 * the live editor's own bar says, never a draft. Its buyers keep it (owner,
 * 2026-11-05: `hasBeenLive`), it opens in the live editor, it has no draft
 * progress, and it is put back with "Publish again". It looks as an
 * archived piece does, muted, as the mockup's Off sale row (content-list.html
 * L1); an archived piece is Off sale too, the tab that lists both
 * (Codex-a6ofh.3.6). ContentStatus (the table and the cards) and the
 * Access cell's "Buyers keep access" both ask here.
 *
 * A piece leaving (Codex-a6ofh.6, mockup LN3) is off sale with a date, and
 * filed under Off sale with the rest, but reads "Leaving": it goes back with
 * Keep it, never Publish again, which its leave refuses.
 */
import {
  CONTENT_LIFECYCLE,
  type ContentLifecycle,
  contentLifecycle,
  type PublicationState,
} from '@codex/constants';
import * as m from '$paraglide/messages';

/** Once live, and not on sale now: it keeps its buyers (owner, 2026-11-05). */
export function isOffSale(piece: PublicationState): boolean {
  return contentLifecycle(piece) === CONTENT_LIFECYCLE.OFF_SALE;
}

/** How it looks: its lifecycle, the one the list's tabs file it under, or leaving. */
export type ListStatusVariant = ContentLifecycle | 'leaving';

/** A piece as its status reads it: its lifecycle, and its leave when it has one. */
export type ListStatusPiece = PublicationState & {
  leavesAt?: string | null;
};

const WORDS: Record<
  ListStatusVariant,
  { label: () => string; toggle: () => string }
> = {
  [CONTENT_LIFECYCLE.PUBLISHED]: {
    label: m.studio_content_status_published,
    toggle: m.studio_content_form_unpublish,
  },
  [CONTENT_LIFECYCLE.OFF_SALE]: {
    label: m.studio_live_badge_unpublished,
    toggle: m.studio_live_republish,
  },
  [CONTENT_LIFECYCLE.DRAFT]: {
    label: m.studio_content_status_draft,
    toggle: m.studio_content_form_publish,
  },
  leaving: {
    label: m.studio_leaving_status,
    toggle: m.studio_leaving_keep,
  },
};

export function listStatus(piece: ListStatusPiece): {
  label: string;
  variant: ListStatusVariant;
  /** What its publish toggle says. */
  toggle: string;
} {
  const variant = piece.leavesAt != null ? 'leaving' : contentLifecycle(piece);
  const words = WORDS[variant];
  return { label: words.label(), variant, toggle: words.toggle() };
}
