/**
 * What still stands between a draft and going live (Codex-a6ofh.2.4): the
 * publish gate's own rules (`@codex/content` publish-gate.ts), read from what
 * the Publish step holds, so its checklist lists only what is missing before
 * the server is asked. The server stays the judge: a refusal it sends maps to
 * the same row by its code (`PUBLISH_REFUSAL_CODES`). Whether the creator is
 * still on the org's team is the server's alone to say.
 */
import {
  MEDIA_STATUS,
  PRICE_LIMITS,
  PUBLISH_REFUSAL_CODES,
  type PublishRefusalCode,
  requiresPayoutsToPublish,
} from '@codex/constants';
import { hasArticleBody } from '@codex/validation';
import { accessGroupToFlags } from '$lib/utils/content-access';
import { formatPrice } from '$lib/utils/format';
import * as m from '$paraglide/messages';
import { TYPE_WORD } from './canvas-text';
import type { DraftValues } from './draft-session.svelte';
import type { EditorContentType } from './editor-url';

/** A row of the checklist: a refusal's own code, or a title still to type. */
export type PublishGap = PublishRefusalCode | 'TITLE_NEEDED';

const REFUSAL_CODES: readonly string[] = PUBLISH_REFUSAL_CODES;

function isRefusalCode(code: string): code is PublishRefusalCode {
  return REFUSAL_CODES.includes(code);
}

/** A refusal's code as a row of the checklist, or null for one it has no row for. */
export function asPublishGap(code: string | undefined): PublishGap | null {
  if (code === 'TITLE_NEEDED') return code;
  return code !== undefined && isRefusalCode(code) ? code : null;
}

export interface PublishFacts {
  contentType: EditorContentType;
  values: DraftValues;
  /** The title field was emptied: the session keeps the saved one. */
  needsTitle: boolean;
  /**
   * The piece's media as the step knows it; null when it has none, or none
   * read yet (the server judges then). `deleted`: deleted, or no longer
   * this creator's to read.
   */
  media: { status: string; deleted: boolean } | null;
  /** Its cover is a frame of a video since deleted (`thumbnailFrame`). */
  coverDeleted: boolean;
  /** Payouts are set up; true until known, as the access choice assumes. */
  connectReady: boolean;
  organizationId: string | null;
}

export function publishGaps(facts: PublishFacts): PublishGap[] {
  const { values, media } = facts;
  const gaps: PublishGap[] = [];
  if (facts.needsTitle || values.title.trim() === '') gaps.push('TITLE_NEEDED');
  if (facts.contentType === 'written') {
    if (!hasArticleBody(values.contentBody)) gaps.push('BODY_REQUIRED');
  } else if (!values.mediaItemId) {
    gaps.push('MEDIA_REQUIRED');
  } else if (media?.deleted) {
    gaps.push('MEDIA_DELETED');
  } else if (media && media.status !== MEDIA_STATUS.READY) {
    gaps.push('MEDIA_NOT_READY');
  }
  if (facts.coverDeleted) gaps.push('THUMBNAIL_MEDIA_DELETED');

  // The same flags a save sends, so the rules read what would go live.
  const { access } = values;
  const flags = accessGroupToFlags(access, facts.organizationId);
  if (flags.isPurchasable && (flags.priceCents ?? 0) < PRICE_LIMITS.MIN_CENTS) {
    gaps.push('PRICE_REQUIRED');
  }
  // Plans never read are not "none ticked": the server decides then.
  if (
    flags.isTierGated &&
    !flags.isPurchasable &&
    access.tierIds?.length === 0
  ) {
    gaps.push('TIER_REQUIRED_TO_PUBLISH');
  }
  if (!facts.connectReady && earnsByFlags(flags)) {
    gaps.push('CREATOR_CONNECT_REQUIRED');
  }
  return gaps;
}

