/**
 * Who is paid the organisation's part of a sale (Codex-2hxff.2;
 * docs/payments/connect-and-payouts.md → Organisation ownership).
 *
 * The organisation slice of any payment — one-off purchase, tier invoice or
 * course-subscription invoice — and the no-agreement creator pool
 * (`creator_payout_to_owner`) go to the organisation's OWNER AT THE TIME OF THE
 * SALE, not the owner when the webhook is processed. A webhook can arrive hours
 * late on a Stripe retry; asking "who owns it now?" then would pay a new owner
 * for a sale the previous owner made. `organization_ownership_periods` answers
 * the time question: the period with `started_at <= at AND (ended_at IS NULL OR
 * ended_at > at)`.
 *
 * `at` is the same instant the agreement resolver uses
 * (`findActiveCreatorAgreementShare`): the payment time for a purchase, the
 * invoice's `created` for a subscription. One clock, so which agreements apply
 * and who receives the organisation's part are decided together.
 *
 * Fallbacks, both logged as warnings because neither should happen:
 *   - `at` earlier than every period (a sale before the org's backfilled
 *     `created_at`) → the earliest period.
 *   - no periods at all (an org inserted outside `createOrganization`: an old
 *     seed, a test fixture) → the single active owner membership, which the
 *     `uq_org_memberships_one_active_owner` index makes unambiguous.
 *
 * Returns the payee even when they have no Connect account (`account`
 * undefined): the caller records a pending payout in that user's name, and
 * pending rows keep their `user_id` for life — an old owner's pending money
 * drains to the old owner. Returns undefined only when there is nobody to pay.
 *
 * The retired `organizations.primary_connect_account_user_id` pin is not read:
 * ownership decides, so the payee cannot drift from the owner.
 */

import type { DatabaseClient } from '@codex/database';
import {
  organizationMemberships,
  organizationOwnershipPeriods,
  stripeConnectAccounts,
} from '@codex/database/schema';
import { and, asc, desc, eq, gt, isNull, lte, or } from 'drizzle-orm';

type StripeConnectAccount = typeof stripeConnectAccounts.$inferSelect;

export interface OrganisationPayee {
  /** The owner at `at` — every organisation-side slice is paid to this user. */
  userId: string;
  /** That user's Connect account; undefined until they onboard. */
  account: StripeConnectAccount | undefined;
}

/** The subset of `ObservabilityClient` the fallbacks log through. */
interface PayeeLogger {
  warn(message: string, metadata?: Record<string, unknown>): void;
}

export async function resolveOrganisationPayee(
  db: DatabaseClient,
  orgId: string,
  at: Date = new Date(),
  log?: PayeeLogger
): Promise<OrganisationPayee | undefined> {
  const userId = await resolveOwnerAt(db, orgId, at, log);
  if (!userId) return undefined;

  const [account] = await db
    .select()
    .from(stripeConnectAccounts)
    .where(eq(stripeConnectAccounts.userId, userId))
    .limit(1);

  return { userId, account };
}

async function resolveOwnerAt(
  db: DatabaseClient,
  orgId: string,
  at: Date,
  log: PayeeLogger | undefined
): Promise<string | undefined> {
  const [covering] = await db
    .select({ userId: organizationOwnershipPeriods.userId })
    .from(organizationOwnershipPeriods)
    .where(
      and(
        eq(organizationOwnershipPeriods.organizationId, orgId),
        lte(organizationOwnershipPeriods.startedAt, at),
        or(
          isNull(organizationOwnershipPeriods.endedAt),
          gt(organizationOwnershipPeriods.endedAt, at)
        )
      )
    )
    // Periods never overlap (each transfer closes one and opens the next at
    // the same instant), so at most one row matches; the order only makes a
    // corrupted overlap resolve deterministically, to the later owner.
    .orderBy(desc(organizationOwnershipPeriods.startedAt))
    .limit(1);
  if (covering) return covering.userId;

  const [earliest] = await db
    .select({ userId: organizationOwnershipPeriods.userId })
    .from(organizationOwnershipPeriods)
    .where(eq(organizationOwnershipPeriods.organizationId, orgId))
    .orderBy(asc(organizationOwnershipPeriods.startedAt))
    .limit(1);
  if (earliest) {
    log?.warn('Sale predates every ownership period; paying the first owner', {
      organizationId: orgId,
      at: at.toISOString(),
    });
    return earliest.userId;
  }

  const [owner] = await db
    .select({ userId: organizationMemberships.userId })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, orgId),
        eq(organizationMemberships.role, 'owner'),
        // A removed owner keeps role='owner' with status='inactive'; they are
        // never paid on this path.
        eq(organizationMemberships.status, 'active')
      )
    )
    .limit(1);
  if (owner) {
    log?.warn(
      'Organisation has no ownership periods; paying the active owner',
      {
        organizationId: orgId,
      }
    );
  }
  return owner?.userId;
}
