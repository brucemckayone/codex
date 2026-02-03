// Export only the specific, safe-to-bundle exports from drizzle-orm
// Avoid re-exporting internal classes that cause bundling issues
export {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';

export * from './client';
export { createDbClient } from './client';
export type { DbEnvVars } from './config/env.config';
export * as schema from './schema';

export type {
  ORPHANED_ENTITY_TYPES,
  ORPHANED_IMAGE_TYPES,
  OrphanedEntityType,
  OrphanedImageType,
  OrphanStatus,
} from './schema/storage';
export * from './utils';
