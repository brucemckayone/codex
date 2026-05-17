/**
 * Resolve the org's canonical Connect settlement account (Codex-sec7i).
 *
 * The org-fee slice of any payment (one-off purchase OR subscription
 * invoice) must route to a single, deterministic Connect account. That
 * account is pinned by `organizations.primary_connect_account_user_id`.
 *
 * Multi-creator orgs commonly have multiple `stripe_connect_accounts`
 * rows scoped to the same `organizationId` — one per creator who
 * onboarded a personal Connect for their own earnings. Without the
 * primary pin, a bare `.limit(1)` lookup over `(organizationId)` was
 * picking an arbitrary member, routing org slices to random creator
 * accounts.
 *
 * Returns null when the org has no Connect account at all. The
 * fallback `.limit(1)` only fires for legacy orgs whose
 * `primary_connect_account_user_id` has not been backfilled — fresh
 * orgs populate it at onboarding so that branch shrinks to zero over
 * time.
 */

import type { DatabaseClient } from '@codex/database';
import { organizations, stripeConnectAccounts } from '@codex/database/schema';
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

  if (org?.primaryConnectAccountUserId) {
    const [pinned] = await db
      .select()
      .from(stripeConnectAccounts)
      .where(
        and(
          eq(stripeConnectAccounts.organizationId, orgId),
          eq(stripeConnectAccounts.userId, org.primaryConnectAccountUserId)
        )
      )
      .limit(1);
    if (pinned) return pinned;
  }

  const [fallback] = await db
    .select()
    .from(stripeConnectAccounts)
    .where(eq(stripeConnectAccounts.organizationId, orgId))
    .limit(1);
  return fallback;
}
