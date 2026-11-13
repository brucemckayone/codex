/**
 * What the content list says about one piece (Codex-a6ofh.3.1, mockup L1):
 * its access in plain words, its views and sales, and the one line under its
 * title that says what it needs. The table and the grid both ask here, so a
 * piece reads the same in either view.
 *
 * Everything is read from the row as listed (owner, 2026-11-10: progress as
 * of the read, no status socket on this page). The words are the editor's
 * own where it has them (the checklist's gap rows, the scheduled heading),
 * so a deleted video reads the same in the list and on the Publish step.
 */
import { hasBeenLive, MEDIA_STATUS } from '@codex/constants';
import type { ContentWithRelations } from '$lib/types';
import type { PayoutsRead } from '$lib/utils/connect-readiness';
import { deriveContentAccessKind } from '$lib/utils/content-access';
import { formatCount, formatPrice } from '$lib/utils/format';
import * as m from '$paraglide/messages';
import { editHref, editorContentType } from '../editor/editor-url';
import { blockedRow, gapRow } from '../editor/publish-gaps';
import { type DraftProgress, draftProgress } from './draft-progress';
import { isOffSale } from './list-status';

/** The Access cell: the kind or price, and what it means for a buyer. */
export interface AccessWords {
  label: string;
  detail: string | null;
}

/** A tier's name by id; undefined while the org's tiers are unread. */
export type TierName = (id: string) => string | undefined;

/**
 * The plans that open it, by name: null while any name is unknown (the
 * tiers unread, or a row older than plan access, whose set is absent),
 * never a partial list that reads as the whole set.
 */
function tierNames(
  row: ContentWithRelations,
  tierName: TierName
): string | null {
  const ids = row.includedInTierIds;
  if (!row.isTierGated || ids === undefined || ids.length === 0) return null;
  const names = ids.map(tierName);
  return names.every((name) => name !== undefined) ? names.join(', ') : null;
}

/**
 * Mockup L1 note 7: the price and the tiers in plain words, never the raw
 * access kind. "£4.99 · One-time purchase", "Subscribers · Pro",
 * "£9.99 or Standard · Purchase + tier", "Followers · Free to follow".
 * Off sale, a paid piece says its buyers keep it.
 */
export function accessWords(
  row: ContentWithRelations,
  tierName: TierName
): AccessWords {
  const kind = deriveContentAccessKind(row);
  switch (kind) {
    case 'team':
      return { label: m.studio_content_form_access_team(), detail: null };
    case 'followers':
      return {
        label: m.studio_content_form_access_followers(),
        detail: m.studio_content_form_access_followers_short(),
      };
    case 'paid': {
      const price = formatPrice(row.priceCents);
      const hybrid =
        row.isTierGated === true && (row.includedInTierIds?.length ?? 0) > 0;
      const names = tierNames(row, tierName);
      const label =
        hybrid && names
          ? m.studio_content_list_access_price_or_tier({ price, tiers: names })
          : price;
      if (isOffSale(row))
        return { label, detail: m.studio_content_list_access_buyers_keep() };
      return {
        label,
        detail: hybrid
          ? m.studio_content_list_access_purchase_and_tier()
          : m.studio_content_form_access_paid(),
      };
    }
    case 'subscribers': {
      // Gated with no plan ticked is closed, never free (Codex-2hxff.91).
      const closed =
        row.includedInTierIds !== undefined &&
        row.includedInTierIds.length === 0;
      return {
        label: m.studio_content_form_access_subscribers(),
        detail: closed
          ? m.studio_content_list_access_no_tier()
          : tierNames(row, tierName),
      };
    }
    default:
      return { label: m.studio_content_form_access_free(), detail: null };
  }
}

/** Views once it has been live; a draft has had none to count. */
export function viewsShown(row: ContentWithRelations): string | null {
  return hasBeenLive(row) ? formatCount(row.viewCount ?? 0) : null;
}

/**
 * Sales for a piece that has been live and was ever bought or is for sale;
 * else nothing to count. Its buyers (Codex-a6ofh.3.5, owner R2): a piece
 * taken off sale keeps its buyers, so it keeps its count.
 */
export function salesShown(row: ContentWithRelations): string | null {
  const buyers = row.buyerCount ?? 0;
  return hasBeenLive(row) && (row.isPurchasable || buyers > 0)
    ? formatCount(buyers)
    : null;
}

/**
 * Someone has it, paid for or given, through the piece or a course that
 * holds it (the list's `holderCount`, owner 2026-11-13): a bulk delete, or a
 * move to Followers or Team only, leaves it alone, as the server does.
 */
export function isHeld(
  row: Pick<ContentWithRelations, 'holderCount'>
): boolean {
  return (row.holderCount ?? 0) > 0;
}

/**
 * Its categories as a row names them (Codex-a6ofh.3.3, owner 2026-11-12):
 * the first, then how many more ("Tutorials +2"), and every name for the
 * tooltip and a screen reader. Null in none, or when the row was not sent
 * them.
 */
export function categoryWords(
  row: ContentWithRelations
): { shown: string; all: string } | null {
  const names = (row.categories ?? []).map((item) => item.name);
  const [first] = names;
  if (first === undefined) return null;
  return {
    shown:
      names.length === 1
        ? first
        : m.studio_content_categories_more({
            name: first,
            count: names.length - 1,
          }),
    all: names.join(', '),
  };
}

/** The line under the title: what the piece needs, if anything. */
export type RowLine =
  /** A draft's two steps and what is left (Codex-a6ofh.2.6). */
  | { kind: 'progress'; progress: DraftProgress }
  /** Publish when ready is waiting on its media (Codex-a6ofh.2.9). */
  | { kind: 'scheduled'; words: string }
  /** A scheduled attempt that didn't go live, and why. */
  | { kind: 'blocked'; words: string }
  /** A piece that has been live whose media went (deleted, or failed for good). */
  | { kind: 'media'; words: string };

export function rowLine(
  row: ContentWithRelations,
  payouts: PayoutsRead
): RowLine | null {
  const contentType = editorContentType(row.contentType);
  if (!contentType) return null;
  const media = row.mediaItem;

  if (hasBeenLive(row)) {
    if (!media) return null;
    if (media.deletedAt != null) {
      return {
        kind: 'media',
        words: gapRow('MEDIA_DELETED', { contentType, media: null }).words,
      };
    }
    if (media.status === MEDIA_STATUS.FAILED) {
      return {
        kind: 'media',
        words: gapRow('MEDIA_NOT_READY', {
          contentType,
          media: { status: media.status, progress: null },
        }).words,
      };
    }
    return null;
  }

  // A live schedule is newer than a reason an earlier attempt was refused.
  if (row.publishRequestedAt != null) {
    const pct = media?.transcodingProgress ?? null;
    return {
      kind: 'scheduled',
      words:
        pct === null
          ? m.studio_publish_scheduled_heading()
          : m.studio_content_list_scheduled_pct({ pct }),
    };
  }
  if (row.publishBlockedReason) {
    return {
      kind: 'blocked',
      words: blockedRow(row.publishBlockedReason, contentType).words,
    };
  }
  const progress = draftProgress(row, payouts);
  return progress ? { kind: 'progress', progress } : null;
}

/**
 * Where the row's title goes: a draft opens at the step it is on, anything
 * that has been live opens the live editor.
 */
export function rowHref(
  row: ContentWithRelations,
  line: RowLine | null
): string {
  return line?.kind === 'progress' ? line.progress.href : editHref(row.id);
}
