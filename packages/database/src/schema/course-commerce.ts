import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { courses } from './journeys';
import { organizations } from './organizations';
import { subscriptionTiers } from './subscriptions';
import { users } from './users';

/**
 * Course monetization — the three course-access paths (SPEC §7).
 *
 *   1. Org subscription tier → course   ({@link courseTierAccess}, derived grant)
 *   2. One-off course purchase          (courses.priceCents → entitlements, WP-6)
 *   3. Course-specific subscription     ({@link courseSubscriptionPlans} + {@link courseSubscriptions})
 *
 * [H] DECIDED (2026-07-23): course subscriptions use a SEPARATE Stripe product
 * per course (reuse `TierService` product/price sync); `course_subscriptions`
 * carries a `planId` FK. Course-sub + course-purchase revenue reuses the payout
 * ledger (WP-6 wires `pendingPayouts` — not this WP). See HARDENING §D / §H3.
 */

/**
 * Course-specific subscription plan — one per course (the low-friction entry
 * into a single course). Mirrors the Stripe sync shape of `subscription_tiers`.
 */
export const courseSubscriptionPlans = pgTable(
  'course_subscription_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),

    priceMonthly: integer('price_monthly').notNull(),
    priceAnnual: integer('price_annual').notNull(),

    // Stripe sync — a SEPARATE Product + 2 Prices per course (HARDENING §D).
    stripeProductId: varchar('stripe_product_id', { length: 255 }),
    stripePriceMonthlyId: varchar('stripe_price_monthly_id', { length: 255 }),
    stripePriceAnnualId: varchar('stripe_price_annual_id', { length: 255 }),

    isActive: boolean('is_active').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_course_sub_plans_course_id').on(table.courseId),
    // One live plan per course (only among non-deleted rows).
    uniqueIndex('uq_course_sub_plans_course')
      .on(table.courseId)
      .where(sql`${table.deletedAt} IS NULL`),

    check('check_course_plan_price_monthly', sql`${table.priceMonthly} >= 0`),
    check('check_course_plan_price_annual', sql`${table.priceAnnual} >= 0`),
  ]
);

/**
 * Course-specific subscription record. Grants a course entitlement while active
 * (derived by the resolver from the live status). `userId` is TEXT ([H]).
 */
export const courseSubscriptions = pgTable(
  'course_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => courseSubscriptionPlans.id, { onDelete: 'restrict' }),
    // Denormalised for org-scoped back-office reporting (courses are always
    // org-owned). `set null` so deleting an org never destroys billing history.
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),

    // Stripe references
    stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 })
      .notNull()
      .unique(),
    stripeCustomerId: varchar('stripe_customer_id', { length: 255 }).notNull(),

    // Lifecycle (mirrors the org `subscriptions` status/interval vocabulary)
    status: varchar('status', { length: 50 }).notNull(),
    billingInterval: varchar('billing_interval', { length: 10 }).notNull(),
    currentPeriodStart: timestamp('current_period_start', {
      withTimezone: true,
    }).notNull(),
    currentPeriodEnd: timestamp('current_period_end', {
      withTimezone: true,
    }).notNull(),

    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_course_subscriptions_user_id').on(table.userId),
    index('idx_course_subscriptions_course_id').on(table.courseId),
    index('idx_course_subscriptions_plan_id').on(table.planId),
    index('idx_course_subscriptions_stripe_id').on(table.stripeSubscriptionId),

    // One active course-subscription per user per course.
    uniqueIndex('uq_active_course_subscription_per_user_course')
      .on(table.userId, table.courseId)
      .where(sql`${table.status} IN ('active', 'past_due', 'cancelling')`),

    check(
      'check_course_subscription_status',
      sql`${table.status} IN ('active', 'past_due', 'cancelling', 'cancelled', 'incomplete', 'paused')`
    ),
    check(
      'check_course_subscription_billing_interval',
      sql`${table.billingInterval} IN ('month', 'year')`
    ),
  ]
);

/**
 * Explicit tier → course grants (SPEC §7). Not "min tier": each row names one
 * tier that unlocks one course, so "certain tiers → certain courses" is exact.
 * The grant is DERIVED live (resolver) while that tier subscription is active.
 * `onDelete: cascade` on `tierId` is the tier-delete sweep for this join.
 */
export const courseTierAccess = pgTable(
  'course_tier_access',
  {
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    tierId: uuid('tier_id')
      .notNull()
      .references(() => subscriptionTiers.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.courseId, table.tierId] }),
    index('idx_course_tier_access_tier_id').on(table.tierId),
  ]
);

// ─── Relations ───────────────────────────────────────────────────────────────

export const courseSubscriptionPlansRelations = relations(
  courseSubscriptionPlans,
  ({ one, many }) => ({
    course: one(courses, {
      fields: [courseSubscriptionPlans.courseId],
      references: [courses.id],
    }),
    subscriptions: many(courseSubscriptions),
  })
);

export const courseSubscriptionsRelations = relations(
  courseSubscriptions,
  ({ one }) => ({
    user: one(users, {
      fields: [courseSubscriptions.userId],
      references: [users.id],
    }),
    course: one(courses, {
      fields: [courseSubscriptions.courseId],
      references: [courses.id],
    }),
    plan: one(courseSubscriptionPlans, {
      fields: [courseSubscriptions.planId],
      references: [courseSubscriptionPlans.id],
    }),
    organization: one(organizations, {
      fields: [courseSubscriptions.organizationId],
      references: [organizations.id],
    }),
  })
);

export const courseTierAccessRelations = relations(
  courseTierAccess,
  ({ one }) => ({
    course: one(courses, {
      fields: [courseTierAccess.courseId],
      references: [courses.id],
    }),
    tier: one(subscriptionTiers, {
      fields: [courseTierAccess.tierId],
      references: [subscriptionTiers.id],
    }),
  })
);

// ─── Type Exports ────────────────────────────────────────────────────────────

export type CourseSubscriptionPlan =
  typeof courseSubscriptionPlans.$inferSelect;
export type NewCourseSubscriptionPlan =
  typeof courseSubscriptionPlans.$inferInsert;

export type CourseSubscription = typeof courseSubscriptions.$inferSelect;
export type NewCourseSubscription = typeof courseSubscriptions.$inferInsert;

export type CourseTierAccess = typeof courseTierAccess.$inferSelect;
export type NewCourseTierAccess = typeof courseTierAccess.$inferInsert;