/**
 * Whether the flags a save sends earn, so the piece needs payouts to go live
 * (the server's `requiresPayoutsToPublish`). Plans never read leave
 * `isTierGated` out: not gated, here as on the server, which keeps its ticks.
 */
export function earnsByFlags(
  flags: ReturnType<typeof accessGroupToFlags>
): boolean {
  return requiresPayoutsToPublish({
    priceCents: flags.priceCents,
    isTierGated: flags.isTierGated ?? false,
  });
}

/** The field a change to which can put a refused gap right on the Publish step. */
const PUT_RIGHT_BY: Partial<Record<PublishGap, keyof DraftValues>> = {
  PRICE_REQUIRED: 'access',
  TIER_REQUIRED_TO_PUBLISH: 'access',
  CREATOR_CONNECT_REQUIRED: 'access',
};

/**
 * A change to `key` may have put right what Publish was refused for, so the
 * refusal goes. One in the server's own words may be anything, so any change
 * may. Another stays until the next Publish: the team is the server's alone
 * to judge, and what is put right on the Write step is checked again there.
 * A deleted frame is put right by a new cover, which is no draft value: the
 * step clears that one itself.
 */
export function refusalPutRightBy(
  gap: PublishGap | null,
  key: keyof DraftValues
): boolean {
  return gap === null || PUT_RIGHT_BY[gap] === key;
}

/** A row as the checklist says it, and where it is put right. */
export interface GapRow {
  gap: PublishGap;
  words: string;
  /** Put right on the Write step, in payouts, or (null) on this screen or by waiting. */
  fix: 'write' | 'payouts' | null;
}

/**
 * The checklist's words for a gap. Media not yet ready says how far it has
 * got (`progress`, the transcode's %, while it is known), or that it failed.
 */
export function gapRow(
  gap: PublishGap,
  {
    contentType,
    media,
  }: {
    contentType: EditorContentType;
    media: { status: string; progress: number | null } | null;
  }
): GapRow {
  const type = TYPE_WORD[contentType]();
  switch (gap) {
    case 'TITLE_NEEDED':
      return { gap, words: m.studio_publish_gap_title(), fix: 'write' };
    case 'MEDIA_REQUIRED':
      return { gap, words: m.studio_publish_gap_media({ type }), fix: 'write' };
    case 'MEDIA_NOT_READY':
      if (media?.status === MEDIA_STATUS.FAILED) {
        return {
          gap,
          words: m.studio_publish_gap_media_failed({ type }),
          fix: 'write',
        };
      }
      if (media?.status === MEDIA_STATUS.UPLOADING) {
        return {
          gap,
          words: m.studio_publish_gap_uploading({ type }),
          fix: null,
        };
      }
      return {
        gap,
        words:
          media?.progress == null
            ? m.studio_publish_gap_preparing({ type })
            : m.studio_publish_gap_preparing_pct({ type, pct: media.progress }),
        fix: null,
      };
    case 'MEDIA_DELETED':
      return {
        gap,
        words: m.studio_publish_gap_media_deleted({ type }),
        fix: 'write',
      };
    case 'BODY_REQUIRED':
      return { gap, words: m.studio_publish_gap_body(), fix: 'write' };
    case 'PRICE_REQUIRED':
      return {
        gap,
        words: m.studio_publish_gap_price({
          price: formatPrice(PRICE_LIMITS.MIN_CENTS),
        }),
        fix: null,
      };
    case 'TIER_REQUIRED_TO_PUBLISH':
      return { gap, words: m.studio_publish_gap_tier(), fix: null };
    case 'CREATOR_CONNECT_REQUIRED':
      return { gap, words: m.studio_publish_gap_payouts(), fix: 'payouts' };
    case 'THUMBNAIL_MEDIA_DELETED':
      return { gap, words: m.studio_publish_gap_cover_deleted(), fix: null };
    case 'NOT_ON_ORG_TEAM':
      return { gap, words: m.studio_publish_gap_team(), fix: null };
  }
}
