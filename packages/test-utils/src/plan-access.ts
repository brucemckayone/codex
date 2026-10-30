/**
 * Plan access test helpers (Codex-2hxff.91).
 *
 * A content item is behind tiers when its `is_tier_gated` SWITCH is on; the
 * tiers that open it are its `content_tier_access` rows. These helpers write
 * both, plus the legacy `included_in_tier_id` the services dual-write, so a
 * fixture looks exactly like a row the services would have saved.
 */
import {
  content,
  contentTierAccess,
  subscriptionTiers,
} from '@codex/database/schema';
import { and, asc, eq, gte, inArray, isNull } from 'drizzle-orm';
import type { Database } from './database';

/**
 * Put content behind EXACTLY these tiers (a set: no tier implies another).
 * `tierIds: []` leaves it gated and CLOSED. Replaces any ticks it had.
 */
export async function gateContentToTiers(
  db: Database,
  opts: { contentId: string; organizationId: string; tierIds: string[] }
): Promise<void> {
  const { contentId, organizationId, tierIds } = opts;
  await db
    .delete(contentTierAccess)
    .where(eq(contentTierAccess.contentId, contentId));
  if (tierIds.length > 0) {
    await db
      .insert(contentTierAccess)
      .values(tierIds.map((tierId) => ({ contentId, tierId, organizationId })));
  }
  const lowest =
    tierIds.length > 0
      ? await db.query.subscriptionTiers.findFirst({
          where: inArray(subscriptionTiers.id, tierIds),
          orderBy: asc(subscriptionTiers.sortOrder),
          columns: { id: true },
        })
      : undefined;
  await db
    .update(content)
    .set({
      isTierGated: true,
      isFree: false,
      ...(lowest ? { legacyIncludedInTierId: lowest.id } : {}),
    })
    .where(eq(content.id, contentId));
}

/**
 * Put content behind `fromTierId` AND every live tier of the org at or above
 * it by `sortOrder`: the old ladder, as the migration backfilled it. For tests
 * that were written against "this tier and above". Returns the ticked ids.
 */
export async function gateContentFromTier(
  db: Database,
  opts: { contentId: string; organizationId: string; fromTierId: string }
): Promise<string[]> {
  const from = await db.query.subscriptionTiers.findFirst({
    where: eq(subscriptionTiers.id, opts.fromTierId),
    columns: { sortOrder: true },
  });
  if (!from) throw new Error(`gateContentFromTier: no tier ${opts.fromTierId}`);
  const tiers = await db
    .select({ id: subscriptionTiers.id })
    .from(subscriptionTiers)
    .where(
      and(
        eq(subscriptionTiers.organizationId, opts.organizationId),
        isNull(subscriptionTiers.deletedAt),
        gte(subscriptionTiers.sortOrder, from.sortOrder)
      )
    );
  const tierIds = tiers.map((t) => t.id);
  await gateContentToTiers(db, {
    contentId: opts.contentId,
    organizationId: opts.organizationId,
    tierIds,
  });
  return tierIds;
}
