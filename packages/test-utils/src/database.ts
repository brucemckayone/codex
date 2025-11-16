/**
 * Database Test Utilities
 *
 * Helpers for setting up and managing test databases for Content Management Service tests.
 * Provides clean database state for each test run.
 *
 * Key Points:
 * - Uses the production database client from @codex/database (configured via .env.dev)
 * - Cleans up content tables between tests
 * - Supports test user creation for auth scenarios
 * - Transaction helpers for isolated test scenarios
 *
 * Database Configuration:
 * - Tests use the same db client as production code
 * - Configuration is controlled by DB_METHOD environment variable (see .env.dev)
 * - In local dev: DB_METHOD=LOCAL_PROXY connects to local Postgres via Neon proxy
 * - No need to create a separate test database connection
 *
 * Usage:
 * ```typescript
 * import { setupTestDatabase, cleanupDatabase, seedTestUsers } from '@codex/test-utils';
 * import type { Database } from '@codex/database';
 *
 * let db: Database;
 * let testUserId: string;
 *
 * beforeAll(async () => {
 *   db = setupTestDatabase();
 *   const [userId] = await seedTestUsers(db, 1);
 *   testUserId = userId;
 * });
 *
 * beforeEach(async () => {
 *   await cleanupDatabase(db);
 * });
 *
 * afterAll(async () => {
 *   await cleanupDatabase(db);
 * });
 * ```
 */

import { sql as sqlOperator } from 'drizzle-orm';
import * as schema from '@codex/database/schema';
import { dbWs as productionDbWs, type DatabaseWs } from '@codex/database';

/**
 * Database type - import from @codex/database for type safety
 * This ensures we use the same type as the content service
 */
export type Database = DatabaseWs;

/**
 * Setup test database connection
 *
 * Returns the WebSocket-based database client with full transaction support.
 * This is essential for tests that need to use db.transaction().
 *
 * The client is configured via environment variables (DB_METHOD, DATABASE_URL, etc.)
 *
 * In test environment:
 * - Uses WebSocket Pool for full transaction support
 * - Supports interactive transactions (BEGIN/COMMIT/ROLLBACK)
 * - Configuration comes from .env.dev
 *
 * @returns Database client (WebSocket-based, configured via env)
 */
export function setupTestDatabase(): Database {
  // Return the WebSocket db client - it supports transactions
  // This is required for tests that use db.transaction()
  return productionDbWs;
}

/**
 * Clean up content data only (preserves users)
 *
 * Deletes test data from content tables while preserving users.
 * Use this in beforeEach when users are seeded once in beforeAll.
 *
 * Deletion order (respects foreign keys):
 * 1. content (references media_items, organizations, users)
 * 2. media_items (references users)
 * 3. organizations (no foreign keys from other content tables)
 *
 * @param db - Database client
 */
export async function cleanupDatabase(db: Database): Promise<void> {
  // Delete in order that respects foreign key constraints
  await db.delete(schema.content);
  await db.delete(schema.mediaItems);
  await db.delete(schema.organizations);
  // NOTE: Users are NOT deleted - preserve them across tests
}

/**
 * Clean up all test data including users
 *
 * Deletes ALL test data including users.
 * Only use this in afterAll cleanup or when you need a complete reset.
 *
 * @param db - Database client
 */
export async function cleanupDatabaseComplete(db: Database): Promise<void> {
  // Delete in order that respects foreign key constraints
  await db.delete(schema.content);
  await db.delete(schema.mediaItems);
  await db.delete(schema.organizations);
  await db.delete(schema.users);
}

/**
 * Cleanup specific tables
 *
 * Useful when you only need to clean specific tables.
 *
 * @param db - Database client
 * @param tables - Array of table names to clean
 */
export async function cleanupTables(
  db: Database,
  tables: ('content' | 'mediaItems' | 'organizations' | 'users')[]
): Promise<void> {
  const tableMap = {
    content: schema.content,
    mediaItems: schema.mediaItems,
    organizations: schema.organizations,
    users: schema.users,
  };

  // Delete in correct order to respect foreign keys
  const orderedTables = [
    'content',
    'mediaItems',
    'organizations',
    'users',
  ] as const;

  for (const tableName of orderedTables) {
    if (tables.includes(tableName)) {
      await db.delete(tableMap[tableName]);
    }
  }
}

/**
 * Seed test users
 *
 * Creates test users in the auth.users table.
 * Returns user IDs for use in tests.
 *
 * @param db - Database client
 * @param count - Number of users to create
 * @returns Array of user IDs
 */
export async function seedTestUsers(
  db: Database,
  count: number = 1
): Promise<string[]> {
  const users: { id: string; email: string; name: string }[] = [];

  for (let i = 0; i < count; i++) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 7);
    users.push({
      id: `test-user-${timestamp}-${random}`,
      email: `test-${timestamp}-${random}@example.com`,
      name: `Test User ${i + 1}`,
    });
  }

  // Insert users directly
  const insertedUsers = await db
    .insert(schema.users)
    .values(users)
    .returning({ id: schema.users.id });

  return insertedUsers.map((u) => u.id);
}

/**
 * Transaction helper for tests
 *
 * Wraps test code in a transaction and rolls back automatically.
 * Useful for tests that need to leave no trace.
 *
 * @param db - Database client
 * @param testFn - Test function to run in transaction
 */
export async function withTransaction<T>(
  db: Database,
  testFn: (
    tx: Parameters<Parameters<Database['transaction']>[0]>[0]
  ) => Promise<T>
): Promise<T> {
  return await db.transaction(async (tx) => {
    const result = await testFn(tx);
    // Transaction will auto-rollback if testFn throws
    return result;
  });
}

/**
 * Execute raw SQL for advanced test setup
 *
 * Useful for creating complex test scenarios.
 *
 * @param db - Database client
 * @param query - SQL query string
 */
export async function executeRawSQL(
  db: Database,
  query: string
): Promise<void> {
  await db.execute(sqlOperator.raw(query));
}

/**
 * Check if tables are empty
 *
 * Useful for verifying cleanup.
 *
 * @param db - Database client
 * @returns True if all content tables are empty
 */
export async function areTablesEmpty(db: Database): Promise<boolean> {
  const [contentCount] = await db
    .select({ count: sqlOperator`count(*)::int` })
    .from(schema.content);

  const [mediaCount] = await db
    .select({ count: sqlOperator`count(*)::int` })
    .from(schema.mediaItems);

  const [orgCount] = await db
    .select({ count: sqlOperator`count(*)::int` })
    .from(schema.organizations);

  return (
    Number(contentCount?.count) === 0 &&
    Number(mediaCount?.count) === 0 &&
    Number(orgCount?.count) === 0
  );
}
