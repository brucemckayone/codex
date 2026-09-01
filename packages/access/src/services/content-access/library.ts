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
  courseStages,
  courses,
  mediaItems,
  organizationFollowers,
  organizationMemberships,
  organizations,
  purchases,
  stagePractices,
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
 * User library item with content, access type, purchase, and progress
 * information.
 *
 * Declared as a `type` alias, NOT an `interface`, and it must stay one.
 * Consumers such as the web app's `LibraryPageView` accept a loose
 * `{ [key: string]: unknown; content: { id: string } }` shape, and TypeScript
 * only infers the implicit index signature that makes that assignment legal for
 * object type ALIASES — an interface is open to declaration merging, so it never
 * gets one. Converting this back to an interface breaks those call sites with a
 * confusing "index signature is missing" error far from the change.
 */
export type UserLibraryItem = {
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
  /**
   * The portal(s) this practice sits inside, resolved through
   * `stage_practices → course_stages → courses`. Empty when the practice
   * stands alone.
   *
   * Deliberately SEPARATE from `accessType`. Provenance ("this lives inside
   * the Descent portal") and access route ("you can open it because you're a
   * member") are orthogonal facts, and a member needs both: the same practice
   * can be reachable via membership AND belong to a portal. Folding a
   * `course:` variant into `accessType` — which is what the frontend's badge
   * helper originally anticipated — would have made the two mutually
   * exclusive and silently dropped the access route.
   *
   * Ordered by title so the rendered badge is stable across requests.
   */
  journeys: Array<{ id: string; title: string; slug: string }>;
};

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

  // ── Shared cross-arm exclusion: "not already acquired by purchase" ──
  //
  // Every non-purchase arm excludes content the user has bought (or is
  // mid-buying) so `queryPurchased` stays the single owner of those rows and
  // the accessType tag is never wrong. Both `completed` (webhook landed) and
  // `pending` (Stripe redirect beat the webhook) count as "already owned".
  //
  // MUST be NOT EXISTS, never `id NOT IN (SELECT content_id ...)`.
  // `purchases.content_id` is NULL for COURSE purchases (those rows carry
  // `course_id` instead), so the NOT IN form returned a NULL from its
  // subquery, and SQL's three-valued logic collapses
  // `x NOT IN (NULL)` → `NOT (x = NULL)` → `NULL` → not TRUE — filtering out
  // EVERY row. One journey purchase therefore blanked the entire library
  // across the membership, subscription, free, and followers arms at once.
  // The correlated NOT EXISTS below is null-safe: a NULL `content_id` simply
  // never equals `content.id`, so it matches nothing and the row survives.
  const notAcquiredByPurchase = sql`NOT EXISTS (
    SELECT 1 FROM ${purchases}
    WHERE ${purchases.customerId} = ${userId}
      AND ${purchases.contentId} = ${content.id}
      AND ${purchases.status} IN (${PURCHASE_STATUS.COMPLETED}, ${PURCHASE_STATUS.PENDING})
  )`;

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
      // Populated by `attachJourneyProvenance` once the page is final — one
      // lookup for the page beats one per arm.
      journeys: [],
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
      // Cross-arm exclusion — see `notAcquiredByPurchase`. Without it a
      // mid-flight purchase leaks into membership with the wrong accessType.
      notAcquiredByPurchase,
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
      // Populated by `attachJourneyProvenance` once the page is final — one
      // lookup for the page beats one per arm.
      journeys: [],
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
          isNull(content.includedInTierId),
          // includedInTierId's sortOrder must be <= user's subscription tier sortOrder
          sql`${content.includedInTierId} IN (
            SELECT ${subscriptionTiers.id} FROM ${subscriptionTiers}
            WHERE ${subscriptionTiers.sortOrder} <= ${tierSortOrder}
              AND ${subscriptionTiers.organizationId} = ${sub.organizationId}
              AND ${subscriptionTiers.deletedAt} IS NULL
          )`
        )
      );
    });

    const conditions = [
      // Content a subscription grants access to = anything TIER-GATED
      // (`includedInTierId` set). The former `accessType='subscribers'` tag and
      // tier-gated paid content (`accessType='paid'` + a tier) BOTH carry a
      // tier, so the single flag captures exactly the old union. Paid content
      // WITHOUT a tier is still gated behind purchase — never appears here.
      // Per-org tier-sortOrder check below (subConditions) decides whether this
      // user's tier is high enough for any given item.
      sql`${content.includedInTierId} IS NOT NULL`,
      eq(content.status, CONTENT_STATUS.PUBLISHED),
      isNull(content.deletedAt),
      // Must belong to one of the user's subscribed orgs (with tier check)
      or(...subConditions)!,
      // Cross-arm exclusion — see `notAcquiredByPurchase`. Matters most in
      // this arm: paid + tier-gated content qualifies for BOTH it and the
      // purchased arm (see 1b6f14a0), so without the exclusion a mid-flight
      // purchase surfaces with the wrong accessType until the webhook lands.
      notAcquiredByPurchase,
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
      // Populated by `attachJourneyProvenance` once the page is final — one
      // lookup for the page beats one per arm.
      journeys: [],
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
  //
  // THE PERIOD BOUND IS A PARAMETER, NOT `NOW()`, AND THE REASON IS NOT STYLE.
  // Hyperdrive decides whether a query may be cached by TEXT-MATCHING it for
  // non-deterministic function names — it does not parse SQL to do so, and
  // Cloudflare's changelog notes that even a mention inside a SQL COMMENT marks
  // the whole query uncacheable. This is the library read path, so it is the query
  // that most wants caching, and it was the ONLY site in packages/ or workers/
  // that tripped the rule (swept for NOW / CURRENT_TIMESTAMP / CURRENT_DATE /
  // LOCALTIMESTAMP, in predicates and in SQL comments alike).
  //
  // The semantic difference is one clock and sub-second: Postgres would evaluate
  // `NOW()` per statement from the database's clock, this evaluates once per
  // request from the worker's. For "is this subscription period still open" that is
  // immaterial — periods run in days — but it is stated because a future predicate
  // where it is NOT immaterial must not copy the pattern blindly.
  //
  // Correct on the current neon-http driver too, so it does not wait for
  // Hyperdrive (Codex-s1i7h).
  const asOf = new Date();

  const relationshipPredicate = or(
    sql`EXISTS (SELECT 1 FROM ${organizationFollowers}
                WHERE ${organizationFollowers.organizationId} = ${content.organizationId}
                  AND ${organizationFollowers.userId} = ${userId})`,
    sql`EXISTS (SELECT 1 FROM ${subscriptions}
                WHERE ${subscriptions.userId} = ${userId}
                  AND ${subscriptions.organizationId} = ${content.organizationId}
                  AND ${subscriptions.status} IN (${SUBSCRIPTION_STATUS.ACTIVE}, ${SUBSCRIPTION_STATUS.CANCELLING})
                  AND ${subscriptions.currentPeriodEnd} > ${asOf})`
  );

  const buildRelationshipQuery = async (
    bucketAccessType:
      | typeof CONTENT_ACCESS_TYPE.FREE
      | typeof CONTENT_ACCESS_TYPE.FOLLOWERS,
    tag: 'free' | 'followers'
  ) => {
    const conditions = [
      bucketAccessType === CONTENT_ACCESS_TYPE.FREE
        ? eq(content.isFree, true)
        : eq(content.isFollowerGated, true),
      eq(content.status, CONTENT_STATUS.PUBLISHED),
      isNull(content.deletedAt),
      sql`${content.organizationId} IS NOT NULL`,
      relationshipPredicate!,
      // Cross-arm exclusion — see `notAcquiredByPurchase`. Defensive here:
      // free/followers items shouldn't be priced, but a flag-flip
      // (paid → free) could create overlap. Keeps the priority contract
      // explicit rather than relying on the flags staying clean.
      notAcquiredByPurchase,
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
      // Populated by `attachJourneyProvenance` once the page is final — one
      // lookup for the page beats one per arm.
      journeys: [],
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

  // ── Step 5b: Portal provenance for the FINAL page ────────────────
  //
  // Runs once, on the page that is actually being returned, rather than
  // per-arm: five arms each fetch up to `limit` rows but at most `limit`
  // survive the merge, so joining provenance inside every arm would do up to
  // 5x the work and throw most of it away. One `IN (page ids)` lookup instead.
  //
  // A practice can appear in several portals (`stage_practices` is keyed
  // `(stage_id, content_id)` and a portal has many stages), so this collects
  // ALL of them rather than assuming one. Deleted stages and deleted portals
  // are filtered out — an archived portal must not keep branding a practice.
  const attachJourneyProvenance = async (
    pageItems: UserLibraryItem[]
  ): Promise<UserLibraryItem[]> => {
    if (pageItems.length === 0) return pageItems;

    const contentIds = pageItems.map((i) => i.content.id);
    const rows = await db
      .selectDistinct({
        contentId: stagePractices.contentId,
        courseId: courses.id,
        courseTitle: courses.title,
        courseSlug: courses.slug,
      })
      .from(stagePractices)
      .innerJoin(
        courseStages,
        and(
          eq(courseStages.id, stagePractices.stageId),
          isNull(courseStages.deletedAt)
        )
      )
      .innerJoin(
        courses,
        and(eq(courses.id, courseStages.courseId), isNull(courses.deletedAt))
      )
      .where(inArray(stagePractices.contentId, contentIds));

    if (rows.length === 0) return pageItems;

    const byContentId = new Map<string, UserLibraryItem['journeys']>();
    for (const row of rows) {
      const list = byContentId.get(row.contentId);
      const entry = {
        id: row.courseId,
        title: row.courseTitle,
        slug: row.courseSlug,
      };
      if (list) list.push(entry);
      else byContentId.set(row.contentId, [entry]);
    }
    for (const list of byContentId.values()) {
      list.sort((a, b) => a.title.localeCompare(b.title));
    }

    return pageItems.map((item) => {
      const journeys = byContentId.get(item.content.id);
      return journeys ? { ...item, journeys } : item;
    });
  };

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
      items: await attachJourneyProvenance(result.items),
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
  const items = await attachJourneyProvenance(
    dedupedItems.slice(0, input.limit)
  );

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
