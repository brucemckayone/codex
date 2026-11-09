/**
 * How far a draft has got (Codex-a6ofh.2.6, mockups W1 and W7), worked out
 * from the row the content list holds by the Publish step's own checklist
 * (`publishGaps`), so the list, the New menu and the Publish screen never
 * disagree. Nothing is stored (data-design §3.6): Write is done once nothing
 * left is put right on the Write step, and Continue opens the step still to
 * do.
 */
import { hasBeenLive } from '@codex/constants';
import type { ContentWithRelations } from '$lib/types';
import type { PayoutsRead } from '$lib/utils/connect-readiness';
import * as m from '$paraglide/messages';
import { savedDraftValues } from '../editor/canvas-text';
import {
  editHref,
  editorContentType,
  publishStepHref,
} from '../editor/editor-url';
import { type GapRow, gapRow, publishGaps } from '../editor/publish-gaps';

export interface DraftProgress {
  /** Nothing left is put right on the Write step. */
  writeDone: boolean;
  /** Nothing is left: Publish is one click away. */
  ready: boolean;
  /** The step Continue opens. */
  href: string;
  /** What is left, in the checklist's words: Write's first. */
  left: GapRow[];
}

/**
 * A draft's progress, or null: for a piece that has been live, which is no
 * draft (unpublished, it is off sale; owner 2026-11-05) and opens in the live
 * editor, or for a type the editor does not know (it cannot be opened).
 */
export function draftProgress(
  row: ContentWithRelations,
  payouts: PayoutsRead
): DraftProgress | null {
  if (hasBeenLive(row)) return null;
  const contentType = editorContentType(row.contentType);
  if (!contentType) return null;
  const media = row.mediaItem
    ? {
        status: row.mediaItem.status,
        deleted: row.mediaItem.deletedAt != null,
      }
    : null;
  const gaps = publishGaps({
    contentType,
    values: savedDraftValues(row),
    needsTitle: false,
    media,
    // The list carries no `thumbnailFrame`: a cover cut from a deleted video
    // is the Publish step's to say.
    coverDeleted: false,
    connectReady: payouts === 'ready',
    organizationId: row.organizationId ?? null,
  });
  const left = gaps.map((gap) => {
    const shown = gapRow(gap, {
      contentType,
      media: media ? { status: media.status, progress: null } : null,
    });
    // Not read (yet) is not "not set up": say so, and never call it ready.
    if (gap !== 'CREATOR_CONNECT_REQUIRED') return shown;
    if (payouts === 'unread')
      return { ...shown, words: m.studio_drafts_payouts_unread() };
    if (payouts === 'loading')
      return { ...shown, words: m.studio_drafts_payouts_checking() };
    return shown;
  });
  left.sort((a, b) => Number(b.fix === 'write') - Number(a.fix === 'write'));
  const writeDone = !left.some((gap) => gap.fix === 'write');
  return {
    writeDone,
    ready: left.length === 0,
    href: writeDone ? publishStepHref(row.id) : editHref(row.id),
    left,
  };
}

/**
 * The New menu's one line for a draft: its step words, unless all that is
 * left is a payout setup not read (yet), which is said instead of a count.
 */
export function draftMenuWords(
  progress: DraftProgress,
  payouts: PayoutsRead
): string {
  const [only, ...more] = progress.left;
  const unchecked =
    more.length === 0 &&
    only?.gap === 'CREATOR_CONNECT_REQUIRED' &&
    (payouts === 'unread' || payouts === 'loading');
  return unchecked ? only.words : draftStepWords(progress);
}

/** "Step 1 of 2", "Step 2 of 2 · 2 things left", or "Ready to publish". */
export function draftStepWords(progress: DraftProgress): string {
  if (!progress.writeDone) return m.studio_drafts_step_write();
  if (progress.ready) return m.studio_drafts_ready();
  return progress.left.length === 1
    ? m.studio_drafts_step_publish_one()
    : m.studio_drafts_step_publish({ count: progress.left.length });
}
