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
 * For a `select().from(content)` only. Drizzle's relational query
 * (`db.query.content.findMany`) renders every column of a raw `sql` in its
 * where as the root table's, the EXISTS subqueries' `media_items` columns
 * included, so a list filters by these through a semi-join of their own
 * (`ContentService.needsCondition`).
 */
import {
  CONTENT_STATUS,
  CONTENT_TYPES,
  type ContentAttentionKind,
  MEDIA_STATUS,
  MEDIA_UPLOAD_STALLED_AFTER_MS,
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
import { holdsPosterFolderOf } from '@codex/transcoding';
import { hasArticleBody } from '@codex/validation';
import { inArray, type SQL, sql } from 'drizzle-orm';
import type { Content } from '../types';

/** Every part holds: `(a and b and …)`. */
function allOf(...parts: SQL[]): SQL {
  return sql`(${sql.join(parts, sql` and `)})`;
}

/** Never live (`hasBeenLive` false): a draft that was never published. */
const isDraft = allOf(
  sql`${content.status} = ${CONTENT_STATUS.DRAFT}`,
  sql`${content.publishedAt} is null`
);

/** A draft neither scheduled nor refused a schedule: one still in hand. */
const draftInHand = allOf(
  isDraft,
  sql`${content.publishRequestedAt} is null`,
  sql`coalesce(${content.publishBlockedReason}, '') = ''`
);

/** A video or audio piece: one that plays its media. */
const playsMedia = sql`${content.contentType} in (${CONTENT_TYPES.VIDEO}, ${CONTENT_TYPES.AUDIO})`;

/** The piece's media item matches `condition`. */
function itsMedia(condition: SQL): SQL {
  return sql`exists (select 1 from ${mediaItems} where ${mediaItems.id} = ${content.mediaItemId} and ${condition})`;
}

/** When an upload started before this, it has stalled (`isMediaOnItsWay`). */
function stalledBefore(now: Date): SQL {
  return sql`${new Date(now.getTime() - MEDIA_UPLOAD_STALLED_AFTER_MS).toISOString()}::timestamptz`;
}

/** Deleted, failed, or a stalled upload: nothing makes it ready by itself. */
function mediaGone(now: Date): SQL {
  return sql`(${mediaItems.deletedAt} is not null or ${mediaItems.status} = ${MEDIA_STATUS.FAILED} or (${mediaItems.status} = ${MEDIA_STATUS.UPLOADING} and ${mediaItems.createdAt} < ${stalledBefore(now)}))`;
}

/** On its way to ready, as Publish when ready reads it (`isMediaOnItsWay`). */
function mediaOnItsWay(now: Date): SQL {
  return sql`(${mediaItems.deletedAt} is null and (${mediaItems.status} in (${MEDIA_STATUS.UPLOADED}, ${MEDIA_STATUS.TRANSCODING}) or (${mediaItems.status} = ${MEDIA_STATUS.UPLOADING} and ${mediaItems.createdAt} >= ${stalledBefore(now)})))`;
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
 * creator's deleted videos, the media it plays aside (`posterFramesOf`).
 */
const coverNotFromADeletedVideo = sql`not exists (select 1 from ${mediaItems} where ${mediaItems.creatorId} = ${content.creatorId} and ${holdsPosterFolderOf(content.thumbnailUrl)} and ${mediaItems.id} is distinct from (case when ${playsMedia} then ${content.mediaItemId} end) and ${mediaItems.deletedAt} is not null)`;

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

/** What `readyAmong` reads of a candidate. */
export type ReadyCandidateRow = Pick<
  Content,
  'id' | 'contentType' | 'contentBody' | 'contentBodyJson'
>;

/**
 * The candidates that are ready: all but an article with nothing to read,
 * judged as publish judges it (`contentGaps`).
 */
export function readyAmong(rows: readonly ReadyCandidateRow[]): string[] {
  return rows
    .filter(
      (row) =>
        row.contentType !== CONTENT_TYPES.WRITTEN ||
        hasArticleBody(row.contentBodyJson ?? row.contentBody)
    )
    .map((row) => row.id);
}

/**
 * The SQL for one kind, but `ready`, whose last rule is JavaScript
 * (`readyCandidate` + `readyAmong`).
 */
export function attentionCondition(
  kind: Exclude<ContentAttentionKind, 'ready'>,
  now: Date = new Date()
): SQL {
  switch (kind) {
    case 'live-media-gone':
      return allOf(
        sql`not ${isDraft}`,
        itsMedia(
          sql`(${mediaItems.deletedAt} is not null or ${mediaItems.status} = ${MEDIA_STATUS.FAILED})`
        )
      );
    case 'scheduled':
      return allOf(isDraft, sql`${content.publishRequestedAt} is not null`);
    case 'didnt-go-live':
      return allOf(
        isDraft,
        sql`${content.publishRequestedAt} is null`,
        sql`coalesce(${content.publishBlockedReason}, '') <> ''`
      );
    case 'media-gone':
      return allOf(draftInHand, playsMedia, itsMedia(mediaGone(now)));
    case 'processing':
      return allOf(draftInHand, playsMedia, itsMedia(mediaOnItsWay(now)));
  }
}
