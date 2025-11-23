/**
 * Test Setup Helpers
 *
 * Reusable helpers for setting up test contexts with database and service instances.
 * Eliminates boilerplate beforeAll/afterAll lifecycle code across test files.
 *
 * These helpers work seamlessly with neon-testing for ephemeral database isolation.
 *
 * @example
 * ```typescript
 * import { createServiceTestContext } from '@codex/test-utils';
 *
 * describe('ContentService', () => {
 *   const getContext = createServiceTestContext(
 *     (db) => new ContentService({ db, environment: 'test' })
 *   );
 *
 *   it('should create content', async () => {
 *     const { db, service, creatorId } = getContext();
 *     // Use service and db directly
 *   });
 * });
 * ```
 */

import { afterAll, beforeAll } from 'vitest';
import type { Database } from './database';
import {
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from './database';

/**
 * Context returned by setup helpers
 * Contains database, service instance, and test user IDs
 */
export interface ServiceTestContext<T> {
  db: Database;
  service: T;
  creatorId: string;
  otherCreatorId: string;
  creatorIds: string[];
}

/**
 * Create a database-only test context
 *
 * Sets up database and provides test users without service instantiation.
 * Useful for tests that work directly with database.
 *
 * @returns Function that returns context with db and user IDs
 *
 * @example
 * ```typescript
 * const getContext = createDatabaseTestContext(2);
 *
 * it('should query content', async () => {
 *   const { db, creatorId } = getContext();
 *   const result = await db.query.content.findFirst({
 *     where: eq(content.creatorId, creatorId)
 *   });
 * });
 * ```
 */
export function createDatabaseTestContext(userCount: number = 2) {
  let db: Database;
  let creatorIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    creatorIds = await seedTestUsers(db, userCount);
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  return () => ({
    db,
    creatorId: creatorIds[0],
    otherCreatorId: creatorIds[1],
    creatorIds,
  });
}

/**
 * Create a service test context
 *
 * Sets up database, creates service instance, and provides test users.
 * Most common pattern for service unit tests.
 *
 * Handles all lifecycle automatically:
 * - beforeAll: Setup database, create service, seed users
 * - afterAll: Teardown database connection
 *
 * @param createService - Function that creates service instance given database
 * @param userCount - Number of test users to create (default: 2)
 * @returns Function that returns context with db, service, and user IDs
 *
 * @example
 * ```typescript
 * const getContext = createServiceTestContext(
 *   (db) => new ContentService({ db, environment: 'test' }),
 *   2
 * );
 *
 * it('should create content', async () => {
 *   const { service, creatorId } = getContext();
 *   const content = await service.create({ ... }, creatorId);
 *   expect(content.id).toBeDefined();
 * });
 * ```
 */
export function createServiceTestContext<T>(
  createService: (db: Database) => T,
  userCount: number = 2
) {
  let db: Database;
  let service: T;
  let creatorIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    service = createService(db);
    creatorIds = await seedTestUsers(db, userCount);
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  return (): ServiceTestContext<T> => ({
    db,
    service,
    creatorId: creatorIds[0] ?? '',
    otherCreatorId: creatorIds[1] ?? '',
    creatorIds,
  });
}

/**
 * Create an integration test context with multiple service instances
 *
 * Sets up database and creates multiple service instances.
 * Useful for testing interactions between multiple services.
 *
 * @param createServices - Function that creates all service instances
 * @param userCount - Number of test users to create (default: 2)
 * @returns Function that returns context with db, services, and user IDs
 *
 * @example
 * ```typescript
 * const getContext = createIntegrationTestContext(
 *   (db) => ({
 *     content: new ContentService({ db, environment: 'test' }),
 *     media: new MediaItemService({ db, environment: 'test' }),
 *   }),
 *   2
 * );
 *
 * it('should create content with media', async () => {
 *   const { services, creatorId } = getContext();
 *   const media = await services.media.create({ ... }, creatorId);
 *   const content = await services.content.create({ ... }, creatorId);
 * });
 * ```
 */
export function createIntegrationTestContext<T extends Record<string, unknown>>(
  createServices: (db: Database) => T,
  userCount: number = 2
) {
  let db: Database;
  let services: T;
  let creatorIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    services = createServices(db);
    creatorIds = await seedTestUsers(db, userCount);
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  return () => ({
    db,
    services,
    creatorId: creatorIds[0],
    otherCreatorId: creatorIds[1],
    creatorIds,
  });
}
