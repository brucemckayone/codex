/**
 * Organisation ownership transfer (Codex-2hxff.2; docs/payments/
 * connect-and-payouts.md → Organisation ownership).
 *
 * An organisation has exactly one owner. Only the owner can hand it on: they
 * offer it to an active admin or creator, who accepts or declines within 7
 * days. Platform support can also assign a new owner. These functions are the
 * data side of that; `OrganizationService` exposes them and sends the emails.
 *
 * Two tables move together on every change of owner, in one transaction:
 *   - `organization_memberships.role` — who may ACT as owner (authorisation);
 *   - `organization_ownership_periods` — who is PAID as owner, and from when
 *     (`resolveOrganisationPayee` reads it at each sale's own time).
 *
 * Ordering inside a change is fixed by `uq_org_memberships_one_active_owner`,
 * which Postgres checks per statement: demote the old owner first, THEN promote
 * the new one.
 *
 * Expiry is lazy (no cron): every entry point first marks this organisation's
 * open offers that are past `expires_at` as 'expired', so a stale open row
 * never blocks the one-open-offer index.
 */

import { isUniqueViolation } from '@codex/database';
import {
  type OwnershipOfferStatus,
  type OwnershipOfferWithdrawnReason,
  organizationMemberships,
  organizationOwnershipOffers,
  organizationOwnershipPeriods,
  organizations,
  payouts,
  stripeConnectAccounts,
  users,
} from '@codex/database/schema';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '@codex/service-errors';
import { and, desc, eq, gt, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import {
  IneligibleOwnershipRecipientError,
  NotOrganisationOwnerError,
  OwnershipConfirmationMismatchError,
  OwnershipOfferNotOpenError,
} from '../errors';
import type { Database } from '../types';

/** An offer stays open for 7 days. */
export const OWNERSHIP_OFFER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Ownership can be offered to (and reassigned to) these roles only. */
const RECIPIENT_ROLES = ['admin', 'creator'] as const;

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Offer = typeof organizationOwnershipOffers.$inferSelect;

export type OwnershipViewerRole = 'owner' | 'admin' | 'creator';

/** `GET /ownership`, minus the agreement fields the route composes in. */
export interface OwnershipViewCore {
  owner: {
    userId: string;
    name: string;
    avatarUrl: string | null;
    ownerSince: string;
    payoutsReady: boolean;
  };
  viewerRole: OwnershipViewerRole;
  openOffer: {
    id: string;
    /** `payoutsReady`: their Connect account can be paid (state 6's prompt). */
    recipient: { userId: string; name: string; payoutsReady: boolean };
    offeredBy: { userId: string; name: string };
    offeredAt: string;
    expiresAt: string;
  } | null;
  lastOutcome?: {
    status: Exclude<OwnershipOfferStatus, 'open'>;
    recipientName: string;
    at: string;
    withdrawnReason: OwnershipOfferWithdrawnReason | null;
  } | null;
  eligibleRecipients?: Array<{
    userId: string;
    name: string;
    role: 'admin' | 'creator';
    joinedAt: string;
    payoutsReady: boolean;
  }>;
}

/** The result of a change of owner. */
export interface OwnershipChange {
  ownerUserId: string;
  ownerSince: string;
  previousOwnerUserId: string | null;
  /**
   * The money held while the organisation had no owner, handed to the new
   * owner by this change (Codex-2hxff.37). Zero for an ordinary transfer.
   */
  heldPayoutsReleased: { count: number; amountCents: number };
}

export interface OwnershipOfferDto {
  id: string;
  organizationId: string;
  offeredByUserId: string;
  recipientUserId: string;
  status: OwnershipOfferStatus;
  withdrawnReason: OwnershipOfferWithdrawnReason | null;
  expiresAt: string;
  respondedAt: string | null;
  createdAt: string;
}

// The status and reason columns are varchar; `check_ownership_offer_status`
// and `check_ownership_offer_withdrawn_reason` hold them to these unions.
const asStatus = (status: string) => status as OwnershipOfferStatus;
const asReason = (reason: string | null) =>
  reason as OwnershipOfferWithdrawnReason | null;

export function toOfferDto(offer: Offer): OwnershipOfferDto {
  return {
    id: offer.id,
    organizationId: offer.organizationId,
    offeredByUserId: offer.offeredByUserId,
    recipientUserId: offer.recipientUserId,
    status: asStatus(offer.status),
    withdrawnReason: asReason(offer.withdrawnReason),
    expiresAt: offer.expiresAt.toISOString(),
    respondedAt: offer.respondedAt?.toISOString() ?? null,
    createdAt: offer.createdAt.toISOString(),
  };
}

function isRecipientRole(
  role: string
): role is (typeof RECIPIENT_ROLES)[number] {
  return (RECIPIENT_ROLES as readonly string[]).includes(role);
}

// ─── Lazy expiry ───────────────────────────────────────────────────────────

/** Mark this organisation's open offers past `expires_at` as 'expired'. */
export async function expireStaleOwnershipOffers(
  db: Database | Tx,
  organizationId: string,
  now: Date
): Promise<void> {
  await db
    .update(organizationOwnershipOffers)
    .set({ status: 'expired', respondedAt: now, updatedAt: now })
    .where(
      and(
        eq(organizationOwnershipOffers.organizationId, organizationId),
        eq(organizationOwnershipOffers.status, 'open'),
        lte(organizationOwnershipOffers.expiresAt, now)
      )
    );
}

// ─── Reads ─────────────────────────────────────────────────────────────────

/** The caller's open, unexpired offer for this organisation (the Studio banner). */
export async function getPendingOwnershipOffer(
  db: Database,
  organizationId: string,
  userId: string,
  now: Date
): Promise<{
  offerId: string;
  offeredByName: string;
  expiresAt: string;
} | null> {
  const [row] = await db
    .select({
      offerId: organizationOwnershipOffers.id,
      offeredByName: users.name,
      expiresAt: organizationOwnershipOffers.expiresAt,
    })
    .from(organizationOwnershipOffers)
    .innerJoin(users, eq(users.id, organizationOwnershipOffers.offeredByUserId))
    .where(
      and(
        eq(organizationOwnershipOffers.organizationId, organizationId),
        eq(organizationOwnershipOffers.recipientUserId, userId),
        eq(organizationOwnershipOffers.status, 'open'),
        // A read on every Studio load: filter, rather than write the expiry.
        gt(organizationOwnershipOffers.expiresAt, now)
      )
    )
    .limit(1);
  return row
    ? {
        offerId: row.offerId,
        offeredByName: row.offeredByName,
        expiresAt: row.expiresAt.toISOString(),
      }
    : null;
}

/**
 * The ownership view. Any active owner, admin or creator may read it; fields
 * are trimmed to what the viewer may see (owner-only management fields; the
 * open offer only for the owner and its recipient).
 */
export async function getOwnershipView(
  db: Database,
  organizationId: string,
  viewerId: string,
  now: Date
): Promise<OwnershipViewCore> {
  await expireStaleOwnershipOffers(db, organizationId, now);

  const [viewer] = await db
    .select({ role: organizationMemberships.role })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, viewerId),
        eq(organizationMemberships.status, 'active')
      )
    )
    .limit(1);
  if (!viewer || (viewer.role !== 'owner' && !isRecipientRole(viewer.role))) {
    throw new ForbiddenError(
      'Only the team can see who owns this organisation',
      {
        organizationId,
      }
    );
  }
  const viewerRole = viewer.role as OwnershipViewerRole;

  const [owner] = await db
    .select({
      userId: organizationMemberships.userId,
      joinedAt: organizationMemberships.createdAt,
      name: users.name,
      avatarUrl: users.avatarUrl,
      image: users.image,
      chargesEnabled: stripeConnectAccounts.chargesEnabled,
      payoutsEnabled: stripeConnectAccounts.payoutsEnabled,
    })
    .from(organizationMemberships)
    .innerJoin(users, eq(users.id, organizationMemberships.userId))
    .leftJoin(
      stripeConnectAccounts,
      eq(stripeConnectAccounts.userId, organizationMemberships.userId)
    )
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.role, 'owner'),
        eq(organizationMemberships.status, 'active')
      )
    )
    .limit(1);
  if (!owner) {
    throw new NotFoundError('This organisation has no owner', {
      organizationId,
    });
  }

  const [period] = await db
    .select({ startedAt: organizationOwnershipPeriods.startedAt })
    .from(organizationOwnershipPeriods)
    .where(
      and(
        eq(organizationOwnershipPeriods.organizationId, organizationId),
        isNull(organizationOwnershipPeriods.endedAt)
      )
    )
    .limit(1);

  const isOwner = viewerRole === 'owner';
  const openOffer = await loadOpenOffer(db, organizationId);
  const view: OwnershipViewCore = {
    owner: {
      userId: owner.userId,
      name: owner.name,
      avatarUrl: owner.avatarUrl ?? owner.image ?? null,
      ownerSince: (period?.startedAt ?? owner.joinedAt).toISOString(),
      payoutsReady: Boolean(owner.chargesEnabled && owner.payoutsEnabled),
    },
    viewerRole,
    openOffer:
      openOffer && (isOwner || openOffer.recipient.userId === viewerId)
        ? openOffer
        : null,
  };
  if (!isOwner) return view;

  view.lastOutcome = await loadLastOutcome(db, organizationId, owner.userId);
  view.eligibleRecipients = await loadEligibleRecipients(
    db,
    organizationId,
    owner.userId
  );
  return view;
}

