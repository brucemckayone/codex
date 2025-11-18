/**
 * Database Triggers Registry
 *
 * Triggers and functions are not managed by Drizzle ORM.
 * This file documents all custom database logic for reference and testing.
 *
 * Usage:
 * - Import in tests to verify triggers exist
 * - Reference in documentation
 * - Track what custom database logic exists
 */

export const DATABASE_TRIGGERS = {
  unpublish_content_on_org_delete: {
    table: 'content',
    triggerName: 'trigger_unpublish_on_org_delete',
    functionName: 'unpublish_content_on_org_delete',
    event: 'BEFORE UPDATE',
    when: 'organization_id changes from NOT NULL to NULL',
    description:
      'Unpublishes content when organization is deleted (sets status=draft, published_at=NULL)',
    migration: '0004_add_org_deletion_trigger.sql',
    businessReason:
      'Prevents published org content from auto-appearing on creator personal page when org is deleted',
    appliedInMigration: '0004_add_org_deletion_trigger',
  },
  // Future triggers will be added here
} as const;

export type TriggerName = keyof typeof DATABASE_TRIGGERS;

/**
 * Helper to get trigger metadata
 */
export function getTriggerMetadata(name: TriggerName) {
  return DATABASE_TRIGGERS[name];
}

/**
 * Get all triggers for a specific table
 */
export function getTriggersForTable(tableName: string) {
  return Object.entries(DATABASE_TRIGGERS)
    .filter(([_, trigger]) => trigger.table === tableName)
    .map(([name, trigger]) => ({ name: name as TriggerName, ...trigger }));
}

/**
 * List all trigger names (for testing)
 */
export function getAllTriggerNames(): TriggerName[] {
  return Object.keys(DATABASE_TRIGGERS) as TriggerName[];
}
