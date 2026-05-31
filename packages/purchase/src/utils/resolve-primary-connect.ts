/**
 * Resolve the org's canonical Connect settlement account (Codex-69t7c).
 *
 * The org-fee slice of any payment (one-off purchase OR subscription invoice)
 * must route to a single, deterministic Connect account: the one owned by the
 * org's PRIMARY settlement user. That user is the explicitly pinned
 * `organizations.primary_connect_account_user_id` when set, otherwise the org
 * OWNER (the `organization_memberships` row with role 'owner' — the user who
 * onboards the org's account). Because a user has exactly ONE Connect account
 * (`stripe_connect_accounts` is unique on `user_id`), resolution is:
 * org → primary-or-owner user id → that user's single account.
 *
 * The account's own `organization_id` is NOT consulted — it is a nullable,
 * vestigial onboarding-origin field (WP1). The owner fallback is DETERMINISTIC
 * (role='owner'), unlike the prior arbitrary `.limit(1)` over that org column
 * which Codex-sec7i set out to eliminate. The pin still wins when present, so
 * an org can route to a non-owner once onboarding/admin sets it.
 *
 * Returns undefined when the org has no resolvable primary/owner user, or that
 * user has not onboarded a Connect account yet.
 */

import type { DatabaseClient } from '@codex/database';
import {
  organizationMemberships,
  organizations,
  stripeConnectAccounts,
} from '@codex/database/schema';
import { and, eq } from 'drizzle-orm';

type StripeConnectAccount = typeof stripeConnectAccounts.$inferSelect;

export async function resolvePrimaryConnect(
  db: DatabaseClient,
  orgId: string
): Promise<StripeConnectAccount | undefined> {
  const [org] = await db
    .select({
      primaryConnectAccountUserId: organizations.primaryConnectAccountUserId,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  // Prefer the explicit pin; until onboarding sets it, fall back to the org
  // owner (deterministic — never an arbitrary member).
  let targetUserId = org?.primaryConnectAccountUserId ?? null;
  if (!targetUserId) {
    const [owner] = await db
      .select({ userId: organizationMemberships.userId })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, orgId),
          eq(organizationMemberships.role, 'owner')
        )
      )
      .limit(1);
    targetUserId = owner?.userId ?? null;
  }

  if (!targetUserId) return undefined;

  const [account] = await db
    .select()
    .from(stripeConnectAccounts)
    .where(eq(stripeConnectAccounts.userId, targetUserId))
    .limit(1);

  return account;
}