async function loadOpenOffer(
  db: Database,
  organizationId: string
): Promise<OwnershipViewCore['openOffer']> {
  const [offer] = await db
    .select()
    .from(organizationOwnershipOffers)
    .where(
      and(
        eq(organizationOwnershipOffers.organizationId, organizationId),
        eq(organizationOwnershipOffers.status, 'open')
      )
    )
    .limit(1);
  if (!offer) return null;
  const names = await loadNames(db, [
    offer.recipientUserId,
    offer.offeredByUserId,
  ]);
  const [connect] = await db
    .select({
      chargesEnabled: stripeConnectAccounts.chargesEnabled,
      payoutsEnabled: stripeConnectAccounts.payoutsEnabled,
    })
    .from(stripeConnectAccounts)
    .where(eq(stripeConnectAccounts.userId, offer.recipientUserId))
    .limit(1);
  return {
    id: offer.id,
    recipient: {
      userId: offer.recipientUserId,
      name: names.get(offer.recipientUserId) ?? '',
      payoutsReady: Boolean(connect?.chargesEnabled && connect.payoutsEnabled),
    },
    offeredBy: {
      userId: offer.offeredByUserId,
      name: names.get(offer.offeredByUserId) ?? '',
    },
    offeredAt: offer.createdAt.toISOString(),
    expiresAt: offer.expiresAt.toISOString(),
  };
}

