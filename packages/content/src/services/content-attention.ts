/**
 * What a piece needs from its creator, as SQL (Codex-a6ofh.3.4, the content
 * list's "Needs you"): one predicate per `CONTENT_ATTENTION_KINDS` kind, over
 * the outer `content` row. The counts (`ContentService.attentionCounts`) and
 * the list's `needs` filter use these same predicates, so a chip lists the
 * pieces it counted, on every page.
 *
 * A piece is one kind at most, in the order the row's own line reads it (the
 * web's `rowLine`): a live piece's media, then a draft's schedule, its refused
 * schedule, its media, and last whether it is ready.
 *
 * `ready` mirrors `assertPublishable` (./publish-gate.ts) rule for rule, with
 * one exception. An article's body is read by `hasArticleBody`, which is
 * JavaScript over a TipTap doc or legacy HTML, so the SQL here keeps an
 * article as a CANDIDATE and the service reads its body
 * (`readyAmong`). A parity test runs the real gate on fixture drafts and
 * fails if the two disagree: a rule added to the gate must be added here.
 *
 * For a `select().from(content)` only, never a relational query's where
 * (`ContentService.needsCondition` says why).
 */
import {
  CONTENT_ATTENTION_KINDS,
  CONTENT_STATUS,
  CONTENT_TYPES,
  type ContentAttentionKind,
  MEDIA_STATUS,
  MEDIA_STATUS_GROUPS,
  ORGANIZATION_STATUS,
  ORGANIZATION_TEAM_ROLES,
  PRICE_LIMITS,
} from '@codex/constants';
import {
  content,
  contentTierAccess,
  mediaItems,
  organizationMemberships,
  organizations,
  stripeConnectAccounts,
  subscriptionTiers,
} from '@codex/database/schema';
import { holdsPosterFolderOf, namesPosterFolderOf } from '@codex/transcoding';
import { hasArticleBody } from '@codex/validation';
import { inArray, type SQL, sql } from 'drizzle-orm';
import type { Content } from '../types';
import { stalledUpload } from './media-service';

/** The kinds SQL decides alone: all but `ready`. */
export type SqlAttentionKind = Exclude<ContentAttentionKind, 'ready'>;
export const SQL_ATTENTION_KINDS = CONTENT_ATTENTION_KINDS.filter(
  (kind): kind is SqlAttentionKind => kind !== 'ready'
);

/** Every part holds: `(a and b and …)`. */
function allOf(...parts: SQL[]): SQL {
  return sql`(${sql.join(parts, sql` and `)})`;
}

/** Never live (`hasBeenLive` false): a draft that was never published. */
const isDraft = allOf(
  sql`${content.status} = ${CONTENT_STATUS.DRAFT}`,
  sql`${content.publishedAt} is null`
);

/** Asked to go live when its media is ready (Publish when ready). */
const scheduled = sql`(${content.publishRequestedAt} is not null)`;

/** A schedule refused at go-live, which says why. */
const refused = sql`(coalesce(${content.publishBlockedReason}, '') <> '')`;

/** A draft neither scheduled nor refused a schedule: one still in hand. */
const draftInHand = allOf(isDraft, sql`not ${scheduled}`, sql`not ${refused}`);

/** A video or audio piece: one that plays its media. */
const playsMedia = sql`${content.contentType} in (${CONTENT_TYPES.VIDEO}, ${CONTENT_TYPES.AUDIO})`;

/** The piece's media item matches `condition`. */
function itsMedia(condition: SQL): SQL {
  return sql`exists (select 1 from ${mediaItems} where ${mediaItems.id} = ${content.mediaItemId} and ${condition})`;
}

/** Media nothing can play. */
const deletedOrFailed = sql`(${mediaItems.deletedAt} is not null or ${mediaItems.status} = ${MEDIA_STATUS.FAILED})`;

/** Media nothing makes ready by itself: gone, or a stalled upload. */
function mediaGone(now: Date): SQL {
  return sql`(${deletedOrFailed} or ${stalledUpload(now)})`;
}

/** On its way to ready, as Publish when ready reads it (`isMediaOnItsWay`). */
function mediaOnItsWay(now: Date): SQL {
  return allOf(
    sql`${mediaItems.deletedAt} is null`,
    inArray(mediaItems.status, [
      MEDIA_STATUS.UPLOADING,
      ...MEDIA_STATUS_GROUPS.processing,
    ]),
    sql`not ${stalledUpload(now)}`
  );
}

// ── `ready`: assertPublishable's rules, one predicate each ────────────────

