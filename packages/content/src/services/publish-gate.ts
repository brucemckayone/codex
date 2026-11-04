/**
 * The publish gate (Codex-a6ofh.2.1): every rule a piece must pass to go
 * live, in one place. `ContentService.publish` and an org manager's
 * `publishContent` (@codex/admin) both call `assertPublishable`. Before it,
 * admin copied each gate by hand, and a new gate reached one path and not the
 * other (Codex-tqvmx's thumbnail check did).
 *
 * The single-rule checks that create() and update() share with publish live
 * here too, so a rule has one definition.
 */

import {
  CONTENT_TYPES,
  MEDIA_STATUS,
  ORGANIZATION_ROLES,
  ORGANIZATION_STATUS,
  PRICE_LIMITS,
  requiresPayoutsToPublish,
} from '@codex/constants';
import {
  mediaItems,
  organizationMemberships,
  organizations,
  stripeConnectAccounts,
} from '@codex/database/schema';
import { ValidationError } from '@codex/service-errors';
import {
  type PosterFrameSource,
  playedMediaItemId,
  posterFramesOf,
} from '@codex/transcoding';
import { hasArticleBody } from '@codex/validation';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  ContentBodyRequiredError,
  CreatorPayoutsRequiredError,
  MediaDeletedError,
  MediaNotFoundError,
  MediaNotReadyError,
  MediaRequiredToPublishError,
  NotOnOrgTeamError,
  PriceRequiredToPublishError,
  ThumbnailMediaDeletedError,
  TierRequiredToPublishError,
} from '../errors';
import type { Content, DatabaseTransaction, MediaItem } from '../types';
import { hasAnyTick } from './content-tier-access';

/**
 * The org roles that may file content into an org's catalogue (Codex-ocal6):
 * the team. `subscriber` and `member` are the org's audience: they can watch
 * its content, never publish into it. The same set as the "Team only" access
 * rule (`MANAGEMENT_ROLES` in @codex/access access-decision.ts).
 */
const MANAGEMENT_ROLES: string[] = [
  ORGANIZATION_ROLES.OWNER,
  ORGANIZATION_ROLES.ADMIN,
  ORGANIZATION_ROLES.CREATOR,
];

/** What the gate reads of a content row, loaded under the row's lock. */
type PublishableRow = Pick<
  Content,
  | 'id'
  | 'creatorId'
  | 'organizationId'
  | 'contentType'
  | 'contentBody'
  | 'contentBodyJson'
  | 'thumbnailUrl'
  | 'mediaItemId'
  | 'isPurchasable'
  | 'isTierGated'
  | 'priceCents'
> & { mediaItem: Pick<MediaItem, 'id' | 'status'> | null };

/** What a piece must hold to be live: the row's own fields, no reads. */
type FilledRow = Pick<
  Content,
  | 'id'
  | 'contentType'
  | 'mediaItemId'
  | 'contentBody'
  | 'contentBodyJson'
  | 'isPurchasable'
  | 'priceCents'
>;

/** A rule a live piece holds: its media, an article's body, a price. */
type ContentGap = 'media' | 'body' | 'price';

/**
 * What a live piece of the row's type holds that this row doesn't, in the
 * order publish names them: a video or audio piece's media, an article's
 * something to read, a piece for sale's price of at least £1
 * (Codex-a6ofh.2.1: these rules left the create schema for publish).
 *
 * @throws {ValidationError} A content type with no rule here: refused, never
 *   waved through
 */
function contentGaps(row: FilledRow): ContentGap[] {
  const gaps: ContentGap[] = [];
  switch (row.contentType) {
    case CONTENT_TYPES.VIDEO:
    case CONTENT_TYPES.AUDIO:
      if (!row.mediaItemId) gaps.push('media');
      break;
    case CONTENT_TYPES.WRITTEN:
      if (!hasArticleBody(row.contentBodyJson ?? row.contentBody)) {
        gaps.push('body');
      }
      break;
    default:
      throw new ValidationError(
        `Content of type "${row.contentType}" has no rules to go live by`,
        { contentId: row.id }
      );
  }
  if (row.isPurchasable && (row.priceCents ?? 0) < PRICE_LIMITS.MIN_CENTS) {
    gaps.push('price');
  }
  return gaps;
}

function gapError(row: FilledRow, gap: ContentGap) {
  switch (gap) {
    case 'media':
      return new MediaRequiredToPublishError(row.id, row.contentType);
    case 'body':
      return new ContentBodyRequiredError(row.id);
    case 'price':
      return new PriceRequiredToPublishError(row.id);
  }
}

/**
 * Refuse a row missing what a live piece of its type holds (`contentGaps`).
 * publish() asks it of the saved row.
 *
 * @throws {MediaRequiredToPublishError} Video or audio with no media
 * @throws {ContentBodyRequiredError} An article with nothing to read
 * @throws {PriceRequiredToPublishError} For sale with no price, or under £1
 */
