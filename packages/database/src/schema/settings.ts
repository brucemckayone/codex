import { relations } from 'drizzle-orm';
import {
  boolean,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { organizations } from './content';

/**
 * Hub table - exists primarily for CASCADE DELETE coordination
 * One row per organization (lazy-created on first settings access)
 */
export const platformSettings = pgTable('platform_settings', {
  organizationId: uuid('organization_id')
    .primaryKey()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

/**
 * Branding settings - visual identity
 */
export const brandingSettings = pgTable('branding_settings', {
  organizationId: uuid('organization_id')
    .primaryKey()
    .references(() => platformSettings.organizationId, { onDelete: 'cascade' }),

  // Logo (store both URL and R2 path for efficient deletion)
  logoUrl: text('logo_url'),
  logoR2Path: text('logo_r2_path'),

  // Colors
  primaryColorHex: varchar('primary_color_hex', { length: 7 })
    .notNull()
    .default('#3B82F6'),

  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

/**
 * Contact settings - business information
 */
export const contactSettings = pgTable('contact_settings', {
  organizationId: uuid('organization_id')
    .primaryKey()
    .references(() => platformSettings.organizationId, { onDelete: 'cascade' }),

  platformName: varchar('platform_name', { length: 100 })
    .notNull()
    .default('Codex Platform'),
  supportEmail: varchar('support_email', { length: 255 }).notNull(),
  contactUrl: text('contact_url'),
  timezone: varchar('timezone', { length: 100 }).notNull().default('UTC'),

  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

/**
 * Feature settings - toggles and capabilities
 */
export const featureSettings = pgTable('feature_settings', {
  organizationId: uuid('organization_id')
    .primaryKey()
    .references(() => platformSettings.organizationId, { onDelete: 'cascade' }),

  enableSignups: boolean('enable_signups').notNull().default(true),
  enablePurchases: boolean('enable_purchases').notNull().default(true),

  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

// Relations
export const platformSettingsRelations = relations(
  platformSettings,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [platformSettings.organizationId],
      references: [organizations.id],
    }),
    branding: one(brandingSettings, {
      fields: [platformSettings.organizationId],
      references: [brandingSettings.organizationId],
    }),
    contact: one(contactSettings, {
      fields: [platformSettings.organizationId],
      references: [contactSettings.organizationId],
    }),
    features: one(featureSettings, {
      fields: [platformSettings.organizationId],
      references: [featureSettings.organizationId],
    }),
  })
);

export const brandingSettingsRelations = relations(
  brandingSettings,
  ({ one }) => ({
    platformSettings: one(platformSettings, {
      fields: [brandingSettings.organizationId],
      references: [platformSettings.organizationId],
    }),
  })
);

export const contactSettingsRelations = relations(
  contactSettings,
  ({ one }) => ({
    platformSettings: one(platformSettings, {
      fields: [contactSettings.organizationId],
      references: [platformSettings.organizationId],
    }),
  })
);

export const featureSettingsRelations = relations(
  featureSettings,
  ({ one }) => ({
    platformSettings: one(platformSettings, {
      fields: [featureSettings.organizationId],
      references: [platformSettings.organizationId],
    }),
  })
);

// Type exports
export type PlatformSettings = typeof platformSettings.$inferSelect;
export type NewPlatformSettings = typeof platformSettings.$inferInsert;
export type BrandingSettings = typeof brandingSettings.$inferSelect;
export type NewBrandingSettings = typeof brandingSettings.$inferInsert;
export type ContactSettings = typeof contactSettings.$inferSelect;
export type NewContactSettings = typeof contactSettings.$inferInsert;
export type FeatureSettings = typeof featureSettings.$inferSelect;
export type NewFeatureSettings = typeof featureSettings.$inferInsert;
