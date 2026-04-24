/**
 * Stripe Customer integrity checks — Q4.4 (Codex-qsvxf)
 *
 * Belt-and-braces utilities that detect when two Codex users have ended up
 * pointing at the same Stripe Customer ID. The Q4.1 backfill validates
 * this at write-time (one user per Customer, but many users may be NULL),
 * and the partial unique index `idx_unique_users_stripe_customer_id`
 * enforces it at the DB level — but those are belt-only; this module is
 * the braces.
 *
 * Use cases:
 *   - Admin console: "detect and fix drifted Customer IDs".
 *   - One-off maintenance scripts post-backfill.
 *   - Pre-unifying-portal guard: a code path that wants to refuse to open
 *     a unified portal if it would expose another user's history.
 *
 * None of these are hot-path — the helpers are intentionally plain
 * Drizzle queries with no caching.
 *
 * @see Codex-cmhnv — the backfill script writes these.
 * @see Codex-49gev — resolveOrCreateCustomer guards the first write.
 * @see Codex-ssfes — Checkout Sessions now use `customer: <id>`.
 */

import type { Database, DatabaseWs } from '@codex/database';
import { users } from '@codex/database/schema';
import { eq, isNotNull, sql } from 'drizzle-orm';

export interface UserCustomerMatch {
  userId: string;
  email: string;
  stripeCustomerId: string;
}

/**
 * Return every Codex user pointing at the given Stripe Customer id.
 * Expected length is exactly 1; returns 0 when the id is unknown to
 * Codex and 2+ when drift has occurred. Caller decides how to respond.
 *
 * Does NOT filter on `deletedAt` — soft-deleted users still count for
 * the collision check (we don't want to grant a new user the portal of
 * a cancelled ghost). Callers that need only live rows should filter
 * the result.
 */
export async function findUsersByStripeCustomerId(
  db: Database | DatabaseWs,
  stripeCustomerId: string
): Promise<UserCustomerMatch[]> {
  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      stripeCustomerId: users.stripeCustomerId,
    })
    .from(users)
    .where(eq(users.stripeCustomerId, stripeCustomerId));

  return rows
    .filter(
      (r): r is UserCustomerMatch => typeof r.stripeCustomerId === 'string'
    )
    .map((r) => ({
      userId: r.userId,
      email: r.email,
      stripeCustomerId: r.stripeCustomerId,
    }));
}

export interface StripeCustomerCollision {
  stripeCustomerId: string;
  userIds: string[];
  count: number;
}

/**
 * Scan the users table for any `stripe_customer_id` shared by more
 * than one user. A clean database returns an empty array; this is the
 * expected state.
 *
 * The partial unique index on `users.stripe_customer_id WHERE NOT NULL`
 * (migration 0057) already prevents new collisions from landing — this
 * helper catches legacy rows that predated the index and gives operator
 * tooling something to surface. Sorted by count DESC so the worst
 * offenders are first.
 */
export async function findStripeCustomerCollisions(
  db: Database | DatabaseWs
): Promise<StripeCustomerCollision[]> {
  const rows = await db
    .select({
      stripeCustomerId: users.stripeCustomerId,
      userIds: sql<string[]>`array_agg(${users.id})`.as('user_ids'),
      count: sql<number>`count(*)::int`.as('count'),
    })
    .from(users)
    .where(isNotNull(users.stripeCustomerId))
    .groupBy(users.stripeCustomerId)
    .having(sql`count(*) > 1`);

  return rows
    .filter(
      (
        r
      ): r is {
        stripeCustomerId: string;
        userIds: string[];
        count: number;
      } => typeof r.stripeCustomerId === 'string'
    )
    .map((r) => ({
      stripeCustomerId: r.stripeCustomerId,
      userIds: r.userIds,
      count: r.count,
    }))
    .sort((a, b) => b.count - a.count);
}