function assertContentFilled(row: FilledRow): void {
  const [gap] = contentGaps(row);
  if (gap) throw gapError(row, gap);
}

/**
 * Refuse a save of a LIVE piece that opens a gap it didn't have: detaching
 * its media, emptying its body, unpricing it. A live save had never checked
 * these. A gap the row already has (a piece live before the rules) doesn't
 * block an unrelated edit such as a title; publishing it again still refuses
 * (review, Codex-a6ofh.2.1).
 *
 * @throws {MediaRequiredToPublishError | ContentBodyRequiredError | PriceRequiredToPublishError}
 */
export function assertSaveKeepsContentFilled(
  current: FilledRow,
  next: FilledRow
): void {
  const had = new Set(contentGaps(current));
  const opened = contentGaps(next).find((gap) => !had.has(gap));
  if (opened) throw gapError(next, opened);
}

/**
 * Refuse unless the row may go live. Call it inside the publish transaction,
 * after locking the row FOR NO KEY UPDATE: its media and frame reads lock FOR
 * KEY SHARE, the order update() takes them in. Each refusal carries a
 * `details.code` the editor's checklist maps to a row.
 *
 * In order: the creator is on the org's team (when the row has an org), then
 * what the row holds (`assertContentFilled`: media attached, an article's
 * body, a price of at least £1), then a video or audio piece's media is the
 * creator's own, not deleted and ready, the thumbnail isn't a frame of a
 * deleted video, subscriber content is in a tier, and content that earns
 * money has a creator who can be paid.
 *
 * @throws {NotOnOrgTeamError} The creator is no longer on the org's team
 * @throws {MediaRequiredToPublishError} Video or audio with no media
 * @throws {MediaNotFoundError} Its media item is another creator's
 *   (Codex-vmi6m)
 * @throws {MediaDeletedError} Its media item was deleted (Codex-6sbn1)
 * @throws {MediaNotReadyError} Its media is still processing, or failed
 * @throws {ContentBodyRequiredError} An article with nothing to read
 * @throws {PriceRequiredToPublishError} For sale with no price, or under £1
 * @throws {ThumbnailMediaDeletedError} Its thumbnail is a frame of a deleted
 *   video (Codex-tqvmx)
 * @throws {TierRequiredToPublishError} Subscriber content in no tier
 * @throws {CreatorPayoutsRequiredError} It earns money and its creator's
 *   Connect account can't take payouts
 */
export async function assertPublishable(
  tx: DatabaseTransaction,
  row: PublishableRow
): Promise<void> {
  // First, so a creator who has left the org learns nothing else about the
  // row's state from the refusal.
  if (row.organizationId) {
    await assertCanFileInOrg(tx, row.organizationId, row.creatorId, 'publish');
  }

  assertContentFilled(row);

  if (
    row.contentType === CONTENT_TYPES.VIDEO ||
    row.contentType === CONTENT_TYPES.AUDIO
  ) {
    // assertContentFilled saw a media id, and its foreign key means the join
    // is there; this narrows it.
    if (!row.mediaItem) {
      throw new MediaRequiredToPublishError(row.id, row.contentType);
    }
    // A draft keeps its link to a deleted item (Codex-6sbn1), and must not
    // go live on it. A locking read, so a delete running now is ordered
    // against this publish: one that committed first is seen here; one that
    // waits on this lock then sees a published use, and refuses. Scoped to
    // the content's creator: a row that took another creator's item through
    // the old PATCH hole (Codex-vmi6m) must not go live streaming their file.
    const [media] = await tx
      .select({ deletedAt: mediaItems.deletedAt })
      .from(mediaItems)
      .where(
        and(
          eq(mediaItems.id, row.mediaItem.id),
          eq(mediaItems.creatorId, row.creatorId)
        )
      )
      .for('key share');
    if (!media) {
      throw new MediaNotFoundError(row.mediaItem.id);
    }
    if (media.deletedAt) {
      throw new MediaDeletedError(row.id);
    }
    if (row.mediaItem.status !== MEDIA_STATUS.READY) {
      throw new MediaNotReadyError(row.mediaItem.id, row.mediaItem.status);
    }
  }

  // Any type: written content can show a video's frame too, and one of the
  // video it links but doesn't play, which nothing above checks.
  await assertThumbnailFrameNotDeleted(
    tx,
    row.id,
    {
      thumbnailUrl: row.thumbnailUrl,
      creatorId: row.creatorId,
      exceptMediaItemId: playedMediaItemId(row),
    },
    'publish'
  );

  // Subscriber content needs at least one tier to go live (Codex-2hxff.91,
  // owner U2). Saving it with none is allowed (closed); publishing it is not.
  // A paid item whose tiers are optional stays on sale, so it may.
  if (
    row.isTierGated &&
    !row.isPurchasable &&
    !(await hasAnyTick(tx, row.id))
  ) {
    throw new TierRequiredToPublishError(row.id);
  }

  // Content that earns money needs a payout-ready Connect account before it
  // can go live: publishing without a payout destination strands buyer funds
  // in a pending payout indefinitely. Any price or tier counts, purchasable
  // or not (Codex-2hxff.14 — the old gate only saw a price on a row marked
  // purchasable).
  await assertCreatorCanBePaid(tx, row.creatorId, row);
}