/** `assertCanFileInOrg`: an org piece's creator is on a live org's team. */
const onTheTeam = sql`(${content.organizationId} is null or exists (select 1 from ${organizationMemberships} inner join ${organizations} on ${organizations.id} = ${organizationMemberships.organizationId} where ${organizationMemberships.organizationId} = ${content.organizationId} and ${organizationMemberships.userId} = ${content.creatorId} and ${organizationMemberships.status} = ${ORGANIZATION_STATUS.ACTIVE} and ${inArray(organizationMemberships.role, ORGANIZATION_TEAM_ROLES)} and ${organizations.deletedAt} is null))`;

/**
 * `assertContentFilled` + `mediaReadiness`: a video or audio piece plays its
 * creator's own media, not deleted and ready; an article stays a candidate
 * for its body (`readyAmong`). A type with no rules is never ready.
 */
const filledForItsType = sql`((${playsMedia} and ${itsMedia(
  allOf(
    sql`${mediaItems.creatorId} = ${content.creatorId}`,
    sql`${mediaItems.deletedAt} is null`,
    sql`${mediaItems.status} = ${MEDIA_STATUS.READY}`
  )
)}) or ${content.contentType} = ${CONTENT_TYPES.WRITTEN})`;

/** `contentGaps`' price rule: a piece for sale is priced at £1 or more. */
const pricedIfForSale = sql`(not ${content.isPurchasable} or coalesce(${content.priceCents}, 0) >= ${PRICE_LIMITS.MIN_CENTS})`;

/** Subscriber content not for sale is in at least one tier (`hasAnyTick`). */
const inATierIfGated = sql`(not (${content.isTierGated} and not ${content.isPurchasable}) or exists (select 1 from ${contentTierAccess} inner join ${subscriptionTiers} on ${subscriptionTiers.id} = ${contentTierAccess.tierId} where ${contentTierAccess.contentId} = ${content.id} and ${subscriptionTiers.deletedAt} is null))`;

/**
 * `assertCreatorCanBePaid`: a piece that earns (any price, any tier:
 * `requiresPayoutsToPublish`) has a creator whose Connect account can take
 * charges and payouts.
 */
const paidIfEarning = sql`(not (coalesce(${content.priceCents}, 0) > 0 or ${content.isTierGated}) or exists (select 1 from ${stripeConnectAccounts} where ${stripeConnectAccounts.userId} = ${content.creatorId} and ${stripeConnectAccounts.chargesEnabled} and ${stripeConnectAccounts.payoutsEnabled}))`;

/**
 * `assertThumbnailFrameNotDeleted`: the thumbnail is no frame of one of the
 * creator's deleted videos, the media it plays aside (`posterFramesOf`,
 * whose skip comes first, as in the gate).
 */
const coverNotFromADeletedVideo = sql`(${content.thumbnailUrl} is null or not (${namesPosterFolderOf(content.thumbnailUrl, content.creatorId)}) or not exists (select 1 from ${mediaItems} where ${mediaItems.creatorId} = ${content.creatorId} and ${holdsPosterFolderOf(content.thumbnailUrl)} and ${mediaItems.id} is distinct from (case when ${playsMedia} then ${content.mediaItemId} end) and ${mediaItems.deletedAt} is not null))`;

/**
 * A draft in hand that passes every rule but an article's body, which the
 * service reads (`readyAmong`).
 */
export const readyCandidate: SQL = allOf(
  draftInHand,
  onTheTeam,
  filledForItsType,
  pricedIfForSale,
  inATierIfGated,
  paidIfEarning,
  coverNotFromADeletedVideo
);

/**
 * The candidates that are ready: all but an article with nothing to read,
 * judged as publish judges it (`contentGaps`).
 */
export function readyAmong(
  rows: readonly Pick<
    Content,
    'id' | 'contentType' | 'contentBody' | 'contentBodyJson'
  >[]
): string[] {
  return rows
    .filter(
      (row) =>
        row.contentType !== CONTENT_TYPES.WRITTEN ||
        hasArticleBody(row.contentBodyJson ?? row.contentBody)
    )
    .map((row) => row.id);
}

/** The SQL for one kind but `ready` (`readyCandidate` + `readyAmong`). */
export function attentionCondition(
  kind: SqlAttentionKind,
  now: Date = new Date()
): SQL {
  switch (kind) {
    case 'live-media-gone':
      return allOf(sql`not ${isDraft}`, itsMedia(deletedOrFailed));
    case 'scheduled':
      return allOf(isDraft, scheduled);
    case 'didnt-go-live':
      return allOf(isDraft, sql`not ${scheduled}`, refused);
    case 'media-gone':
      return allOf(draftInHand, playsMedia, itsMedia(mediaGone(now)));
    case 'processing':
      return allOf(draftInHand, playsMedia, itsMedia(mediaOnItsWay(now)));
  }
}
