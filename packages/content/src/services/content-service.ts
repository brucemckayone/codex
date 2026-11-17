/**
 * Content Service
 *
 * Manages content creation, publishing, and lifecycle.
 * All operations are scoped to creator/organization.
 *
 * Key Principles:
 * - NO `any` types - all types properly inferred from Drizzle
 * - Organization scoping on ALL queries
 * - Transaction safety for multi-step operations
 * - Proper error handling with custom error classes
 * - Soft deletes only (sets deleted_at)
 */

import type { R2Bucket } from '@cloudflare/workers-types';
import { CacheType, type VersionedCache } from '@codex/cache';
import { R2Service } from '@codex/cloudflare-clients';
import {
  CONTENT_ACCESS_TYPE,
  CONTENT_MAX_CATEGORIES,
  CONTENT_STATUS,
  CONTENT_TYPES,
  type ContentAttentionCounts,
  type ContentAttentionKind,
  ERROR_CODES,
  hasBeenLive,
  isMediaOnItsWay,
  isPublicContent,
  isPublishBlockedReason,
  isTerminalTranscodeFailure,
  MEDIA_STATUS,
  MEDIA_TYPES,
  PAGINATION,
  type PublishBlockedReason,
} from '@codex/constants';
import {
  type DatabaseClient,
  isLockNotAvailable,
  isUniqueViolationOf,
  MEDIA_ITEM_RESPONSE_COLUMNS,
  messageForLog,
  paginatedQuery,
  scopedNotDeleted,
  withCreatorScope,
  withOrgScope,
} from '@codex/database';
import {
  categories,
  content,
  contentCategories,
  mediaItems,
  organizations,
} from '@codex/database/schema';
import {
  claimStagedCover,
  type ImageProcessingResult,
  ImageProcessingService,
  ownContentThumbnailFolder,
  stagedCoverRefusal,
} from '@codex/image-processing';
import type { ServiceConfig } from '@codex/service-errors';
import {
  BaseService,
  isServiceError,
  mapErrorToResponse,
  ServiceUnavailableError,
  ValidationError,
} from '@codex/service-errors';
import type {
  ContentBulkAction,
  ContentBulkResult,
  ContentWhereCounts,
  ContentWhereOrg,
  PaginatedListResponse,
} from '@codex/shared-types';
import {
  playedMediaItemId,
  posterFolderCount,
  posterFramesOf,
} from '@codex/transcoding';
import type {
  ContentAccessGroupInput,
  CreateContentInput,
  UpdateContentInput,
} from '@codex/validation';
import {
  CONTENT_ACCESS_GROUP_FIELDS,
  createContentSchema,
  createPlatformImageUrlSchema,
  PLATFORM_IMAGE_URL_MESSAGE,
  parseTiptapDoc,
  updateContentSchema,
} from '@codex/validation';
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  ne,
  notExists,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import {
  ContentAlreadyLiveError,
  ContentHasBuyersError,
  ContentNotFoundError,
  ContentTypeMismatchError,
  InternalServiceError,
  MediaNotFoundError,
  MediaNotReadyError,
  SlugConflictError,
} from '../errors';
import type {
  BulkTouchedPiece,
  CatalogueContentRow,
  Content,
  ContentBulkReport,
  ContentCategoryRef,
  ContentFilters,
  ContentWithRelations,
  DatabaseTransaction,
  PaginationParams,
  PublicContentCreator,
  PublicContentOrganization,
  PublicContentRow,
  PublicMediaItemSource,
  ScheduleSettlement,
  SettledDraft,
  SettleOptions,
  SettleOutcome,
  StoppedDraft,
} from '../types';
import {
  attentionCondition,
  lifecycleCondition,
  readyAmong,
  readyCandidate,
  SQL_ATTENTION_KINDS,
  type SqlAttentionKind,
} from './content-attention';
import {
  buyerCountsOf,
  byBuyers,
  countHolders,
  holderCountsOf,
} from './content-buyers';
import {
  assertTiersInOrg,
  type ContentTierWire,
  clearTicks,
  expandLegacyTier,
  notClosedToNewViewers,
  readTickIds,
  replaceTicks,
  shareLockOrgTiers,
  syncLegacyIncludedInTierId,
  withTierWire,
} from './content-tier-access';
import {
  assertCanFileInOrg,
  assertCreatorCanBePaid,
  assertPublishable,
  assertSaveKeepsContentFilled,
  assertThumbnailFrameNotDeleted,
  goLiveColumns,
  NO_PUBLISH_REQUEST,
  type PublishOptions,
} from './publish-gate';

/**
 * The media_items columns `listPublic` selects (Codex-ve5eh). It used to load
 * `mediaItem: true`, every column, into an anonymous, KV-cached list that each
 * public page serialises into its HTML. `satisfies` ties this to
 * `PublicMediaItemSource`, so the type and the SELECT cannot drift apart.
 *
 * Exported for the public list's twin, `ContentAccessService.
 * getWithdrawnContent` (@codex/access), which serves the same item to a reader
 * who still has a piece withdrawn from sale: one column list, so the two reads
 * cannot drift apart either. The same holds for the lists below.
 *
 * A change to ANY of these lists changes two cached payloads, so it needs two
 * bumps: `PUBLIC_CONTENT_SHAPE_VERSION` (content-api public-cache.ts, which
 * caches `listPublic`'s rows) and apps/web /explore's `content:auth:vN` (which
 * caches the browse route's response).
 */
export const PUBLIC_MEDIA_ITEM_COLUMNS = {
  durationSeconds: true,
  thumbnailKey: true,
  hlsPreviewKey: true,
} as const satisfies Record<keyof PublicMediaItemSource, true>;

/**
 * The organizations columns `listPublic` selects (Codex-567de). It used to
 * load `organization: true`, which put every column on the anonymous list,
 * the payee's `primaryConnectAccountUserId` among them. Tied to
 * `PublicContentOrganization` the same way.
 */
export const PUBLIC_ORGANIZATION_COLUMNS = {
  id: true,
  name: true,
  slug: true,
  logoUrl: true,
} as const satisfies Record<keyof PublicContentOrganization, true>;

/** The users columns a catalogue row's creator carries: never the email. */
export const PUBLIC_CREATOR_COLUMNS = {
  id: true,
  name: true,
} as const satisfies Record<keyof PublicContentCreator, true>;

/**
 * The content columns a catalogue row leaves out: every column but these.
 * The route spreads the content row's own columns onto the wire, so this is
 * where one is kept off it. `purchaseCount` is each piece's sales: on the
 * anonymous list anyone could rank an org's catalogue by them without signing
 * in. Owner, 2026-10-26: "Hide it from lists (Recommended)". Sorting by it
 * still works, because ORDER BY reads the table, not the select. `viewCount`
 * stays: the public Spotlight shows it.
 *
 * Exported for the withdrawn read (@codex/access), as the lists above are,
 * and a change to it needs the same two cache bumps.
 */
export const CATALOGUE_CONTENT_COLUMNS = {
  purchaseCount: false,
  // A draft's publish-when-ready state (Codex-a6ofh.2.7) is the studio's:
  // null on every live row, and kept off the public wire from the column's
  // first day, so no cached public slot ever held it (no bump needed).
  publishRequestedAt: false,
  publishBlockedReason: false,
  // The leaving notice (Codex-a6ofh.6), off the public wire from the
  // columns' first day for the same reason. The public list and browse
  // hold only live rows, so the date is null there, but the withdrawn read
  // serves exactly the leaving pieces: when owners need their date, select
  // it on THAT read, never by dropping it here. `ownersCanDownload` is set
  // on every row and must stay off. A `true` spread into this map turns
  // drizzle's `columns` into include mode and drops every other column.
  leavesAt: false,
  ownersCanDownload: false,
} as const satisfies Partial<Record<keyof Content, false>>;

/**
 * The media-ready trigger reached a row no longer waiting on the media that
 * fired (Codex-a6ofh.2.8): a cancel, a removal or a swap committed first.
 */
function noLongerScheduledOn(
  row: Pick<Content, 'publishRequestedAt' | 'mediaItemId'>,
  fromSchedule: PublishOptions['fromSchedule']
): boolean {
  return (
    fromSchedule !== undefined &&
    (row.publishRequestedAt === null ||
      row.mediaItemId !== fromSchedule.mediaItemId)
  );
}

/** Drafts one media-ready call settles; the maintenance run takes the rest. */
const SETTLE_BATCH = 50;

/**
 * A settle's write gave up a lock held elsewhere (`lock_timeout`): nothing
 * was written, the draft keeps waiting, and the next run tries again. A 503,
 * so it is kept, not read as a refusal its creator must fix. `lockedOn` is
 * the table it waited on, when Postgres names it: a go-live locks the
 * draft's media, the membership and the thumbnail's media as well as the
 * draft. Unnamed for a waiter queued behind another on the same row, or for
 * a table lock (a migration's).
 */
class ScheduledRowLockedError extends ServiceUnavailableError {
  readonly lockedOn: string | undefined;
  constructor(contentId: string | undefined, cause: unknown) {
    super(
      'A scheduled draft is locked; the next run tries again',
      { ...(contentId ? { contentId } : {}) },
      { cause }
    );
    this.lockedOn = lockedRelation(cause);
  }
}

/**
 * A bulk piece gave up a lock another request held ({@link BULK_LOCK_WAIT}):
 * the outcome the wait exists for, so a typed 503, never an unhandled 500.
 * The piece's result is `failed`; nothing of it was written. `eachPiece`
 * logs it as a try-again, with the action and the table it waited on. Its
 * message is the creator's: the bulk line's Show reads it out.
 */
class BulkPieceBusyError extends ServiceUnavailableError {
  readonly lockedOn: string | undefined;
  constructor(contentId: string, cause: unknown) {
    super(
      'It was being changed elsewhere just then. Try again.',
      { contentId },
      { cause }
    );
    this.lockedOn = lockedRelation(cause);
  }
}

/**
 * A bulk piece left untried at {@link BULK_DEADLINE_MS}: a try-again, never
 * written. Its message is the creator's, as {@link BulkPieceBusyError}'s is.
 */
class BulkOutOfTimeError extends ServiceUnavailableError {
  constructor(contentId: string) {
    super('Not reached: the action ran out of time. Try again.', {
      contentId,
    });
  }
}

/** A bulk piece's given-up lock as {@link BulkPieceBusyError}; anything else as it was. */
function asBulkBusy(error: unknown, bulk: boolean, contentId: string): unknown {
  return bulk && isLockNotAvailable(error)
    ? new BulkPieceBusyError(contentId, error)
    : error;
}

/**
 * The table a given-up lock waited on, from Postgres's `where` (`while
 * locking tuple (0,1) in relation "media_items"`), through Drizzle's
 * wrapper. Only the name: the field can carry statement text. It runs as
 * a lock error is caught, so it never throws: an error it cannot read names
 * no table.
 */
