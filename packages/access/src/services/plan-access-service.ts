/**
 * Plan access by ticks (Codex-2hxff.91): the studio's tier-contents service.
 *
 * - {@link PlanAccessService.getAccessSummary}: per-tier film and course
 *   counts, the guidance-note gaps, and the org's eligible / closed /
 *   ineligible film counts (the monetisation page, the create dialog, the
 *   checklist's filter counts).
 * - {@link PlanAccessService.getDeleteImpact}: what deleting a tier would
 *   leave only there (the delete dialog's preview; the delete recomputes).
 * - {@link PlanAccessService.listTierItems}: the checklist rows, paginated.
 * - {@link PlanAccessService.setTierItems}: the checklist's save, a capped,
 *   idempotent DELTA. One of the three writers of `content_tier_access` (the
 *   others: the content editor, `TierService` copy and delete).
 *
 * Studio-only and uncached: authoritative, like the course monetisation read.
 * Per-tier counts, closed items and gaps NEVER go on a public or cached route.
 * Every read and write is scoped to one organisation.
 */

import { CONTENT_STATUS, PRICE_LIMITS } from '@codex/constants';
import {
  type InvalidatePlanSubscriberLibrariesArgs,
  invalidatePlanSubscriberLibraries,
  syncLegacyIncludedInTierId,
} from '@codex/content';
import type { dbWs } from '@codex/database';
import {
  content,
  contentTierAccess,
  courses,
  courseTierAccess,
  subscriptions,
  subscriptionTiers,
} from '@codex/database/schema';
import {
  BaseService,
  NotFoundError,
  type ServiceConfig,
  ValidationError,
} from '@codex/service-errors';
import type { PaginatedListResponse } from '@codex/shared-types';
import type {
  PlanItemsDeltaInput,
  PlanItemsQueryInput,
} from '@codex/validation';
import { and, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm';
import { assertCreatorCanBePaid } from './course-payouts';

// ── Wire shapes (the contract is apps/web `api.ts`, Codex-2hxff.91 phase 1) ──

export type PlanItemKind = 'film' | 'course';

export interface PlanItemRef {
  kind: PlanItemKind;
  id: string;
  title: string;
}

export interface TierAccessGap {
  cheaperTierId: string;
  films: number;
  courses: number;
  /** The first ≤ 3 by title. */
  sampleItems: PlanItemRef[];
}

export interface TierAccessSummaryRow {
  tierId: string;
  films: number;
  courses: number;
  missingFromCheaper: TierAccessGap[];
}

export interface TierAccessSummary {
  tiers: TierAccessSummaryRow[];
  eligibleFilms: number;
  totalCourses: number;
  closedFilms: number;
  ineligibleFilms: number;
}

type ItemStatus = 'draft' | 'published' | 'archived';

export interface TierDeleteImpact {
  liveSubscriberCount: number;
  onlyHere: {
    films: {
      total: number;
      closing: number;
      staysForSale: number;
      items: Array<{
        id: string;
        title: string;
        status: ItemStatus;
        isPurchasable: boolean;
      }>;
    };
    courses: {
      total: number;
      items: Array<{ id: string; title: string; status: ItemStatus }>;
    };
  };
  alsoInOtherPlans: { films: number; courses: number };
}

export type PlanItemAccess =
  | 'subscribers'
  | 'paid'
  | 'free'
  | 'followers'
  | 'team'
  | 'course';

export interface PlanItemRow {
  kind: PlanItemKind;
  id: string;
  title: string;
  thumbnailUrl: string | null;
  status: ItemStatus;
  access: PlanItemAccess;
  eligible: boolean;
  included: boolean;
  otherTierIds: string[];
  durationSeconds: number | null;
  stageCount: number | null;
  priceCents: number | null;
}

export interface PlanItemsDeltaResult {
  films: number;
  courses: number;
  closedNow: { contentIds: string[] };
}

/** The delete preview names at most this many items of each kind. */
const DELETE_IMPACT_ITEMS_MAX = 50;
/** A gap names at most this many items. */
const GAP_SAMPLE_MAX = 3;

/** The WS client: the delta write is a multi-step transaction. */
type TxDb = typeof dbWs;
type Tx = Parameters<Parameters<TxDb['transaction']>[0]>[0];

export interface PlanAccessServiceConfig extends ServiceConfig {
  /** For the post-write catalogue + library bumps; absent → no bumps. */
  cache?: InvalidatePlanSubscriberLibrariesArgs['cache'];
  waitUntil?: InvalidatePlanSubscriberLibrariesArgs['waitUntil'];
}

/**
 * A film a tier can include: live, in this org, not course-only, team-only or
 * followers-only, and behind the tier switch or for sale. Free, followers and
 * team films are left out (owner U6: ticking one in a bulk list would take its
 * free access away silently).
 */
function eligibleFilm(orgId: string): SQL {
  return sql`${content.organizationId} = ${orgId}
    AND ${content.deletedAt} IS NULL
    AND ${content.courseOnly} IS NOT TRUE
    AND ${content.isTeamOnly} IS NOT TRUE
    AND ${content.isFollowerGated} IS NOT TRUE
    AND (${content.isTierGated} IS TRUE OR ${content.isPurchasable} IS TRUE)`;
}

/** On sale for a one-time price that would actually open it. */
function onSale(): SQL {
  return sql`(${content.isPurchasable} IS TRUE AND COALESCE(${content.priceCents}, 0) >= ${PRICE_LIMITS.MIN_CENTS})`;
}

const escapeLike = (raw: string): string =>
  raw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');

export class PlanAccessService extends BaseService {
  private readonly cache?: PlanAccessServiceConfig['cache'];
  private readonly waitUntil?: PlanAccessServiceConfig['waitUntil'];

  constructor(config: PlanAccessServiceConfig) {
    super(config);
    this.cache = config.cache;
    this.waitUntil = config.waitUntil;
  }

  private get txDb(): TxDb {
    return this.db as TxDb;
  }

  /** A live tier of this org, or `NotFoundError` (code `TIER_NOT_FOUND`). */
  private async liveTier(
    db: TxDb | Tx,
    orgId: string,
    tierId: string,
    lock?: 'share'
  ): Promise<{ id: string }> {
    const query = db
      .select({ id: subscriptionTiers.id })
      .from(subscriptionTiers)
      .where(
        and(
          eq(subscriptionTiers.id, tierId),
          eq(subscriptionTiers.organizationId, orgId),
          isNull(subscriptionTiers.deletedAt)
        )
      );
    const [tier] = lock ? await query.for(lock) : await query;
    if (!tier) {
      throw new NotFoundError('Subscription tier not found', {
        tierId,
        code: 'TIER_NOT_FOUND',
      });
    }
    return tier;
  }

  // ── Summary ────────────────────────────────────────────────────────────

  /**
   * Every live tier of the org (inactive included) with its live film and
   * course counts, and for each ACTIVE tier the gaps against each cheaper
   * ACTIVE tier (cheaper = a strictly lower monthly price): eligible live
   * items the cheaper tier includes and this one doesn't.
   */
  async getAccessSummary(orgId: string): Promise<TierAccessSummary> {
    try {
      const tiers = await this.db
        .select({
          id: subscriptionTiers.id,
          priceMonthly: subscriptionTiers.priceMonthly,
          isActive: subscriptionTiers.isActive,
        })
        .from(subscriptionTiers)
        .where(
          and(
            eq(subscriptionTiers.organizationId, orgId),
            isNull(subscriptionTiers.deletedAt)
          )
        )
        .orderBy(subscriptionTiers.sortOrder);

      const [filmTicks, courseTicks, counts] = await Promise.all([
        this.db
          .select({
            tierId: contentTierAccess.tierId,
            id: content.id,
            title: content.title,
          })
          .from(contentTierAccess)
          .innerJoin(content, eq(content.id, contentTierAccess.contentId))
          .where(
            and(
              eq(contentTierAccess.organizationId, orgId),
              eligibleFilm(orgId),
              eq(content.isTierGated, true)
            )
          ),
        this.db
          .select({
            tierId: courseTierAccess.tierId,
            id: courses.id,
            title: courses.title,
          })
          .from(courseTierAccess)
          .innerJoin(courses, eq(courses.id, courseTierAccess.courseId))
          .where(
            and(
              eq(courseTierAccess.organizationId, orgId),
              eq(courses.organizationId, orgId),
              isNull(courses.deletedAt)
            )
          ),
        this.db.execute<{
          eligible_films: number;
          total_courses: number;
          closed_films: number;
          ineligible_films: number;
        }>(sql`SELECT
          (SELECT count(*)::int FROM ${content} WHERE ${eligibleFilm(orgId)}) AS eligible_films,
          (SELECT count(*)::int FROM ${courses} WHERE ${courses.organizationId} = ${orgId} AND ${courses.deletedAt} IS NULL) AS total_courses,
          (SELECT count(*)::int FROM ${content}
            WHERE ${content.organizationId} = ${orgId} AND ${content.deletedAt} IS NULL
              AND ${content.isTierGated} IS TRUE AND NOT ${onSale()}
              AND NOT EXISTS (SELECT 1 FROM ${contentTierAccess} WHERE ${contentTierAccess.contentId} = ${content.id})) AS closed_films,
          (SELECT count(*)::int FROM ${content}
            WHERE ${content.organizationId} = ${orgId} AND ${content.deletedAt} IS NULL
              AND ${content.courseOnly} IS NOT TRUE
              AND NOT (${content.isTierGated} IS TRUE OR ${content.isPurchasable} IS TRUE)) AS ineligible_films`),
      ]);

      type Item = PlanItemRef;
      const byTier = new Map<string, Map<string, Item>>();
      const add = (tierId: string, item: Item) => {
        let set = byTier.get(tierId);
        if (!set) {
          set = new Map();
          byTier.set(tierId, set);
        }
        set.set(`${item.kind}:${item.id}`, item);
      };
      for (const r of filmTicks)
        add(r.tierId, { kind: 'film', id: r.id, title: r.title });
      for (const r of courseTicks)
        add(r.tierId, { kind: 'course', id: r.id, title: r.title });

      const countKind = (
        set: Map<string, Item> | undefined,
        kind: PlanItemKind
      ) => (set ? [...set.values()].filter((i) => i.kind === kind).length : 0);

      const active = tiers.filter((t) => t.isActive);
      const rows: TierAccessSummaryRow[] = tiers.map((tier) => {
        const mine = byTier.get(tier.id);
        const missingFromCheaper: TierAccessGap[] = [];
        if (tier.isActive) {
          for (const cheaper of active) {
            if (!(cheaper.priceMonthly < tier.priceMonthly)) continue;
            const theirs = byTier.get(cheaper.id);
            if (!theirs) continue;
            const missing = [...theirs.entries()]
              .filter(([key]) => !mine?.has(key))
              .map(([, item]) => item)
              .sort((a, b) => a.title.localeCompare(b.title));
            if (missing.length === 0) continue;
            missingFromCheaper.push({
              cheaperTierId: cheaper.id,
              films: missing.filter((i) => i.kind === 'film').length,
              courses: missing.filter((i) => i.kind === 'course').length,
              sampleItems: missing.slice(0, GAP_SAMPLE_MAX),
            });
          }
        }
        return {
          tierId: tier.id,
          films: countKind(mine, 'film'),
          courses: countKind(mine, 'course'),
          missingFromCheaper,
        };
      });

      const c = counts.rows[0];
      return {
        tiers: rows,
        eligibleFilms: Number(c?.eligible_films ?? 0),
        totalCourses: Number(c?.total_courses ?? 0),
        closedFilms: Number(c?.closed_films ?? 0),
        ineligibleFilms: Number(c?.ineligible_films ?? 0),
      };
    } catch (error) {
      this.handleError(error, 'getAccessSummary');
    }
  }

  // ── Delete impact ──────────────────────────────────────────────────────

  /**
   * What deleting `tierId` would leave ONLY there, its live subscriber count
   * (> 0 → the delete is refused), and what is also in another live tier.
   * A preview: `TierService.deleteTier` recomputes inside its transaction.
   */
  async getDeleteImpact(
    orgId: string,
    tierId: string
  ): Promise<TierDeleteImpact> {
    try {
      await this.liveTier(this.txDb, orgId, tierId);

      const inOtherLiveTier = (table: 'content' | 'course'): SQL =>
        table === 'content'
          ? sql`EXISTS (SELECT 1 FROM content_tier_access o
              INNER JOIN subscription_tiers ot ON ot.id = o.tier_id AND ot.deleted_at IS NULL
              WHERE o.content_id = ${content.id} AND o.tier_id <> ${tierId})`
          : sql`EXISTS (SELECT 1 FROM course_tier_access o
              INNER JOIN subscription_tiers ot ON ot.id = o.tier_id AND ot.deleted_at IS NULL
              WHERE o.course_id = ${courses.id} AND o.tier_id <> ${tierId})`;

      const [subs, films, courseRows] = await Promise.all([
        this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(subscriptions)
          .where(
            and(
              eq(subscriptions.tierId, tierId),
              sql`${subscriptions.status} NOT IN ('cancelled')`
            )
          ),
        this.db
          .select({
            id: content.id,
            title: content.title,
            status: content.status,
            isPurchasable: content.isPurchasable,
            staysForSale: sql<boolean>`${onSale()}`,
            elsewhere: sql<boolean>`${inOtherLiveTier('content')}`,
          })
          .from(contentTierAccess)
          .innerJoin(content, eq(content.id, contentTierAccess.contentId))
          .where(
            and(
              eq(contentTierAccess.tierId, tierId),
              eq(contentTierAccess.organizationId, orgId),
              isNull(content.deletedAt)
            )
          )
          .orderBy(content.title),
        this.db
          .select({
            id: courses.id,
            title: courses.title,
            status: courses.status,
            elsewhere: sql<boolean>`${inOtherLiveTier('course')}`,
          })
          .from(courseTierAccess)
          .innerJoin(courses, eq(courses.id, courseTierAccess.courseId))
          .where(
            and(
              eq(courseTierAccess.tierId, tierId),
              eq(courseTierAccess.organizationId, orgId),
              isNull(courses.deletedAt)
            )
          )
          .orderBy(courses.title),
      ]);

      const onlyFilms = films.filter((f) => !f.elsewhere);
      const onlyCourses = courseRows.filter((c) => !c.elsewhere);
      const staysForSale = onlyFilms.filter((f) => f.staysForSale).length;
      return {
        liveSubscriberCount: Number(subs[0]?.count ?? 0),
        onlyHere: {
          films: {
            total: onlyFilms.length,
            closing: onlyFilms.length - staysForSale,
            staysForSale,
            items: onlyFilms.slice(0, DELETE_IMPACT_ITEMS_MAX).map((f) => ({
              id: f.id,
              title: f.title,
              status: f.status as ItemStatus,
              isPurchasable: f.staysForSale,
            })),
          },
          courses: {
            total: onlyCourses.length,
            items: onlyCourses.slice(0, DELETE_IMPACT_ITEMS_MAX).map((c) => ({
              id: c.id,
              title: c.title,
              status: c.status as ItemStatus,
            })),
          },
        },
        alsoInOtherPlans: {
          films: films.length - onlyFilms.length,
          courses: courseRows.length - onlyCourses.length,
        },
      };
    } catch (error) {
      this.handleError(error, 'getDeleteImpact');
    }
  }

  // ── Checklist rows ─────────────────────────────────────────────────────

  /**
   * One page of "What's in {tier}": films first, then courses, each by title.
   * Eligible films and every live course; ineligible films (free, followers,
   * team) only in a SEARCH, as disabled rows, never in an unfiltered or
   * `included` list.
   */
  async listTierItems(
    orgId: string,
    tierId: string,
    query: PlanItemsQueryInput
  ): Promise<PaginatedListResponse<PlanItemRow>> {
    try {
      await this.liveTier(this.txDb, orgId, tierId);
      const { page, limit, kind, filter, cheaperTierId, search } = query;
      const offset = (page - 1) * limit;
      const showIneligible =
        !!search && (filter === 'all' || filter === 'excluded');
      const cheaper = cheaperTierId ?? null;

      const items = sql`
        SELECT 'film'::text AS kind, c.id, c.title, c.thumbnail_url,
               c.status,
               CASE WHEN c.is_purchasable THEN 'paid'
                    WHEN c.is_tier_gated THEN 'subscribers'
                    WHEN c.is_team_only THEN 'team'
                    WHEN c.is_follower_gated THEN 'followers'
                    ELSE 'free' END AS access,
               (c.is_team_only IS NOT TRUE AND c.is_follower_gated IS NOT TRUE
                 AND (c.is_tier_gated IS TRUE OR c.is_purchasable IS TRUE)) AS eligible,
               EXISTS (SELECT 1 FROM content_tier_access t
                        WHERE t.content_id = c.id AND t.tier_id = ${tierId}) AS included,
               EXISTS (SELECT 1 FROM content_tier_access t
                        WHERE t.content_id = c.id AND t.tier_id = ${cheaper}) AS in_cheaper,
               COALESCE((SELECT array_agg(t.tier_id::text ORDER BY st.sort_order)
                           FROM content_tier_access t
                           INNER JOIN subscription_tiers st ON st.id = t.tier_id AND st.deleted_at IS NULL
                          WHERE t.content_id = c.id AND t.tier_id <> ${tierId}), '{}') AS other_tier_ids,
               m.duration_seconds, NULL::int AS stage_count,
               CASE WHEN c.is_purchasable THEN c.price_cents END AS price_cents,
               0 AS kind_order
          FROM content c
          LEFT JOIN media_items m ON m.id = c.media_item_id
         WHERE c.organization_id = ${orgId} AND c.deleted_at IS NULL
           AND c.course_only IS NOT TRUE
        UNION ALL
        SELECT 'course'::text, co.id, co.title, NULL, co.status, 'course', TRUE,
               EXISTS (SELECT 1 FROM course_tier_access t
                        WHERE t.course_id = co.id AND t.tier_id = ${tierId}),
               EXISTS (SELECT 1 FROM course_tier_access t
                        WHERE t.course_id = co.id AND t.tier_id = ${cheaper}),
               COALESCE((SELECT array_agg(t.tier_id::text ORDER BY st.sort_order)
                           FROM course_tier_access t
                           INNER JOIN subscription_tiers st ON st.id = t.tier_id AND st.deleted_at IS NULL
                          WHERE t.course_id = co.id AND t.tier_id <> ${tierId}), '{}'),
               NULL::int,
               (SELECT count(*)::int FROM course_stages s
                 WHERE s.course_id = co.id AND s.deleted_at IS NULL),
               NULLIF(co.price_cents, 0),
               1
          FROM courses co
         WHERE co.organization_id = ${orgId} AND co.deleted_at IS NULL`;

      const conditions: SQL[] = [showIneligible ? sql`TRUE` : sql`i.eligible`];
      if (kind) conditions.push(sql`i.kind = ${kind}`);
      if (filter === 'included') conditions.push(sql`i.included`);
      if (filter === 'excluded') conditions.push(sql`NOT i.included`);
      if (filter === 'missing') {
        conditions.push(sql`i.in_cheaper AND NOT i.included AND i.eligible`);
      }
      if (search) {
        conditions.push(sql`i.title ILIKE ${`%${escapeLike(search)}%`}`);
      }
      const where = sql.join(conditions, sql` AND `);

      const [rows, total] = await Promise.all([
        this.db.execute<{
          kind: PlanItemKind;
          id: string;
          title: string;
          thumbnail_url: string | null;
          status: ItemStatus;
          access: PlanItemAccess;
          eligible: boolean;
          included: boolean;
          other_tier_ids: string[];
          duration_seconds: number | null;
          stage_count: number | null;
          price_cents: number | null;
        }>(sql`SELECT * FROM (${items}) i WHERE ${where}
               ORDER BY i.kind_order, lower(i.title), i.id
               LIMIT ${limit} OFFSET ${offset}`),
        this.db.execute<{ total: number }>(
          sql`SELECT count(*)::int AS total FROM (${items}) i WHERE ${where}`
        ),
      ]);

      const totalCount = Number(total.rows[0]?.total ?? 0);
      return {
        items: rows.rows.map((r) => ({
          kind: r.kind,
          id: r.id,
          title: r.title,
          thumbnailUrl: r.thumbnail_url,
          status: r.status,
          access: r.access,
          eligible: r.eligible,
          included: r.included,
          otherTierIds: r.other_tier_ids ?? [],
          durationSeconds:
            r.duration_seconds == null ? null : Number(r.duration_seconds),
          stageCount: r.stage_count == null ? null : Number(r.stage_count),
          priceCents: r.price_cents == null ? null : Number(r.price_cents),
        })),
        pagination: {
          page,
          limit,
          total: totalCount,
          totalPages: Math.ceil(totalCount / limit),
        },
      };
    } catch (error) {
      this.handleError(error, 'listTierItems');
    }
  }

  // ── Checklist save ─────────────────────────────────────────────────────

  /**
   * Add and remove films and courses for one tier, in one transaction. A
   * DELTA, so a resend lands the same state (add = insert-if-absent, remove =
   * delete). Refuses, writing nothing:
   * - an id that is not an eligible live item of this org (`ValidationError`
   *   naming them);
   * - an ADD of a PUBLISHED item whose creator can't be paid
   *   (`CreatorPayoutsRequiredError`), as the editor and the course panel do.
   *
   * Adding a paid film turns its tier switch on. Removing never touches the
   * switch: a subscribers-only film left in no tier is CLOSED (never free),
   * and is named in `closedNow`.
   */
  async setTierItems(
    orgId: string,
    tierId: string,
    delta: PlanItemsDeltaInput
  ): Promise<PlanItemsDeltaResult> {
    try {
      const contentIds = [
        ...new Set([...delta.add.contentIds, ...delta.remove.contentIds]),
      ];
      const courseIds = [
        ...new Set([...delta.add.courseIds, ...delta.remove.courseIds]),
      ];

      const result = await this.txDb.transaction(async (tx) => {
        await this.liveTier(tx, orgId, tierId, 'share');

        // Eligible films and live courses of THIS org only.
        const films =
          contentIds.length > 0
            ? await tx
                .select({
                  id: content.id,
                  creatorId: content.creatorId,
                  status: content.status,
                  isTierGated: content.isTierGated,
                })
                .from(content)
                .where(
                  and(inArray(content.id, contentIds), eligibleFilm(orgId))
                )
            : [];
        const courseRows =
          courseIds.length > 0
            ? await tx
                .select({
                  id: courses.id,
                  creatorId: courses.creatorId,
                  status: courses.status,
                })
                .from(courses)
                .where(
                  and(
                    inArray(courses.id, courseIds),
                    eq(courses.organizationId, orgId),
                    isNull(courses.deletedAt)
                  )
                )
            : [];
        if (
          films.length !== contentIds.length ||
          courseRows.length !== courseIds.length
        ) {
          const foundFilms = new Set(films.map((f) => f.id));
          const foundCourses = new Set(courseRows.map((c) => c.id));
          throw new ValidationError(
            'One or more items cannot be included in this tier',
            {
              invalidContentIds: contentIds.filter((id) => !foundFilms.has(id)),
              invalidCourseIds: courseIds.filter((id) => !foundCourses.has(id)),
            }
          );
        }

        // What is ADDED (not already ticked for this tier).
        const tickedFilms = new Set(
          delta.add.contentIds.length > 0
            ? (
                await tx
                  .select({ id: contentTierAccess.contentId })
                  .from(contentTierAccess)
                  .where(
                    and(
                      eq(contentTierAccess.tierId, tierId),
                      inArray(contentTierAccess.contentId, delta.add.contentIds)
                    )
                  )
              ).map((r) => r.id)
            : []
        );
        const tickedCourses = new Set(
          delta.add.courseIds.length > 0
            ? (
                await tx
                  .select({ id: courseTierAccess.courseId })
                  .from(courseTierAccess)
                  .where(
                    and(
                      eq(courseTierAccess.tierId, tierId),
                      inArray(courseTierAccess.courseId, delta.add.courseIds)
                    )
                  )
              ).map((r) => r.id)
            : []
        );
        const filmById = new Map(films.map((f) => [f.id, f]));
        const courseById = new Map(courseRows.map((c) => [c.id, c]));
        const addedFilms = delta.add.contentIds.filter(
          (id) => !tickedFilms.has(id)
        );
        const addedCourses = delta.add.courseIds.filter(
          (id) => !tickedCourses.has(id)
        );

        // Payouts: a PUBLISHED item added to a tier opens a way to pay. Each
        // distinct creator is checked once, by the course paths' own check.
        const creators = new Map<string, 'included_in_tier' | 'course'>();
        for (const id of addedFilms) {
          const f = filmById.get(id);
          if (f?.status === CONTENT_STATUS.PUBLISHED) {
            creators.set(f.creatorId, 'included_in_tier');
          }
        }
        for (const id of addedCourses) {
          const c = courseById.get(id);
          if (
            c?.status === CONTENT_STATUS.PUBLISHED &&
            !creators.has(c.creatorId)
          ) {
            creators.set(c.creatorId, 'course');
          }
        }
        for (const [creatorId, reason] of creators) {
          await assertCreatorCanBePaid(tx, creatorId, reason);
        }

        // Write.
        if (addedFilms.length > 0) {
          await tx
            .insert(contentTierAccess)
            .values(
              addedFilms.map((contentId) => ({
                contentId,
                tierId,
                organizationId: orgId,
              }))
            )
            .onConflictDoNothing();
          // A paid film added to a tier: its switch goes on (never free).
          await tx
            .update(content)
            .set({ isTierGated: true, isFree: false, updatedAt: new Date() })
            .where(
              and(
                inArray(content.id, addedFilms),
                eq(content.organizationId, orgId),
                eq(content.isTierGated, false)
              )
            );
        }
        if (delta.remove.contentIds.length > 0) {
          await tx
            .delete(contentTierAccess)
            .where(
              and(
                eq(contentTierAccess.tierId, tierId),
                eq(contentTierAccess.organizationId, orgId),
                inArray(contentTierAccess.contentId, delta.remove.contentIds)
              )
            );
        }
        if (addedCourses.length > 0) {
          await tx
            .insert(courseTierAccess)
            .values(
              addedCourses.map((courseId) => ({
                courseId,
                tierId,
                organizationId: orgId,
              }))
            )
            .onConflictDoNothing();
        }
        if (delta.remove.courseIds.length > 0) {
          await tx
            .delete(courseTierAccess)
            .where(
              and(
                eq(courseTierAccess.tierId, tierId),
                eq(courseTierAccess.organizationId, orgId),
                inArray(courseTierAccess.courseId, delta.remove.courseIds)
              )
            );
        }

        // The legacy dual-write for every touched film (phase 1-2).
        await syncLegacyIncludedInTierId(
          tx as unknown as Parameters<typeof syncLegacyIncludedInTierId>[0],
          [...addedFilms, ...delta.remove.contentIds]
        );

        // Subscribers-only films this request left in no tier: now closed.
        const closedNow =
          delta.remove.contentIds.length > 0
            ? (
                await tx
                  .select({ id: content.id })
                  .from(content)
                  .where(
                    and(
                      inArray(content.id, delta.remove.contentIds),
                      eq(content.isTierGated, true),
                      sql`NOT ${onSale()}`,
                      sql`NOT EXISTS (SELECT 1 FROM ${contentTierAccess} WHERE ${contentTierAccess.contentId} = ${content.id})`
                    )
                  )
              ).map((r) => r.id)
            : [];

        // The tier's new totals (live items).
        const [totals] = await tx
          .execute<{ films: number; courses: number }>(
            sql`SELECT
            (SELECT count(*)::int FROM ${contentTierAccess}
               INNER JOIN ${content} ON ${content.id} = ${contentTierAccess.contentId}
                AND ${content.deletedAt} IS NULL
              WHERE ${contentTierAccess.tierId} = ${tierId}) AS films,
            (SELECT count(*)::int FROM ${courseTierAccess}
               INNER JOIN ${courses} ON ${courses.id} = ${courseTierAccess.courseId}
                AND ${courses.deletedAt} IS NULL
              WHERE ${courseTierAccess.tierId} = ${tierId}) AS courses`
          )
          .then((r) => r.rows);

        return {
          films: Number(totals?.films ?? 0),
          courses: Number(totals?.courses ?? 0),
          closedNow: { contentIds: closedNow },
        };
      });

      await this.afterTierAccessChange(orgId, [tierId]);
      return result;
    } catch (error) {
      this.handleError(error, 'setTierItems');
    }
  }

  /**
   * After a tier's contents change (this service's save, a delete's move, a
   * create's copy): bump the org catalogue (the public list carries each
   * item's tiers) and the libraries of the tiers' live subscribers. Fire and
   * forget; a failure is logged, never thrown. `[]` → the catalogue only.
   */
  async afterTierAccessChange(orgId: string, tierIds: string[]): Promise<void> {
    if (!this.cache || !this.waitUntil) return;
    try {
      await invalidatePlanSubscriberLibraries({
        db: this.db as InvalidatePlanSubscriberLibrariesArgs['db'],
        cache: this.cache,
        waitUntil: this.waitUntil,
        organizationId: orgId,
        tierIds,
        reason: 'plan_access_changed',
        logger: this.obs,
      });
    } catch (error) {
      this.obs.warn('plan-access: invalidation failed', {
        organizationId: orgId,
        tierCount: tierIds.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
