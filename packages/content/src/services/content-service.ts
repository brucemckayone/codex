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
  CONTENT_STATUS,
  CONTENT_TYPES,
  isPublicContent,
  MEDIA_STATUS,
  MEDIA_TYPES,
  PAGINATION,
  requiresPayoutsToPublish,
} from '@codex/constants';
import {
  isUniqueViolation,
  MEDIA_ITEM_RESPONSE_COLUMNS,
  paginatedQuery,
  scopedNotDeleted,
  withCreatorScope,
} from '@codex/database';
import {
  categories,
  content,
  contentCategories,
  mediaItems,
  organizations,
  stripeConnectAccounts,
} from '@codex/database/schema';
import {
  type ImageProcessingResult,
  ImageProcessingService,
  ownContentThumbnailFolder,
} from '@codex/image-processing';
import { READABLE_ORGANIZATION_COLUMNS } from '@codex/organization';
import type { ServiceConfig } from '@codex/service-errors';
import { BaseService, ValidationError } from '@codex/service-errors';
import type { PaginatedListResponse } from '@codex/shared-types';
import type { CreateContentInput, UpdateContentInput } from '@codex/validation';
import {
  createContentSchema,
  createPlatformImageUrlSchema,
  PLATFORM_IMAGE_URL_MESSAGE,
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
  BusinessLogicError,
  ContentNotFoundError,
  ContentTypeMismatchError,
  CreatorPayoutsRequiredError,
  InternalServiceError,
  MediaDeletedError,
  MediaNotFoundError,
  MediaNotReadyError,
  SlugConflictError,
  TierRequiredToPublishError,
} from '../errors';
import type {
  CatalogueContentRow,
  Content,
  ContentFilters,
  ContentWithRelations,
  DatabaseTransaction,
  PaginationParams,
  PublicContentCreator,
  PublicContentOrganization,
  PublicContentRow,
  PublicMediaItemSource,
} from '../types';
import {
  assertTiersInOrg,
  type ContentTierWire,
  clearTicks,
  expandLegacyTier,
  hasAnyTick,
  notClosedToNewViewers,
  readTickIds,
  replaceTicks,
  shareLockOrgTiers,
  syncLegacyIncludedInTierId,
  withTierWire,
} from './content-tier-access';

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
} as const satisfies Partial<Record<keyof Content, false>>;

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
    if (raw.startsWith('{')) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed.type === 'doc') {
          return { contentBody: null, contentBodyJson: parsed };
        }
      } catch {
        // Not valid JSON — treat as plain text
      }
    }
    return { contentBody: raw, contentBodyJson: null };
  }

  /**
   * Whether the creator's Stripe Connect account can receive money.
   *
   * DB-only readiness check: `charges_enabled` + `payouts_enabled` on
   * `stripe_connect_accounts` are kept in sync by Stripe's `account.updated`
   * webhook, so this needs no live Stripe call (content-api has no
   * STRIPE_SECRET_KEY binding) and mirrors the backend gate the subscription
   * domain uses (`chargesEnabled && payoutsEnabled`). One account per user is
   * enforced by a unique(userId) constraint, so `.limit(1)` is exact.
   */
  private async isCreatorConnectReady(
    tx: DatabaseTransaction,
    creatorId: string
  ): Promise<boolean> {
    const [account] = await tx
      .select({
        chargesEnabled: stripeConnectAccounts.chargesEnabled,
        payoutsEnabled: stripeConnectAccounts.payoutsEnabled,
      })
      .from(stripeConnectAccounts)
      .where(eq(stripeConnectAccounts.userId, creatorId))
      .limit(1);

    return !!account && account.chargesEnabled && account.payoutsEnabled;
  }

  /**
   * Refuse to put content that earns money on sale while its creator can't be
   * paid. `requiresPayoutsToPublish` decides what earns money — any price or
   * any tier, whether or not the row is marked purchasable (owner rule,
   * Codex-2hxff.14) — so publish() and update() both ask here. Free, followers
   * and team content passes without a lookup.
   *
   * @throws {CreatorPayoutsRequiredError} When the row needs payouts and the
   *   creator's Connect account is not charges + payouts enabled
   */
  private async assertCreatorCanBePaid(
    tx: DatabaseTransaction,
    creatorId: string,
    row: { priceCents: number | null; isTierGated: boolean }
  ): Promise<void> {
    if (!requiresPayoutsToPublish(row)) return;
    if (await this.isCreatorConnectReady(tx, creatorId)) return;
    throw new CreatorPayoutsRequiredError(
      (row.priceCents ?? 0) > 0 ? 'paid' : 'included_in_tier'
    );
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

    // De-dupe incoming ids so a repeated id can't collide on the
    // (contentId, categoryId) primary key.
    const uniqueIds = [...new Set(categoryIds)];
    if (uniqueIds.length === 0) return;

    // Space scope: org content matches org categories (any curator in the org);
    // personal content matches the creator's OWN personal categories — scoping
    // by creatorId, NOT merely `organizationId IS NULL`, which would leak
    // personal categories across creators.
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
          inArray(categories.id, uniqueIds),
          isNull(categories.deletedAt),
          spaceScope
        )
      );

    if (inSpace.length !== uniqueIds.length) {
      const found = new Set(inSpace.map((row) => row.id));
      const invalid = uniqueIds.filter((id) => !found.has(id));
      throw new ValidationError(
        'One or more categories do not exist in this space',
        { invalidCategoryIds: invalid }
      );
    }

    await tx
      .insert(contentCategories)
      .values(uniqueIds.map((categoryId) => ({ contentId, categoryId })));
  }

  /**
   * Create new content
   *
   * Security:
   * - Validates media item exists and belongs to creator
   * - Validates content type matches media type
   * - Enforces organization scoping
   * - Prevents slug conflicts
   *
   * @param input - Content creation data (validated by Zod)
   * @param creatorId - ID of the creator
   * @returns Created content
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
      // Handle unique constraint violations (slug conflicts)
      if (isUniqueViolation(error)) {
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
          organization: { columns: READABLE_ORGANIZATION_COLUMNS },
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
      // Joins to `categories` + filters soft-deleted so a dead category (its
      // join row lingers until hard delete) never shows as a live selection.
      const membershipRows = await this.db
        .select({ categoryId: contentCategories.categoryId })
        .from(contentCategories)
        .innerJoin(categories, eq(contentCategories.categoryId, categories.id))
        .where(
          and(eq(contentCategories.contentId, id), isNull(categories.deletedAt))
        );

      // The item's tiers (Codex-2hxff.91), so the editor's tier picker can
      // pre-tick them: the editor refuses to save a set it never read.
      const [wired] = await withTierWire(this.db, [result]);
      return {
        ...(wired ?? result),
        categoryIds: membershipRows.map((row) => row.categoryId),
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
   * - Maintains organization scoping
   *
   * @param id - Content ID
   * @param input - Partial update data
   * @param creatorId - Creator ID (for authorization)
   * @returns Updated content
   * @throws {ContentNotFoundError} If content doesn't exist
   * @throws {ForbiddenError} If content doesn't belong to creator
   * @throws {MediaNotFoundError} If a newly attached media item isn't the
   *   caller's, or is deleted
   * @throws {MediaNotReadyError} If it isn't ready and the content is live
   * @throws {ContentTypeMismatchError} If its type isn't the content's
   * @throws {CreatorPayoutsRequiredError} If the update sets or changes a
   *   price or tier on published content whose creator can't be paid
   */
  async update(
    id: string,
    input: UpdateContentInput,
    creatorId: string
  ): Promise<Content & ContentTierWire> {
    const { content: updated } = await this.updateReportingDroppedThumbnail(
      id,
      input,
      creatorId
    );
    return updated;
  }

  /**
   * {@link update}, also returning the thumbnail URL the update moved the row
   * off, or null. Each upload goes to a new folder (Codex-kk9nv.5), so nothing
   * would ever overwrite the old one; this service has no R2 binding, so the
   * content-api PATCH route deletes it.
   */
  async updateReportingDroppedThumbnail(
    id: string,
    input: UpdateContentInput,
    creatorId: string
  ): Promise<{
    content: Content & ContentTierWire;
    droppedThumbnailUrl: string | null;
  }> {
    // Validate input
    const validated = updateContentSchema.parse(input);

    // Same external-host gate as create() (Codex-8so68). `updateContentSchema`
    // is a partial, so an absent `thumbnailUrl` is a no-op and an explicit
    // null clears it; only a string is checked.
    this.assertPlatformThumbnailUrl(validated.thumbnailUrl);

    // Read inside the transaction; only meaningful once it has committed.
    let previousThumbnailUrl: string | null = null;

    try {
      const result = await this.db.transaction(async (tx) => {
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
        const bodyFields =
          _rawBody !== undefined ? this.parseContentBody(_rawBody) : {};
        previousThumbnailUrl = existing.thumbnailUrl;

        // A URL in this content's own thumbnail folders is written only by an
        // upload. One the payload sends that differs from the row's names an
        // upload since replaced, whose files are deleted, so a stale form
        // re-sending it would point the row at a 404. The stored thumbnail
        // stays (Codex-kk9nv.5).
        const sentThumbnailUrl = restValidated.thumbnailUrl;
        const keepStoredThumbnail =
          sentThumbnailUrl != null &&
          sentThumbnailUrl !== existing.thumbnailUrl &&
          ownContentThumbnailFolder(
            sentThumbnailUrl,
            { creatorId, contentId: id },
            this.r2PublicUrlBase
          ) !== null;

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
        if (
          sentMediaItemId != null &&
          sentMediaItemId !== existing.mediaItemId
        ) {
          await this.validateMediaItem(
            tx as DatabaseTransaction,
            sentMediaItemId,
            creatorId,
            restValidated.contentType ?? existing.contentType,
            // Live as the usage lookup counts it: released content keeps its
            // buyers after it goes off sale, so it needs a playable item too.
            existing.status === CONTENT_STATUS.PUBLISHED ||
              existing.publishedAt !== null
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
            await this.assertCreatorCanBePaid(
              tx as DatabaseTransaction,
              creatorId,
              { priceCents: nextPriceCents, isTierGated: effGated }
            );
          }
        }

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

      // Bump content catalogue version keys (fire-and-forget; invalidate swallows errors)
      void this.cache?.invalidate(CacheType.COLLECTION_CONTENT_PUBLISHED);
      if (result.organizationId) {
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

      const thumbnailMoved = previousThumbnailUrl !== result.thumbnailUrl;
      const [wired] = await withTierWire(this.db, [result]);
      return {
        content: wired ?? {
          ...result,
          includedInTierIds: [],
          includedInTierId: result.legacyIncludedInTierId,
        },
        droppedThumbnailUrl: thumbnailMoved ? previousThumbnailUrl : null,
      };
    } catch (error) {
      if (error instanceof ContentNotFoundError) {
        throw error;
      }
      this.handleError(error, 'update');
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
   * - Validates content is ready (has media if video/audio)
   * - Idempotent (returns success if already published)
   *
   * @param id - Content ID
   * @param creatorId - Creator ID (for authorization)
   * @returns Published content
   * @throws {ContentNotFoundError} If content doesn't exist
   * @throws {BusinessLogicError} If content is not ready to publish
   * @throws {MediaDeletedError} If its media item was deleted (Codex-6sbn1)
   * @throws {MediaNotFoundError} If its media item is another creator's
   *   (Codex-vmi6m)
   */
  async publish(
    id: string,
    creatorId: string
  ): Promise<Content & ContentTierWire> {
    try {
      const result = await this.db.transaction(async (tx) => {
        // The row first, locked FOR NO KEY UPDATE, then its media FOR KEY
        // SHARE below: the order update() takes them in. Publish takes no tier
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

        // Validate content is ready to publish
        if (
          [CONTENT_TYPES.VIDEO, CONTENT_TYPES.AUDIO].includes(
            existing.contentType as
              | typeof CONTENT_TYPES.VIDEO
              | typeof CONTENT_TYPES.AUDIO
          )
        ) {
          if (!existing.mediaItem) {
            throw new BusinessLogicError(
              'Cannot publish content without media',
              {
                contentId: id,
                contentType: existing.contentType,
              }
            );
          }
          // A draft keeps its link to a deleted item (Codex-6sbn1), and must
          // not go live on it. A locking read, so a delete running now is
          // ordered against this publish: one that committed first is seen
          // here; one that waits on this lock then sees a published use, and
          // refuses. Scoped to the content's creator: a row that took another
          // creator's item through the old PATCH hole (Codex-vmi6m) must not
          // go live streaming their file.
          const [media] = await tx
            .select({ deletedAt: mediaItems.deletedAt })
            .from(mediaItems)
            .where(
              and(
                eq(mediaItems.id, existing.mediaItem.id),
                eq(mediaItems.creatorId, existing.creatorId)
              )
            )
            .for('key share');
          if (!media) {
            throw new MediaNotFoundError(existing.mediaItem.id);
          }
          if (media.deletedAt) {
            throw new MediaDeletedError(id);
          }
          if (existing.mediaItem.status !== MEDIA_STATUS.READY) {
            throw new MediaNotReadyError(existing.mediaItem.id);
          }
        }

        // Subscriber content needs at least one tier to go live (Codex-2hxff.91,
        // owner U2). Saving it with none is allowed (closed); publishing it is
        // not. A paid item whose tiers are optional stays on sale, so it may.
        if (
          existing.isTierGated &&
          !existing.isPurchasable &&
          !(await hasAnyTick(tx as DatabaseTransaction, id))
        ) {
          throw new TierRequiredToPublishError(id);
        }

        // Content that earns money needs a payout-ready Connect account before
        // it can go live: publishing without a payout destination strands
        // buyer funds in a pending payout indefinitely. Any price or tier
        // counts, purchasable or not (Codex-2hxff.14 — the old gate only saw
        // a price on a row marked purchasable).
        await this.assertCreatorCanBePaid(
          tx as DatabaseTransaction,
          creatorId,
          existing
        );

        // Publish content
        const [published] = await tx
          .update(content)
          .set({
            status: CONTENT_STATUS.PUBLISHED,
            publishedAt: new Date(),
            // Back on sale: no longer "taken off sale on departure"
            // (Codex-2hxff.64), so tier access follows the normal rule.
            offSaleAt: null,
            updatedAt: new Date(),
          })
          .where(and(eq(content.id, id), withCreatorScope(content, creatorId)))
          .returning();

        if (!published) {
          throw new ContentNotFoundError(id);
        }

        return published;
      });

      if (!result) {
        throw new ContentNotFoundError(id);
      }

      // Bump content catalogue version keys (fire-and-forget; invalidate swallows errors)
      void this.cache?.invalidate(CacheType.COLLECTION_CONTENT_PUBLISHED);
      if (result.organizationId) {
        void this.cache?.invalidate(
          CacheType.COLLECTION_ORG_CONTENT(result.organizationId)
        );
      }

      const [wired] = await withTierWire(this.db, [result]);
      return (
        wired ?? { ...result, includedInTierIds: [], includedInTierId: null }
      );
    } catch (error) {
      if (
        error instanceof ContentNotFoundError ||
        error instanceof BusinessLogicError
      ) {
        throw error;
      }
      this.handleError(error, 'publish');
    }
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
    try {
      const result = await this.db.transaction(async (tx) => {
        const existing = await tx.query.content.findFirst({
          where: and(eq(content.id, id), scopedNotDeleted(content, creatorId)),
        });

        if (!existing) {
          throw new ContentNotFoundError(id);
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

        return unpublished;
      });

      // Bump content catalogue version keys (fire-and-forget; invalidate swallows errors)
      void this.cache?.invalidate(CacheType.COLLECTION_CONTENT_PUBLISHED);
      if (result.organizationId) {
        void this.cache?.invalidate(
          CacheType.COLLECTION_ORG_CONTENT(result.organizationId)
        );
      }

      // Its tiers (Codex-2hxff.91), as every content read carries them.
      const [wired] = await withTierWire(this.db, [result]);
      return (
        wired ?? { ...result, includedInTierIds: [], includedInTierId: null }
      );
    } catch (error) {
      if (error instanceof ContentNotFoundError) {
        throw error;
      }
      this.handleError(error, 'unpublish');
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
    try {
      await this.db.transaction(async (tx) => {
        const existing = await tx.query.content.findFirst({
          where: and(eq(content.id, id), scopedNotDeleted(content, creatorId)),
        });

        if (!existing) {
          throw new ContentNotFoundError(id);
        }

        await tx
          .update(content)
          .set({
            deletedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(content.id, id), withCreatorScope(content, creatorId)));
      });
    } catch (error) {
      if (error instanceof ContentNotFoundError) {
        throw error;
      }
      this.handleError(error, 'delete');
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
    paginationOrOptions?: PaginationParams | { scope?: 'studio' },
    maybeOptions?: { scope?: 'studio' }
  ): Promise<PaginatedListResponse<ContentWithRelations>>;
  async list(
    creatorId: string,
    filters: ContentFilters = {},
    paginationOrOptions: PaginationParams | { scope?: 'studio' | 'browse' } = {
      page: 1,
      limit: PAGINATION.DEFAULT,
    },
    maybeOptions?: { scope?: 'studio' | 'browse' }
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
    const options =
      (isPagination
        ? maybeOptions
        : (paginationOrOptions as { scope?: 'studio' | 'browse' })) ?? {};
    const scope = options.scope ?? 'studio';

    if (scope === 'browse' && !filters.organizationId) {
      // Hard fail-closed: browse-mode queries without an org filter are
      // a multi-tenant boundary violation. Schema-level validation
      // catches this at the route, this is the service-level seatbelt.
      throw new ValidationError(
        'organizationId is required for browse-mode content list'
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
      if (filters.category) {
        whereConditions.push(eq(content.category, filters.category));
      }
      if (filters.organizationId !== undefined) {
        if (filters.organizationId === null) {
          whereConditions.push(isNull(content.organizationId));
        } else {
          whereConditions.push(
            eq(content.organizationId, filters.organizationId)
          );
        }
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

      // Determine sort column and order
      const sortColumn = filters.sortBy || 'createdAt';
      const sortOrder = filters.sortOrder || 'desc';
      const orderByClause =
        sortOrder === 'desc'
          ? desc(content[sortColumn])
          : asc(content[sortColumn]);

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
                orderBy: [orderByClause],
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
                orderBy: [orderByClause],
                // The studio scope is the signed-in creator's own rows, whole
                // and with their email. The org is not theirs: no payee id.
                with: {
                  mediaItem: { columns: MEDIA_ITEM_RESPONSE_COLUMNS },
                  organization: { columns: READABLE_ORGANIZATION_COLUMNS },
                  creator: { columns: { id: true, email: true, name: true } },
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
      // one query over the page's ids.
      return {
        items: await withTierWire(this.db, page.items),
        pagination: page.pagination,
      };
    } catch (error) {
      this.handleError(error, 'list');
    }
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

      // Optional category (topic) filter — restrict to content tagged with the
      // given category slug within the SAME space as the listing. A membership
      // subquery (content_categories ⋈ categories) yields the matching content
      // ids and we match via `IN`, so the relational `findMany` below (with its
      // media/creator/org relations) stays intact — no join reshaping needed.
      //
      // The org's own topics only (the guard above refuses a category with no
      // org). Soft-deleted categories are excluded.
      if (params.category && params.orgId) {
        const categoryContentIds = this.db
          .select({ contentId: contentCategories.contentId })
          .from(contentCategories)
          .innerJoin(
            categories,
            eq(contentCategories.categoryId, categories.id)
          )
          .where(
            and(
              eq(categories.slug, params.category),
              isNull(categories.deletedAt),
              eq(categories.organizationId, params.orgId)
            )
          );
        whereConditions.push(inArray(content.id, categoryContentIds));
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
   * A locking read (FOR KEY SHARE): a media delete holds the row FOR UPDATE
   * while it checks the item's uses, so an attach that started after it
   * waits, re-reads the row, finds it deleted and refuses (Codex-6sbn1).
   *
   * @param tx - Database transaction
   * @param mediaItemId - Media item ID
   * @param creatorId - Creator ID
   * @param contentType - Content type
   * @param requireReady - Whether to require media status to be 'ready' (default: true)
   * @throws {MediaNotFoundError} If media doesn't exist or doesn't belong to creator
   * @throws {MediaNotReadyError} If media is not ready (when requireReady is true)
   * @throws {ContentTypeMismatchError} If types don't match
   */
  private async validateMediaItem(
    tx: DatabaseTransaction,
    mediaItemId: string,
    creatorId: string,
    contentType: string,
    requireReady: boolean = true
  ): Promise<void> {
    const [mediaItem] = await tx
      .select({ status: mediaItems.status, mediaType: mediaItems.mediaType })
      .from(mediaItems)
      .where(
        and(
          eq(mediaItems.id, mediaItemId),
          scopedNotDeleted(mediaItems, creatorId)
        )
      )
      .for('key share');

    if (!mediaItem) {
      throw new MediaNotFoundError(mediaItemId);
    }

    // Only check ready status when required (e.g., during publishing)
    if (requireReady && mediaItem.status !== MEDIA_STATUS.READY) {
      throw new MediaNotReadyError(mediaItemId);
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
  }
}
