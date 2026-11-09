/**
 * A piece's status as the content lists show it (Codex-a6ofh.2, the epic
 * review). A piece that has been live and is a draft again is "Off sale",
 * as the live editor's own bar says, never a draft. Its buyers keep it
 * (owner, 2026-11-05: `hasBeenLive`), it opens in the live editor, and it
 * has no draft progress. The row, the slab and the table all ask here.
 */
import {
  CONTENT_STATUS,
  hasBeenLive,
  type PublicationState,
} from '@codex/constants';
import * as m from '$paraglide/messages';

export type ListStatusVariant = 'published' | 'draft' | 'archived';

export function listStatus(piece: PublicationState): {
  label: string;
  variant: ListStatusVariant;
} {
  if (piece.status === CONTENT_STATUS.PUBLISHED) {
    return {
      label: m.studio_content_status_published(),
      variant: 'published',
    };
  }
  if (piece.status === CONTENT_STATUS.ARCHIVED) {
    return { label: m.studio_content_status_archived(), variant: 'archived' };
  }
  return {
    label: hasBeenLive(piece)
      ? m.studio_live_badge_unpublished()
      : m.studio_content_status_draft(),
    variant: 'draft',
  };
}
