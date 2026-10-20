/**
 * Organisation ownership — who owns an organisation, and since when
 * (Codex-2hxff.2; docs/payments/connect-and-payouts.md → Organisation
 * ownership).
 *
 * - The OWNER is the membership row with `role='owner'`, at most one active per
 *   organisation (`uq_org_memberships_one_active_owner`, on
 *   `organization_memberships`). That row is the AUTHORISATION truth.
 * - `organization_ownership_periods` is the MONEY truth by time: a sale is paid
 *   to whoever owned the organisation at the sale's own time, however late its
 *   webhook arrives. Both are written in the same transaction.
 * - `organization_ownership_offers` is the offer-and-accept transfer, and its
 *   audit trail. Rows are never deleted.
 */

import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { users } from './users';

/** 'open' → 'accepted' | 'declined' | 'withdrawn' | 'expired'. */
export const OWNERSHIP_OFFER_STATUSES = [
  'open',
  'accepted',
  'declined',
  'withdrawn',
  'expired',
] as const;
export type OwnershipOfferStatus = (typeof OWNERSHIP_OFFER_STATUSES)[number];

/** Why an offer was withdrawn — set iff `status = 'withdrawn'`. */
export const OWNERSHIP_OFFER_WITHDRAWN_REASONS = [
  'owner_cancelled',
  'recipient_ineligible',
  'support_reassigned',
] as const;
export type OwnershipOfferWithdrawnReason =
  (typeof OWNERSHIP_OFFER_WITHDRAWN_REASONS)[number];

/** How an ownership period began. */
export const OWNERSHIP_PERIOD_SOURCES = [
  'created',
  'transfer',
  'support',
  'backfill',
] as const;
export type OwnershipPeriodSource = (typeof OWNERSHIP_PERIOD_SOURCES)[number];

export const organizationOwnershipOffers = pgTable(
  'organization_ownership_offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** The owner at the time of the offer. */
    offeredByUserId: text('offered_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    recipientUserId: text('recipient_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 16 }).notNull(),
    withdrawnReason: varchar('withdrawn_reason', { length: 32 }),
    /** created_at + 7 days. Expiry is lazy: the next read marks it 'expired'. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Set on every terminal status. */
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // One open offer per organisation at a time.
    uniqueIndex('uq_ownership_offers_one_open')
      .on(table.organizationId)
      .where(sql`${table.status} = 'open'`),
    // The recipient's banner lookup.
    index('idx_ownership_offers_recipient_open')
      .on(table.recipientUserId)
      .where(sql`${table.status} = 'open'`),
    check(
      'check_ownership_offer_status',
      sql`${table.status} IN ('open', 'accepted', 'declined', 'withdrawn', 'expired')`
    ),
    check(
      'check_ownership_offer_withdrawn_reason',
      sql`(${table.status} = 'withdrawn') = (${table.withdrawnReason} IS NOT NULL) AND (${table.withdrawnReason} IS NULL OR ${table.withdrawnReason} IN ('owner_cancelled', 'recipient_ineligible', 'support_reassigned'))`
    ),
    check(
      'check_ownership_offer_not_self',
      sql`${table.recipientUserId} <> ${table.offeredByUserId}`
    ),
  ]
);

export const organizationOwnershipPeriods = pgTable(
  'organization_ownership_periods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    /** Exclusive. Null = the current owner. */
    endedAt: timestamp('ended_at', { withTimezone: true }),
    source: varchar('source', { length: 16 }).notNull(),
    offerId: uuid('offer_id').references(() => organizationOwnershipOffers.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    // Exactly one open period per organisation.
    uniqueIndex('uq_ownership_periods_one_open')
      .on(table.organizationId)
      .where(sql`${table.endedAt} IS NULL`),
    index('idx_ownership_periods_org_started').on(
      table.organizationId,
      table.startedAt
    ),
    check(
      'check_ownership_period_source',
      sql`${table.source} IN ('created', 'transfer', 'support', 'backfill')`
    ),
    check(
      'check_ownership_period_order',
      sql`${table.endedAt} IS NULL OR ${table.endedAt} >= ${table.startedAt}`
    ),
  ]
);

export type OrganizationOwnershipOffer =
  typeof organizationOwnershipOffers.$inferSelect;
export type OrganizationOwnershipPeriod =
  typeof organizationOwnershipPeriods.$inferSelect;
export type NewOrganizationOwnershipOffer =
  typeof organizationOwnershipOffers.$inferInsert;
export type NewOrganizationOwnershipPeriod =
  typeof organizationOwnershipPeriods.$inferInsert;
