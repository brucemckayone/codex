/**
 * Plan access by ticks (Codex-2hxff.91): the content side of
 * `content_tier_access`.
 *
 * `content.is_tier_gated` is the GATE (the subscribers-only switch); the rows
 * of `content_tier_access` say WHICH tiers open it. Gated with no tick is
 * CLOSED (buyers, granted users, course owners and the team only), never
 * free. This file is the content editor's only writer of the ticks; the other
 * two writers are `TierService` (copy on create, sweep on delete) and
 * `PlanAccessService` (the tier checklist).
 *
 * Phase 1-2 also keeps the legacy `included_in_tier_id` column in step
 * (`syncLegacyIncludedInTierId`), so an old web or a rolled-back worker reads
 * a value that is never looser than the ticks.
 */
import { PRICE_LIMITS } from '@codex/constants';
import type { DatabaseClient } from '@codex/database';
import {
  content,
  contentTierAccess,
  subscriptionTiers,
} from '@codex/database/schema';
import { ValidationError } from '@codex/service-errors';
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  notInArray,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { DatabaseTransaction } from '../types';

/** Client-facing: the ids in the error context are the caller's own. */
export const TIERS_NOT_IN_ORG_MESSAGE =
  'One or more tiers do not exist in this organisation';

/** The item's ticked tier ids, by tier `sortOrder`. */
export async function readTickIds(
  tx: DatabaseTransaction,
  contentId: string
): Promise<string[]> {
  const rows = await tx
    .select({ tierId: contentTierAccess.tierId })
    .from(contentTierAccess)
    .innerJoin(
      subscriptionTiers,
      eq(subscriptionTiers.id, contentTierAccess.tierId)
    )
    .where(eq(contentTierAccess.contentId, contentId))
    .orderBy(asc(subscriptionTiers.sortOrder));
  return rows.map((r) => r.tierId);
}

/**
 * The old studio's single "this tier and above" pick, as ticks: every live
 * tier of the org at or above it by `sortOrder`, inactive tiers included —
 * exactly what the ladder meant. Refuses a tier that is not a live tier of
 * this org (the old path never checked).
 */
export async function expandLegacyTier(
  tx: DatabaseTransaction,
  organizationId: string,
  legacyTierId: string
): Promise<string[]> {
  const [from] = await tx
    .select({ sortOrder: subscriptionTiers.sortOrder })
    .from(subscriptionTiers)
    .where(
      and(
        eq(subscriptionTiers.id, legacyTierId),
        eq(subscriptionTiers.organizationId, organizationId),
        isNull(subscriptionTiers.deletedAt)
      )
    )
    .limit(1);
  if (!from) {
    throw new ValidationError(TIERS_NOT_IN_ORG_MESSAGE, {
      invalidTierIds: [legacyTierId],
    });
  }
  const rows = await tx
    .select({ id: subscriptionTiers.id })
    .from(subscriptionTiers)
    .where(
      and(
        eq(subscriptionTiers.organizationId, organizationId),
        isNull(subscriptionTiers.deletedAt),
        gte(subscriptionTiers.sortOrder, from.sortOrder)
      )
    )
    .orderBy(asc(subscriptionTiers.sortOrder));
  return rows.map((r) => r.id);
}

/**
 * Every id must be a LIVE tier of this org. `FOR SHARE` serialises with a
 * concurrent `deleteTier` (which locks the tier `FOR UPDATE`): it waits, and
 * READ COMMITTED then re-reads `deleted_at` and refuses the deleted tier.
 *
 * @throws {ValidationError} naming the ids that are not
 */
export async function assertTiersInOrg(
  tx: DatabaseTransaction,
  organizationId: string,
  tierIds: string[]
): Promise<void> {
  const unique = [...new Set(tierIds)];
  if (unique.length === 0) return;
  const rows = await tx
    .select({ id: subscriptionTiers.id })
    .from(subscriptionTiers)
    .where(
      and(
        inArray(subscriptionTiers.id, unique),
        eq(subscriptionTiers.organizationId, organizationId),
        isNull(subscriptionTiers.deletedAt)
      )
    )
    .for('share');
  if (rows.length === unique.length) return;
  const found = new Set(rows.map((r) => r.id));
  throw new ValidationError(TIERS_NOT_IN_ORG_MESSAGE, {
    invalidTierIds: unique.filter((id) => !found.has(id)),
  });
}

/** Make the item's ticks EXACTLY `tierIds` (a total set; `[]` empties them). */
export async function replaceTicks(
  tx: DatabaseTransaction,
  contentId: string,
  organizationId: string,
  tierIds: string[]
): Promise<void> {
  const unique = [...new Set(tierIds)];
  await tx
    .delete(contentTierAccess)
    .where(
      unique.length > 0
        ? and(
            eq(contentTierAccess.contentId, contentId),
            notInArray(contentTierAccess.tierId, unique)
          )
        : eq(contentTierAccess.contentId, contentId)
    );
  if (unique.length === 0) return;
  await tx
    .insert(contentTierAccess)
    .values(unique.map((tierId) => ({ contentId, tierId, organizationId })))
    .onConflictDoNothing();
}

/** Remove every tick of the item (the switch is going off: I1). */
export async function clearTicks(
  tx: DatabaseTransaction,
  contentId: string
): Promise<void> {
  await tx
    .delete(contentTierAccess)
    .where(eq(contentTierAccess.contentId, contentId));
}

