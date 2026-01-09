import { relations, sql } from 'drizzle-orm';
import {
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { organizations } from './content';
import { users } from './users';

// Enums
export const templateScopeEnum = pgEnum('template_scope', [
  'global',
  'organization',
  'creator',
]);
export const templateStatusEnum = pgEnum('template_status', [
  'draft',
  'active',
  'archived',
]);

/**
 * Email templates table
 * Supports global, organization, and creator scopes with name-uniqueness per scope
 */
export const emailTemplates = pgTable(
  'email_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Template identity
    name: varchar('name', { length: 100 }).notNull(), // e.g., 'email-verification'
    scope: templateScopeEnum('scope').notNull(),

    // Ownership (nullable based on scope)
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    creatorId: text('creator_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    createdBy: text('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),

    // Content
    subject: varchar('subject', { length: 500 }).notNull(),
    htmlBody: text('html_body').notNull(),
    textBody: text('text_body').notNull(),
    description: text('description'),

    // State
    status: templateStatusEnum('status').default('draft').notNull(),

    // Timestamps
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
    // Regular indexes
    index('idx_email_templates_org_id').on(table.organizationId),
    index('idx_email_templates_creator_id').on(table.creatorId),
    index('idx_email_templates_scope').on(table.scope),
    index('idx_email_templates_status').on(table.status),

    // Partial unique indexes (unique name per scope+owner)
    uniqueIndex('idx_unique_template_global')
      .on(table.name)
      .where(sql`${table.scope} = 'global' AND ${table.deletedAt} IS NULL`),

    uniqueIndex('idx_unique_template_org')
      .on(table.name, table.organizationId)
      .where(
        sql`${table.scope} = 'organization' AND ${table.deletedAt} IS NULL`
      ),

    uniqueIndex('idx_unique_template_creator')
      .on(table.name, table.creatorId)
      .where(sql`${table.scope} = 'creator' AND ${table.deletedAt} IS NULL`),

    // Scope integrity constraints
    check(
      'global_scope_no_owners',
      sql`${table.scope} != 'global' OR (${table.organizationId} IS NULL AND ${table.creatorId} IS NULL)`
    ),
    check(
      'org_scope_requires_org',
      sql`${table.scope} != 'organization' OR (${table.organizationId} IS NOT NULL AND ${table.creatorId} IS NULL)`
    ),
    check(
      'creator_scope_requires_creator',
      sql`${table.scope} != 'creator' OR ${table.creatorId} IS NOT NULL`
    ),

    // Composite indexes for list filtering
    index('idx_templates_org_scope').on(table.organizationId, table.scope),
    index('idx_templates_creator_scope').on(table.creatorId, table.scope),
    // Additional performance indexes
    index('idx_templates_status_scope').on(table.status, table.scope),
    index('idx_templates_active')
      .on(table.id, table.status)
      .where(sql`${table.deletedAt} IS NULL`),

    // Template resolution optimization (Migration 0022)
    // Composite index for TemplateRepository.findTemplate() query
    index('idx_template_lookup')
      .on(table.name, table.scope, table.organizationId, table.creatorId)
      .where(sql`${table.deletedAt} IS NULL`),
  ]
);

// Relations
export const emailTemplatesRelations = relations(emailTemplates, ({ one }) => ({
  organization: one(organizations, {
    fields: [emailTemplates.organizationId],
    references: [organizations.id],
  }),
  creator: one(users, {
    fields: [emailTemplates.creatorId],
    references: [users.id],
  }),
  createdByUser: one(users, {
    fields: [emailTemplates.createdBy],
    references: [users.id],
  }),
}));

// Type exports
export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type NewEmailTemplate = typeof emailTemplates.$inferInsert;
export type TemplateScope = (typeof templateScopeEnum.enumValues)[number];
export type TemplateStatus = (typeof templateStatusEnum.enumValues)[number];