/**
 * Refuse unless `userId` may file content into `organizationId`
 * (Codex-ocal6): an ACTIVE membership whose role is owner, admin or creator.
 * `subscriber` and `member` are the audience; `invited` and `inactive` are
 * not (yet, or any longer) on the team. A soft-deleted org has no team.
 *
 * A locking read, FOR SHARE on the membership. A removal flips its status
 * with an UPDATE (FOR NO KEY UPDATE, which KEY SHARE would not block), then
 * archives the creator's PUBLISHED content. Unlocked, a publish could read
 * the membership as active, the removal commit and skip the row (still a
 * draft to it), and the publish then put content live in an org its creator
 * has left. Locked, a removal that starts after this read waits for the
 * publish to commit, and its archive, a later statement, sees the row as
 * published; one that started first makes this read wait, then find the
 * membership inactive (review, Codex-a6ofh.2.1).
 *
 * @throws {NotOnOrgTeamError} If there is no such membership
 */
export async function assertCanFileInOrg(
  tx: DatabaseTransaction,
  organizationId: string,
  userId: string,
  action: 'file' | 'publish' = 'file'
): Promise<void> {
  const [membership] = await tx
    .select({ id: organizationMemberships.id })
    .from(organizationMemberships)
    .innerJoin(
      organizations,
      eq(organizations.id, organizationMemberships.organizationId)
    )
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, userId),
        eq(organizationMemberships.status, ORGANIZATION_STATUS.ACTIVE),
        inArray(organizationMemberships.role, MANAGEMENT_ROLES),
        isNull(organizations.deletedAt)
      )
    )
    .limit(1)
    .for('share', { of: organizationMemberships });

  if (!membership) {
    throw new NotOnOrgTeamError(action);
  }
}

/**
 * Refuse a thumbnail that is a frame of one of the creator's deleted videos
 * (Codex-tqvmx): the purge removes that frame 30 days after the delete, and
 * a live thumbnail would then 404, or keep the purge skipping its video every
 * week. A locking read, taken after the row's and its own media's locks: a
 * delete that committed first is seen here, and one that waits on this lock
 * then finds a live use of the frame (the usage lookup's `thumbnail` slot,
 * which matches URLs by the same test), and refuses. A frame of no video of
 * the creator's isn't this check's (Codex-p0uuc).
 */
export async function assertThumbnailFrameNotDeleted(
  tx: DatabaseTransaction,
  contentId: string,
  source: PosterFrameSource,
  action: 'publish' | 'save'
): Promise<void> {
  const frames = posterFramesOf(source);
  if (frames === undefined) return;
  const rows = await tx
    .select({ deletedAt: mediaItems.deletedAt })
    .from(mediaItems)
    .where(frames)
    .for('key share');
  if (rows.some((row) => row.deletedAt !== null)) {
    throw new ThumbnailMediaDeletedError(contentId, action);
  }
}

/**
 * Refuse to put content that earns money on sale while its creator can't be
 * paid. `requiresPayoutsToPublish` decides what earns money — any price or
 * any tier, whether or not the row is marked purchasable (owner rule,
 * Codex-2hxff.14) — so publish and update() both ask here. Free, followers
 * and team content passes without a lookup.
 *
 * DB-only readiness: `charges_enabled` + `payouts_enabled` on
 * `stripe_connect_accounts` are kept in sync by Stripe's `account.updated`
 * webhook, so this needs no live Stripe call (content-api has no
 * STRIPE_SECRET_KEY binding) and mirrors the backend gate the subscription
 * domain uses. One account per user (unique userId), so `.limit(1)` is exact.
 *
 * @throws {CreatorPayoutsRequiredError} When the row needs payouts and the
 *   creator's Connect account is not charges + payouts enabled
 */
export async function assertCreatorCanBePaid(
  tx: DatabaseTransaction,
  creatorId: string,
  row: { priceCents: number | null; isTierGated: boolean }
): Promise<void> {
  if (!requiresPayoutsToPublish(row)) return;
  const [account] = await tx
    .select({
      chargesEnabled: stripeConnectAccounts.chargesEnabled,
      payoutsEnabled: stripeConnectAccounts.payoutsEnabled,
    })
    .from(stripeConnectAccounts)
    .where(eq(stripeConnectAccounts.userId, creatorId))
    .limit(1);
  if (account?.chargesEnabled && account.payoutsEnabled) return;
  throw new CreatorPayoutsRequiredError(
    (row.priceCents ?? 0) > 0 ? 'paid' : 'included_in_tier'
  );
}