/**
 * The newest closed offer the CURRENT owner made — "your offer expired /
 * was declined". Another owner's offers (one that was accepted, or withdrawn
 * by a support reassignment) are not this owner's news.
 */
async function loadLastOutcome(
  db: Database,
  organizationId: string,
  ownerUserId: string
): Promise<OwnershipViewCore['lastOutcome']> {
  const [offer] = await db
    .select({
      status: organizationOwnershipOffers.status,
      respondedAt: organizationOwnershipOffers.respondedAt,
      updatedAt: organizationOwnershipOffers.updatedAt,
      withdrawnReason: organizationOwnershipOffers.withdrawnReason,
      recipientName: users.name,
    })
    .from(organizationOwnershipOffers)
    .innerJoin(users, eq(users.id, organizationOwnershipOffers.recipientUserId))
    .where(
      and(
        eq(organizationOwnershipOffers.organizationId, organizationId),
        eq(organizationOwnershipOffers.offeredByUserId, ownerUserId),
        ne(organizationOwnershipOffers.status, 'open')
      )
    )
    .orderBy(desc(organizationOwnershipOffers.updatedAt))
    .limit(1);
  if (!offer) return null;
  return {
    // `ne(status, 'open')` above.
    status: asStatus(offer.status) as Exclude<OwnershipOfferStatus, 'open'>,
    recipientName: offer.recipientName,
    at: (offer.respondedAt ?? offer.updatedAt).toISOString(),
    withdrawnReason: asReason(offer.withdrawnReason),
  };
}

