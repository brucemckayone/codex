/**
 * A creator removed from an organisation has everything of theirs there taken
 * off sale (owner decision 2026-10-21, Codex-2hxff.64;
 * docs/payments/agreements.md §Leaving an organisation):
 * - their published content and courses become `archived`, stamped with
 *   `off_sale_at` — every checkout refuses anything that is not `published`;
 * - each course's published landing pages move with it, keeping the rule that
 *   a course is published exactly when a page sells it.
 *
 * Buyers keep what they bought: purchase, entitlement and course grants
 * survive unpublication, and the course player opens anything released
 * (Codex-2hxff.65). Tier subscribers keep it until their next renewal, which
 * the access layer reads from `off_sale_at`. Drafts were never on sale and are
 * left alone. Runs in the removal's transaction, beside the membership change.
 */

import type { DatabaseClient } from '@codex/database';
import { content, courses, landingPages } from '@codex/database/schema';
import { and, eq, inArray, isNull } from 'drizzle-orm';

type Tx = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];

export interface WithdrawnCatalogue {
  contentIds: string[];
  courseIds: string[];
}

/** The creator's published content and courses in the organisation, archived at `at`. */
export async function withdrawCatalogueOnDeparture(
  tx: Tx | DatabaseClient,
  params: { organizationId: string; creatorId: string; at: Date }
): Promise<WithdrawnCatalogue> {
  const archivedContent = await tx
    .update(content)
    .set({ status: 'archived', offSaleAt: params.at, updatedAt: params.at })
    .where(
      and(
        eq(content.organizationId, params.organizationId),
        eq(content.creatorId, params.creatorId),
        eq(content.status, 'published'),
        isNull(content.deletedAt)
      )
    )
    .returning();

  const archivedCourses = await tx
    .update(courses)
    .set({ status: 'archived', offSaleAt: params.at, updatedAt: params.at })
    .where(
      and(
        eq(courses.organizationId, params.organizationId),
        eq(courses.creatorId, params.creatorId),
        eq(courses.status, 'published'),
        isNull(courses.deletedAt)
      )
    )
    .returning();

  const courseIds = archivedCourses.map((course) => course.id);
  if (courseIds.length > 0) {
    await tx
      .update(landingPages)
      .set({ status: 'archived', updatedAt: params.at })
      .where(
        and(
          eq(landingPages.organizationId, params.organizationId),
          eq(landingPages.subjectType, 'course'),
          inArray(landingPages.subjectId, courseIds),
          eq(landingPages.status, 'published'),
          isNull(landingPages.deletedAt)
        )
      );
  }

  return {
    contentIds: archivedContent.map((item) => item.id),
    courseIds,
  };
}
