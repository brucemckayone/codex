import { relations } from 'drizzle-orm';
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Creator first-run onboarding state.
 *
 * One row per user, tracking progress through the guided "become a creator"
 * setup flow (the wizard unified from /become-creator). Distinct from the
 * dashboard "get set up to sell" checklist, whose completion is derived live
 * from Stripe/media/content signals — this table tracks the identity-setup
 * arc that precedes it.
 *
 * Timestamp columns (not booleans) so the row doubles as drop-off analytics:
 * when a creator started, stalled, dismissed, or completed onboarding.
 * `currentStep` is the resume pointer that survives the Stripe Connect
 * external redirect round-trip.
 *
 * Payouts completion is deliberately NOT stored here — it stays derived from
 * the live Stripe Connect account status, the single source of truth shared
 * with the dashboard checklist.
 */
export const creatorOnboarding = pgTable('creator_onboarding', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Resume pointer — one of the wizard step ids (validated in @codex/validation). */
  currentStep: text('current_step').notNull().default('essentials'),
  /** Set the first time the studio dashboard renders — gates the first-run modal tour. */
  welcomeSeenAt: timestamp('welcome_seen_at', { withTimezone: true }),
  /** Set when the creator explicitly skips the whole flow. */
  dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  /** Set when the creator reaches the finish step. */
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

// Relations
export const creatorOnboardingRelations = relations(
  creatorOnboarding,
  ({ one }) => ({
    user: one(users, {
      fields: [creatorOnboarding.userId],
      references: [users.id],
    }),
  })
);

// Type exports
export type CreatorOnboarding = typeof creatorOnboarding.$inferSelect;
export type NewCreatorOnboarding = typeof creatorOnboarding.$inferInsert;