async function loadEligibleRecipients(
  db: Database,
  organizationId: string,
  ownerUserId: string
): Promise<NonNullable<OwnershipViewCore['eligibleRecipients']>> {
  const rows = await db
    .select({
      userId: organizationMemberships.userId,
      role: organizationMemberships.role,
      joinedAt: organizationMemberships.createdAt,
      name: users.name,
      chargesEnabled: stripeConnectAccounts.chargesEnabled,
      payoutsEnabled: stripeConnectAccounts.payoutsEnabled,
    })
    .from(organizationMemberships)
    .innerJoin(users, eq(users.id, organizationMemberships.userId))
    .leftJoin(
      stripeConnectAccounts,
      eq(stripeConnectAccounts.userId, organizationMemberships.userId)
    )
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.status, 'active'),
        inArray(organizationMemberships.role, [...RECIPIENT_ROLES]),
        ne(organizationMemberships.userId, ownerUserId)
      )
    )
    .orderBy(organizationMemberships.createdAt);
  return rows.flatMap((row) =>
    isRecipientRole(row.role)
      ? [
          {
            userId: row.userId,
            name: row.name,
            role: row.role,
            joinedAt: row.joinedAt.toISOString(),
            payoutsReady: Boolean(row.chargesEnabled && row.payoutsEnabled),
          },
        ]
      : []
  );
}

async function loadNames(
  db: Database | Tx,
  userIds: string[]
): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, userIds));
  return new Map(rows.map((r) => [r.id, r.name]));
}

// ─── Offer lifecycle ───────────────────────────────────────────────────────

/** Lock and return the caller's active owner membership, or refuse. */
async function lockOwnerMembership(
  tx: Tx,
  organizationId: string,
  userId: string
) {
  const [membership] = await tx
    .select()
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, userId),
        eq(organizationMemberships.role, 'owner'),
        eq(organizationMemberships.status, 'active')
      )
    )
    .for('update');
  if (!membership) {
    throw new NotOrganisationOwnerError({ organizationId });
  }
  return membership;
}

/** Lock and return an active admin/creator membership, or null. */
async function lockEligibleRecipient(
  tx: Tx,
  organizationId: string,
  userId: string
) {
  const [membership] = await tx
    .select()
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, userId),
        eq(organizationMemberships.status, 'active'),
        inArray(organizationMemberships.role, [...RECIPIENT_ROLES])
      )
    )
    .for('update');
  return membership ?? null;
}

async function lockOffer(tx: Tx, organizationId: string, offerId: string) {
  const [offer] = await tx
    .select()
    .from(organizationOwnershipOffers)
    .where(
      and(
        eq(organizationOwnershipOffers.id, offerId),
        eq(organizationOwnershipOffers.organizationId, organizationId)
      )
    )
    .for('update');
  if (!offer) {
    throw new NotFoundError('Ownership offer not found', {
      organizationId,
      offerId,
    });
  }
  return offer;
}

function assertOpen(offer: Offer, now: Date): void {
  if (offer.status !== 'open' || offer.expiresAt <= now) {
    throw new OwnershipOfferNotOpenError({
      offerId: offer.id,
      status: offer.expiresAt <= now ? 'expired' : offer.status,
    });
  }
}

/**
 * The owner offers ownership. `confirmName` must match the organisation's name
 * (trimmed, case-insensitive). One open offer at a time.
 */
