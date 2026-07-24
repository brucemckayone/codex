/**
 * EntitlementsService — READ resolution of stored grants (Codex-2pryk.2.3 · WP-2).
 *
 * The registry-facing read surface over the `entitlements` grant table (SPEC
 * §6.2). It answers "does user U hold a live grant over resource R?" and lists a
 * user's live grants mapped back to the frozen
 * {@link import('@codex/shared-types').Entitlement} domain shape.
 *
 * READ-ONLY. The WRITE path (grant-on-purchase / grant-on-course-subscription /
 * manual grant) is WP-6 — this service never inserts. The access decision itself
 * (`canView` / `canEnterCourse`) lives on {@link ContentAccessService}, co-located
 * with `getStreamingUrl`; both this service and the resolver share the same pure
 * reads in `content-access/entitlements-resolver.ts`, so a grant reads identically
 * wherever it's consulted.
 *
 * The `entitlements` table is a SPLIT-FK (`contentId` / `courseId`, exactly one
 * set); this service maps `(contentId ?? courseId)` back to the domain
 * `{ resourceType, resourceId }` pair so callers never touch the split.
 */

import { toIso } from '@codex/database';
import { entitlements } from '@codex/database/schema';
import { BaseService } from '@codex/service-errors';
import type { Entitlement } from '@codex/shared-types';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import {
  hasCourseEntitlement,
  hasStoredContentEntitlement,
  resolveCourseEntitlementsBatch,
} from './content-access/entitlements-resolver';

/** Map a split-FK DB row to the frozen `Entitlement` domain shape. */
function toDomainEntitlement(
  row: typeof entitlements.$inferSelect
): Entitlement {
  const isCourse = row.courseId != null;
  return {
    id: row.id,
    userId: row.userId,
    organizationId: row.organizationId,
    resourceType: isCourse ? 'course' : 'content',
    // Split-FK CHECK guarantees exactly one of contentId/courseId is set.
    resourceId: (isCourse ? row.courseId : row.contentId) as string,
    source: row.source as Entitlement['source'],
    sourceRef: row.sourceRef,
    grantedAt: toIso(row.grantedAt),
    expiresAt: row.expiresAt ? toIso(row.expiresAt) : null,
    revokedAt: row.revokedAt ? toIso(row.revokedAt) : null,
  };
}

export class EntitlementsService extends BaseService {
  /**
   * Does the user hold a live STORED entitlement over this content
   * (`content_purchase` / `grant`)? Additive to `PurchaseService.verifyPurchase`
   * — the resolver unions them.
   */
  async hasContentEntitlement(
    userId: string,
    contentId: string
  ): Promise<boolean> {
    return hasStoredContentEntitlement(this.db, userId, contentId);
  }

  /**
   * Does the user hold ANY course entitlement — stored (purchase / course-sub /
   * grant) OR derived tier (active subscription ∩ `course_tier_access`)?
   */
  async hasCourseEntitlement(
    userId: string,
    courseId: string
  ): Promise<boolean> {
    return hasCourseEntitlement(this.db, userId, courseId);
  }

  /**
   * Batched course-entitlement resolution — the set of the requested course ids
   * the user may enter, in two `SELECT`s regardless of N (no N+1 on Neon HTTP).
   */
  async resolveCourseEntitlements(
    userId: string,
    courseIds: readonly string[]
  ): Promise<ReadonlySet<string>> {
    return resolveCourseEntitlementsBatch(this.db, userId, courseIds);
  }

  /**
   * List a user's LIVE stored grants (not revoked, not past expiry), optionally
   * scoped to one organization, mapped to the frozen domain shape. Backs WP-7
   * reporting and the library's course-entitlement arm. Derived tier grants are
   * NOT materialised, so they never appear here (SPEC §6.2 [H]).
   */
  async getUserEntitlements(
    userId: string,
    organizationId?: string
  ): Promise<Entitlement[]> {
    const now = new Date();
    const rows = await this.db.query.entitlements.findMany({
      where: and(
        eq(entitlements.userId, userId),
        organizationId
          ? eq(entitlements.organizationId, organizationId)
          : undefined,
        isNull(entitlements.revokedAt),
        or(isNull(entitlements.expiresAt), gt(entitlements.expiresAt, now))
      ),
    });
    return rows.map(toDomainEntitlement);
  }
}