/**
 * The legacy dual-write (phase 1-2), in the same transaction as any tick or
 * switch write:
 * - switch off → NULL;
 * - switch on with ticks → the ticked tier with the lowest `sort_order`
 *   (exact for a ladder, a superset for a bundle);
 * - switch on with NO tick (closed) → KEEP the current value. Under old code
 *   a NULL means FREE (Codex-2hxff.90), so a closed item is never nulled.
 */
export async function syncLegacyIncludedInTierId(
  tx: DatabaseTransaction,
  contentIds: string[]
): Promise<void> {
  const ids = [...new Set(contentIds)];
  if (ids.length === 0) return;
  await tx
    .update(content)
    .set({
      legacyIncludedInTierId: sql`(SELECT ${contentTierAccess.tierId} FROM ${contentTierAccess} INNER JOIN ${subscriptionTiers} ON ${subscriptionTiers.id} = ${contentTierAccess.tierId} WHERE ${contentTierAccess.contentId} = ${content.id} ORDER BY ${subscriptionTiers.sortOrder} LIMIT 1)`,
    })
    .where(
      and(
        inArray(content.id, ids),
        eq(content.isTierGated, true),
        sql`EXISTS (SELECT 1 FROM ${contentTierAccess} WHERE ${contentTierAccess.contentId} = ${content.id})`
      )
    );
  await tx
    .update(content)
    .set({ legacyIncludedInTierId: null })
    .where(and(inArray(content.id, ids), eq(content.isTierGated, false)));
}

/**
 * Tier ids per content id, by tier `sortOrder`, for the reads. Inactive tiers
 * are included (their subscribers must still see "Included"); a deleted tier
 * has no ticks (its delete sweeps them), and the join refuses one anyway.
 */
export async function loadIncludedTierIds(
  db: DatabaseClient,
  contentIds: string[]
): Promise<Map<string, string[]>> {
  const byContent = new Map<string, string[]>();
  const ids = [...new Set(contentIds)];
  if (ids.length === 0) return byContent;
  const rows = await db
    .select({
      contentId: contentTierAccess.contentId,
      tierId: contentTierAccess.tierId,
    })
    .from(contentTierAccess)
    .innerJoin(
      subscriptionTiers,
      eq(subscriptionTiers.id, contentTierAccess.tierId)
    )
    .where(
      and(
        inArray(contentTierAccess.contentId, ids),
        isNull(subscriptionTiers.deletedAt)
      )
    )
    .orderBy(asc(subscriptionTiers.sortOrder));
  for (const row of rows) {
    const list = byContent.get(row.contentId);
    if (list) list.push(row.tierId);
    else byContent.set(row.contentId, [row.tierId]);
  }
  return byContent;
}

/**
 * What every content read adds to a row on the wire (design §4.1):
 * - `includedInTierIds`, the set (`[]` when not gated);
 * - `includedInTierId`, the PHASE 1-2 SHIM: the legacy column under its old
 *   wire name, for a web older than the plan-access release. New code must
 *   read the set and `isTierGated`. Removed in the cleanup release.
 */
export interface ContentTierWire {
  includedInTierIds: string[];
  /** @deprecated Phase 1-2 wire shim for the old web; read `includedInTierIds`. */
  includedInTierId: string | null;
}

/** The wire fields for one row, from its loaded ticks. */
export function tierWire(
  row: { isTierGated: boolean; legacyIncludedInTierId: string | null },
  tierIds: string[] | undefined
): ContentTierWire {
  return {
    includedInTierIds: row.isTierGated ? (tierIds ?? []) : [],
    includedInTierId: row.legacyIncludedInTierId,
  };
}

/** {@link tierWire} for a page of rows, in one query. */
export async function withTierWire<
  T extends {
    id: string;
    isTierGated: boolean;
    legacyIncludedInTierId: string | null;
  },
>(db: DatabaseClient, rows: T[]): Promise<Array<T & ContentTierWire>> {
  const byContent = await loadIncludedTierIds(
    db,
    rows.filter((r) => r.isTierGated).map((r) => r.id)
  );
  return rows.map((row) => ({
    ...row,
    ...tierWire(row, byContent.get(row.id)),
  }));
}

/**
 * Hides a CLOSED item from public lists (owner U11): behind the switch, in no
 * tier, and not on sale for a one-time price. A priced closed item stays
 * listed, as any paid item. Its own page (by slug) still loads, to say "Not
 * available right now". Every conjunct is IS TRUE / COALESCE / EXISTS, so the
 * whole test is never NULL (a NULL inside NOT(…) would hide nothing).
 *
 * The subquery names its columns as TEXT under its own alias: the public list
 * runs this inside a relational `findMany`, which rewrites EVERY drizzle column
 * in its `where` to the root alias (`"content"."content_id"` would not exist).
 */
export function notClosedToNewViewers(): SQL {
  return sql`NOT (
    ${content.isTierGated} IS TRUE
    AND NOT (${content.isPurchasable} IS TRUE AND COALESCE(${content.priceCents}, 0) >= ${PRICE_LIMITS.MIN_CENTS})
    AND NOT EXISTS (SELECT 1 FROM ${contentTierAccess} cta WHERE cta.content_id = ${content.id})
  )`;
}

/** Does this item have at least one tick (for the publish rule)? */
export async function hasAnyTick(
  tx: DatabaseTransaction,
  contentId: string
): Promise<boolean> {
  const [row] = await tx
    .select({ one: sql<number>`1` })
    .from(contentTierAccess)
    .innerJoin(
      subscriptionTiers,
      eq(subscriptionTiers.id, contentTierAccess.tierId)
    )
    .where(
      and(
        eq(contentTierAccess.contentId, contentId),
        isNull(subscriptionTiers.deletedAt)
      )
    )
    .limit(1);
  return !!row;
}