export async function createOwnershipOffer(
  db: Database,
  input: {
    organizationId: string;
    ownerUserId: string;
    recipientUserId: string;
    confirmName: string;
  },
  now: Date
): Promise<Offer> {
  const { organizationId, ownerUserId, recipientUserId } = input;
  await expireStaleOwnershipOffers(db, organizationId, now);

  try {
    return await db.transaction(async (tx) => {
      await lockOwnerMembership(tx, organizationId, ownerUserId);

      const [org] = await tx
        .select({ name: organizations.name })
        .from(organizations)
        .where(
          and(
            eq(organizations.id, organizationId),
            isNull(organizations.deletedAt)
          )
        )
        .limit(1);
      if (!org) {
        throw new NotFoundError('Organization not found', { organizationId });
      }
      if (
        input.confirmName.trim().toLowerCase() !== org.name.trim().toLowerCase()
      ) {
        throw new OwnershipConfirmationMismatchError();
      }

      if (recipientUserId === ownerUserId) {
        throw new IneligibleOwnershipRecipientError({ organizationId });
      }
      const recipient = await lockEligibleRecipient(
        tx,
        organizationId,
        recipientUserId
      );
      if (!recipient) {
        throw new IneligibleOwnershipRecipientError({ organizationId });
      }

      const [offer] = await tx
        .insert(organizationOwnershipOffers)
        .values({
          organizationId,
          offeredByUserId: ownerUserId,
          recipientUserId,
          status: 'open',
          expiresAt: new Date(now.getTime() + OWNERSHIP_OFFER_TTL_MS),
        })
        .returning();
      if (!offer) {
        throw new ConflictError('Could not create the ownership offer', {
          organizationId,
        });
      }
      return offer;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError('An ownership offer is already open', {
        organizationId,
      });
    }
    throw error;
  }
}

/** The owner withdraws their open offer. */
export async function withdrawOwnershipOffer(
  db: Database,
  input: { organizationId: string; offerId: string; ownerUserId: string },
  now: Date
): Promise<Offer> {
  const { organizationId, offerId, ownerUserId } = input;
  await expireStaleOwnershipOffers(db, organizationId, now);

  return await db.transaction(async (tx) => {
    await lockOwnerMembership(tx, organizationId, ownerUserId);
    const offer = await lockOffer(tx, organizationId, offerId);
    assertOpen(offer, now);
    return await closeOffer(tx, offer.id, now, {
      status: 'withdrawn',
      withdrawnReason: 'owner_cancelled',
    });
  });
}

/** The recipient declines. */
export async function declineOwnershipOffer(
  db: Database,
  input: { organizationId: string; offerId: string; recipientUserId: string },
  now: Date
): Promise<Offer> {
  const { organizationId, offerId, recipientUserId } = input;
  await expireStaleOwnershipOffers(db, organizationId, now);

  return await db.transaction(async (tx) => {
    const offer = await lockOffer(tx, organizationId, offerId);
    if (offer.recipientUserId !== recipientUserId) {
      throw new ForbiddenError('This offer was made to someone else', {
        offerId,
      });
    }
    assertOpen(offer, now);
    return await closeOffer(tx, offer.id, now, {
      status: 'declined',
      withdrawnReason: null,
    });
  });
}

/**
 * The recipient accepts (data-design §7). On success they are the owner, the
 * previous owner is an admin, and the ownership period has moved at one
 * instant. If either party is no longer eligible the offer is withdrawn
 * (`recipient_ineligible`) and the call refused.
 */
export async function acceptOwnershipOffer(
  db: Database,
  input: { organizationId: string; offerId: string; recipientUserId: string },
  now: Date
): Promise<OwnershipChange> {
  const { organizationId, offerId, recipientUserId } = input;
  await expireStaleOwnershipOffers(db, organizationId, now);

  const outcome = await db.transaction(async (tx) => {
    const offer = await lockOffer(tx, organizationId, offerId);
    if (offer.recipientUserId !== recipientUserId) {
      throw new ForbiddenError('This offer was made to someone else', {
        offerId,
      });
    }
    assertOpen(offer, now);

    const [offerer] = await tx
      .select()
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.userId, offer.offeredByUserId),
          eq(organizationMemberships.role, 'owner'),
          eq(organizationMemberships.status, 'active')
        )
      )
      .for('update');
    const recipient = await lockEligibleRecipient(
      tx,
      organizationId,
      recipientUserId
    );
    // A throw here would roll back the withdrawal too, so report it and let
    // the caller withdraw in a transaction of its own.
    if (!offerer || !recipient) return { ineligible: true as const };

    const change = await moveOwnership(tx, {
      organizationId,
      fromUserId: offerer.userId,
      toUserId: recipientUserId,
      source: 'transfer',
      offerId: offer.id,
      now,
    });
    await closeOffer(tx, offer.id, now, {
      status: 'accepted',
      withdrawnReason: null,
    });
    return { ineligible: false as const, change };
  });

  if (outcome.ineligible) {
    await db
      .update(organizationOwnershipOffers)
      .set({
        status: 'withdrawn',
        withdrawnReason: 'recipient_ineligible',
        respondedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(organizationOwnershipOffers.id, offerId),
          eq(organizationOwnershipOffers.status, 'open')
        )
      );
    throw new OwnershipOfferNotOpenError({
      offerId,
      status: 'withdrawn',
      withdrawnReason: 'recipient_ineligible',
    });
  }
  return outcome.change;
}

