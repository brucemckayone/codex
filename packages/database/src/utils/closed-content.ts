/**
 * Which content is CLOSED to new viewers (Codex-2hxff.91, owner U11 and U13).
 *
 * Here, below every service package, because the public lists
 * (`@codex/content`) and the public counts beside them (`@codex/organization`:
 * creators' `contentCount`, the org stats; `@codex/content`: the active
 * topics) must apply the same test, and `@codex/content` depends on
 * `@codex/organization`, so neither can import the other's (review L7).
 */

import { PRICE_LIMITS } from '@codex/constants';
import { type SQL, sql } from 'drizzle-orm';
import { content, contentTierAccess } from '../schema/content';
import { subscriptionTiers } from '../schema/subscriptions';

/**
 * Hides a CLOSED item from public lists and counts (owner U11): behind the
 * switch, in no tier a new subscriber can join, and not on sale for a
 * one-time price. A priced closed item stays listed, as any paid item. Its own
 * page (by slug) still loads, to say "Not available right now". Every conjunct
 * is IS TRUE / COALESCE / EXISTS, so the whole test is never NULL (a NULL
 * inside NOT(…) would hide nothing).
 *
 * Only a tick on a live ACTIVE tier opens the item to new viewers (owner U13):
 * checkout and a change of tier both refuse an inactive or deleted tier. The
 * access decision and the library still read every tick, so the members of a
 * switched-off tier keep watching what it includes.
 *
 * The subquery names its columns as TEXT under its own aliases: the public list
 * runs this inside a relational `findMany`, which rewrites EVERY drizzle column
 * in its `where` to the root alias (`"content"."content_id"` would not exist).
 */
export function notClosedToNewViewers(): SQL {
  return sql`NOT (
    ${content.isTierGated} IS TRUE
    AND NOT (${content.isPurchasable} IS TRUE AND COALESCE(${content.priceCents}, 0) >= ${PRICE_LIMITS.MIN_CENTS})
    AND NOT EXISTS (
      SELECT 1 FROM ${contentTierAccess} cta
      INNER JOIN ${subscriptionTiers} st ON st.id = cta.tier_id
      WHERE cta.content_id = ${content.id}
        AND st.is_active IS TRUE
        AND st.deleted_at IS NULL
    )
  )`;
}
