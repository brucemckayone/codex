import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { mediaItems, organizations } from './content';

/**
 * Hub table - exists primarily for CASCADE DELETE coordination
 * One row per organization (lazy-created on first settings access)
 */
export const platformSettings = pgTable(
  'platform_settings',
  {
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
  },
  (table) => ({
    updatedAtIdx: index('platform_settings_updated_at_idx').on(table.updatedAt),
  })
);

/**
 * Branding settings - visual identity
 */
export const brandingSettings = pgTable(
  'branding_settings',
  {
    organizationId: uuid('organization_id')
      .primaryKey()
      .references(() => platformSettings.organizationId, {
        onDelete: 'cascade',
      }),

    // Logo (store both URL and R2 path for efficient deletion)
    logoUrl: text('logo_url'),
    logoR2Path: text('logo_r2_path'),

    // Colors
    primaryColorHex: varchar('primary_color_hex', { length: 7 })
      .notNull()
      .default('#3B82F6'),
    secondaryColorHex: varchar('secondary_color_hex', { length: 7 }),
    accentColorHex: varchar('accent_color_hex', { length: 7 }),
    backgroundColorHex: varchar('background_color_hex', { length: 7 }),

    // Typography (Google Fonts family name, null = platform default)
    fontBody: varchar('font_body', { length: 50 }),
    fontHeading: varchar('font_heading', { length: 50 }),

    // Shape & density (continuous values from sliders)
    radiusValue: varchar('radius_value', { length: 10 })
      .notNull()
      .default('0.5'),
    densityValue: varchar('density_value', { length: 10 })
      .notNull()
      .default('1'),

    // Intro video (FK to media item, public HLS URL set when transcoding completes)
    introVideoMediaItemId: uuid('intro_video_media_item_id').references(
      () => mediaItems.id,
      { onDelete: 'set null' }
    ),
    introVideoUrl: text('intro_video_url'),

    // Brand Editor — Level 2 fine-tune fields
    tokenOverrides: text('token_overrides'), // JSON: Record<string, string>
    darkModeOverrides: text('dark_mode_overrides'), // JSON: Partial<ThemeColors>
    textColorHex: varchar('text_color_hex', { length: 7 }),
    shadowScale: varchar('shadow_scale', { length: 10 }).default('1'),
    shadowColor: varchar('shadow_color', { length: 20 }),
    textScale: varchar('text_scale', { length: 10 }).default('1'),
    headingWeight: varchar('heading_weight', { length: 10 }),
    bodyWeight: varchar('body_weight', { length: 10 }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    updatedAtIdx: index('branding_settings_updated_at_idx').on(table.updatedAt),
  })
);

/**
 * Contact settings - business information
 */
export const contactSettings = pgTable(
  'contact_settings',
  {
    organizationId: uuid('organization_id')
      .primaryKey()
      .references(() => platformSettings.organizationId, {
        onDelete: 'cascade',
      }),

    platformName: varchar('platform_name', { length: 100 })
      .notNull()
      .default('Codex Platform'),
    supportEmail: varchar('support_email', { length: 255 })
      .notNull()
      .default('support@example.com'),
    contactUrl: text('contact_url'),
    timezone: varchar('timezone', { length: 100 }).notNull().default('UTC'),

    // Social media URLs (optional)
    twitterUrl: text('twitter_url'),
    youtubeUrl: text('youtube_url'),
    instagramUrl: text('instagram_url'),
    tiktokUrl: text('tiktok_url'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    updatedAtIdx: index('contact_settings_updated_at_idx').on(table.updatedAt),
  })
);

/**
 * Feature settings - toggles and capabilities
 */
export const featureSettings = pgTable(
  'feature_settings',
  {
    organizationId: uuid('organization_id')
      .primaryKey()
      .references(() => platformSettings.organizationId, {
        onDelete: 'cascade',
      }),

    enableSignups: boolean('enable_signups').notNull().default(true),
    enablePurchases: boolean('enable_purchases').notNull().default(true),
    enableSubscriptions: boolean('enable_subscriptions')
      .notNull()
      .default(false),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    updatedAtIdx: index('feature_settings_updated_at_idx').on(table.updatedAt),
  })
);

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