/**
 * Platform support assigns a new owner (admin-api). Any open offer is
 * withdrawn (`support_reassigned`); the new owner must be an active admin or
 * creator. Returns the withdrawn offer, if there was one.
 */
export async function reassignOrganisationOwner(
  db: Database,
  input: { organizationId: string; newOwnerUserId: string },
  now: Date
): Promise<{ change: OwnershipChange; withdrawnOffer: Offer | null }> {
  const { organizationId, newOwnerUserId } = input;
  await expireStaleOwnershipOffers(db, organizationId, now);

  return await db.transaction(async (tx) => {
    const [currentOwner] = await tx
      .select()
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.role, 'owner'),
          eq(organizationMemberships.status, 'active')
        )
      )
      .for('update');
    if (currentOwner?.userId === newOwnerUserId) {
      throw new IneligibleOwnershipRecipientError({ organizationId });
    }
    const recipient = await lockEligibleRecipient(
      tx,
      organizationId,
      newOwnerUserId
    );
    if (!recipient) {
      throw new IneligibleOwnershipRecipientError({ organizationId });
    }

    const [openOffer] = await tx
      .select()
      .from(organizationOwnershipOffers)
      .where(
        and(
          eq(organizationOwnershipOffers.organizationId, organizationId),
          eq(organizationOwnershipOffers.status, 'open')
        )
      )
      .for('update');
    const withdrawnOffer = openOffer
      ? await closeOffer(tx, openOffer.id, now, {
          status: 'withdrawn',
          withdrawnReason: 'support_reassigned',
        })
      : null;

    const change = await moveOwnership(tx, {
      organizationId,
      fromUserId: currentOwner?.userId ?? null,
      toUserId: newOwnerUserId,
      source: 'support',
      offerId: null,
      now,
    });
    return { change, withdrawnOffer };
  });
}

/**
 * Withdraw the open offer made to `userId`, because they stopped being an
 * admin or creator (removed, or their role changed). Runs inside the caller's
 * transaction so the change and the withdrawal commit together. Returns the
 * withdrawn offer so the owner can be told.
 */
export async function withdrawOfferForIneligibleRecipient(
  tx: Tx,
  organizationId: string,
  userId: string,
  now: Date
): Promise<Offer | null> {
  const [offer] = await tx
    .update(organizationOwnershipOffers)
    .set({
      status: 'withdrawn',
      withdrawnReason: 'recipient_ineligible',
      respondedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(organizationOwnershipOffers.organizationId, organizationId),
        eq(organizationOwnershipOffers.recipientUserId, userId),
        eq(organizationOwnershipOffers.status, 'open')
      )
    )
    .returning();
  return offer ?? null;
}

