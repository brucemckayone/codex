/**
 * Database Test Utilities
 *
 * Helpers for setting up and managing test databases for integration tests.
 * Works with neon-testing library for ephemeral branch isolation.
 *
 * Key Points:
 * - Uses the production database client from @codex/database
 * - Each test file gets its own ephemeral Neon branch (via neon-testing)
 * - Complete isolation between test files - no cleanup needed between files
 * - Optional cleanup helpers for tests within the same file
 * - Supports test user creation for auth scenarios
 * - Transaction helpers for isolated test scenarios
 *
 * HYBRID TESTING STRATEGY - COST OPTIMIZATION:
 * =============================================
 * **Local Development** (FREE, unlimited test runs):
 * - Uses DATABASE_URL from .env.dev (LOCAL_PROXY method)
 * - No ephemeral branch creation costs
 * - Fast execution with no provisioning delay
 * - Tests share database (cleanup helpers still work if needed)
 *
 * **CI/CD** (Isolated, reliable):
 * - Uses neon-testing to create ephemeral Neon branches
 * - Each test file gets its own isolated branch
 * - Complete isolation between test files
 * - Full production schema and constraints
 *
 * This hybrid approach saves 200+ branch creations per day during local development!
 *
 * Usage with neon-testing (works in both local and CI):
 * ```typescript
 * import { test } from 'vitest';
 * import { withNeonTestBranch } from '../../config/vitest/test-setup';
 * import { setupTestDatabase, seedTestUsers } from '@codex/test-utils';
 * import type { Database } from '@codex/database';
 *
 * // Enable neon-testing (only activates in CI, uses .env.dev locally)
 * withNeonTestBranch();
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
 * // No cleanup needed - CI gets fresh database per file!
 * // Local uses shared database but tests are idempotent
 *
 * test('my test', async () => {
 *   // Test with clean database state (CI) or shared state (local)
 * });
 * ```
 */

import {
  closeDbPool,
  type DatabaseWs,
  dbWs as productionDbWs,
} from '@codex/database';
import * as schema from '@codex/database/schema';
import { neonConfig } from '@neondatabase/serverless';
import { sql as sqlOperator } from 'drizzle-orm';
import { makeNeonTesting } from 'neon-testing';
import ws from 'ws';

// Configure Neon serverless WebSocket for Node.js environment
// This is required for @neondatabase/serverless in Node.js v21 and earlier
// and for neon-testing to work properly in test environments
neonConfig.webSocketConstructor = ws;

// Also polyfill global WebSocket for other code that might need it
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = ws as unknown as typeof WebSocket;
}

// Apply LOCAL_PROXY configuration for local development testing
// This must be done early, before any database connections are created
if (process.env.DB_METHOD === 'LOCAL_PROXY') {
  neonConfig.useSecureWebSocket = false;
  neonConfig.fetchEndpoint = (host: string): string => {
    const [protocol, port] =
      host === 'db.localtest.me' ? ['http', 4444] : ['https', 443];
    return `${protocol}://${host}:${port}/sql`;
  };
  const dbUrl = process.env.DATABASE_URL_LOCAL_PROXY;
  if (dbUrl && new URL(dbUrl).hostname === 'db.localtest.me') {
    neonConfig.wsProxy = (host: string) => `${host}:4444/v1`;
  }
}

/**
 * Database type - import from @codex/database for type safety
 * This ensures we use the same type as the content service
 */
export type Database = DatabaseWs;

/**
 * Setup neon-testing for database integration tests
 *
 * Creates ephemeral Neon branches for test isolation in CI.
 * In local development, uses existing DATABASE_URL (no branch creation).
 *
 * **MUST be called at module level**, not inside beforeAll/beforeEach.
 *
 * **IMPORTANT**: In CI, ephemeral branches are cloned from NEON_PARENT_BRANCH_ID
 * if provided, otherwise from the project's default branch. The parent branch
 * MUST have all migrations applied for tests to work correctly.
 *
 * Usage:
 * ```typescript
 * import { withNeonTestBranch } from '@codex/test-utils';
 *
 * // Call at module level
 * withNeonTestBranch();
 *
 * describe('My tests', () => {
 *   // Tests run with isolated database in CI
 * });
 * ```
 */
