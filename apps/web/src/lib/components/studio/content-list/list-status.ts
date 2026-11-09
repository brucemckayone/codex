/**
 * A piece's status as the content lists show it (Codex-a6ofh.2, the epic
 * review). A piece that has been live and is not on sale is "Off sale", as
 * the live editor's own bar says, never a draft. Its buyers keep it (owner,
 * 2026-11-05: `hasBeenLive`), it opens in the live editor, it has no draft
 * progress, and it is put back with "Publish again". It looks as an
 * archived piece does, muted, as the mockup's Off sale row (content-list.html
 * L1); archived keeps its own word until the list renames it
 * (Codex-a6ofh.3.6). The row, the slab and the table all ask here.
 */
import {
  CONTENT_STATUS,
  hasBeenLive,
  type PublicationState,
} from '@codex/constants';
import * as m from '$paraglide/messages';

/** How it looks: on sale, a draft on its way, or once live and off sale now. */
export type ListStatusVariant = 'published' | 'draft' | 'off-sale';

export function listStatus(piece: PublicationState): {
  label: string;
  variant: ListStatusVariant;
  /** What its publish toggle says. */
  toggle: string;
} {
  if (piece.status === CONTENT_STATUS.PUBLISHED) {
    return {
      label: m.studio_content_status_published(),
      variant: 'published',
      toggle: m.studio_content_form_unpublish(),
    };
  }
  if (hasBeenLive(piece)) {
    return {
      label:
        piece.status === CONTENT_STATUS.ARCHIVED
          ? m.studio_content_status_archived()
          : m.studio_live_badge_unpublished(),
      variant: 'off-sale',
      toggle: m.studio_live_republish(),
    };
  }
  return {
    label: m.studio_content_status_draft(),
    variant: 'draft',
    toggle: m.studio_content_form_publish(),
  };
}