async function closeOffer(
  tx: Tx,
  offerId: string,
  now: Date,
  outcome: {
    status: 'accepted' | 'declined' | 'withdrawn';
    withdrawnReason: OwnershipOfferWithdrawnReason | null;
  }
): Promise<Offer> {
  const [offer] = await tx
    .update(organizationOwnershipOffers)
    .set({
      status: outcome.status,
      withdrawnReason: outcome.withdrawnReason,
      respondedAt: now,
      updatedAt: now,
    })
    .where(eq(organizationOwnershipOffers.id, offerId))
    .returning();
  if (!offer) {
    throw new NotFoundError('Ownership offer not found', { offerId });
  }
  return offer;
}

/**
 * Move ownership at one instant `now`: demote, then promote (the one-owner
 * index is checked per statement), then close the open period and open the
 * new one.
 */
async function moveOwnership(
  tx: Tx,
  args: {
    organizationId: string;
    fromUserId: string | null;
    toUserId: string;
    source: 'transfer' | 'support';
    offerId: string | null;
    now: Date;
  }
): Promise<OwnershipChange> {
  const { organizationId, fromUserId, toUserId, source, offerId, now } = args;

  if (fromUserId) {
    await tx
      .update(organizationMemberships)
      .set({ role: 'admin', updatedAt: now })
      .where(
        and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.userId, fromUserId)
        )
      );
  }
  await tx
    .update(organizationMemberships)
    .set({ role: 'owner', updatedAt: now })
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, toUserId)
      )
    );

  const closed = await tx
    .update(organizationOwnershipPeriods)
    .set({ endedAt: now })
    .where(
      and(
        eq(organizationOwnershipPeriods.organizationId, organizationId),
        isNull(organizationOwnershipPeriods.endedAt)
      )
    )
    // Bare `.returning()`: the `Database | DatabaseWs` union collapses the
    // projected overload; only the row count matters here.
    .returning();
  if (closed.length === 0 && fromUserId) {
    // An organisation inserted outside `createOrganization` has no periods.
    // Record the previous owner's tenure first, so sales before `now` still
    // resolve to them rather than to the new owner.
    await tx.insert(organizationOwnershipPeriods).values({
      organizationId,
      userId: fromUserId,
      startedAt: sql`(SELECT ${organizations.createdAt} FROM ${organizations} WHERE ${organizations.id} = ${organizationId})`,
      endedAt: now,
      source: 'backfill',
    });
  }
  await tx.insert(organizationOwnershipPeriods).values({
    organizationId,
    userId: toUserId,
    startedAt: now,
    source,
    offerId,
  });

  // Money the organisation earned while it had no owner is held as pending
  // `no_owner` rows with no payee; it goes to the next owner (owner decision
  // 2026-10-18, Codex-2hxff.37). Handed over in this transaction, so it moves
  // exactly when ownership does. As ordinary pending rows in their name, the
  // drains pay them once the new owner's payouts are set up — the hourly sweep
  // at the latest. Rows earned under a previous OWNER never match: they
  // already name that owner, whose money it stays.
  const released = await tx
    .update(payouts)
    .set({ userId: toUserId, reason: 'connect_not_ready', updatedAt: now })
    .where(
      and(
        eq(payouts.organizationId, organizationId),
        isNull(payouts.userId),
        eq(payouts.reason, 'no_owner'),
        eq(payouts.status, 'pending')
      )
    )
    // Bare `.returning()`: the `Database | DatabaseWs` union collapses the
    // projected overload.
    .returning();

  return {
    ownerUserId: toUserId,
    ownerSince: now.toISOString(),
    previousOwnerUserId: fromUserId,
    heldPayoutsReleased: {
      count: released.length,
      amountCents: released.reduce((sum, row) => sum + row.amountCents, 0),
    },
  };
}