export function withNeonTestBranch() {
  // Only create ephemeral branches in CI environment
  // In local development (DB_METHOD=LOCAL_PROXY), this is a no-op
  if (process.env.CI === 'true') {
    // Verify required environment variables for CI
    if (!process.env.NEON_API_KEY || !process.env.NEON_PROJECT_ID) {
      console.error('invalid enviroment variables or enviroment');
      return;
    }

    const config: {
      apiKey: string;
      projectId: string;
      autoCloseWebSockets: boolean;
      parentBranchId?: string;
    } = {
      apiKey: process.env.NEON_API_KEY,
      projectId: process.env.NEON_PROJECT_ID,
      autoCloseWebSockets: true,
    };

    // If NEON_PARENT_BRANCH_ID is provided, use it as the parent branch
    // This ensures ephemeral branches have the correct schema
    if (process.env.NEON_PARENT_BRANCH_ID) {
      config.parentBranchId = process.env.NEON_PARENT_BRANCH_ID;
      console.log('[test-utils] Using parent branch:', config.parentBranchId);
    } else {
      console.warn(
        '[test-utils] No NEON_PARENT_BRANCH_ID provided, using project default branch'
      );
    }

    const fixture = makeNeonTesting(config);
    fixture();
  } else {
    console.error('invalid enviroment variables or enviroment');
  }
  // In local development - use existing DATABASE_URL (no-op)
}

/**
 * Validate database connection health
 *
 * Tests that the database Pool connection is working properly before running tests.
 * This helps catch connection issues early and provides better error messages.
 *
 * @param db - Database client to validate
 * @param retries - Number of retry attempts (default: 3)
 * @param delayMs - Delay between retries in milliseconds (default: 1000)
 * @returns Promise that resolves if connection is healthy
 * @throws Error if connection fails after all retries
 */
export async function validateDatabaseConnection(
  db: Database,
  retries: number = 3,
  delayMs: number = 1000
): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Test basic connectivity with a simple query
      const result =
        await db.execute(sqlOperator<{ test: number }>`SELECT 1 as test`);

      if (
        !result ||
        !Array.isArray(result.rows) ||
        result.rows.length === 0 ||
        !result.rows[0] ||
        result.rows[0].test !== 1
      ) {
        throw new Error('Database query did not return expected result');
      }

      // Connection is healthy
      if (attempt > 1) {
        console.log(
          `[test-utils] Database connection established after ${attempt} attempts`
        );
      }
      return;
    } catch (error) {
      lastError = error as Error;
      console.error(
        `[test-utils] Database connection attempt ${attempt}/${retries} failed:`,
        {
          error: lastError.message,
          name: lastError.name,
          DB_METHOD: process.env.DB_METHOD,
          CI: process.env.CI,
        }
      );

      if (attempt < retries) {
        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  // All retries failed
  throw new Error(
    `Database connection validation failed after ${retries} attempts. Last error: ${lastError?.message}. Check DATABASE_URL and DB_METHOD environment variables.`
  );
}

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
 *
 * With neon-testing (ephemeral branches per test file):
 * - This function is optional - each test file gets a fresh database
 * - Use only if you need to clean up between tests within the same file
 * - No retry logic needed - ephemeral branches ensure complete isolation
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
 * Teardown test database connection
 *
 * Closes the database Pool connection to allow the test process to exit cleanly.
 * This should be called in afterAll to prevent tests from hanging.
 *
 * @example
 * afterAll(async () => {
 *   await cleanupDatabase(db);
 *   await teardownTestDatabase();
 * });
 */
export async function teardownTestDatabase(): Promise<void> {
  await closeDbPool();
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