function lockedRelation(error: unknown): string | undefined {
  try {
    let at = error;
    for (let hop = 0; hop < 3; hop++) {
      if (typeof at !== 'object' || at === null) return undefined;
      const { where, cause } = at as { where?: unknown; cause?: unknown };
      if (typeof where === 'string') {
        return /in relation "([^"]+)"/.exec(where)?.[1];
      }
      at = cause;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** A given-up lock's log fields (the table it waited on); none otherwise. */
const lockFields = (error: unknown) =>
  error instanceof ScheduledRowLockedError ? { lockedOn: error.lockedOn } : {};

/**
 * No draft is started past this. The route settles in the 30 s Workers gives
 * background work after a response, shared with its emails and cache bumps.
 */
const SETTLE_BUDGET_MS = 10_000;

/**
 * `and()` arguments for a creator's drafts still scheduled on a media item:
 * both predicates of idx_content_publish_requested_media, and the scope.
 * Spread into the `and()`, never held in one, which is typed `SQL | undefined`.
 */
function waitingOn(mediaItemId: string, creatorId: string): SQL[] {
  return [
    eq(content.mediaItemId, mediaItemId),
    scopedNotDeleted(content, creatorId),
    isNotNull(content.publishRequestedAt),
  ];
}

/** The SET that ends a draft's wait, keeping why for its editor. */
function stoppedWaiting(reason: PublishBlockedReason) {
  return {
    publishRequestedAt: null,
    publishBlockedReason: reason,
    updatedAt: new Date(),
  };
}

/**
 * Why a scheduled draft stops waiting, from what its go-live refused with: a
 * publish refusal the creator must fix (`details.code`). Null for anything a
 * later run may get past: an unexpected error, or media no longer ready (a
 * new transcode claimed it), which leaves the schedule waiting on it.
 */
function stoppingReason(error: unknown): PublishBlockedReason | null {
  if (!isServiceError(error) || error.statusCode >= 500) return null;
  const code = error.context?.code;
  return isPublishBlockedReason(code) && code !== ERROR_CODES.MEDIA_NOT_READY
    ? code
    : null;
}

/**
 * Content Service Class
 *
 * Handles all content-related business logic:
 * - Create content with media validation
 * - Update content metadata
 * - Publish/unpublish content
 * - Delete content (soft delete)
 * - List content with filters
 */
/**
 * ContentService configuration.
 *
 * Adds the public asset CDN base to the standard `ServiceConfig` so the
 * write paths can reject an externally-hosted `thumbnailUrl` (Codex-8so68).
 * Optional because the binding itself is optional in `HonoEnv`; when it is
 * absent the thumbnail gate FAILS CLOSED (no base ⇒ no URL can be
 * platform-produced), so the only effect is that a caller cannot set a
 * thumbnail at all on a mis-configured deployment.
 */
export interface ContentServiceConfig extends ServiceConfig {
  /** Public asset CDN base — the `R2_PUBLIC_URL_BASE` worker binding. */
  r2PublicUrlBase?: string;
}

/** How {@link ContentService.update} is asked to save. */
export interface UpdateContentOptions {
  /**
   * A draft's autosave (Codex-a6ofh.2): refused with
   * `ContentAlreadyLiveError` once the piece has been live, never written.
   */
  asDraft?: boolean;
}

/**
 * Refuse a thumbnail URL naming a poster folder that isn't one of the
 * caller's videos' (Codex-p0uuc). Another creator's poster URL is public in
 * any page's HTML and passes the host check, but the purge deletes it with
 * that creator's video and the usage lookup never counts it, so the
 * thumbnail would break unannounced. Every folder must be one of the
 * caller's videos', found by the test the delete guard counts uses with:
 * deleted ones too, since a draft may hold a frame of its own deleted video
 * until it publishes (Codex-tqvmx). Like the host check, every sent URL is
 * checked, a re-sent one too.
 */
async function assertOwnPosterFolders(
  tx: DatabaseTransaction,
  creatorId: string,
  thumbnailUrl: string | null | undefined
): Promise<void> {
  if (thumbnailUrl == null) return;
  const folders = posterFolderCount(thumbnailUrl);
  if (folders === 0) return;
  const frames = posterFramesOf({
    thumbnailUrl,
    creatorId,
    exceptMediaItemId: null,
  });
  const own = frames
    ? await tx.select({ id: mediaItems.id }).from(mediaItems).where(frames)
    : [];
  if (own.length !== folders) {
    throw new ValidationError(
      'Choose a frame of one of your own videos as the thumbnail.',
      { field: 'thumbnailUrl' }
    );
  }
}

/** The partial unique indexes that keep a slug to one piece (schema/content.ts). */
const CONTENT_SLUG_INDEXES = new Set([
  'idx_unique_content_slug_per_org',
  'idx_unique_content_slug_personal',
]);

/**
 * A studio list's options. `withCategories` names each row's live
 * categories (Codex-a6ofh.3.3): only the org studio's list shows them, so
 * the badges and pickers that read this list skip the query.
 */
type StudioListOptions = { scope?: 'studio'; withCategories?: boolean };

/**
 * A bulk action's piece (Codex-a6ofh.3.5). `bulk` skips the per-piece cache
 * writes, which the route makes once after the loop: KV takes about one
 * write a second to a key, so fifteen bumps of one key lose writes. It also
 * waits at most a second for a row another request holds
 * ({@link BULK_LOCK_WAIT}), so one held row is that piece's `failed`, never a
 * stall that runs the whole request past its time.
 */
type BulkPieceOption = { bulk?: boolean };

/**
 * A bulk piece's wait on each lock it takes (a publish takes up to four: its
 * row, media, membership and cover). The loop stops starting pieces at
 * {@link BULK_DEADLINE_MS}, so one request stays inside the call's 30 s.
 */
const BULK_LOCK_WAIT = sql`SET LOCAL lock_timeout = '1s'`;

/**
 * After this long a bulk action starts no more pieces: those left are
 * `failed`, not tried, so a request held up by locks ends with its results
 * (and its one cache refresh) inside the web call's 30 s, never as a 408
 * while pieces were still changing.
 */
const BULK_DEADLINE_MS = 20_000;

/** What `addCategories` filed, and the caller's cache gate. */
type AddedCategories = {
  categoryIds: string[];
  organizationId: string | null;
  hasBeenLive: boolean;
  changed: boolean;
};

type AccessColumn = Exclude<
  keyof typeof CONTENT_ACCESS_GROUP_FIELDS,
  'includedInTierIds'
>;

/**
 * The access columns a bulk access change sets: the group's, but the tier
 * set. Read when asked, never at import: a test elsewhere that mocks
 * `@codex/validation` whole and loads this module on the way (ecom-api's
 * checkout test, Codex-a6ofh.3 CI) failed to load at all when this ran at
 * the top of the file.
 */
function accessColumns(): AccessColumn[] {
  return (
    Object.keys(CONTENT_ACCESS_GROUP_FIELDS) as Array<
      keyof typeof CONTENT_ACCESS_GROUP_FIELDS
    >
  ).filter((key): key is AccessColumn => key !== 'includedInTierIds');
}

/**
 * Whether a piece's access already reads as an update sends it
 * (Codex-a6ofh.3.5): every access column it states is the row's, and the
 * tier set, when it states one, is the piece's ticks. A bulk change then
 * writes nothing and reports the piece `unchanged`.
 */
async function accessAlreadyHeld(
  tx: DatabaseTransaction,
  existing: Content,
  sent: UpdateContentInput
): Promise<boolean> {
  for (const column of accessColumns()) {
    if (sent[column] !== undefined && sent[column] !== existing[column]) {
      return false;
    }
  }
  if (sent.includedInTierIds === undefined) return true;
  const held = new Set(await readTickIds(tx, existing.id));
  return (
    held.size === sent.includedInTierIds.length &&
    sent.includedInTierIds.every((tierId) => held.has(tierId))
  );
}

/**
 * Where a studio read looks: one org's pieces, those filed under none
 * (`null`, the personal studio), or, `undefined`, everywhere. The list and
 * the "Needs you" counts read the same pieces by it (Codex-a6ofh.3.4).
 */
function filedUnder(
  organizationId: string | null | undefined
): SQL | undefined {
  if (organizationId === undefined) return undefined;
  return organizationId === null
    ? isNull(content.organizationId)
    : withOrgScope(content, organizationId);
}

/**
 * A live category in its piece's own space, the rule
 * `assertCategoriesInSpace` files by: the piece's org's categories, or a
 * personal piece's creator's own personal ones. For a read that joins
 * `content_categories` to both `categories` and `content`. A piece moved
 * to another space keeps its old join rows until its set is next saved,
 * and those name nothing (Codex-a6ofh.3.3 review).
 */
function filedInItsSpace(): SQL {
  // `sql`, not and()/or(): those answer `SQL | undefined`, and and() drops
  // an undefined argument silently.
  const orgs = eq(categories.organizationId, content.organizationId);
  const ownPersonal = sql`(${content.organizationId} is null and ${categories.organizationId} is null and ${categories.creatorId} = ${content.creatorId})`;
  return sql`(${isNull(categories.deletedAt)} and (${orgs} or ${ownPersonal}))`;
}

export class ContentService extends BaseService {
  private cache?: VersionedCache;
  private readonly r2PublicUrlBase?: string;

  /**
   * Narrowed `thumbnailUrl` schema, bound to this worker's asset CDN base.
   * Built once per instance — the base never changes within a request.
   */
  private readonly thumbnailUrlSchema: ReturnType<
    typeof createPlatformImageUrlSchema
  >;

  constructor(config: ContentServiceConfig) {
    super(config);
    this.r2PublicUrlBase = config.r2PublicUrlBase;
    this.thumbnailUrlSchema = createPlatformImageUrlSchema(
      config.r2PublicUrlBase
    );
  }

  setCache(cache: VersionedCache): void {
    this.cache = cache;
  }

  /**
   * Reject an externally-hosted content thumbnail (Codex-8so68).
   *
   * `createContentSchema`/`updateContentSchema` only prove the value is an
   * http(s) URL, so a direct API call could aim a thumbnail at a third-party
   * host — bypassing the R2 + `@codex/image-processing` pipeline and making
   * every viewer's browser fetch that host (leaking IP and referrer). The
   * allowed base is the `R2_PUBLIC_URL_BASE` binding, which the Zod schema
   * in `@codex/validation` cannot read, so the gate lives here, on the write
   * path, where the registry has injected it.
   *
   * MUST be called from BOTH create() and update(), and BEFORE the
   * transaction opens — keeping it ahead of any DB work is also what makes
   * it unit-testable without a database.
   *
   * There is no grandfather clause: an update that re-submits a legacy
   * external URL is rejected (owner decision).
   */
  private assertPlatformThumbnailUrl(
    thumbnailUrl: string | null | undefined
  ): void {
    if (thumbnailUrl == null) return;
    if (this.thumbnailUrlSchema.safeParse(thumbnailUrl).success) return;

    throw new ValidationError(PLATFORM_IMAGE_URL_MESSAGE, {
      field: 'thumbnailUrl',
    });
  }

  /**
   * Parse contentBody to determine if it's Tiptap JSON or legacy markdown.
   * If JSON, routes to content_body_json column; otherwise keeps in content_body.
   */
  private parseContentBody(raw: string | null | undefined): {
    contentBody: string | null;
    contentBodyJson: Record<string, unknown> | null;
  } {
    if (!raw) return { contentBody: null, contentBodyJson: null };
    const doc = parseTiptapDoc(raw);
    return doc
      ? { contentBody: null, contentBodyJson: doc }
      : { contentBody: raw, contentBodyJson: null };
  }

  /**
   * Replace a content item's category (topic) memberships inside a transaction.
   *
   * REPLACE semantics: existing `content_categories` join rows for this content
   * are cleared first, then the provided set is inserted. Called from both
   * `create` (no existing rows) and `update` (true replace) with the SAME `tx`
   * as the content write, so a rejected category rolls back the content change
   * too — never a half-applied tag set.
   *
   * IDOR guard: every `categoryId` MUST resolve to a live category in the
   * CONTENT'S OWN SPACE — same `organizationId` for org content, or the
   * creator's own personal space (`organizationId IS NULL AND creatorId` match)
   * for orgless content. (The public read side is narrower: `listPublic`
   * matches an org's topics only, and refuses a category with no org.) A
   * foreign or unknown id fails loudly with a `ValidationError`; ids are never
   * silently dropped.
   *
   * @throws {ValidationError} If any id is out-of-space, unknown, or soft-deleted
   */
  private async syncContentCategories(
    tx: DatabaseTransaction,
    contentId: string,
    organizationId: string | null,
    creatorId: string,
    categoryIds: string[]
  ): Promise<void> {
    // Clear current membership first — this is a replace, not an append.
    await tx
      .delete(contentCategories)
      .where(eq(contentCategories.contentId, contentId));

    if (categoryIds.length === 0) return;

    const uniqueIds = await this.assertCategoriesInSpace(
      tx,
      categoryIds,
      organizationId,
      creatorId
    );

    await tx
      .insert(contentCategories)
      .values(uniqueIds.map((categoryId) => ({ contentId, categoryId })));
  }

  /**
   * Refuses any category outside the piece's own space: the replace (a
   * `categoryIds` save) and the add (`addCategories`) both file through it.
   * Org content matches the org's categories (any curator in the org);
   * personal content matches the creator's OWN personal categories, scoped
   * by `creatorId`, NOT merely `organizationId IS NULL`, which would leak
   * personal categories across creators. A soft-deleted or unknown id is
   * refused too, never dropped.
   *
   * @returns the ids once each: a repeat would collide on the
   *   (contentId, categoryId) key, and read here as a missing category
   */
  private async assertCategoriesInSpace(
    tx: DatabaseTransaction,
    ids: string[],
    organizationId: string | null,
    creatorId: string
  ): Promise<string[]> {
    const categoryIds = [...new Set(ids)];
    const spaceScope = organizationId
      ? eq(categories.organizationId, organizationId)
      : and(
          isNull(categories.organizationId),
          eq(categories.creatorId, creatorId)
        );

    const inSpace = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          inArray(categories.id, categoryIds),
          isNull(categories.deletedAt),
          spaceScope
        )
      );

    if (inSpace.length !== categoryIds.length) {
      const found = new Set(inSpace.map((row) => row.id));
      const invalid = categoryIds.filter((id) => !found.has(id));
      throw new ValidationError(
        'One or more categories do not exist in this space',
        { code: ERROR_CODES.CATEGORY_NOT_IN_SPACE, invalidCategoryIds: invalid }
      );
    }
    return categoryIds;
  }

  /**
   * The ids of the live categories a piece is filed in, in its own space
   * (`filedInItsSpace`). In the caller's transaction when it holds the row.
   */
  private liveCategoryIds(
    db: DatabaseClient | DatabaseTransaction,
    contentId: string
  ) {
    return db
      .select({ categoryId: contentCategories.categoryId })
      .from(contentCategories)
      .innerJoin(categories, eq(contentCategories.categoryId, categories.id))
      .innerJoin(content, eq(contentCategories.contentId, content.id))
      .where(
        and(eq(contentCategories.contentId, contentId), filedInItsSpace())
      );
  }

  /**
   * Create new content
   *
   * Security:
   * - Validates media item exists and belongs to creator
   * - Validates content type matches media type
   * - Files into an org only for an active owner/admin/creator of it
   *   (Codex-ocal6)
   * - Prevents slug conflicts
   *
   * @param input - Content creation data (validated by Zod)
   * @param creatorId - ID of the creator
   * @returns Created content
   * @throws {NotOnOrgTeamError} If `organizationId` names an org the creator is
   *   not an active owner, admin or creator of
   * @throws {MediaNotFoundError} If media item doesn't exist or doesn't belong to creator
   * @throws {MediaNotReadyError} If media item is not in 'ready' status
   * @throws {ContentTypeMismatchError} If content type doesn't match media type
   * @throws {SlugConflictError} If slug already exists for organization
   */
  async create(
    input: CreateContentInput,
    creatorId: string
  ): Promise<Content & ContentTierWire> {
    // Step 1: Validate input with Zod schema
    const validated = createContentSchema.parse(input);

    // Plan access (Codex-2hxff.91). The switch is the gate; the set says which
    // tiers. The legacy single tier (the old studio, phase 1) means the switch
    // plus every tier at or above it. The schema refuses the two forms
    // together, and refuses the switch without an org.
    const tierGated =
      validated.isTierGated ?? validated.includedInTierId != null;

    // Step 1b: Zod only proved the thumbnail is an http(s) URL — reject any
    // host other than the platform asset CDN (Codex-8so68). Mirrored in
    // update(); a fix applied to only one of the two leaves the hole open.
    this.assertPlatformThumbnailUrl(validated.thumbnailUrl);

    try {
      // Step 2: Use transaction for atomicity
      const result = await this.db.transaction(async (tx) => {
        // Step 2a: the org comes from the request BODY. The route's policy is
        // roles-only, and requireOrgMembership reads the org from the
        // subdomain or params, never the body, so this is the only gate
        // between a creator and another org's catalogue (Codex-ocal6). It runs
        // first so a non-member learns nothing about media or tiers.
        if (validated.organizationId) {
          await assertCanFileInOrg(
            tx as DatabaseTransaction,
            validated.organizationId,
            creatorId
          );
        }

        // Step 3: Validate media item (if provided)
        // Note: For draft creation, we don't require media to be ready
        // The ready check happens during publishing
        if (validated.mediaItemId) {
          await this.validateMediaItem(
            tx as DatabaseTransaction,
            validated.mediaItemId,
            creatorId,
            validated.contentType as
              | typeof CONTENT_TYPES.VIDEO
              | typeof CONTENT_TYPES.AUDIO,
            false // requireReady = false for draft creation
          );
        }

        // Codex-p0uuc: a poster-frame thumbnail must be of the caller's own
        // video. Mirrored in update().
        await assertOwnPosterFolders(
          tx as DatabaseTransaction,
          creatorId,
          validated.thumbnailUrl
        );

        // Step 3b: the tiers the item starts in, checked against its org
        // before anything is written (refine (a) guarantees the org).
        const orgId = validated.organizationId || null;
        let tierIds: string[] = [];
        if (tierGated && orgId) {
          tierIds =
            validated.includedInTierIds ??
            (validated.includedInTierId
              ? await expandLegacyTier(
                  tx as DatabaseTransaction,
                  orgId,
                  validated.includedInTierId
                )
              : []);
          await assertTiersInOrg(tx as DatabaseTransaction, orgId, tierIds);
        }

        // Step 4: Create content record
        const [newContent] = await tx
          .insert(content)
          .values({
            creatorId,
            organizationId: validated.organizationId || null,
            mediaItemId: validated.mediaItemId || null,
            title: validated.title,
            slug: validated.slug,
            description: validated.description || null,
            contentType: validated.contentType,
            ...this.parseContentBody(validated.contentBody),
            category: validated.category || null,
            tags: validated.tags || [],
            thumbnailUrl: validated.thumbnailUrl || null,
            // Codex-1g5lh.9: immersive-playback presentation. These three were
            // validated by `createContentSchema` and then silently dropped —
            // this insert uses an explicit field list and Zod's default
            // `.strip()` discards anything the list omits, so the studio's
            // shader pick / featured toggle never survived a create. (update()
            // spreads the whole partial, so it always persisted there; the
            // create/update asymmetry is what made this look intermittent.)
            // `|| null` on the varchar mirrors thumbnailUrl/category and folds
            // an empty selection to NULL; `?? null` on the jsonb record because
            // there is no falsy-empty form to collapse (cf. priceCents).
            shaderPreset: validated.shaderPreset || null,
            shaderConfig: validated.shaderConfig ?? null,
            featured: validated.featured ?? false,
            // Content access POLICY flags (SPEC §6.1) — hard-replace the old
            // (accessType, minimumTierId). Flags are separable/non-exclusive.
            isPurchasable: validated.isPurchasable ?? false,
            priceCents: validated.priceCents ?? null,
            // The subscribers-only switch (Codex-2hxff.91). The legacy column
            // is written by syncLegacyIncludedInTierId below, never here.
            isTierGated: tierGated,
            courseOnly: validated.courseOnly ?? false,
            isFollowerGated: validated.isFollowerGated ?? false,
            isTeamOnly: validated.isTeamOnly ?? false,
            // FREE by default only when the creator set NO other gate — this
            // preserves the old `accessType='free'` default. An explicit gate
            // turns free off unless isFree was set explicitly; the resolver
            // checks isFree first (SPEC §6.3), so this defaulting is
            // access-relevant. [WP-1 conductor note: verify at scoping review.]
            //
            // A PRICE IS A GATE (Codex-al9ft). `@codex/access`'s paid arm is
            // `(priceCents ?? 0) > 0` and never reads isFree/isPurchasable
            // (access-decision.ts), so a price-only payload used to derive
            // `isFree: true` on content the gate DENIES — and apps/web's
            // `isPublicContent(isFree)` then rendered the full body into the
            // anonymous SSR payload. Keep this list in sync with `effHasGate`
            // in update() below; they must recognise the same gates.
            isFree:
              validated.isFree ??
              !(
                (validated.isPurchasable ?? false) ||
                (validated.priceCents ?? 0) > 0 ||
                (validated.isFollowerGated ?? false) ||
                (validated.isTeamOnly ?? false) ||
                (validated.courseOnly ?? false) ||
                // The switch is a gate even with no tick (closed, I2).
                tierGated
              ),
            status: CONTENT_STATUS.DRAFT, // Always start as draft
            viewCount: 0,
            purchaseCount: 0,
          })
          .returning();

        if (!newContent) {
          throw new InternalServiceError('Failed to create content', {
            creatorId,
            organizationId: validated.organizationId,
          });
        }

        // Attach category memberships in the SAME transaction — a bad id (out
        // of space / unknown) throws and rolls the content insert back too.
        // Undefined means "no categories provided"; an array (incl. []) is a
        // definitive set.
        if (validated.categoryIds !== undefined) {
          await this.syncContentCategories(
            tx as DatabaseTransaction,
            newContent.id,
            newContent.organizationId,
            newContent.creatorId,
            validated.categoryIds
          );
        }

        // The ticks, then the legacy dual-write, in the same transaction. A
        // draft needs no payouts check: publish() asks.
        if (tierGated && orgId && tierIds.length > 0) {
          await replaceTicks(
            tx as DatabaseTransaction,
            newContent.id,
            orgId,
            tierIds
          );
          await syncLegacyIncludedInTierId(tx as DatabaseTransaction, [
            newContent.id,
          ]);
          const [synced] = await tx
            .select({ legacyIncludedInTierId: content.legacyIncludedInTierId })
            .from(content)
            .where(eq(content.id, newContent.id));
          newContent.legacyIncludedInTierId =
            synced?.legacyIncludedInTierId ?? null;
        }

        return newContent;
      });

      if (!result) {
        throw new InternalServiceError(
          'Failed to create content after transaction',
          {
            creatorId,
            organizationId: validated.organizationId,
          }
        );
      }

      const [wired] = await withTierWire(this.db, [result]);
      return (
        wired ?? { ...result, includedInTierIds: [], includedInTierId: null }
      );
    } catch (error) {
      // A slug another piece holds; any other clash stays unexpected.
      if (isUniqueViolationOf(error, CONTENT_SLUG_INDEXES)) {
        throw new SlugConflictError(validated.slug);
      }
      this.handleError(error, 'create');
    }
  }

  /**
   * Get content by ID
   *
   * Security:
   * - Scoped to creator (can only see own content)
   * - Excludes soft-deleted content
   * - Populates relations (mediaItem, organization, creator)
   *
   * @param id - Content ID
   * @param creatorId - Creator ID (for authorization)
   * @returns Content with relations or null if not found
   */
  async get(
    id: string,
    creatorId: string
  ): Promise<ContentWithRelations | null> {
    try {
      const result = await this.db.query.content.findFirst({
        where: and(eq(content.id, id), scopedNotDeleted(content, creatorId)),
        with: {
          mediaItem: { columns: MEDIA_ITEM_RESPONSE_COLUMNS },
          organization: true,
          creator: {
            columns: {
              id: true,
              email: true,
              name: true,
            },
          },
        },
      });

      if (!result) return null;

      // Surface current category memberships (WP-5) so the studio edit form can
      // pre-select them — critical because update REPLACES the set, so a form
      // that submitted an empty selection would otherwise wipe every tag.
      // A dead category never shows as a live selection.
      const membershipRows = await this.liveCategoryIds(this.db, id);

      // The item's tiers (Codex-2hxff.91), so the editor's tier picker can
      // pre-tick them: the editor refuses to save a set it never read.
      const [wired] = await withTierWire(this.db, [result]);

      // The video its thumbnail is a frame of, a deleted one first
      // (Codex-tqvmx). Its own video's too: the editor warns unless that is
      // the media the form plays, the one frame publish doesn't refuse.
      const frames = posterFramesOf({
        thumbnailUrl: result.thumbnailUrl,
        creatorId: result.creatorId,
        exceptMediaItemId: null,
      });
      const [frame] = frames
        ? await this.db
            .select({
              mediaItemId: mediaItems.id,
              title: mediaItems.title,
              deletedAt: mediaItems.deletedAt,
            })
            .from(mediaItems)
            .where(frames)
            .orderBy(sql`${mediaItems.deletedAt} DESC NULLS LAST`)
            .limit(1)
        : [];
      return {
        ...(wired ?? result),
        categoryIds: membershipRows.map((row) => row.categoryId),
        thumbnailFrame: frame ?? null,
      };
    } catch (error) {
      this.handleError(error, 'get');
    }
  }

  /**
   * Update content
   *
   * Security:
   * - Validates creator ownership before update
   * - Checks a CHANGED mediaItemId as create does: the caller's own, not
   *   deleted, the content's type, ready if live (published or ever
   *   released; Codex-vmi6m)
   * - Moves content into an org only for an active owner/admin/creator of
   *   it (Codex-ocal6)
   *
   * @param id - Content ID
   * @param input - Partial update data
   * @param creatorId - Creator ID (for authorization)
   * @returns Updated content
   * @throws {ContentNotFoundError} If content doesn't exist
   * @throws {NotOnOrgTeamError} If `organizationId` moves the content into an
   *   org the creator is not an active owner, admin or creator of
   * @throws {MediaNotFoundError} If a newly attached media item isn't the
   *   caller's, or is deleted
   * @throws {MediaNotReadyError} If it isn't ready and the content is live
   * @throws {ContentTypeMismatchError} If its type isn't the content's
   * @throws {CreatorPayoutsRequiredError} If the update sets or changes a
   *   price or tier on published content whose creator can't be paid
   * @throws {ContentAlreadyLiveError} (409) `asDraft` on a piece that has
   *   been live: a draft's autosave never writes to one
   */
  async update(
    id: string,
    input: UpdateContentInput,
    creatorId: string,
    options: UpdateContentOptions = {}
  ): Promise<Content & ContentTierWire> {
    const { content: updated } = await this.updateReportingDroppedThumbnail(
      id,
      input,
      creatorId,
      options
    );
    return updated;
  }

  /**
   * {@link update}, also returning the thumbnail URL the update moved the row
   * off, or null. Each upload goes to a new folder (Codex-kk9nv.5), so nothing
   * would ever overwrite the old one; this service has no R2 binding, so the
   * content-api PATCH route deletes it.
   *
   * `hasBeenLive` says whether any cache can hold the piece, so whether the
   * route fans out invalidation. It is judged from the row as it was before
   * this update (see `hasBeenLive` in `@codex/constants`): an update cannot
   * make a piece live, and moving it out of its org resets the row.
   */
  async updateReportingDroppedThumbnail(
    id: string,
    input: UpdateContentInput,
    creatorId: string,
    options: UpdateContentOptions = {}
  ): Promise<{
    content: Content & ContentTierWire;
    droppedThumbnailUrl: string | null;
    hasBeenLive: boolean;
  }> {
    const { row, droppedThumbnailUrl, hasBeenLive } = await this.applyUpdate(
      id,
      input,
      creatorId,
      options
    );
    try {
      const [wired] = await withTierWire(this.db, [row]);
      return {
        content: wired ?? {
          ...row,
          includedInTierIds: [],
          includedInTierId: row.legacyIncludedInTierId,
        },
        droppedThumbnailUrl,
        hasBeenLive,
      };
    } catch (error) {
      this.handleError(error, 'update');
    }
  }

  /**
   * The update itself, without its tier wire. `bulk` is a piece of a bulk
   * access change (Codex-a6ofh.3.5): it writes no cache (the route does,
   * once), waits at most a second for its row ({@link BulkPieceOption}), a
   * piece whose access already reads as sent is left unwritten and
   * reported `unchanged`, and with `refuseIfBought` a piece people bought is
   * left alone (`ContentHasBuyersError`), for a move to Followers or Team
   * only, which would end their playback (owner R1). Judged on the locked row.
   */
  private async applyUpdate(
    id: string,
    input: UpdateContentInput,
    creatorId: string,
    {
      asDraft = false,
      bulk,
    }: UpdateContentOptions & { bulk?: { refuseIfBought: boolean } } = {}
  ): Promise<{
    row: Content;
    droppedThumbnailUrl: string | null;
    hasBeenLive: boolean;
    unchanged: boolean;
  }> {
    // Validate input
    const validated = updateContentSchema.parse(input);
    let unchanged = false;

    // Same external-host gate as create() (Codex-8so68). `updateContentSchema`
    // is a partial, so an absent `thumbnailUrl` is a no-op and an explicit
    // null clears it; only a string is checked.
    this.assertPlatformThumbnailUrl(validated.thumbnailUrl);

    // Read inside the transaction; only meaningful once it has committed.
    let previousThumbnailUrl: string | null = null;
    let previousSlug: string | null = null;
    let wasLive = false;
    // `as`: assigned in the callback, which TS cannot see, so it would stay
    // narrowed to `null` after it.
    let refusedFolder = null as string | null;

    try {
      const result = await this.db.transaction(async (tx) => {
        if (bulk) await tx.execute(BULK_LOCK_WAIT);
        // Verify content exists and belongs to creator, reading the row
        // LOCKED (review round 2). Every decision below reads `existing`,
        // and the write always sets the switch, so from an unlocked read a
        // save that never mentioned access reverted a checklist switch-on
        // that committed while it waited for the row. FOR NO KEY UPDATE
        // waits for that commit instead, then reads it. Lock order
        // (@codex/subscription tier-service.ts, file header): tiers, then
        // this row, then ticks. A save that names tiers locks the org's
        // tiers before the row; one that names none takes no tier lock
        // below (`assertTiersInOrg` locks nothing for an empty set).
        const rowScope = and(
          eq(content.id, id),
          scopedNotDeleted(content, creatorId)
        );
        const namesTiers =
          (validated.includedInTierIds?.length ?? 0) > 0 ||
          validated.includedInTierId != null;
        if (namesTiers) {
          const tierOrgId =
            'organizationId' in validated
              ? (validated.organizationId ?? null)
              : ((
                  await tx
                    .select({ organizationId: content.organizationId })
                    .from(content)
                    .where(rowScope)
                )[0]?.organizationId ?? null);
          if (tierOrgId) {
            await shareLockOrgTiers(tx as DatabaseTransaction, tierOrgId);
          }
        }
        const [existing] = await tx
          .select()
          .from(content)
          .where(rowScope)
          .for('no key update');

        if (!existing) {
          throw new ContentNotFoundError(id);
        }

        // A draft's autosave writes only while the piece has never been
        // live. Judged here, on the locked row, so a go-live the editor did
        // not see (its schedule fired, an admin, another tab) is refused,
        // never a half-typed change on the live piece (Codex-a6ofh.2).
        if (asDraft && hasBeenLive(existing)) {
          throw new ContentAlreadyLiveError(id, 'draft-save');
        }

        // Moving the row into a different org needs the same team membership
        // as create() (Codex-ocal6). An unchanged org is not re-checked: the
        // studio form sends the current organizationId on every save.
        if (
          'organizationId' in validated &&
          validated.organizationId &&
          validated.organizationId !== existing.organizationId
        ) {
          await assertCanFileInOrg(
            tx as DatabaseTransaction,
            validated.organizationId,
            creatorId
          );
        }

        // Route contentBody to the appropriate column (JSON vs legacy text).
        // `categoryIds` is pulled OUT here so it never reaches the `.set()`
        // spread below — it is not a `content` column; it drives the
        // `content_categories` join write instead (see syncContentCategories).
        // The plan-access fields (Codex-2hxff.91) come out too: the switch is
        // written explicitly below, the set goes to `content_tier_access`, and
        // the legacy single tier is expanded, never spread onto the column.
        const {
          contentBody: _rawBody,
          categoryIds: _categoryIds,
          isTierGated: sentTierGated,
          includedInTierIds: sentTierIds,
          includedInTierId: sentLegacyTierId,
          ...restValidated
        } = validated;
        const sentBody =
          _rawBody !== undefined ? this.parseContentBody(_rawBody) : undefined;
        const bodyFields = sentBody ?? {};
        previousThumbnailUrl = existing.thumbnailUrl;
        previousSlug = existing.slug;
        wasLive = hasBeenLive(existing);

        if (
          bulk &&
          (await accessAlreadyHeld(
            tx as DatabaseTransaction,
            existing,
            validated
          ))
        ) {
          unchanged = true;
          return existing;
        }
        // A URL in this content's own thumbnail folders is written only by an
        // upload. One the payload sends that differs from the row's names an
        // upload since replaced, whose files are deleted, so a stale form
        // re-sending it would point the row at a 404. The stored thumbnail
        // stays (Codex-kk9nv.5). Unless it is a cover staged for this piece's
        // Update (Codex-a6ofh.2.5), which this PATCH takes, so it applies
        // once; a stage taken before, replaced or too old is not one.
        const sentThumbnailUrl = restValidated.thumbnailUrl;
        const sentOwnFolder =
          sentThumbnailUrl != null && sentThumbnailUrl !== existing.thumbnailUrl
            ? ownContentThumbnailFolder(
                sentThumbnailUrl,
                { creatorId, contentId: id },
                this.r2PublicUrlBase
              )
            : null;
        const keepStoredThumbnail =
          sentOwnFolder !== null &&
          !(await claimStagedCover(tx, id, sentOwnFolder));
        if (keepStoredThumbnail) refusedFolder = sentOwnFolder;

        // Codex-up7bx: the tier gate is only valid on org-scoped content —
        // subscription_tiers is org-scoped. Determine the org the row will have
        // AFTER this update (incoming value when the payload touches
        // organizationId, otherwise the existing value).
        const resultingOrgId =
          'organizationId' in restValidated
            ? (restValidated.organizationId ?? null)
            : existing.organizationId;

        // Plan access (Codex-2hxff.91), steps 2-4 of the design's §3.1.
        // The EFFECTIVE switch: the payload's, else the legacy single tier's
        // meaning (set = gated, null = not), else the row's.
        const legacyStated = sentLegacyTierId !== undefined;
        const effGated =
          sentTierGated ??
          (legacyStated ? sentLegacyTierId != null : existing.isTierGated);
        // Update refine (b)'s other half (review L4): the schema lets a set
        // through with the switch absent, so the EFFECTIVE switch is checked
        // here. Off, the ticks are cleared below, and the set would be
        // dropped without a word, so it is refused as create refuses it.
        if (!effGated && (sentTierIds?.length ?? 0) > 0) {
          throw new ValidationError(
            'Tiers can only be ticked on subscriber content — set isTierGated to include it in tiers',
            { contentId: id }
          );
        }
        if (effGated && resultingOrgId == null) {
          // Belt and braces for a partial that never stated the org (the
          // schema catches the one that does). Refuse, never clamp: the old
          // clamp nulled the tier, which reads as free.
          throw new ValidationError(
            'Subscription tier requires an organisation — orgless content cannot be tier-gated',
            { contentId: id }
          );
        }
        if (
          effGated &&
          'organizationId' in restValidated &&
          resultingOrgId !== existing.organizationId
        ) {
          // Ticks are pinned to the item's org (composite FK). A move would
          // silently keep the old org's tiers, so it is refused.
          throw new ValidationError(
            'Remove this item from plans before moving it out of the organisation',
            { contentId: id }
          );
        }
        // The new SET, when the payload states one: the explicit set, or the
        // legacy tier expanded to the old ladder. `undefined` leaves the
        // ticks alone (a title edit never undoes a checklist change). The old
        // studio resends its single pick on EVERY save, so a pick equal to the
        // stored legacy value on a gated row is "unchanged", not a re-pick:
        // expanding it would silently undo a checklist edit made since.
        const legacyUnchanged =
          existing.isTierGated &&
          sentLegacyTierId != null &&
          sentLegacyTierId === existing.legacyIncludedInTierId;
        let nextTierIds: string[] | undefined = sentTierIds;
        if (
          nextTierIds === undefined &&
          legacyStated &&
          sentLegacyTierId != null &&
          !legacyUnchanged &&
          resultingOrgId != null
        ) {
          nextTierIds = await expandLegacyTier(
            tx as DatabaseTransaction,
            resultingOrgId,
            sentLegacyTierId
          );
        }
        if (effGated && nextTierIds !== undefined && resultingOrgId) {
          await assertTiersInOrg(
            tx as DatabaseTransaction,
            resultingOrgId,
            nextTierIds
          );
        }

        // I2 and I4 on the EFFECTIVE row (the schema sees only what the
        // partial states): gated is never free, and never beside a gate the
        // decision applies before the tier arm.
        const effIsFollowerGated =
          restValidated.isFollowerGated ?? existing.isFollowerGated;
        const effIsTeamOnly = restValidated.isTeamOnly ?? existing.isTeamOnly;
        const effCourseOnly = restValidated.courseOnly ?? existing.courseOnly;
        // Create's org rules, on the EFFECTIVE row (owner R3): followers and
        // the team are an org's, so either gate on a personal piece shuts
        // everyone out. Only create's schema has them; for an update this is
        // the one check.
        if (resultingOrgId == null && (effIsFollowerGated || effIsTeamOnly)) {
          throw new ValidationError(
            effIsFollowerGated
              ? 'Followers-only content requires an organisation'
              : 'Team-only content requires an organisation',
            { contentId: id }
          );
        }
        if (effGated && restValidated.isFree === true) {
          throw new ValidationError(
            'Tier-gated content cannot be free — an item in no tier is closed, not free.',
            { contentId: id }
          );
        }
        if (
          effGated &&
          (effIsFollowerGated || effIsTeamOnly || effCourseOnly)
        ) {
          throw new ValidationError(
            'Tier-gated content cannot also be followers-only, team-only or course-only',
            { contentId: id }
          );
        }
        // Access-policy invariant: NON-FREE ⟺ at least one active gate.
        // A partial PATCH can clear the sole gate WITHOUT restating `isFree`
        // (the Zod refine can't reason across a partial — it never sees the
        // existing row), which would persist a zero-gate row still carrying
        // `isFree:false`; the resolver then falls through team/follower/tier/
        // paid to its final `return true` → the content is silently PUBLIC.
        // Recompute the EFFECTIVE merged policy (existing row overlaid with the
        // partial) and, when it carries no gate, force `isFree:true`. CLAMP
        // (not throw): a gate-less row IS free — this mirrors create()'s
        // `isFree ?? !gates` derivation and keeps a legitimate "clear the gate
        // → make it free" edit working. The tier SWITCH is a gate whether or
        // not any tier is ticked (Codex-2hxff.91): closed, never free.
        //
        // A PRICE IS A GATE (Codex-al9ft) — and omitting it here was worse than
        // in create(): because the clamp at the `.set()` below FORCES
        // `isFree: true` when it sees no gate, a PATCH that unset
        // `isPurchasable` while leaving `priceCents` intact rewrote a correctly
        // gated row to PUBLIC, which is the exact failure this clamp exists to
        // prevent. Mirrors create()'s derivation — keep the two in sync.
        const effPriceCents =
          'priceCents' in restValidated
            ? restValidated.priceCents
            : existing.priceCents;
        const effHasGate =
          (restValidated.isPurchasable ?? existing.isPurchasable) ||
          (effPriceCents ?? 0) > 0 ||
          effIsFollowerGated ||
          effIsTeamOnly ||
          effCourseOnly ||
          effGated;

        // Codex-vmi6m: an item the PATCH attaches is checked as create checks
        // one: the caller's own, not deleted, the content's type, and ready
        // when the content is live (published, or ever released). Before, the id went straight
        // into the `.set()` spread, so any media item, another creator's or a
        // deleted one, could be attached. A locking read, so an attach can't
        // land on an item a delete just took (Codex-6sbn1). Only a CHANGED id
        // is checked: a draft whose item was deleted keeps its link until a
        // new one is picked (a restore heals it), so a save that doesn't touch
        // the media still goes through.
        const sentMediaItemId = restValidated.mediaItemId;
        let swappedTo: { status: string; createdAt: Date } | null = null;
        if (
          sentMediaItemId != null &&
          sentMediaItemId !== existing.mediaItemId
        ) {
          swappedTo = await this.validateMediaItem(
            tx as DatabaseTransaction,
            sentMediaItemId,
            creatorId,
            restValidated.contentType ?? existing.contentType,
            // Live as the usage lookup counts it: released content keeps its
            // buyers after it goes off sale, so it needs a playable item too.
            existing.status === CONTENT_STATUS.PUBLISHED ||
              existing.publishedAt !== null,
            // A scheduled draft reads its new media FOR SHARE, as the publish
            // gate does: a transcode failing mid-swap is either seen here,
            // and clears the schedule, or waits for this save (review R2).
            existing.publishRequestedAt ? 'share' : 'key share'
          );
        }

        // A LIVE piece stays complete (Codex-a6ofh.2.1, review): a save may
        // not open a gap publishing it would refuse, media, an article's
        // body, a price of at least £1, since those rules left the schema for
        // publish(). Judged on the whole row, the partial overlaid on it,
        // because the studio resends some fields and not others; a gap the
        // row already had doesn't block an unrelated edit. Drafts are left to
        // publish(), and so is a piece taken off sale.
        if (existing.status === CONTENT_STATUS.PUBLISHED) {
          assertSaveKeepsContentFilled(existing, {
            id,
            contentType: restValidated.contentType ?? existing.contentType,
            mediaItemId:
              restValidated.mediaItemId === undefined
                ? existing.mediaItemId
                : restValidated.mediaItemId,
            contentBody: sentBody ? sentBody.contentBody : existing.contentBody,
            contentBodyJson: sentBody
              ? sentBody.contentBodyJson
              : existing.contentBodyJson,
            isPurchasable:
              restValidated.isPurchasable ?? existing.isPurchasable,
            priceCents: effPriceCents ?? null,
          });
        }

        // Codex-p0uuc: a poster-frame thumbnail must be of the caller's own
        // video, as create() checks.
        await assertOwnPosterFolders(
          tx as DatabaseTransaction,
          creatorId,
          sentThumbnailUrl
        );

        // Codex-tqvmx: live content must not take a deleted video's frame as
        // its thumbnail, which publish refuses too. Only a CHANGED thumbnail
        // the row will keep is checked, as the media above: a draft may hold
        // one until it publishes. After the media's lock, as publish orders
        // them.
        if (
          sentThumbnailUrl != null &&
          sentThumbnailUrl !== existing.thumbnailUrl &&
          !keepStoredThumbnail &&
          (existing.status === CONTENT_STATUS.PUBLISHED ||
            existing.publishedAt !== null)
        ) {
          await assertThumbnailFrameNotDeleted(
            tx as DatabaseTransaction,
            id,
            {
              thumbnailUrl: sentThumbnailUrl,
              creatorId,
              exceptMediaItemId: playedMediaItemId({
                contentType: restValidated.contentType ?? existing.contentType,
                mediaItemId:
                  restValidated.mediaItemId === undefined
                    ? existing.mediaItemId
                    : restValidated.mediaItemId,
              }),
            },
            'save'
          );
        }

        // Codex-2hxff.14: publish() refuses priced or tier content whose
        // creator can't be paid, so a LIVE row must not be priced or tiered
        // past that gate here. Only a change that opens a way to pay is
        // checked — a price set or changed, a tier ADDED, the switch newly on,
        // or the row turned purchasable — compared by VALUE, not by key
        // presence, because the studio form resends the whole flag set on
        // every save and a title edit must never fail on payouts. Removing a
        // price or a tier is never refused. Drafts are left to publish().
        const currentTierIds =
          nextTierIds !== undefined
            ? await readTickIds(tx as DatabaseTransaction, id)
            : undefined;
        if (existing.status === CONTENT_STATUS.PUBLISHED) {
          const nextPriceCents = effPriceCents ?? null;
          const current = new Set(currentTierIds ?? []);
          const tierAdded =
            effGated &&
            (nextTierIds ?? []).some((tierId) => !current.has(tierId));
          const opensAWayToPay =
            ((nextPriceCents ?? 0) > 0 &&
              nextPriceCents !== existing.priceCents) ||
            tierAdded ||
            (effGated && !existing.isTierGated) ||
            (!existing.isPurchasable && restValidated.isPurchasable === true);
          if (opensAWayToPay) {
            await assertCreatorCanBePaid(tx as DatabaseTransaction, creatorId, {
              priceCents: nextPriceCents,
              isTierGated: effGated,
            });
          }
        }

        // Last, before the write: a change any rule above refuses for its
        // own reason (the org, the tier rules, an empty live piece, the
        // payouts gate) never reads as "people have it", which, put right,
        // would not let it through. A course-only piece is let through: the
        // access decision answers course-only before Followers or Team only,
        // so its course holders keep it, and nobody else had it.
        if (bulk?.refuseIfBought && !effCourseOnly) {
          const holders = await countHolders(tx as DatabaseTransaction, id);
          if (holders > 0) throw new ContentHasBuyersError(id, holders);
        }

        // A publish-when-ready schedule waits only on media that will get
        // there (owner, Codex-a6ofh.2.7): removing the media clears it, and so
        // does a swap onto a failed item or a stopped upload, or a change to
        // an article, which plays no media. A swap onto media on its way, or
        // already ready, keeps it.
        const dropsSchedule =
          restValidated.mediaItemId === null ||
          (restValidated.contentType ?? existing.contentType) ===
            CONTENT_TYPES.WRITTEN ||
          (swappedTo !== null &&
            swappedTo.status !== MEDIA_STATUS.READY &&
            !isMediaOnItsWay(swappedTo));

        // Update content
        const [updated] = await tx
          .update(content)
          .set({
            ...restValidated,
            ...bodyFields,
            // Codex-1g5lh.9: `shaderPreset` already round-trips here via the
            // spread above — this only normalises an explicit EMPTY selection
            // to NULL so an update matches create()'s `|| null` and reads back
            // as "no shader" rather than the empty string. The `in` guard is
            // load-bearing: `.partial()` omits an absent `shaderPreset`, so an
            // update that never mentions the preset must not clobber the stored
            // one, and only a key the caller actually sent is rewritten.
            //
            // That holds for THIS field, and the earlier "(verified)" note here
            // claimed it of `.partial()` in general — which is false, and cost
            // Codex-moyu5. `.partial()` makes a key optional but does NOT strip
            // an inner `.default()`, so a field declared `.default([])` is
            // still MATERIALISED when the payload omits it and then written by
            // the spread above. `tags` was exactly that, and every PATCH that
            // did not mention tags wiped them. Fixed in the schema rather than
            // here: `updateContentSchema` now overrides `tags` without the
            // default. Before adding a defaulted field to `baseContentSchema`,
            // check whether the update path needs the same override.
            ...('shaderPreset' in restValidated
              ? { shaderPreset: restValidated.shaderPreset || null }
              : {}),
            ...(keepStoredThumbnail
              ? { thumbnailUrl: existing.thumbnailUrl }
              : {}),
            ...(dropsSchedule ? NO_PUBLISH_REQUEST : {}),
            isTierGated: effGated,
            // Clamp AFTER the spread so it overrides a stale `isFree:false` the
            // partial may carry alongside the gate it just cleared — and a
            // stale `isFree:true` on a row behind the tier switch (I2).
            ...(effHasGate ? {} : { isFree: true }),
            ...(effGated ? { isFree: false } : {}),
            updatedAt: new Date(),
          })
          .where(and(eq(content.id, id), withCreatorScope(content, creatorId)))
          .returning();

        if (!updated) {
          throw new ContentNotFoundError(id);
        }

        // Replace category memberships in the SAME transaction when the caller
        // sent a categoryIds set. Absent (undefined) leaves existing tags
        // untouched — a partial update that never mentions categories must not
        // wipe them.
        if (_categoryIds !== undefined) {
          await this.syncContentCategories(
            tx as DatabaseTransaction,
            updated.id,
            updated.organizationId,
            updated.creatorId,
            _categoryIds
          );
        }

        // The ticks (design §3.1 step 7), then the legacy dual-write (step
        // 8). Switch off → no ticks (I1). Switch on → the stated set, or the
        // current ticks untouched when none was stated.
        const tierTouched =
          sentTierGated !== undefined ||
          sentTierIds !== undefined ||
          legacyStated;
        if (!effGated) {
          if (existing.isTierGated || tierTouched) {
            await clearTicks(tx as DatabaseTransaction, id);
          }
        } else if (nextTierIds !== undefined && updated.organizationId) {
          await replaceTicks(
            tx as DatabaseTransaction,
            id,
            updated.organizationId,
            nextTierIds
          );
        }
        if (tierTouched || existing.isTierGated !== effGated) {
          await syncLegacyIncludedInTierId(tx as DatabaseTransaction, [id]);
          const [synced] = await tx
            .select({ legacyIncludedInTierId: content.legacyIncludedInTierId })
            .from(content)
            .where(eq(content.id, id));
          updated.legacyIncludedInTierId =
            synced?.legacyIncludedInTierId ?? null;
        }

        return updated;
      });

      if (!result) {
        throw new ContentNotFoundError(id);
      }

      // Bump content catalogue version keys (fire-and-forget; invalidate
      // swallows errors), unless the piece was never live. Judged from the
      // row before the update: moving a piece out of its org fires
      // trigger_unpublish_on_org_delete (migration 0004), which resets its
      // status and publishedAt, and its buyers still hold it. An update
      // cannot set either, so the row after it can only read less live.
      const bumps = wasLive && !bulk && !unchanged;
      if (bumps) {
        void this.cache?.invalidate(CacheType.COLLECTION_CONTENT_PUBLISHED);
      }
      if (bumps && result.organizationId) {
        void this.cache?.invalidate(
          CacheType.COLLECTION_ORG_CONTENT(result.organizationId)
        );
        // A changed tag set changes which categories have >=1 item, so the
        // public "Browse by topic" list (CATEGORIES version key, bump-only /
        // no TTL) must refresh. The content-api PATCH route also bumps this via
        // bumpOrgContentVersion; wiring it here keeps the service correct for
        // any caller that bypasses that route (tests, future workers).
        // `validated` (not the tx-scoped `_categoryIds`) is the in-scope
        // source here — the destructured alias only lives inside the
        // transaction callback above.
        if (validated.categoryIds !== undefined) {
          void this.cache?.invalidate(
            CacheType.CATEGORIES(result.organizationId)
          );
        }
      }

      if (refusedFolder) {
        // Once committed: a PATCH that rolled back kept nothing. Why, read
        // after it and best-effort: the log's, so it never fails the Update.
        // The answer carries the cover kept, for the editor to say so.
        const reason = await stagedCoverRefusal(
          this.db,
          id,
          refusedFolder
        ).catch((err: unknown) => `unread: ${messageForLog(err)}`);
        this.obs.warn(
          'Sent cover was not a stage this piece could take; stored cover kept',
          // The folder's name, never its path: that starts with a user id.
          { contentId: id, folder: refusedFolder.split('/').at(-1), reason }
        );
      }
      const thumbnailMoved = previousThumbnailUrl !== result.thumbnailUrl;
      return {
        row: result,
        droppedThumbnailUrl: thumbnailMoved ? previousThumbnailUrl : null,
        hasBeenLive: wasLive,
        unchanged,
      };
    } catch (error) {
      if (error instanceof ContentNotFoundError) {
        throw error;
      }
      // A slug another piece holds, a 409 as create() reports it: the
      // creator's to change, never an unexpected error (Codex-a6ofh.2.4).
      // Only the slug's own indexes: any other clash stays unexpected. A move
      // to an org where its slug is taken sends none: the clash is its own.
      if (isUniqueViolationOf(error, CONTENT_SLUG_INDEXES)) {
        throw new SlugConflictError(validated.slug ?? previousSlug ?? '');
      }
      this.handleError(asBulkBusy(error, bulk !== undefined, id), 'update');
    }
  }

  /**
   * Upload and process content thumbnail
   *
   * Security:
   * - Validates creator ownership
   * - Validates image file (size, type) via ImageProcessingService
   * - ImageProcessingService updates content record with thumbnail URL
   *
   * @param id - Content ID
   * @param creatorId - Creator ID (for authorization)
   * @param file - Image file to upload
   * @param r2 - R2 Bucket instance
   * @param r2PublicUrlBase - Public CDN base URL (e.g., https://cdn.revelations.studio)
   * @returns Result containing upload URL and metadata
   * @throws {ContentNotFoundError} If content doesn't exist
   */
  async uploadThumbnail(
    id: string,
    creatorId: string,
    file: File,
    r2: R2Bucket,
    r2PublicUrlBase: string
  ): Promise<ImageProcessingResult> {
    const existing = await this.db.query.content.findFirst({
      where: and(eq(content.id, id), scopedNotDeleted(content, creatorId)),
    });

    if (!existing) {
      throw new ContentNotFoundError(id);
    }

    // Create R2Service from R2 bucket
    const r2Service = new R2Service(r2);

    // Create image processing service with all required config
    const imageService = new ImageProcessingService({
      db: this.db,
      environment: this.environment,
      r2Service,
      r2PublicUrlBase,
    });

    // Process the thumbnail (service handles validation, upload, and DB update)
    const result = await imageService.processContentThumbnail(
      id,
      creatorId,
      file
    );

    return result;
  }

  /**
   * Check if a content slug is available
   *
   * Mirrors the database's partial unique indexes:
   * - With organizationId: checks slug uniqueness per organization
   * - Without organizationId: checks slug uniqueness per creator (personal content)
   *
   * @param slug - Slug to check
   * @param creatorId - Creator ID (for personal content scope)
   * @param organizationId - Organization ID (for org content scope), null for personal
   * @param excludeContentId - Content ID to exclude from check (for edit mode)
   * @returns True if slug is available, false if taken
   */
  async isSlugAvailable(
    slug: string,
    creatorId: string,
    organizationId?: string | null,
    excludeContentId?: string | null
  ): Promise<boolean> {
    try {
      const conditions = [
        eq(content.slug, slug.toLowerCase()),
        isNull(content.deletedAt),
        ...(organizationId
          ? [eq(content.organizationId, organizationId)]
          : [eq(content.creatorId, creatorId), isNull(content.organizationId)]),
        ...(excludeContentId ? [ne(content.id, excludeContentId)] : []),
      ];

      const existing = await this.db.query.content.findFirst({
        columns: { id: true },
        where: and(...conditions),
      });

      return !existing;
    } catch (error) {
      this.handleError(error, 'isSlugAvailable');
    }
  }

  /**
   * Publish content
   *
   * Business Logic:
   * - Sets status to 'published'
   * - Sets publishedAt timestamp
   * - Refuses unless `assertPublishable` passes (./publish-gate.ts): the
   *   org's team, media, body, price, thumbnail, tier and payouts rules
   * - Publish when ready (Codex-a6ofh.2.7): with `whenReady`, media still on
   *   its way schedules it instead, and the scheduled draft comes back. Its
   *   `publishRequestedAt` keeps the first request's time; the media-ready
   *   trigger publishes it later, every rule again
   * - Clears any schedule, and the last attempt's blocked reason, as it goes
   *   live
   * - Idempotent (returns success if already published)
   *
   * @param id - Content ID
   * @param creatorId - Creator ID (for authorization)
   * @param options - `whenReady`: schedule on media still on its way
   * @returns Published content, or the scheduled draft (status `draft`,
   *   `publishRequestedAt` set)
   * @throws {ContentNotFoundError} If content doesn't exist
   * @throws {BusinessLogicError} (422) A rule refused it; `details.code` names
   *   which (see `assertPublishable`)
   * @throws {NotOnOrgTeamError} (403) The creator is not on the org's team
   * @throws {MediaNotFoundError} If its media item is another creator's
   *   (Codex-vmi6m)
   */
  async publish(
    id: string,
    creatorId: string,
    options: PublishOptions = {}
  ): Promise<Content & ContentTierWire> {
    const { row } = await this.publishAndReport(id, creatorId, options);
    try {
      const [wired] = await withTierWire(this.db, [row]);
      return wired ?? { ...row, includedInTierIds: [], includedInTierId: null };
    } catch (error) {
      this.handleError(error, 'publish');
    }
  }

  /**
   * `publish` without its tier wire, and whether THIS call put the row live:
   * true only when its own transaction wrote the go-live columns under the
   * row lock, so of two callers racing one draft (the media-ready webhook and
   * the maintenance run) exactly one hears it (Codex-a6ofh.2.8). An
   * already-live row, a schedule, or a trigger that came too late, is false.
   */
  private async publishAndReport(
    id: string,
    creatorId: string,
    options: PublishOptions,
    { bulk = false }: BulkPieceOption = {}
  ): Promise<{ row: Content; wentLive: boolean }> {
    try {
      let wentLive = false;
      const result = await this.db.transaction(async (tx) => {
        if (bulk) await tx.execute(BULK_LOCK_WAIT);
        // A scheduled go-live gives up any one lock it waits 5 s on (each of
        // its row, media, membership and thumbnail locks), for the next run:
        // a lock held elsewhere must not run a settle past the 30 s its
        // background work gets, cutting off what it had not told.
        if (options.fromSchedule) {
          await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
        }
        // The row first, locked FOR NO KEY UPDATE, then its media below (FOR
        // KEY SHARE, or FOR SHARE to publish when ready): the order update()
        // takes them in. Publish takes no tier
        // lock (its tick and payouts reads are plain), so the plan-access lock
        // order (@codex/subscription tier-service.ts) holds. Unlocked, a PATCH
        // that swapped the media between this read and the media lock made
        // the publish go live on an item checked only as a draft attach
        // (Codex-6sbn1).
        await tx
          .select({ id: content.id })
          .from(content)
          .where(and(eq(content.id, id), scopedNotDeleted(content, creatorId)))
          .for('no key update');
        const existing = await tx.query.content.findFirst({
          where: and(eq(content.id, id), scopedNotDeleted(content, creatorId)),
          with: {
            mediaItem: { columns: MEDIA_ITEM_RESPONSE_COLUMNS },
          },
        });

        if (!existing) {
          throw new ContentNotFoundError(id);
        }

        // Already published - idempotent
        if (existing.status === CONTENT_STATUS.PUBLISHED) {
          return existing;
        }

        // The media-ready trigger publishes a row only if it is still
        // scheduled on the media that fired (Codex-a6ofh.2.8): a cancel, a
        // removal or a swap that committed first wins. Read under the lock.
        if (noLongerScheduledOn(existing, options.fromSchedule)) {
          return existing;
        }

        // Every rule a piece must pass to go live (Codex-a6ofh.2.1), shared
        // with the platform owner's publish so the two can't drift apart.
        const readiness = await assertPublishable(
          tx as DatabaseTransaction,
          existing,
          options
        );

        // Publish when ready: nothing public changes, the draft only
        // remembers it was asked (Codex-a6ofh.2.7), from the first ask on. A
        // repeat ask that has nothing to clear writes nothing.
        const scheduling = readiness === 'when-media-ready';
        if (
          scheduling &&
          existing.publishRequestedAt &&
          !existing.publishBlockedReason
        ) {
          return existing;
        }
        const now = new Date();
        const [written] = await tx
          .update(content)
          .set(
            scheduling
              ? {
                  publishRequestedAt: existing.publishRequestedAt ?? now,
                  publishBlockedReason: null,
                  updatedAt: now,
                }
              : goLiveColumns(now)
          )
          .where(and(eq(content.id, id), withCreatorScope(content, creatorId)))
          .returning();

        if (!written) {
          throw new ContentNotFoundError(id);
        }

        wentLive = !scheduling;
        return written;
      });

      if (!result) {
        throw new ContentNotFoundError(id);
      }

      // Bump content catalogue version keys (fire-and-forget; invalidate
      // swallows errors). A scheduled draft changed nothing public.
      if (!bulk && result.status === CONTENT_STATUS.PUBLISHED) {
        void this.cache?.invalidate(CacheType.COLLECTION_CONTENT_PUBLISHED);
        if (result.organizationId) {
          void this.cache?.invalidate(
            CacheType.COLLECTION_ORG_CONTENT(result.organizationId)
          );
        }
      }

      return { row: result, wentLive };
    } catch (error) {
      // A scheduled go-live that gave up its lock is expected: kept for the
      // next run, a typed 503, never logged as an unhandled error.
      if (options.fromSchedule && isLockNotAvailable(error)) {
        throw new ScheduledRowLockedError(id, error);
      }
      this.handleError(asBulkBusy(error, bulk, id), 'publish');
    }
  }

  /**
   * Cancel a publish-when-ready schedule (Codex-a6ofh.2.7): the draft stays a
   * draft, and its media going ready no longer publishes it. Also clears the
   * reason a scheduled attempt didn't go live, which the media-ready trigger
   * leaves with no schedule (Codex-a6ofh.2.8). A draft with neither comes
   * back as it is; a piece already live refuses, so a cancel that lost to a
   * go-live is never read as "cancelled".
   *
   * @param id - Content ID
   * @param creatorId - Creator ID (for authorization)
   * @returns The content, its schedule cleared
   * @throws {ContentNotFoundError} If content doesn't exist
   * @throws {ContentAlreadyLiveError} (409) It went live first
   */
  async cancelPublishRequest(
    id: string,
    creatorId: string
  ): Promise<Content & ContentTierWire> {
    try {
      // Each clause spelled out: an `and()` held in a variable is typed
      // `SQL | undefined`, and a nested one that came back undefined would be
      // dropped with the creator scope in it.
      const [cleared] = await this.db
        .update(content)
        .set({ ...NO_PUBLISH_REQUEST, updatedAt: new Date() })
        .where(
          and(
            eq(content.id, id),
            scopedNotDeleted(content, creatorId),
            // Plain SQL, never `or()`: it cannot come back undefined either.
            sql`(${isNotNull(content.publishRequestedAt)} or ${isNotNull(content.publishBlockedReason)})`
          )
        )
        .returning();
      const row =
        cleared ??
        (await this.db.query.content.findFirst({
          where: and(eq(content.id, id), scopedNotDeleted(content, creatorId)),
        }));
      if (!row) {
        throw new ContentNotFoundError(id);
      }
      if (!cleared && row.status === CONTENT_STATUS.PUBLISHED) {
        throw new ContentAlreadyLiveError(id, 'cancel');
      }
      const [wired] = await withTierWire(this.db, [row]);
      return wired ?? { ...row, includedInTierIds: [], includedInTierId: null };
    } catch (error) {
      this.handleError(error, 'cancelPublishRequest');
    }
  }

  /**
   * Settle every draft scheduled to publish when this media item is ready
   * (Codex-a6ofh.2.8), by the media's state NOW, so a late, repeated or
   * concurrent call can neither publish nor clear the wrong thing:
   * - ready: each goes live through every publish rule again (`fromSchedule`,
   *   under the row's lock); one a rule refuses stops waiting, the refusal's
   *   code kept as its reason;
   * - deleted: each stops waiting with MEDIA_DELETED, and no email (owner);
   * - failed for good (`isTerminalTranscodeFailure`): MEDIA_FAILED;
   * - on its way, or a failure that may still be retried: nothing.
   *
   * A worker operation keyed by a media id (content-api's media-ready route,
   * and after a media delete), so every read is scoped to the MEDIA's
   * creator: the gate never schedules a draft on another creator's file.
   * At most SETTLE_BATCH drafts, and none started after `budgetMs`; the
   * maintenance run settles the rest. Never call it while a transaction that
   * wrote the media row is still open.
   *
   * Never throws once it has written: a draft that went live or stopped no
   * longer reads as waiting, so a later call can't announce it. Everything
   * its creator is told is read BEFORE the first write, each draft is handed
   * to `onSettled` as its write commits (so work cut off later loses nothing
   * already told), and every step after a write is guarded and logged. A
   * throw means nothing was written.
   */
  async settleScheduledForMedia(
    mediaItemId: string,
    options: SettleOptions = {}
  ): Promise<ScheduleSettlement> {
    try {
      const settlement: ScheduleSettlement = {
        wentLive: [],
        stopped: [],
        retryLater: 0,
        more: false,
        liveOrgIds: [],
      };
      const [media] = await this.db
        .select({
          creatorId: mediaItems.creatorId,
          status: mediaItems.status,
          deletedAt: mediaItems.deletedAt,
          transcodingErrorCode: mediaItems.transcodingErrorCode,
          transcodingAttempts: mediaItems.transcodingAttempts,
        })
        .from(mediaItems)
        .where(eq(mediaItems.id, mediaItemId));
      if (!media) return settlement;
      // Nothing will make this media ready: every draft waiting on it stops.
      const never = media.deletedAt
        ? ERROR_CODES.MEDIA_DELETED
        : isTerminalTranscodeFailure(media)
          ? ERROR_CODES.MEDIA_FAILED
          : null;
      if (!never && media.status !== MEDIA_STATUS.READY) return settlement;

      const { drafts: waiting, more } = await this.waitingDrafts(
        mediaItemId,
        media.creatorId
      );
      settlement.more = more;

      if (never) {
        if (waiting.length === 0) return settlement;
        // One write; only a draft still waiting matches, so a second caller
        // matches none. Nothing after it can fail.
        let stopped: Content[];
        try {
          stopped = await this.writeStop(
            never,
            waiting.map((draft) => draft.id),
            mediaItemId,
            media.creatorId
          );
        } catch (error) {
          if (!(error instanceof ScheduledRowLockedError)) throw error;
          // Nothing written, and expected: the maintenance run reads this
          // file again, as it does every file that will never be ready.
          settlement.retryLater = waiting.length;
          this.obs.warn('Drafts on a file never to be ready are locked; kept', {
            mediaItemId,
            reason: never,
            left: waiting.length,
            ...lockFields(error),
          });
          return settlement;
        }
        const read = new Map(waiting.map((draft) => [draft.id, draft]));
        for (const row of stopped) {
          const draft = read.get(row.id);
          if (!draft) continue;
          const told = {
            ...(await this.settledFrom(draft, row)),
            reason: never,
          };
          settlement.stopped.push(told);
          this.tell(options, { kind: 'stopped', draft: told });
        }
        return settlement;
      }

      const stopBy = Date.now() + (options.budgetMs ?? SETTLE_BUDGET_MS);
      for (const [index, draft] of waiting.entries()) {
        if (Date.now() >= stopBy) {
          // Still waiting: the next run settles them.
          settlement.retryLater += waiting.length - index;
          this.obs.warn('Settle out of time; the rest wait for the next run', {
            mediaItemId,
            left: waiting.length - index,
          });
          break;
        }
        // Only the go-live is classified here: what follows a write that
        // committed must never be read as the write having failed.
        let published: { row: Content; wentLive: boolean };
        try {
          published = await this.publishAndReport(draft.id, media.creatorId, {
            fromSchedule: { mediaItemId },
          });
        } catch (error) {
          const stopped = await this.stopRefused(
            error,
            draft,
            mediaItemId,
            media.creatorId
          );
          if (stopped === 'kept') settlement.retryLater++;
          else if (stopped) {
            settlement.stopped.push(stopped);
            this.tell(options, { kind: 'stopped', draft: stopped });
          }
          continue;
        }
        if (published.wentLive) {
          const told = await this.settledFrom(draft, published.row);
          settlement.wentLive.push(told);
          this.tell(options, { kind: 'live', draft: told });
        }
      }

      // A file that went ready changes every live list showing it, not only
      // the drafts it just published (Codex-1szw2). Lost, those lists wait
      // for their TTL; the route still refreshes the go-lives' own orgs.
      try {
        const liveOrgs = await this.db
          .selectDistinct({ organizationId: content.organizationId })
          .from(content)
          .where(
            and(
              eq(content.mediaItemId, mediaItemId),
              scopedNotDeleted(content, media.creatorId),
              eq(content.status, CONTENT_STATUS.PUBLISHED),
              isNotNull(content.organizationId)
            )
          );
        settlement.liveOrgIds = liveOrgs.flatMap((row) =>
          row.organizationId ? [row.organizationId] : []
        );
      } catch (error) {
        this.obs.error('Orgs showing a ready file not read; not refreshed', {
          mediaItemId,
          error: messageForLog(error),
        });
      }
      return settlement;
    } catch (error) {
      this.handleError(error, 'settleScheduledForMedia');
    }
  }

  /**
   * What a scheduled draft's failed go-live means. Deleted since the read:
   * nothing (null). A refusal its creator must fix: it stops waiting, if it
   * still is (a cancel or a swap that committed meanwhile wins). Anything
   * else, or a stop that could not be written: 'kept', for the next run.
   * Never throws.
   */
  private async stopRefused(
    error: unknown,
    draft: SettledDraft,
    mediaItemId: string,
    creatorId: string
  ): Promise<StoppedDraft | 'kept' | null> {
    if (
      isServiceError(error) &&
      error.context?.code === ERROR_CODES.CONTENT_NOT_FOUND
    ) {
      return null;
    }
    const reason = stoppingReason(error);
    if (reason === null) {
      const log = {
        contentId: draft.id,
        mediaItemId,
        error: messageForLog(error),
      };
      // A 4xx with no reason its creator can be told refuses again every
      // run, and the editor shows it waiting: a gate this trigger can't name.
      if (
        isServiceError(error) &&
        error.statusCode < 500 &&
        error.context?.code !== ERROR_CODES.MEDIA_NOT_READY
      ) {
        this.obs.error('A scheduled draft was refused for no known reason', {
          ...log,
          statusCode: error.statusCode,
          code: error.code,
        });
      } else {
        this.obs.warn('A scheduled draft could not be settled; kept', {
          ...log,
          ...lockFields(error),
        });
      }
      return 'kept';
    }
    let stopped: Content | undefined;
    try {
      [stopped] = await this.writeStop(
        reason,
        [draft.id],
        mediaItemId,
        creatorId
      );
    } catch (stopError) {
      // Nothing written: the next run is refused again and stops it then.
      // A lock held elsewhere is expected; anything else would fail the
      // same way every run, its creator never told.
      const log = {
        contentId: draft.id,
        mediaItemId,
        reason,
        error: messageForLog(stopError),
      };
      if (stopError instanceof ScheduledRowLockedError) {
        this.obs.warn('A refused draft could not be stopped; kept', {
          ...log,
          ...lockFields(stopError),
        });
      } else {
        this.obs.error('A refused draft could not be stopped; kept', log);
      }
      return 'kept';
    }
    return stopped
      ? { ...(await this.settledFrom(draft, stopped)), reason }
      : null;
  }

  /**
   * The write that ends the wait of the drafts `ids`, those of them still
   * the creator's and still scheduled on the media: scoped here, never by
   * the caller. It gives up any one row lock it waits 5 s on as a typed 503,
   * as a scheduled go-live does, so it is never left queued for good.
   */
  private async writeStop(
    reason: PublishBlockedReason,
    ids: string[],
    mediaItemId: string,
    creatorId: string
  ): Promise<Content[]> {
    if (ids.length === 0) return [];
    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
        return tx
          .update(content)
          .set(stoppedWaiting(reason))
          .where(
            and(inArray(content.id, ids), ...waitingOn(mediaItemId, creatorId))
          )
          .returning();
      });
    } catch (error) {
      if (isLockNotAvailable(error)) {
        throw new ScheduledRowLockedError(
          ids.length === 1 ? ids[0] : undefined,
          error
        );
      }
      throw error;
    }
  }

  /** Hands one settled draft to the caller as its write commits. Never throws. */
  private tell(options: SettleOptions, outcome: SettleOutcome): void {
    try {
      options.onSettled?.(outcome);
    } catch (error) {
      this.obs.error('A settled draft was not announced', {
        contentId: outcome.draft.id,
        kind: outcome.kind,
        error: messageForLog(error),
      });
    }
  }

  /**
   * A settled draft as its creator is told: the details read before the
   * write, refreshed from the row the write returned. An org it moved to
   * since that read gets one guarded slug read; failing that, no slug, and
   * the route sends that draft no link rather than a wrong one. Never throws.
   */
  private async settledFrom(
    read: SettledDraft,
    row: Pick<Content, 'title' | 'slug' | 'organizationId'>
  ): Promise<SettledDraft> {
    const refreshed = {
      ...read,
      title: row.title,
      slug: row.slug,
      organizationId: row.organizationId,
    };
    if (row.organizationId === read.organizationId) return refreshed;
    if (!row.organizationId) return { ...refreshed, organizationSlug: null };
    try {
      // A deleted org's slug is free for another org to take: never linked.
      const [org] = await this.db
        .select({ slug: organizations.slug })
        .from(organizations)
        .where(
          and(
            eq(organizations.id, row.organizationId),
            isNull(organizations.deletedAt)
          )
        );
      return { ...refreshed, organizationSlug: org?.slug ?? null };
    } catch (error) {
      this.obs.error('Org slug of a settled draft not read; no link sent', {
        contentId: read.id,
        organizationId: row.organizationId,
        error: messageForLog(error),
      });
      return { ...refreshed, organizationSlug: null };
    }
  }

  /**
   * The creator's drafts still scheduled on the media, with everything their
   * emails and cache bumps need, oldest ask first, at most SETTLE_BATCH, and
   * whether more wait (one row over the cap tells).
   */
  private async waitingDrafts(
    mediaItemId: string,
    creatorId: string
  ): Promise<{ drafts: SettledDraft[]; more: boolean }> {
    const rows = await this.db.query.content.findMany({
      where: and(...waitingOn(mediaItemId, creatorId)),
      orderBy: asc(content.publishRequestedAt),
      limit: SETTLE_BATCH + 1,
      columns: {
        id: true,
        title: true,
        slug: true,
        contentType: true,
        organizationId: true,
      },
      with: {
        creator: {
          columns: { id: true, name: true, email: true, username: true },
        },
        organization: { columns: { slug: true, deletedAt: true } },
      },
    });
    return {
      drafts: rows.slice(0, SETTLE_BATCH).map(({ organization, ...row }) => ({
        ...row,
        // A deleted org's slug is free for another org to take: the draft
        // is sent no link rather than one into someone else's studio.
        organizationSlug:
          organization && organization.deletedAt === null
            ? organization.slug
            : null,
      })),
      more: rows.length > SETTLE_BATCH,
    };
  }

  /**
   * Unpublish content
   *
   * Business Logic:
   * - Sets status back to 'draft'
   * - Keeps publishedAt timestamp (for history)
   *
   * @param id - Content ID
   * @param creatorId - Creator ID (for authorization)
   * @returns Unpublished content
   * @throws {ContentNotFoundError} If content doesn't exist
   */
  async unpublish(
    id: string,
    creatorId: string
  ): Promise<Content & ContentTierWire> {
    const { row } = await this.unpublishAndReport(id, creatorId);
    try {
      // Its tiers (Codex-2hxff.91), as every content read carries them.
      const [wired] = await withTierWire(this.db, [row]);
      return wired ?? { ...row, includedInTierIds: [], includedInTierId: null };
    } catch (error) {
      this.handleError(error, 'unpublish');
    }
  }

  /**
   * `unpublish` without its tier wire, and whether the piece was live, so a
   * bulk unpublish can tell "taken down" from "already a draft"
   * (Codex-a6ofh.3.5). A draft is left as it is: nothing to write.
   */
  private async unpublishAndReport(
    id: string,
    creatorId: string,
    { bulk = false }: BulkPieceOption = {}
  ): Promise<{ row: Content; wasLive: boolean; changed: boolean }> {
    try {
      const result = await this.db.transaction(async (tx) => {
        if (bulk) await tx.execute(BULK_LOCK_WAIT);
        const [existing] = await tx
          .select()
          .from(content)
          .where(and(eq(content.id, id), scopedNotDeleted(content, creatorId)))
          .for('no key update');

        if (!existing) {
          throw new ContentNotFoundError(id);
        }
        const wasLive = existing.status === CONTENT_STATUS.PUBLISHED;
        if (existing.status === CONTENT_STATUS.DRAFT) {
          return { row: existing, wasLive, changed: false };
        }

        const [unpublished] = await tx
          .update(content)
          .set({
            status: CONTENT_STATUS.DRAFT,
            updatedAt: new Date(),
          })
          .where(and(eq(content.id, id), withCreatorScope(content, creatorId)))
          .returning();

        if (!unpublished) {
          throw new ContentNotFoundError(id);
        }

        return { row: unpublished, wasLive, changed: true };
      });

      // Bump content catalogue version keys (fire-and-forget; invalidate swallows errors)
      if (!bulk) {
        void this.cache?.invalidate(CacheType.COLLECTION_CONTENT_PUBLISHED);
        if (result.row.organizationId) {
          void this.cache?.invalidate(
            CacheType.COLLECTION_ORG_CONTENT(result.row.organizationId)
          );
        }
      }
      return result;
    } catch (error) {
      if (error instanceof ContentNotFoundError) {
        throw error;
      }
      this.handleError(asBulkBusy(error, bulk, id), 'unpublish');
    }
  }

  /**
   * Soft delete content
   *
   * Security:
   * - Sets deleted_at timestamp (soft delete)
   * - Preserves data for purchase history/analytics
   * - Scoped to creator ownership
   *
   * @param id - Content ID
   * @param creatorId - Creator ID (for authorization)
   * @throws {ContentNotFoundError} If content doesn't exist
   */
  async delete(id: string, creatorId: string): Promise<void> {
    await this.deleteAndReport(id, creatorId);
  }

  /**
   * `delete`, returning the org the piece was filed in. A `bulk` delete
   * (owner D-b4) leaves alone a piece people bought
   * (`ContentHasBuyersError`): deleting it would end their playback. Counted
   * here, under the row's lock, never taken from the list. A buyer still in
   * checkout is not counted: completing a purchase takes no lock this waits
   * on, so it can land after the count (a delete one at a time never counts
   * at all). That gap is the purchase path's to close (Codex-z1t3c).
   */
  private async deleteAndReport(
    id: string,
    creatorId: string,
    { bulk = false }: BulkPieceOption = {}
  ): Promise<{ organizationId: string | null }> {
    try {
      return await this.db.transaction(async (tx) => {
        if (bulk) await tx.execute(BULK_LOCK_WAIT);
        const [existing] = await tx
          .select({ organizationId: content.organizationId })
          .from(content)
          .where(and(eq(content.id, id), scopedNotDeleted(content, creatorId)))
          .for('no key update');

        if (!existing) {
          throw new ContentNotFoundError(id);
        }
        if (bulk) {
          const holders = await countHolders(tx as DatabaseTransaction, id);
          if (holders > 0) throw new ContentHasBuyersError(id, holders);
        }

        await tx
          .update(content)
          .set({
            deletedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(content.id, id), withCreatorScope(content, creatorId)));
        return existing;
      });
    } catch (error) {
      if (error instanceof ContentNotFoundError) {
        throw error;
      }
      this.handleError(asBulkBusy(error, bulk, id), 'delete');
    }
  }

  /**
   * Content whose org is live (Codex-osuqt), for every public read. Deleting an
   * org soft-deletes only the org row, so its content stays published: without
   * this a deleted org's pieces went on being listed, with cards into an org
   * that 404s. Personal content has no org, so it has no deleted org to match
   * and is kept. One correlated anti-join on the org's primary key; no or(), so
   * no undefined branch for and() to drop silently.
   */
  private orgIsLive(): SQL {
    return notExists(
      this.db
        .select({ one: sql`1` })
        .from(organizations)
        .where(
          and(
            eq(organizations.id, content.organizationId),
            isNotNull(organizations.deletedAt)
          )
        )
    );
  }

  /**
   * List content with filtering and pagination.
   *
   * **Scope is required** to make the multi-tenant boundary explicit:
   *
   * - `scope: 'studio'` (default for legacy callers) — scopes results
   *   to the signed-in creator (`creatorId`). Used by the studio drafts
   *   list / dashboard where the user is browsing THEIR OWN content.
   *
   * - `scope: 'browse'` — scopes results to an organization, NOT to
   *   the signed-in creator. Used by authenticated /explore "popular"
   *   / "top-selling" sorts where the user is browsing the catalogue
   *   across creators within an org. **`organizationId` is required**
   *   in browse mode — the method throws otherwise to prevent
   *   cross-org data leakage. Browse mode also implicitly filters to
   *   `status = 'published'`.
   *
   * @param creatorId - Signed-in user ID (used only when scope='studio')
   * @param filters - Query filters (organizationId required for browse)
   * @param pagination - Pagination parameters
   * @param options.scope - 'studio' (default) | 'browse'
   * @param options.withCategories - studio only: each row's `categories`
   * @returns Paginated content list with metadata
   * @throws ValidationError when scope='browse' and organizationId is missing
   *
   * The two scopes return different rows, so each has its own signature: a
   * browse row is a {@link CatalogueContentRow} (Codex-1bdx0), a studio row
   * the creator's own whole row.
   */
  list(
    creatorId: string,
    filters: ContentFilters,
    pagination: PaginationParams,
    options: { scope: 'browse' }
  ): Promise<PaginatedListResponse<CatalogueContentRow>>;
  list(
    creatorId: string,
    filters?: ContentFilters,
    paginationOrOptions?: PaginationParams | StudioListOptions,
    maybeOptions?: StudioListOptions
  ): Promise<PaginatedListResponse<ContentWithRelations>>;
  async list(
    creatorId: string,
    filters: ContentFilters = {},
    paginationOrOptions:
      | PaginationParams
      | StudioListOptions
      | { scope: 'browse' } = {
      page: 1,
      limit: PAGINATION.DEFAULT,
    },
    maybeOptions?: StudioListOptions | { scope: 'browse' }
  ): Promise<
    PaginatedListResponse<ContentWithRelations | CatalogueContentRow>
  > {
    // Backwards-compatible argument handling: callers may pass either
    // (creatorId, filters, options) — new shape — or
    // (creatorId, filters, pagination, options?) — extended shape.
    const isPagination =
      'page' in paginationOrOptions || 'limit' in paginationOrOptions;
    const pagination: PaginationParams = isPagination
      ? (paginationOrOptions as PaginationParams)
      : { page: 1, limit: PAGINATION.DEFAULT };
    const options: StudioListOptions | { scope: 'browse' } =
      (isPagination
        ? maybeOptions
        : (paginationOrOptions as StudioListOptions | { scope: 'browse' })) ??
      {};
    const scope = options.scope ?? 'studio';
    const withCategories =
      'withCategories' in options && options.withCategories === true;

    if (scope === 'browse' && !filters.organizationId) {
      // Hard fail-closed: browse-mode queries without an org filter are
      // a multi-tenant boundary violation. Schema-level validation
      // catches this at the route, this is the service-level seatbelt.
      throw new ValidationError(
        'organizationId is required for browse-mode content list'
      );
    }
    if (scope === 'browse' && filters.needs) {
      throw new ValidationError(
        "needs filters a creator's own pieces: browse spans creators"
      );
    }
    if (scope === 'browse' && filters.lifecycle) {
      throw new ValidationError(
        "lifecycle filters a creator's own pieces: browse lists what is on sale"
      );
    }

    try {
      // Build WHERE conditions. Studio scope filters by the signed-in
      // creator; browse scope filters by the org and published status,
      // ignoring `creatorId` so the result spans every creator in the
      // org's catalogue.
      const whereConditions =
        scope === 'browse'
          ? [
              isNull(content.deletedAt),
              eq(content.status, CONTENT_STATUS.PUBLISHED),
              // Course-only practices are reachable ONLY through a course
              // entitlement (SPEC §6.1), so they must not appear in a public
              // browse catalogue. Omitting this listed a paid course's whole
              // curriculum as free, browsable content (Codex-0biug). The STUDIO
              // scope deliberately still shows them — a creator must be able to
              // see and manage their own gated practices.
              eq(content.courseOnly, false),
              // A deleted org's catalogue is not browsable either; its content
              // stays published when the org is deleted.
              this.orgIsLive(),
              // A CLOSED item (behind the tier switch, in no tier, not for
              // sale) is hidden from the catalogue (Codex-2hxff.91, owner U11).
              notClosedToNewViewers(),
            ]
          : [scopedNotDeleted(content, creatorId)];

      // Add filters
      if (filters.status) {
        whereConditions.push(eq(content.status, filters.status));
      }
      // A status tab (`lifecycleCondition`): a never-live draft, on sale, or
      // off sale. On the where, before the count, so the totals are its; as
      // a semi-join, as `needs` is, since this where feeds a relational
      // query (`ownPieces`). Studio only: browse refused it above.
      if (filters.lifecycle) {
        whereConditions.push(
          this.ownPieces(creatorId, lifecycleCondition(filters.lifecycle))
        );
      }
      if (filters.contentType) {
        whereConditions.push(eq(content.contentType, filters.contentType));
      }
      if (filters.accessType) {
        // The list filter still accepts the legacy access-KIND labels
        // (CONTENT_ACCESS_TYPE — the display/filter projection of the policy
        // flags); translate each to the equivalent flag predicate on the
        // hard-replaced columns.
        const at = filters.accessType;
        whereConditions.push(
          at === CONTENT_ACCESS_TYPE.FREE
            ? eq(content.isFree, true)
            : at === CONTENT_ACCESS_TYPE.PAID
              ? eq(content.isPurchasable, true)
              : at === CONTENT_ACCESS_TYPE.SUBSCRIBERS
                ? eq(content.isTierGated, true)
                : at === CONTENT_ACCESS_TYPE.FOLLOWERS
                  ? eq(content.isFollowerGated, true)
                  : at === CONTENT_ACCESS_TYPE.TEAM
                    ? eq(content.isTeamOnly, true)
                    : eq(content.courseOnly, true)
        );
      }
      // A category, by id (the org studio's facet) or by slug (/explore's
      // topics): its pieces, through `content_categories` as a semi-join, so
      // a piece in several categories is still one row and the count stays
      // right; a join would repeat it (Codex-a6ofh.3.3).
      if (filters.categoryId || filters.category) {
        whereConditions.push(inArray(content.id, this.filedIn(filters)));
      }
      const filedWhere = filedUnder(filters.organizationId);
      if (filedWhere) {
        whereConditions.push(filedWhere);
      }
      // A "Needs you" chip's pieces (`needsCondition`).
      if (filters.needs) {
        whereConditions.push(
          await this.needsCondition(
            filters.needs,
            creatorId,
            filters.organizationId
          )
        );
      }
      if (filters.creatorId) {
        whereConditions.push(eq(content.creatorId, filters.creatorId));
      }
      if (filters.search) {
        const escaped = filters.search
          .replace(/%/g, '\\%')
          .replace(/_/g, '\\_');
        const searchCondition = or(
          ilike(content.title, `%${escaped}%`),
          ilike(content.description ?? '', `%${escaped}%`)
        );
        if (searchCondition) {
          whereConditions.push(searchCondition);
        }
      }

      // Sort column and order (Codex-a6ofh.3.1). Descending puts NULLs LAST:
      // Postgres puts them first, so "Recently published" led with every
      // draft, which has no publishedAt. A tie (the many at 0 views or 0
      // sales, every draft on "Recently published") reads newest first, an
      // order the creator recognises; the id is random, so it only comes
      // last, to keep one order from page to page: offset paging over a tie
      // may reorder it, and "Show more" could repeat a row or skip one.
      //
      // The studio's "sales" sort is by buyers (Codex-a6ofh.3.5, owner R2):
      // `purchase_count` has no writer (Codex-r7os5), so it read 0 for every
      // real piece. Browse keeps the column until that bead moves it.
      const sortColumn = filters.sortBy || 'createdAt';
      const sortOrder = filters.sortOrder || 'desc';
      const orderByClause =
        scope === 'studio' && sortColumn === 'purchaseCount'
          ? byBuyers(this.db, sortOrder)
          : sortOrder === 'desc'
            ? sql`${content[sortColumn]} DESC NULLS LAST`
            : asc(content[sortColumn]);
      const orderBy = [
        orderByClause,
        ...(sortColumn === 'createdAt' ? [] : [desc(content.createdAt)]),
        asc(content.id),
      ];

      const where = and(...whereConditions);
      const page = await paginatedQuery({
        page: pagination.page,
        limit: pagination.limit,
        // Two reads, not one with conditional relations: drizzle types a
        // `true | { columns }` relation as the narrow shape for BOTH scopes.
        fetchItems: (
          limit,
          offset
        ): Promise<Array<ContentWithRelations | CatalogueContentRow>> =>
          scope === 'browse'
            ? this.db.query.content.findMany({
                where,
                limit,
                offset,
                orderBy,
                // Browse spans every creator in an org for ANY signed-in
                // viewer, so it selects what the anonymous public list
                // selects: no creator email, and (Codex-1bdx0) no raw R2 key,
                // RunPod job id or transcoding error on the media item, no
                // payee id on the org, no sales count on the row.
                columns: CATALOGUE_CONTENT_COLUMNS,
                with: {
                  mediaItem: { columns: PUBLIC_MEDIA_ITEM_COLUMNS },
                  organization: { columns: PUBLIC_ORGANIZATION_COLUMNS },
                  creator: { columns: PUBLIC_CREATOR_COLUMNS },
                },
              })
            : this.db.query.content.findMany({
                where,
                limit,
                offset,
                orderBy,
                // The studio scope is the signed-in creator's own rows, whole
                // and with their email, and their username, which a personal
                // piece's address is under (the row menu's Copy link).
                with: {
                  mediaItem: { columns: MEDIA_ITEM_RESPONSE_COLUMNS },
                  organization: true,
                  creator: {
                    columns: {
                      id: true,
                      email: true,
                      name: true,
                      username: true,
                    },
                  },
                },
              }),
        countQuery: { db: this.db, table: content, where },
        // Browse is a catalogue for any signed-in viewer (its route checks
        // sign-in, not entitlement), so it never carries a body. It used to
        // return the full text of every published paid, tier, follower and
        // team-only article in the org, and /explore's signed-in sorts put
        // it in the page: a free account could read them all. Its consumers
        // (/explore's cards, the studio grant picker) read metadata only.
        // The studio scope is the creator's own rows and keeps them.
        mapItem: (item) =>
          scope === 'browse'
            ? { ...item, contentBody: null, contentBodyJson: null }
            : item,
      });
      // Every content read carries its tiers (Codex-2hxff.91, design §4.1):
      // one query over the page's ids. The org studio's rows carry their
      // categories too, the same way and beside it (Codex-a6ofh.3.3), and
      // every studio row its buyers and its holders (Codex-a6ofh.3.5): the
      // Sales column, and what a bulk delete or a move to Followers or Team
      // only would leave alone. A browse row never.
      const pageIds = page.items.map((row) => row.id);
      const [items, filed, buyers, holders] = await Promise.all([
        withTierWire(this.db, page.items),
        withCategories ? this.categoriesOf(page.items) : null,
        scope === 'studio' ? buyerCountsOf(this.db, pageIds) : null,
        scope === 'studio' ? holderCountsOf(this.db, pageIds) : null,
      ]);
      return {
        items: items.map((row) => ({
          ...row,
          ...(filed ? { categories: filed.get(row.id) ?? [] } : {}),
          ...(buyers ? { buyerCount: buyers.get(row.id) ?? 0 } : {}),
          ...(holders ? { holderCount: holders.get(row.id) ?? 0 } : {}),
        })),
        pagination: page.pagination,
      };
    } catch (error) {
      this.handleError(error, 'list');
    }
  }

  /**
   * The ids of the pieces filed in one category: by id, by slug, or both,
   * in `filters.organizationId`'s categories when one is given. Only a live
   * category in its piece's own space files anything (`filedInItsSpace`):
   * join rows outlive a soft delete, and a move to another space. The outer
   * query keeps the list's own scope, so a category id from elsewhere only
   * ever finds nothing. The subquery's own `content` is its join, not the
   * outer list's row.
   */
  private filedIn(
    filters: Pick<ContentFilters, 'categoryId' | 'category' | 'organizationId'>
  ) {
    const conditions: SQL[] = [filedInItsSpace()];
    if (filters.categoryId) {
      conditions.push(eq(categories.id, filters.categoryId));
    }
    if (filters.category) {
      conditions.push(eq(categories.slug, filters.category));
    }
    if (filters.organizationId) {
      conditions.push(eq(categories.organizationId, filters.organizationId));
    }
    return this.db
      .select({ contentId: contentCategories.contentId })
      .from(contentCategories)
      .innerJoin(categories, eq(contentCategories.categoryId, categories.id))
      .innerJoin(content, eq(contentCategories.contentId, content.id))
      .where(and(...conditions));
  }

  /**
   * The live categories each row is filed in, in its own space
   * (`filedInItsSpace`), by `sortOrder` then name, keyed by its id (a row in
   * none has no key): one query over the page.
   */
  private async categoriesOf(
    rows: Array<{ id: string }>
  ): Promise<Map<string, ContentCategoryRef[]>> {
    const byContent = new Map<string, ContentCategoryRef[]>();
    if (rows.length === 0) return byContent;
    const filed = await this.db
      .select({
        contentId: contentCategories.contentId,
        id: categories.id,
        name: categories.name,
      })
      .from(contentCategories)
      .innerJoin(categories, eq(contentCategories.categoryId, categories.id))
      .innerJoin(content, eq(contentCategories.contentId, content.id))
      .where(
        and(
          inArray(
            contentCategories.contentId,
            rows.map((row) => row.id)
          ),
          filedInItsSpace()
        )
      )
      .orderBy(asc(categories.sortOrder), asc(categories.name));
    for (const { contentId, id, name } of filed) {
      const held = byContent.get(contentId);
      if (held) held.push({ id, name });
      else byContent.set(contentId, [{ id, name }]);
    }
    return byContent;
  }

  /**
   * Files a piece in more categories, keeping the ones it has
   * (Codex-a6ofh.3.3): the list's bulk "Add to category", which a
   * `categoryIds` save cannot do without reading each piece's set first,
   * since a save replaces it. Idempotent: a category it already has is kept,
   * once. Each one must be in the piece's own space, and a piece holds at
   * most `CONTENT_MAX_CATEGORIES`, as a save allows. The row is read locked,
   * as `update` reads it, so two adds at once cannot both pass the limit.
   *
   * `changed && hasBeenLive` is the caller's cache gate: a never-live draft
   * is in no cache to bump, and an add that filed nothing new changed none.
   *
   * @throws {ContentNotFoundError} not the creator's, or deleted
   * @throws {ValidationError} a category outside its space, or past the limit
   */
  async addCategories(
    contentId: string,
    creatorId: string,
    categoryIds: string[]
  ): Promise<AddedCategories> {
    return this.addCategoriesAndReport(contentId, creatorId, categoryIds);
  }

  /** {@link addCategories}, or a piece of a bulk add ({@link BulkPieceOption}). */
  private async addCategoriesAndReport(
    contentId: string,
    creatorId: string,
    categoryIds: string[],
    { bulk = false }: BulkPieceOption = {}
  ): Promise<AddedCategories> {
    try {
      const result = await this.db.transaction(async (tx) => {
        if (bulk) await tx.execute(BULK_LOCK_WAIT);
        const [piece] = await tx
          .select({
            organizationId: content.organizationId,
            creatorId: content.creatorId,
            status: content.status,
            publishedAt: content.publishedAt,
          })
          .from(content)
          .where(
            and(eq(content.id, contentId), scopedNotDeleted(content, creatorId))
          )
          .for('no key update');
        if (!piece) throw new ContentNotFoundError(contentId);

        const adding = await this.assertCategoriesInSpace(
          tx as DatabaseTransaction,
          categoryIds,
          piece.organizationId,
          piece.creatorId
        );

        const held = await this.liveCategoryIds(
          tx as DatabaseTransaction,
          contentId
        );
        const after = [
          ...new Set([...held.map((row) => row.categoryId), ...adding]),
        ];
        if (after.length > CONTENT_MAX_CATEGORIES) {
          throw new ValidationError(
            `A piece can be in at most ${CONTENT_MAX_CATEGORIES} categories`,
            {
              code: ERROR_CODES.CATEGORY_LIMIT_REACHED,
              max: CONTENT_MAX_CATEGORIES,
              filedIn: held.length,
            }
          );
        }

        const inserted = await tx
          .insert(contentCategories)
          .values(adding.map((categoryId) => ({ contentId, categoryId })))
          .onConflictDoNothing()
          .returning();

        return {
          categoryIds: after,
          organizationId: piece.organizationId,
          hasBeenLive: hasBeenLive(piece),
          changed: inserted.length > 0,
        };
      });
      // As `update` does for a categories save: an org's public topic list
      // counts its live pieces per category, so a changed set refreshes it.
      // A never-live or personal piece is on no such list.
      if (
        !bulk &&
        result.changed &&
        result.hasBeenLive &&
        result.organizationId
      ) {
        void this.cache?.invalidate(
          CacheType.CATEGORIES(result.organizationId)
        );
      }
      return result;
    } catch (error) {
      this.handleError(asBulkBusy(error, bulk, contentId), 'addCategories');
    }
  }

  // ==========================================================================
  // Bulk actions (Codex-a6ofh.3.5, owner 2026-11-12: "Bulk endpoints, one
  // bump"). Each runs every piece through its own method, in its own
  // transaction, so one refused piece never undoes the others; makes each
  // reports each piece. They write no cache: each piece runs `bulk`, and the
  // route refreshes each key once after the loop (`afterBulkChange`), since
  // KV takes about one write a second to a key and these are its only caller.
  // ==========================================================================

  /**
   * Publish each piece, publish when ready included (owner D-b1): media on
   * its way schedules it. Every rule `publish` holds applies to each.
   */
  async publishMany(
    ids: string[],
    creatorId: string
  ): Promise<ContentBulkReport> {
    return this.eachPiece('publish', ids, async (id) => {
      const { row, wentLive } = await this.publishAndReport(
        id,
        creatorId,
        { whenReady: true },
        { bulk: true }
      );
      if (wentLive) return { outcome: 'done', touched: row };
      return {
        outcome:
          row.status === CONTENT_STATUS.PUBLISHED ? 'unchanged' : 'scheduled',
      };
    });
  }

  /** Take each piece down; one already a draft is `unchanged`. */
  async unpublishMany(
    ids: string[],
    creatorId: string
  ): Promise<ContentBulkReport> {
    return this.eachPiece('unpublish', ids, async (id) => {
      const { row, wasLive, changed } = await this.unpublishAndReport(
        id,
        creatorId,
        { bulk: true }
      );
      if (!changed) return { outcome: 'unchanged' };
      return { outcome: 'done', touched: wasLive ? row : undefined };
    });
  }

  /**
   * Soft-delete each piece, leaving alone any piece people bought (owner
   * D-b4, `CONTENT_HAS_BUYERS`). Every deleted piece is `touched`: the route
   * clears its cover's files and its people's libraries.
   */
  async deleteMany(
    ids: string[],
    creatorId: string
  ): Promise<ContentBulkReport> {
    return this.eachPiece('delete', ids, async (id) => {
      const { organizationId } = await this.deleteAndReport(id, creatorId, {
        bulk: true,
      });
      return { outcome: 'done', touched: { id, organizationId } };
    });
  }

  /**
   * File each piece in more categories, as `addCategories` does: each one's
   * space and its 20-category limit hold. One that held them all is
   * `unchanged`; only a live piece that changed is `touched`.
   */
  async addCategoriesMany(
    ids: string[],
    creatorId: string,
    categoryIds: string[]
  ): Promise<ContentBulkReport> {
    return this.eachPiece('categories', ids, async (id) => {
      const added = await this.addCategoriesAndReport(
        id,
        creatorId,
        categoryIds,
        { bulk: true }
      );
      if (!added.changed) return { outcome: 'unchanged' };
      return {
        outcome: 'done',
        touched: added.hasBeenLive
          ? { id, organizationId: added.organizationId }
          : undefined,
      };
    });
  }

  /**
   * Set who can watch each piece (owner D-b2): an update of the access
   * fields alone, under every rule an editor save is held to (the payouts
   * gate on a live piece included). A piece that already reads so is
   * `unchanged`. A move to Followers or Team only leaves alone any piece
   * people bought (owner R1, `CONTENT_HAS_BUYERS`): both end their playback.
   * Only a piece that has been live is `touched`, as `PATCH` refreshes.
   */
  async accessMany(
    ids: string[],
    creatorId: string,
    access: ContentAccessGroupInput
  ): Promise<ContentBulkReport> {
    const endsBuyersPlayback =
      access.isFollowerGated === true || access.isTeamOnly === true;
    return this.eachPiece('access', ids, async (id) => {
      const {
        row,
        hasBeenLive: live,
        unchanged,
      } = await this.applyUpdate(id, access, creatorId, {
        bulk: { refuseIfBought: endsBuyersPlayback },
      });
      if (unchanged) return { outcome: 'unchanged' };
      return { outcome: 'done', touched: live ? row : undefined };
    });
  }

  /**
   * One bulk action's loop: each piece through `one`, in the order sent. A
   * piece's 4xx is its `refused`, with the error the per-piece route would
   * send; anything else is `failed`, with no internal detail, and logged
   * with the piece and the action, since the request itself answers 200.
   * Past {@link BULK_DEADLINE_MS} the rest are `failed` without a try.
   */
  private async eachPiece(
    action: ContentBulkAction,
    ids: string[],
    one: (id: string) => Promise<{
      outcome: 'done' | 'scheduled' | 'unchanged';
      touched?: BulkTouchedPiece;
    }>
  ): Promise<ContentBulkReport> {
    const results: ContentBulkResult[] = [];
    const touched: BulkTouchedPiece[] = [];
    const started = Date.now();
    for (const [index, id] of ids.entries()) {
      // Out of time: the rest are not started, said once (BULK_DEADLINE_MS).
      if (index > 0 && Date.now() - started > BULK_DEADLINE_MS) {
        const notTried = ids.slice(index);
        this.obs.warn('content bulk out of time; the rest not tried', {
          action,
          notTried: notTried.length,
        });
        for (const rest of notTried) {
          // The warn above says it; the mapper would say it once a piece.
          const { response } = mapErrorToResponse(
            new BulkOutOfTimeError(rest),
            { logError: false }
          );
          results.push({ id: rest, outcome: 'failed', error: response.error });
        }
        break;
      }
      try {
        const { outcome, touched: piece } = await one(id);
        results.push({ id, outcome });
        if (piece) {
          touched.push({ id: piece.id, organizationId: piece.organizationId });
        }
      } catch (error) {
        // A given-up lock is a try-again, said here with the action and the
        // table it waited on, which the mapper's line would leave out.
        const busy = error instanceof BulkPieceBusyError;
        const { statusCode, response } = mapErrorToResponse(error, {
          obs: this.obs,
          logError: !busy,
        });
        if (busy) {
          this.obs.warn('content bulk piece busy; a try-again', {
            action,
            contentId: id,
            lockedOn: error.lockedOn,
          });
        }
        // Any other 503 is a try-again the mapper logs as one; any other
        // 5xx is a fault, named by piece and action.
        if (statusCode >= 500 && statusCode !== 503) {
          this.obs.error('content bulk piece failed', {
            action,
            contentId: id,
            code: response.error.code,
          });
        }
        results.push({
          id,
          outcome: statusCode < 500 ? 'refused' : 'failed',
          error: response.error,
        });
      }
    }
    return { results, touched };
  }

  /**
   * How the creator's live content is filed (Codex-a6ofh.3.2): the personal
   * studio's "Where" menu. One grouped count over their own rows, whatever
   * the status, since the menu narrows the whole list. An org is named by
   * its row, which a filed piece always has: the FK sets a piece personal
   * when its org row goes, and orgs are soft-deleted. "Everywhere" sums
   * every row, so it stays right even if an org went unnamed.
   */
  async whereCounts(creatorId: string): Promise<ContentWhereCounts> {
    try {
      const rows = await this.db
        .select({
          organizationId: content.organizationId,
          name: organizations.name,
          count: sql<number>`count(*)`.mapWith(Number),
        })
        .from(content)
        .leftJoin(organizations, eq(organizations.id, content.organizationId))
        .where(scopedNotDeleted(content, creatorId))
        .groupBy(content.organizationId, organizations.name);

      let all = 0;
      let personal = 0;
      const orgs: ContentWhereOrg[] = [];
      for (const row of rows) {
        all += row.count;
        if (row.organizationId === null) personal = row.count;
        else if (row.name !== null) {
          orgs.push({
            id: row.organizationId,
            name: row.name,
            count: row.count,
          });
        }
      }
      orgs.sort((a, b) => a.name.localeCompare(b.name));
      return { all, personal, orgs };
    } catch (error) {
      this.handleError(error, 'whereCounts');
    }
  }

  /**
   * How many of the creator's pieces need them, by kind, by the rules in
   * ./content-attention.ts: the content list's "Needs you" (Codex-a6ofh.3.4).
   * Where the list looks (`organizationId`, as `list()` reads it), and
   * nothing else of its filters: the counts are a to-do, not a view (owner,
   * 2026-11-12).
   */
  async attentionCounts(
    creatorId: string,
    organizationId?: string | null
  ): Promise<ContentAttentionCounts> {
    const now = new Date();
    const counts = Object.fromEntries(
      SQL_ATTENTION_KINDS.map((kind) => [
        kind,
        sql<number>`count(*) filter (where ${attentionCondition(kind, now)})`.mapWith(
          Number
        ),
      ])
    ) as Record<SqlAttentionKind, SQL<number>>;
    try {
      const [[row], ready] = await Promise.all([
        this.db
          .select(counts)
          .from(content)
          .where(
            and(
              scopedNotDeleted(content, creatorId),
              filedUnder(organizationId)
            )
          ),
        this.readyIds(creatorId, organizationId),
      ]);
      if (!row) {
        // An aggregate with no GROUP BY returns its one row over no pieces.
        throw new InternalServiceError('The attention counts read no row');
      }
      return { ...row, ready: ready.length };
    } catch (error) {
      this.handleError(error, 'attentionCounts');
    }
  }

  /**
   * The list's `needs` filter: the rule its chip counted by, so the chip
   * lists what it said, as a semi-join over a select of its own. Never the
   * predicate itself in the list's `findMany` where: drizzle's relational
   * query renders every column of a raw `sql` there as the root table's, so
   * `media_items.id` in its EXISTS read as `content.id`, and the filter
   * matched nothing (Codex-a6ofh.3.4).
   */
  private async needsCondition(
    kind: ContentAttentionKind,
    creatorId: string,
    organizationId: string | null | undefined
  ): Promise<SQL> {
    if (kind !== 'ready') {
      return this.ownPieces(creatorId, attentionCondition(kind));
    }
    const ids = await this.readyIds(creatorId, organizationId);
    return ids.length > 0 ? inArray(content.id, ids) : sql`false`;
  }

  /**
   * A `content-attention` predicate (a "Needs you" kind, a status tab) as
   * the list's where can take it: the creator's pieces it holds for, as a
   * semi-join over a select of their own. Never the predicate itself in the
   * `findMany` where, which renders a raw `sql`'s columns as the root
   * table's (`needsCondition` says how that bit), so a predicate that reads
   * another table one day cannot quietly match the wrong pieces.
   */
  private ownPieces(creatorId: string, condition: SQL): SQL {
    return inArray(
      content.id,
      this.db
        .select({ id: content.id })
        .from(content)
        .where(and(scopedNotDeleted(content, creatorId), condition))
    );
  }

  /**
   * The creator's drafts in hand that would go live now, where the list
   * looks: the SQL candidates, then an article's body, read as publish
   * reads it (`readyAmong`). Bounded by the creator's drafts.
   */
  private async readyIds(
    creatorId: string,
    organizationId: string | null | undefined
  ): Promise<string[]> {
    const rows = await this.db
      .select({
        id: content.id,
        contentType: content.contentType,
        contentBody: content.contentBody,
        contentBodyJson: content.contentBodyJson,
      })
      .from(content)
      .where(
        and(
          scopedNotDeleted(content, creatorId),
          filedUnder(organizationId),
          readyCandidate
        )
      );
    return readyAmong(rows);
  }

  /**
   * List published content for public (unauthenticated) access
   *
   * Security:
   * - No authentication required
   * - Only returns published, non-deleted content whose org (if any) is live
   * - Scoped by an org, a creator (their public profile) or a slug; with none
   *   it is /discover's platform-wide catalogue. The route schemas decide
   *   which a caller may send.
   * - The creator relation carries no email: this list is anonymous
   * - The media item carries only PUBLIC_MEDIA_ITEM_COLUMNS, and the org only
   *   PUBLIC_ORGANIZATION_COLUMNS, never the row
   *
   * Features:
   * - Optional contentType filter
   * - Optional text search on title/description
   * - Sorting: newest, oldest, title
   * - Pagination with offset/limit
   * - Includes media item and creator relations
   *
   * @param params - Public content query parameters
   * @returns Paginated list of published content
   */
  async listPublic(params: {
    orgId?: string;
    page: number;
    limit: number;
    slug?: string;
    contentType?: string;
    search?: string;
    sort: string;
    creatorId?: string;
    featured?: boolean;
    category?: string;
  }): Promise<PaginatedListResponse<PublicContentRow>> {
    // A topic is an org's, so only an org-scoped read can filter by one. The
    // public route refuses this already (publicContentQuerySchema); this is the
    // service-level seatbelt, as in list()'s browse scope. Without an org there
    // is no right answer: a creatorId read is cross-org (their public profile),
    // where a personal-topic match silently dropped their org content, and a
    // bare category returned the list unfiltered.
    if (params.category && !params.orgId) {
      throw new ValidationError('category requires orgId');
    }

    try {
      // Build WHERE conditions — published, not deleted, optionally scoped to org
      const whereConditions = [
        eq(content.status, CONTENT_STATUS.PUBLISHED),
        isNull(content.deletedAt),
      ];

      if (params.orgId) {
        whereConditions.push(eq(content.organizationId, params.orgId));
      }

      // Only content whose org is live, on every path: a creator's profile,
      // /discover, and an org-scoped read of a deleted org by a direct API
      // client (a KV-cached org list is also invalidated on delete, by
      // organization-api).
      whereConditions.push(this.orgIsLive());

      // Optional slug filter (exact match for content detail page)
      if (params.slug) {
        whereConditions.push(eq(content.slug, params.slug));
      } else {
        // CATALOGUE reads only: a course-only practice is reachable solely via a
        // course entitlement (SPEC §6.1) and must never be advertised in a
        // public listing — that is how a paid curriculum came to be listed as
        // free, browsable content (Codex-0biug).
        //
        // The by-slug branch above is deliberately EXEMPT. That read backs the
        // content DETAIL page, which needs the row in order to render the
        // "part of a course" state that the resolver's `deny('course_only')`
        // implies. Excluding it here would turn a correct paywall into a 404 and
        // would break any deep link into a practice. Access is decided by the
        // entitlement resolver, not by this projection — hiding the row from a
        // catalogue is a discovery concern, not the access control itself.
        whereConditions.push(eq(content.courseOnly, false));
        // The same for a CLOSED item (Codex-2hxff.91, owner U11): hidden from
        // every catalogue, while its own page (the by-slug read) still loads
        // to say "Not available right now". A priced one stays listed.
        whereConditions.push(notClosedToNewViewers());
      }

      // Optional content type filter
      if (params.contentType) {
        whereConditions.push(eq(content.contentType, params.contentType));
      }

      // Optional creator filter: one creator's content within the org, or, with
      // no orgId, across their orgs and personal space (their public profile,
      // Codex-osuqt)
      if (params.creatorId) {
        whereConditions.push(eq(content.creatorId, params.creatorId));
      }

      // Optional featured filter — true = only featured, false = exclude featured.
      // Undefined returns everything (backward-compatible).
      if (params.featured !== undefined) {
        whereConditions.push(eq(content.featured, params.featured));
      }

      // Optional category (topic) filter: the studio list's semi-join
      // (`filedIn`), so the relational `findMany` below keeps its relations.
      // The org's own topics only (the guard above refuses a category with no
      // org).
      if (params.category && params.orgId) {
        whereConditions.push(
          inArray(
            content.id,
            this.filedIn({
              category: params.category,
              organizationId: params.orgId,
            })
          )
        );
      }

      // Optional search on title/description
      if (params.search) {
        const escaped = params.search.replace(/%/g, '\\%').replace(/_/g, '\\_');
        const searchCondition = or(
          ilike(content.title, `%${escaped}%`),
          ilike(content.description ?? '', `%${escaped}%`)
        );
        if (searchCondition) {
          whereConditions.push(searchCondition);
        }
      }

      // Determine sort order — use publishedAt for public listings (not createdAt).
      // Force NULLS LAST so any published rows with a missing publishedAt (legacy
      // or malformed data) don't dominate the head of the public catalogue.
      const orderByClause =
        params.sort === 'oldest'
          ? sql`${content.publishedAt} ASC NULLS LAST`
          : params.sort === 'title'
            ? asc(content.title)
            : sql`${content.publishedAt} DESC NULLS LAST`;

      const where = and(...whereConditions);
      const result = await paginatedQuery({
        page: params.page,
        limit: params.limit,
        fetchItems: (limit, offset) =>
          this.db.query.content.findMany({
            where,
            limit,
            offset,
            orderBy: [orderByClause],
            // No sales count: see CATALOGUE_CONTENT_COLUMNS.
            columns: CATALOGUE_CONTENT_COLUMNS,
            with: {
              // Three columns, not the row: see PUBLIC_MEDIA_ITEM_COLUMNS.
              mediaItem: { columns: PUBLIC_MEDIA_ITEM_COLUMNS },
              // No email: this list is anonymous, and every public page that
              // lists content (creator pages, /discover, the org landing,
              // /explore, the related strips) serialises each item into its HTML.
              creator: { columns: PUBLIC_CREATOR_COLUMNS },
              // Four columns, not the row: see PUBLIC_ORGANIZATION_COLUMNS.
              organization: { columns: PUBLIC_ORGANIZATION_COLUMNS },
            },
          }),
        countQuery: { db: this.db, table: content, where },
        // The body ships only on a by-slug read (a detail page) of a PUBLIC
        // row, by the whole policy (`isPublicContent`). The public endpoint is
        // unauthenticated and KV-cached, so it must never return the text of a
        // gated piece (followers / subscribers / team / paid / course-only).
        // It used to read `isFree` alone, and a course-only practice is
        // flagged free on purpose (the course service leaves `isFree` as it
        // was), so anyone could read one by its slug (Codex-039vo). An
        // entitled reader gets a gated body from the access check instead
        // (`/stream?include=body`). A catalogue read (no slug: an org's list,
        // /discover, a creator's profile) never needs a body, so it never
        // carries one. Metadata (title, description, thumbnail, access-policy
        // flags, priceCents, creator, org, mediaItem) stays so cards and the
        // detail page shell render.
        mapItem: (item) =>
          params.slug && isPublicContent(item)
            ? item
            : { ...item, contentBody: null, contentBodyJson: null },
      });

      // Enrich each item with its category (topic) slugs so the landing
      // "Browse by topic" filter can match items to the active topic without a
      // second round-trip. One extra query keyed on the returned content ids,
      // for an org-scoped read only: a topic is an org's, the same scope as
      // the category filter above, and only the org landing reads the slugs. A
      // creatorId-only read (a creator's profile, never KV-cached) skips the
      // query, so its items get an empty array. Soft-deleted categories are
      // excluded.
      const itemIds = result.items.map((item) => item.id);
      const slugsByContentId = new Map<string, string[]>();
      if (itemIds.length > 0 && params.orgId) {
        const slugRows = await this.db
          .select({
            contentId: contentCategories.contentId,
            slug: categories.slug,
          })
          .from(contentCategories)
          .innerJoin(
            categories,
            eq(contentCategories.categoryId, categories.id)
          )
          .where(
            and(
              inArray(contentCategories.contentId, itemIds),
              isNull(categories.deletedAt),
              eq(categories.organizationId, params.orgId)
            )
          );
        for (const row of slugRows) {
          const existing = slugsByContentId.get(row.contentId);
          if (existing) existing.push(row.slug);
          else slugsByContentId.set(row.contentId, [row.slug]);
        }
      }

      // The tiers that include each item (Codex-2hxff.91): public, as the
      // tier list already is. Per-tier counts and closed items never are.
      const wired = await withTierWire(this.db, result.items);
      return {
        items: wired.map((item) => ({
          ...item,
          categorySlugs: slugsByContentId.get(item.id) ?? [],
        })),
        pagination: result.pagination,
      };
    } catch (error) {
      this.handleError(error, 'listPublic');
    }
  }

  /**
   * Private helper: Validate media item
   *
   * Checks:
   * - Media exists
   * - Media belongs to creator
   * - Media is not deleted
   * - Media status is 'ready' (if requireReady is true)
   * - Media type matches content type
   *
   * A locking read (FOR KEY SHARE, or the caller's `lock`): a media delete
   * holds the row FOR UPDATE while it checks the item's uses, so an attach
   * that started after it waits, re-reads the row, finds it deleted and
   * refuses (Codex-6sbn1). A scheduled draft's swap passes FOR SHARE, which a
   * status write also waits on, because it decides on the status.
   *
   * @param tx - Database transaction
   * @param mediaItemId - Media item ID
   * @param creatorId - Creator ID
   * @param contentType - Content type
   * @param requireReady - Whether to require media status to be 'ready' (default: true)
   * @param lock - The row lock: KEY SHARE holds off a delete; SHARE also
   *   holds off a status write, for a read the caller decides on
   * @returns The item's status and creation time, read under the lock
   * @throws {MediaNotFoundError} If media doesn't exist or doesn't belong to creator
   * @throws {MediaNotReadyError} If media is not ready (when requireReady is true)
   * @throws {ContentTypeMismatchError} If types don't match
   */
  private async validateMediaItem(
    tx: DatabaseTransaction,
    mediaItemId: string,
    creatorId: string,
    contentType: string,
    requireReady: boolean = true,
    lock: 'key share' | 'share' = 'key share'
  ): Promise<{ status: string; createdAt: Date }> {
    const [mediaItem] = await tx
      .select({
        status: mediaItems.status,
        mediaType: mediaItems.mediaType,
        createdAt: mediaItems.createdAt,
      })
      .from(mediaItems)
      .where(
        and(
          eq(mediaItems.id, mediaItemId),
          scopedNotDeleted(mediaItems, creatorId)
        )
      )
      .for(lock);

    if (!mediaItem) {
      throw new MediaNotFoundError(mediaItemId);
    }

    // Only check ready status when required (e.g., during publishing)
    if (requireReady && mediaItem.status !== MEDIA_STATUS.READY) {
      throw new MediaNotReadyError(
        mediaItemId,
        mediaItem.status,
        mediaItem.status === MEDIA_STATUS.UPLOADING &&
          !isMediaOnItsWay(mediaItem)
      );
    }

    // Validate content type matches media type
    if (
      (contentType === CONTENT_TYPES.VIDEO &&
        mediaItem.mediaType !== MEDIA_TYPES.VIDEO) ||
      (contentType === CONTENT_TYPES.AUDIO &&
        mediaItem.mediaType !== MEDIA_TYPES.AUDIO)
    ) {
      throw new ContentTypeMismatchError(contentType, mediaItem.mediaType);
    }
    return mediaItem;
  }
}
