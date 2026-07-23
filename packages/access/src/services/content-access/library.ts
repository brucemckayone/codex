/**
 * User content-library aggregation for ContentAccessService.
 *
 * Extracted from ContentAccessService (Codex-2pryk.1.1) — behaviour-preserving.
 * Builds a user's library across five source arms (purchased, membership,
 * subscription, engaged-free, engaged-followers), then merges, dedupes, sorts,
 * and paginates.
 */

import {
  CONTENT_ACCESS_TYPE,
  CONTENT_STATUS,
  ORGANIZATION_ROLES,
  PURCHASE_STATUS,
  SUBSCRIPTION_STATUS,
} from '@codex/constants';
import { type DatabaseClient, toIso } from '@codex/database';
import {
  content,
  mediaItems,
  organizationFollowers,
  organizationMemberships,
  organizations,
  purchases,
  subscriptions,
  subscriptionTiers,
  videoPlayback,
} from '@codex/database/schema';
import type { ObservabilityClient } from '@codex/observability';
import type { ListUserLibraryInput } from '@codex/validation';
import {
  and,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from 'drizzle-orm';

/**
 * User library item with content, access type, purchase, and progress information
 */
export interface UserLibraryItem {
  content: {
    id: string;
    slug: string;
    title: string;
    description: string;
    thumbnailUrl: string | null;
    contentType: string;
    durationSeconds: number;
    organizationId: string | null;
    organizationSlug: string | null;
  };
  /**
   * How the user has access:
   * - `'purchased'`     — completed (or pending-webhook) purchase row exists
   * - `'membership'`    — user holds an org management role (owner/admin/creator)
   * - `'subscription'`  — active subscription gates `subscribers`/tier-paid content
   * - `'free'`          — `accessType='free'` content the user has *engaged with*
   *                       (a `videoPlayback` row exists)
   * - `'followers'`     — `accessType='followers'` content the user can access
   *                       (follower row OR active subscription) AND has engaged with
   */
  accessType:
    | 'purchased'
    | 'membership'
    | 'subscription'
    | 'free'
    | 'followers';
  purchase: {
    purchasedAt: string;
    priceCents: number;
  } | null;
  progress: {
    positionSeconds: number;
    durationSeconds: number;
    completed: boolean;
    percentComplete: number;
    updatedAt: string;
  } | null;
}

/**
 * User library response with pagination
 */
export interface UserLibraryResponse {
  items: UserLibraryItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * List user's purchased/accessible content library with playback progress.
 *
 * @returns Paginated list of content with progress
 */
export async function listUserLibrary(
  deps: { db: DatabaseClient; obs: ObservabilityClient },
  userId: string,
  input: ListUserLibraryInput
): Promise<UserLibraryResponse> {
  const { db, obs } = deps;

  obs.info('Listing user library', {
    userId,
    page: input.page,
    filter: input.filter,
    sortBy: input.sortBy,
    contentType: input.contentType,
    accessType: input.accessType,
    search: input.search,
  });

  const offset = (input.page - 1) * input.limit;

  // ── Step 1: Resolve active membership org IDs ─────────────────────
  const membershipConditions = [
    eq(organizationMemberships.userId, userId),
    eq(organizationMemberships.status, 'active'),
  ];
  if (input.organizationId) {
    membershipConditions.push(
      eq(organizationMemberships.organizationId, input.organizationId)
    );
  }

  const MANAGEMENT_ROLES: string[] = [
    ORGANIZATION_ROLES.OWNER,
    ORGANIZATION_ROLES.ADMIN,
    ORGANIZATION_ROLES.CREATOR,
  ];

  // Skip the membership lookup when the caller filters to a bucket that
  // doesn't need it. The membership arm needs it; engaged-free and
  // engaged-followers also reference `managementOrgIds` for cross-arm
  // exclusion, so they must NOT skip.
  const activeMemberships =
    input.accessType === 'purchased' || input.accessType === 'subscription'
      ? []
      : await db.query.organizationMemberships.findMany({
          where: and(
            ...membershipConditions,
            inArray(organizationMemberships.role, MANAGEMENT_ROLES)
          ),
          columns: { organizationId: true, role: true },
        });

  // Only management roles (owner/admin/creator) populate the library's
  // "membership" bucket. Regular 'member' / 'subscriber' roles are handled
  // by the subscription query (if subscribed) — they don't pull content
  // into library just for existing.
  const managementOrgIds = activeMemberships.map((m) => m.organizationId);

  // ── Step 1b: Resolve active subscriptions with tier info ─────────
  // Skip when filtering to a bucket that doesn't need subscription tier
  // info. The engaged-followers arm uses an `EXISTS subscription` predicate
  // inline (cheaper than reading + serialising tier rows here), so it can
  // skip too. Engaged-free also doesn't reference subscriptions.
  const activeSubscriptions =
    input.accessType === 'purchased' ||
    input.accessType === 'membership' ||
    input.accessType === 'free' ||
    input.accessType === 'followers'
      ? []
      : await db.query.subscriptions.findMany({
          where: and(
            eq(subscriptions.userId, userId),
            inArray(subscriptions.status, [
              SUBSCRIPTION_STATUS.ACTIVE,
              SUBSCRIPTION_STATUS.CANCELLING,
            ]),
            gt(subscriptions.currentPeriodEnd, new Date()),
            ...(input.organizationId
              ? [eq(subscriptions.organizationId, input.organizationId)]
              : [])
          ),
          with: { tier: true },
        });

  // ── Step 2: Build shared filter conditions ────────────────────────
  const buildContentFilters = () => {
    const conditions: ReturnType<typeof eq>[] = [];
    if (input.contentType && input.contentType !== 'all') {
      conditions.push(eq(content.contentType, input.contentType));
    }
    if (input.search) {
      const pattern = `%${input.search.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
      const searchCondition = or(
        ilike(content.title, pattern),
        ilike(content.description ?? '', pattern)
      );
      if (searchCondition) conditions.push(searchCondition);
    }
    return conditions;
  };

  const buildProgressFilters = () => {
    const conditions: ReturnType<typeof eq>[] = [];
    if (input.filter === 'completed') {
      conditions.push(eq(videoPlayback.completed, true));
    } else if (input.filter === 'in_progress') {
      conditions.push(gt(videoPlayback.positionSeconds, 0));
      const notCompleted = or(
        isNull(videoPlayback.completed),
        eq(videoPlayback.completed, false)
      );
      if (notCompleted) conditions.push(notCompleted);
    } else if (input.filter === 'not_started') {
      const noProgress = or(
        isNull(videoPlayback.positionSeconds),
        eq(videoPlayback.positionSeconds, 0)
      );
      if (noProgress) conditions.push(noProgress);
      const notCompleted = or(
        isNull(videoPlayback.completed),
        eq(videoPlayback.completed, false)
      );
      if (notCompleted) conditions.push(notCompleted);
    }
    return conditions;
  };

  const contentFilters = buildContentFilters();
  const progressFilters = buildProgressFilters();

  // ── Helper: map a row to UserLibraryItem ──────────────────────────
  const mapProgress = (row: {
    progressPositionSeconds: number | null;
    progressDurationSeconds: number | null;
    progressCompleted: boolean | null;
    progressUpdatedAt: Date | null;
  }): UserLibraryItem['progress'] => {
    if (!row.progressUpdatedAt) return null;
    const pos = row.progressPositionSeconds ?? 0;
    const dur = row.progressDurationSeconds ?? 0;
    return {
      positionSeconds: pos,
      durationSeconds: dur,
      completed: row.progressCompleted ?? false,
      percentComplete: dur > 0 ? Math.round((pos / dur) * 100) : 0,
      updatedAt: toIso(row.progressUpdatedAt),
    };
  };

  // ── Step 3: Query purchased items ─────────────────────────────────
  const queryPurchased = async () => {
    if (
      input.accessType === 'membership' ||
      input.accessType === 'subscription' ||
      input.accessType === 'free' ||
      input.accessType === 'followers'
    ) {
      return { items: [] as UserLibraryItem[], count: 0 };
    }

    const conditions = [
      eq(purchases.customerId, userId),
      eq(purchases.status, PURCHASE_STATUS.COMPLETED),
      ...contentFilters,
      ...progressFilters,
    ];
    if (input.organizationId) {
      conditions.push(eq(purchases.organizationId, input.organizationId));
    }

    const sortClause =
      input.sortBy === 'title'
        ? content.title
        : input.sortBy === 'duration'
          ? sql`COALESCE(${mediaItems.durationSeconds}, 0)`
          : purchases.createdAt;

    const baseFrom = db
      .select({
        contentId: content.id,
        contentSlug: content.slug,
        contentTitle: content.title,
        contentDescription: content.description,
        contentThumbnailUrl: content.thumbnailUrl,
        contentType: content.contentType,
        mediaThumbnailKey: mediaItems.thumbnailKey,
        mediaDurationSeconds: mediaItems.durationSeconds,
        orgId: content.organizationId,
        orgSlug: organizations.slug,
        purchasedAt: purchases.createdAt,
        amountPaidCents: purchases.amountPaidCents,
        progressPositionSeconds: videoPlayback.positionSeconds,
        progressDurationSeconds: videoPlayback.durationSeconds,
        progressCompleted: videoPlayback.completed,
        progressUpdatedAt: videoPlayback.updatedAt,
      })
      .from(purchases)
      .innerJoin(content, eq(content.id, purchases.contentId))
      .leftJoin(mediaItems, eq(mediaItems.id, content.mediaItemId))
      .leftJoin(organizations, eq(organizations.id, content.organizationId))
      .leftJoin(
        videoPlayback,
        and(
          eq(videoPlayback.contentId, content.id),
          eq(videoPlayback.userId, userId)
        )
      );

    const countQuery = db
      .select({ count: sql<number>`count(*)::int` })
      .from(purchases)
      .innerJoin(content, eq(content.id, purchases.contentId))
      .leftJoin(mediaItems, eq(mediaItems.id, content.mediaItemId))
      .leftJoin(
        videoPlayback,
        and(
          eq(videoPlayback.contentId, content.id),
          eq(videoPlayback.userId, userId)
        )
      )
      .where(and(...conditions));

    const dataQuery = baseFrom
      .where(and(...conditions))
      .orderBy(input.sortBy === 'title' ? sortClause : desc(sortClause))
      .limit(input.limit)
      .offset(offset);

    const [countResult, rows] = await Promise.all([countQuery, dataQuery]);

    const items: UserLibraryItem[] = rows.map((row) => ({
      content: {
        id: row.contentId,
        slug: row.contentSlug,
        title: row.contentTitle,
        description: row.contentDescription || '',
        thumbnailUrl: row.contentThumbnailUrl ?? row.mediaThumbnailKey ?? null,
        contentType: row.contentType ?? 'video',
        durationSeconds: row.mediaDurationSeconds ?? 0,
        organizationId: row.orgId,
        organizationSlug: row.orgSlug ?? null,
      },
      accessType: 'purchased' as const,
      purchase: {
        purchasedAt: row.purchasedAt.toISOString(),
        priceCents: row.amountPaidCents,
      },
      progress: mapProgress(row),
    }));

    return { items, count: countResult[0]?.count ?? 0 };
  };

  // ── Step 4: Query membership items ─────────────────────────────────
  // Library membership = content the user has via a MANAGEMENT relationship
  // with an org (owner/admin/creator). Free + follower content from orgs the
  // user merely follows is publicly browseable and does not belong in
  // "my library" — followers haven't acquired anything, they're just opted-in
  // to see it on the org's pages. Including it here would pollute every
  // subscriber's/follower's library with the full free catalogue.
  const queryMembership = async () => {
    if (
      input.accessType === 'purchased' ||
      input.accessType === 'subscription' ||
      input.accessType === 'free' ||
      input.accessType === 'followers' ||
      managementOrgIds.length === 0
    ) {
      return { items: [] as UserLibraryItem[], count: 0 };
    }

    // Management roles see ALL content from orgs they manage.
    const membershipContentFilter = inArray(
      content.organizationId,
      managementOrgIds
    );

    const conditions = [
      membershipContentFilter,
      eq(content.status, CONTENT_STATUS.PUBLISHED),
      isNull(content.deletedAt),
      // Exclude content the user has acquired or is acquiring via purchase.
      // Both `completed` (webhook landed) and `pending` (Stripe redirect beat
      // the webhook — row exists but status hasn't flipped yet) count as
      // "already owned" for library-categorisation purposes. Without the
      // `pending` clause, a purchase mid-flight leaks into membership and
      // shows up with the wrong accessType tag until the webhook lands.
      sql`${content.id} NOT IN (SELECT ${purchases.contentId} FROM ${purchases} WHERE ${purchases.customerId} = ${userId} AND ${purchases.status} IN (${PURCHASE_STATUS.COMPLETED}, ${PURCHASE_STATUS.PENDING}))`,
      ...contentFilters,
      ...progressFilters,
    ];

    const sortClause =
      input.sortBy === 'title'
        ? content.title
        : input.sortBy === 'duration'
          ? sql`COALESCE(${mediaItems.durationSeconds}, 0)`
          : content.createdAt;

    const baseFrom = db
      .select({
        contentId: content.id,
        contentSlug: content.slug,
        contentTitle: content.title,
        contentDescription: content.description,
        contentThumbnailUrl: content.thumbnailUrl,
        contentType: content.contentType,
        mediaThumbnailKey: mediaItems.thumbnailKey,
        mediaDurationSeconds: mediaItems.durationSeconds,
        orgId: content.organizationId,
        orgSlug: organizations.slug,
        contentCreatedAt: content.createdAt,
        progressPositionSeconds: videoPlayback.positionSeconds,
        progressDurationSeconds: videoPlayback.durationSeconds,
        progressCompleted: videoPlayback.completed,
        progressUpdatedAt: videoPlayback.updatedAt,
      })
      .from(content)
      .leftJoin(mediaItems, eq(mediaItems.id, content.mediaItemId))
      .leftJoin(organizations, eq(organizations.id, content.organizationId))
      .leftJoin(
        videoPlayback,
        and(
          eq(videoPlayback.contentId, content.id),
          eq(videoPlayback.userId, userId)
        )
      );

    const countQuery = db
      .select({ count: sql<number>`count(*)::int` })
      .from(content)
      .leftJoin(mediaItems, eq(mediaItems.id, content.mediaItemId))
      .leftJoin(
        videoPlayback,
        and(
          eq(videoPlayback.contentId, content.id),
          eq(videoPlayback.userId, userId)
        )
      )
      .where(and(...conditions));

    const dataQuery = baseFrom
      .where(and(...conditions))
      .orderBy(input.sortBy === 'title' ? sortClause : desc(sortClause))
      .limit(input.limit)
      .offset(offset);

    const [countResult, rows] = await Promise.all([countQuery, dataQuery]);

    const items: UserLibraryItem[] = rows.map((row) => ({
      content: {
        id: row.contentId,
        slug: row.contentSlug,
        title: row.contentTitle,
        description: row.contentDescription || '',
        thumbnailUrl: row.contentThumbnailUrl ?? row.mediaThumbnailKey ?? null,
        contentType: row.contentType ?? 'video',
        durationSeconds: row.mediaDurationSeconds ?? 0,
        organizationId: row.orgId,
        organizationSlug: row.orgSlug ?? null,
      },
      accessType: 'membership' as const,
      purchase: null,
      progress: mapProgress(row),
    }));

    return { items, count: countResult[0]?.count ?? 0 };
  };

  // ── Step 4b: Query subscription items ───────────────────────────
  const querySubscription = async () => {
    if (
      input.accessType === 'purchased' ||
      input.accessType === 'membership' ||
      input.accessType === 'free' ||
      input.accessType === 'followers' ||
      activeSubscriptions.length === 0
    ) {
      return { items: [] as UserLibraryItem[], count: 0 };
    }

    // Build a tier-aware filter: for each subscription, include content
    // from that org where the user's tier sortOrder >= content's minimum tier
    // sortOrder (or content has no minimum tier).
    //
    // Build per-subscription tier conditions using SQL:
    // For each sub, content.organizationId = sub.orgId AND
    //   (content.minimumTierId IS NULL
    //    OR content.minimumTierId IN (tiers with sortOrder <= user's tier sortOrder))
    //
    // Since each subscription may be to a different org with a different tier,
    // we build an OR of per-subscription conditions.
    const subConditions = activeSubscriptions.map((sub) => {
      const tierSortOrder = sub.tier.sortOrder;
      return and(
        eq(content.organizationId, sub.organizationId),
        or(
          isNull(content.minimumTierId),
          // minimumTierId's sortOrder must be <= user's subscription tier sortOrder
          sql`${content.minimumTierId} IN (
            SELECT ${subscriptionTiers.id} FROM ${subscriptionTiers}
            WHERE ${subscriptionTiers.sortOrder} <= ${tierSortOrder}
              AND ${subscriptionTiers.organizationId} = ${sub.organizationId}
              AND ${subscriptionTiers.deletedAt} IS NULL
          )`
        )
      );
    });

    const conditions = [
      // Content a subscription grants access to — either explicitly tagged
      // `accessType='subscribers'`, or tier-gated paid content
      // (`accessType='paid'` with a `minimumTierId` set). This mirrors the
      // streaming-access rule in getStreamingUrl() so anything a subscriber
      // can actually stream shows in their library. Paid content WITHOUT a
      // minimumTierId is still gated behind purchase — it never appears
      // here. Per-org tier-sortOrder check below (subConditions) decides
      // whether this user's tier is high enough for any given item.
      or(
        eq(content.accessType, CONTENT_ACCESS_TYPE.SUBSCRIBERS),
        and(
          eq(content.accessType, CONTENT_ACCESS_TYPE.PAID),
          sql`${content.minimumTierId} IS NOT NULL`
        )
      )!,
      eq(content.status, CONTENT_STATUS.PUBLISHED),
      isNull(content.deletedAt),
      // Must belong to one of the user's subscribed orgs (with tier check)
      or(...subConditions)!,
      // Exclude content the user has acquired or is acquiring via purchase.
      // Both `completed` and `pending` count — a `pending` purchase is a
      // Stripe session whose webhook hasn't landed yet. Without the
      // `pending` clause, a mid-flight purchase leaks into the subscription
      // arm (particularly for `accessType='paid'` + `minimumTierId` set
      // content, which now qualifies for both arms — see 1b6f14a0) and
      // shows up with the wrong accessType tag on the library. Once the
      // webhook lands and `status` flips to `completed`, the row continues
      // to be excluded here and surfaces in the purchased arm instead.
      sql`${content.id} NOT IN (SELECT ${purchases.contentId} FROM ${purchases} WHERE ${purchases.customerId} = ${userId} AND ${purchases.status} IN (${PURCHASE_STATUS.COMPLETED}, ${PURCHASE_STATUS.PENDING}))`,
      // Exclude content from management orgs (owner/admin/creator see
      // all their org's content via the membership query).
      ...(managementOrgIds.length > 0
        ? [
            sql`${content.organizationId} NOT IN (${sql.join(
              managementOrgIds.map((id) => sql`${id}`),
              sql`, `
            )})`,
          ]
        : []),
      ...contentFilters,
      ...progressFilters,
    ];

    const sortClause =
      input.sortBy === 'title'
        ? content.title
        : input.sortBy === 'duration'
          ? sql`COALESCE(${mediaItems.durationSeconds}, 0)`
          : content.createdAt;

    const baseFrom = db
      .select({
        contentId: content.id,
        contentSlug: content.slug,
        contentTitle: content.title,
        contentDescription: content.description,
        contentThumbnailUrl: content.thumbnailUrl,
        contentType: content.contentType,
        mediaThumbnailKey: mediaItems.thumbnailKey,
        mediaDurationSeconds: mediaItems.durationSeconds,
        orgId: content.organizationId,
        orgSlug: organizations.slug,
        contentCreatedAt: content.createdAt,
        progressPositionSeconds: videoPlayback.positionSeconds,
        progressDurationSeconds: videoPlayback.durationSeconds,
        progressCompleted: videoPlayback.completed,
        progressUpdatedAt: videoPlayback.updatedAt,
      })
      .from(content)
      .leftJoin(mediaItems, eq(mediaItems.id, content.mediaItemId))
      .leftJoin(organizations, eq(organizations.id, content.organizationId))
      .leftJoin(
        videoPlayback,
        and(
          eq(videoPlayback.contentId, content.id),
          eq(videoPlayback.userId, userId)
        )
      );

    const countQuery = db
      .select({ count: sql<number>`count(*)::int` })
      .from(content)
      .leftJoin(mediaItems, eq(mediaItems.id, content.mediaItemId))
      .leftJoin(
        videoPlayback,
        and(
          eq(videoPlayback.contentId, content.id),
          eq(videoPlayback.userId, userId)
        )
      )
      .where(and(...conditions));

    const dataQuery = baseFrom
      .where(and(...conditions))
      .orderBy(input.sortBy === 'title' ? sortClause : desc(sortClause))
      .limit(input.limit)
      .offset(offset);

    const [countResult, rows] = await Promise.all([countQuery, dataQuery]);

    const items: UserLibraryItem[] = rows.map((row) => ({
      content: {
        id: row.contentId,
        slug: row.contentSlug,
        title: row.contentTitle,
        description: row.contentDescription || '',
        thumbnailUrl: row.contentThumbnailUrl ?? row.mediaThumbnailKey ?? null,
        contentType: row.contentType ?? 'video',
        durationSeconds: row.mediaDurationSeconds ?? 0,
        organizationId: row.orgId,
        organizationSlug: row.orgSlug ?? null,
      },
      accessType: 'subscription' as const,
      purchase: null,
      progress: mapProgress(row),
    }));

    return { items, count: countResult[0]?.count ?? 0 };
  };

  // ── Step 4c/4d: Relationship-based free + followers buckets ─────
  // Free and followers buckets are both gated by *relationship*, not
  // engagement. The relationship is "user has a follower row OR an active
  // in-period subscription to the org" — i.e. the user has explicitly opted
  // in to seeing this org's content. Differences between the two buckets:
  //
  //   - free arm:        content.accessType = 'free'
  //   - followers arm:   content.accessType = 'followers'
  //
  // Same relationship predicate, same JOIN shape, same cross-arm exclusions.
  // The shared builder below avoids 200 lines of near-duplicate SQL plumbing.
  //
  // Why dropping the engagement gate matters: the user already opted in by
  // following or subscribing. Requiring them to additionally press play
  // before content shows up in their library makes follow/subscribe feel
  // empty until they navigate elsewhere first. Aligns with user expectation
  // that "I follow this org → its content shows in my library."
  //
  // Volume guard: relationship-bound — if you don't follow / subscribe to
  // any org, both buckets are empty for non-management orgs.
  const relationshipPredicate = or(
    sql`EXISTS (SELECT 1 FROM ${organizationFollowers}
                WHERE ${organizationFollowers.organizationId} = ${content.organizationId}
                  AND ${organizationFollowers.userId} = ${userId})`,
    sql`EXISTS (SELECT 1 FROM ${subscriptions}
                WHERE ${subscriptions.userId} = ${userId}
                  AND ${subscriptions.organizationId} = ${content.organizationId}
                  AND ${subscriptions.status} IN (${SUBSCRIPTION_STATUS.ACTIVE}, ${SUBSCRIPTION_STATUS.CANCELLING})
                  AND ${subscriptions.currentPeriodEnd} > NOW())`
  );

  const buildRelationshipQuery = async (
    bucketAccessType:
      | typeof CONTENT_ACCESS_TYPE.FREE
      | typeof CONTENT_ACCESS_TYPE.FOLLOWERS,
    tag: 'free' | 'followers'
  ) => {
    const conditions = [
      eq(content.accessType, bucketAccessType),
      eq(content.status, CONTENT_STATUS.PUBLISHED),
      isNull(content.deletedAt),
      sql`${content.organizationId} IS NOT NULL`,
      relationshipPredicate!,
      // Cross-arm exclusion: purchased rows are surfaced by queryPurchased.
      // Free items shouldn't be purchased, but flag-flips (paid → free)
      // could create overlap; followers items shouldn't be priced. Both
      // exclusions are defensive — keeps the priority contract explicit.
      sql`${content.id} NOT IN (SELECT ${purchases.contentId} FROM ${purchases} WHERE ${purchases.customerId} = ${userId} AND ${purchases.status} IN (${PURCHASE_STATUS.COMPLETED}, ${PURCHASE_STATUS.PENDING}))`,
      // Cross-arm exclusion: management orgs are surfaced by queryMembership
      // which returns ALL of an org's content for owners/admins/creators.
      ...(managementOrgIds.length > 0
        ? [
            sql`${content.organizationId} NOT IN (${sql.join(
              managementOrgIds.map((id) => sql`${id}`),
              sql`, `
            )})`,
          ]
        : []),
      ...(input.organizationId
        ? [eq(content.organizationId, input.organizationId)]
        : []),
      ...contentFilters,
      ...progressFilters,
    ];

    const sortClause =
      input.sortBy === 'title'
        ? content.title
        : input.sortBy === 'duration'
          ? sql`COALESCE(${mediaItems.durationSeconds}, 0)`
          : content.createdAt;

    const baseFrom = db
      .select({
        contentId: content.id,
        contentSlug: content.slug,
        contentTitle: content.title,
        contentDescription: content.description,
        contentThumbnailUrl: content.thumbnailUrl,
        contentType: content.contentType,
        mediaThumbnailKey: mediaItems.thumbnailKey,
        mediaDurationSeconds: mediaItems.durationSeconds,
        orgId: content.organizationId,
        orgSlug: organizations.slug,
        progressPositionSeconds: videoPlayback.positionSeconds,
        progressDurationSeconds: videoPlayback.durationSeconds,
        progressCompleted: videoPlayback.completed,
        progressUpdatedAt: videoPlayback.updatedAt,
      })
      .from(content)
      .leftJoin(mediaItems, eq(mediaItems.id, content.mediaItemId))
      .leftJoin(organizations, eq(organizations.id, content.organizationId))
      .leftJoin(
        videoPlayback,
        and(
          eq(videoPlayback.contentId, content.id),
          eq(videoPlayback.userId, userId)
        )
      );

    const countQuery = db
      .select({ count: sql<number>`count(*)::int` })
      .from(content)
      .leftJoin(mediaItems, eq(mediaItems.id, content.mediaItemId))
      .leftJoin(
        videoPlayback,
        and(
          eq(videoPlayback.contentId, content.id),
          eq(videoPlayback.userId, userId)
        )
      )
      .where(and(...conditions));

    const dataQuery = baseFrom
      .where(and(...conditions))
      .orderBy(input.sortBy === 'title' ? sortClause : desc(sortClause))
      .limit(input.limit)
      .offset(offset);

    const [countResult, rows] = await Promise.all([countQuery, dataQuery]);

    const items: UserLibraryItem[] = rows.map((row) => ({
      content: {
        id: row.contentId,
        slug: row.contentSlug,
        title: row.contentTitle,
        description: row.contentDescription || '',
        thumbnailUrl: row.contentThumbnailUrl ?? row.mediaThumbnailKey ?? null,
        contentType: row.contentType ?? 'video',
        durationSeconds: row.mediaDurationSeconds ?? 0,
        organizationId: row.orgId,
        organizationSlug: row.orgSlug ?? null,
      },
      accessType: tag,
      purchase: null,
      progress: mapProgress(row),
    }));

    return { items, count: countResult[0]?.count ?? 0 };
  };

  const queryFreeRelationship = async () => {
    if (input.accessType !== 'all' && input.accessType !== 'free') {
      return { items: [] as UserLibraryItem[], count: 0 };
    }
    return buildRelationshipQuery(CONTENT_ACCESS_TYPE.FREE, 'free');
  };

  const queryFollowersRelationship = async () => {
    if (input.accessType !== 'all' && input.accessType !== 'followers') {
      return { items: [] as UserLibraryItem[], count: 0 };
    }
    return buildRelationshipQuery(CONTENT_ACCESS_TYPE.FOLLOWERS, 'followers');
  };

  // ── Step 5: Execute all queries in parallel ──────────────────────
  const [
    purchaseResult,
    membershipResult,
    subscriptionResult,
    freeResult,
    followersResult,
  ] = await Promise.all([
    queryPurchased(),
    queryMembership(),
    querySubscription(),
    queryFreeRelationship(),
    queryFollowersRelationship(),
  ]);

  // ── Step 6: Merge, sort, and paginate ─────────────────────────────
  // Source priority (first-match-wins on overlap):
  //   purchased > membership > subscription > free > followers
  // Cross-arm exclusion clauses already minimise overlap; the explicit
  // dedup-by-contentId step below hardens this contract for future arms.
  const sources = [
    purchaseResult,
    membershipResult,
    subscriptionResult,
    freeResult,
    followersResult,
  ];
  const activeSources = sources.filter((s) => s.count > 0);

  // When a specific accessType filter is applied or only one source has
  // items, the DB already handled pagination — return directly.
  const filteredAccessType =
    input.accessType === 'purchased' ||
    input.accessType === 'membership' ||
    input.accessType === 'subscription' ||
    input.accessType === 'free' ||
    input.accessType === 'followers';

  if (filteredAccessType || activeSources.length <= 1) {
    const result = filteredAccessType
      ? input.accessType === 'purchased'
        ? purchaseResult
        : input.accessType === 'membership'
          ? membershipResult
          : input.accessType === 'subscription'
            ? subscriptionResult
            : input.accessType === 'free'
              ? freeResult
              : followersResult
      : (activeSources[0] ?? purchaseResult);
    return {
      items: result.items,
      pagination: {
        page: input.page,
        limit: input.limit,
        total: result.count,
        totalPages: Math.max(1, Math.ceil(result.count / input.limit)),
      },
    };
  }

  // Multiple sources have items — merge sort (each fetched with LIMIT/OFFSET
  // from their own source, so we merge and trim to page size). Cross-arm
  // exclusion clauses (`NOT IN purchases`, `NOT IN management orgs`, etc.)
  // already make arms disjoint at the DB layer, so summed counts are honest.
  // The dedup pass below preserves the priority contract defensively for
  // any future arm that forgets an exclusion clause.
  const totalCount = sources.reduce((sum, s) => sum + s.count, 0);
  const seen = new Set<string>();
  const dedupedItems: UserLibraryItem[] = [];
  for (const source of sources) {
    for (const item of source.items) {
      if (seen.has(item.content.id)) continue;
      seen.add(item.content.id);
      dedupedItems.push(item);
    }
  }

  if (input.sortBy === 'title') {
    dedupedItems.sort((a, b) => a.content.title.localeCompare(b.content.title));
  } else if (input.sortBy === 'duration') {
    dedupedItems.sort(
      (a, b) =>
        (b.content.durationSeconds ?? 0) - (a.content.durationSeconds ?? 0)
    );
  } else {
    dedupedItems.sort((a, b) => {
      const dateA = a.purchase?.purchasedAt ?? '';
      const dateB = b.purchase?.purchasedAt ?? '';
      return dateB.localeCompare(dateA);
    });
  }

  // Trim to page size (each source may have returned up to limit items)
  const items = dedupedItems.slice(0, input.limit);

  return {
    items,
    pagination: {
      page: input.page,
      limit: input.limit,
      total: totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / input.limit)),
    },
  };
}
