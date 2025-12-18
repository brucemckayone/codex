/**
 * Organization Service Tests
 *
 * Comprehensive test suite for OrganizationService covering:
 * - Organization creation (valid, slug uniqueness)
 * - Organization retrieval (by id, by slug)
 * - Organization updates (fields, slug conflicts)
 * - Organization deletion (soft delete)
 * - List operations (pagination, search, sorting)
 * - Slug validation and availability
 * - Error handling
 *
 * Test Count: 20+ tests
 *
 * Database Isolation:
 * - Uses neon-testing for ephemeral branch per test file
 * - No cleanup needed between tests - fresh database for this file
 * - Tests are fully isolated and idempotent
 */

import {
  createUniqueSlug,
  type Database,
  setupTestDatabase,
  teardownTestDatabase,
  validateDatabaseConnection,
} from '@codex/test-utils';
import type { CreateOrganizationInput } from '@codex/validation';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConflictError, OrganizationNotFoundError } from '../../errors';
import { OrganizationService } from '../organization-service';

// Uses workflow-level Neon branch in CI, LOCAL_PROXY locally

describe('OrganizationService', () => {
  let db: Database;
  let service: OrganizationService;

  beforeAll(async () => {
    db = setupTestDatabase();

    // Validate database connection before running tests
    // This helps catch connection issues early with better error messages
    try {
      await validateDatabaseConnection(db);
    } catch (error) {
      console.warn(
        'Database connection failed - tests will be skipped:',
        (error as Error).message
      );
      throw error; // Re-throw to fail the test suite if database is expected but not available
    }

    service = new OrganizationService({ db, environment: 'test' });
  });

  // No cleanup needed between tests - neon-testing provides fresh database per file

  afterAll(async () => {
    await teardownTestDatabase();
  });

  describe('create', () => {
    it('should create organization with valid data', async () => {
      const input: CreateOrganizationInput = {
        name: 'Test Organization',
        slug: createUniqueSlug('test-org'),
        description: 'A test organization',
        logoUrl: 'https://example.com/logo.png',
        websiteUrl: 'https://example.com',
      };

      const result = await service.create(input);

      expect(result.id).toBeDefined();
      expect(result.name).toBe(input.name);
      expect(result.slug).toBe(input.slug);
      expect(result.description).toBe(input.description);
      expect(result.logoUrl).toBe(input.logoUrl);
      expect(result.websiteUrl).toBe(input.websiteUrl);
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
      expect(result.deletedAt).toBeNull();
    });

    it('should create organization with minimal data', async () => {
      const input: CreateOrganizationInput = {
        name: 'Minimal Org',
        slug: createUniqueSlug('minimal'),
      };

      const result = await service.create(input);

      expect(result.name).toBe(input.name);
      expect(result.slug).toBe(input.slug);
      expect(result.description).toBeNull();
      expect(result.logoUrl).toBeNull();
      expect(result.websiteUrl).toBeNull();
    });

    it('should throw ConflictError for duplicate slug', async () => {
      const slug = createUniqueSlug('duplicate');

      await service.create({
        name: 'First Org',
        slug,
      });

      await expect(
        service.create({
          name: 'Second Org',
          slug, // Same slug
        })
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('get', () => {
    it('should retrieve organization by id', async () => {
      const created = await service.create({
        name: 'Test Org',
        slug: createUniqueSlug('test'),
      });

      const result = await service.get(created.id);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(created.id);
      expect(result?.name).toBe(created.name);
    });

    it('should return null for non-existent organization', async () => {
      const result = await service.get('00000000-0000-0000-0000-000000000000');

      expect(result).toBeNull();
    });

    it('should return null for soft-deleted organization', async () => {
      const created = await service.create({
        name: 'To Delete',
        slug: createUniqueSlug('delete'),
      });

      await service.delete(created.id);
      const result = await service.get(created.id);

      expect(result).toBeNull();
    });
  });

  describe('getBySlug', () => {
    it('should retrieve organization by slug', async () => {
      const slug = createUniqueSlug('test-slug');
      const created = await service.create({
        name: 'Test Org',
        slug,
      });

      const result = await service.getBySlug(slug);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(created.id);
      expect(result?.slug).toBe(slug);
    });

    it('should be case-insensitive', async () => {
      const slug = createUniqueSlug('case-test');
      await service.create({
        name: 'Test Org',
        slug: slug.toLowerCase(),
      });

      const result = await service.getBySlug(slug.toUpperCase());

      expect(result).not.toBeNull();
    });

    it('should return null for non-existent slug', async () => {
      const result = await service.getBySlug('non-existent-slug');

      expect(result).toBeNull();
    });

    it('should return null for soft-deleted organization', async () => {
      const slug = createUniqueSlug('deleted');
      const created = await service.create({
        name: 'To Delete',
        slug,
      });

      await service.delete(created.id);
      const result = await service.getBySlug(slug);

      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('should update organization name', async () => {
      const created = await service.create({
        name: 'Original Name',
        slug: createUniqueSlug('test'),
      });

      const updated = await service.update(created.id, {
        name: 'Updated Name',
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.updatedAt.getTime()).toBeGreaterThan(
        created.updatedAt.getTime()
      );
    });

    it('should update organization description', async () => {
      const created = await service.create({
        name: 'Test',
        slug: createUniqueSlug('test'),
      });

      const updated = await service.update(created.id, {
        description: 'New description',
      });

      expect(updated.description).toBe('New description');
    });

    it('should update organization slug', async () => {
      const created = await service.create({
        name: 'Test',
        slug: createUniqueSlug('old-slug'),
      });

      const newSlug = createUniqueSlug('new-slug');
      const updated = await service.update(created.id, {
        slug: newSlug,
      });

      expect(updated.slug).toBe(newSlug);
    });

    it('should throw OrganizationNotFoundError if organization does not exist', async () => {
      await expect(
        service.update('00000000-0000-0000-0000-000000000000', {
          name: 'New Name',
        })
      ).rejects.toThrow(OrganizationNotFoundError);
    });

    it('should throw ConflictError if updating to existing slug', async () => {
      const slug1 = createUniqueSlug('slug1');
      const slug2 = createUniqueSlug('slug2');

      await service.create({ name: 'Org 1', slug: slug1 });
      const org2 = await service.create({ name: 'Org 2', slug: slug2 });

      await expect(
        service.update(org2.id, { slug: slug1 }) // Try to use slug1
      ).rejects.toThrow(ConflictError);
    });

    it('should update multiple fields at once', async () => {
      const created = await service.create({
        name: 'Test',
        slug: createUniqueSlug('test'),
      });

      const updated = await service.update(created.id, {
        name: 'New Name',
        description: 'New Description',
        logoUrl: 'https://example.com/new-logo.png',
        websiteUrl: 'https://example.com/new-site',
      });

      expect(updated.name).toBe('New Name');
      expect(updated.description).toBe('New Description');
      expect(updated.logoUrl).toBe('https://example.com/new-logo.png');
      expect(updated.websiteUrl).toBe('https://example.com/new-site');
    });
  });

  describe('delete', () => {
    it('should soft delete organization', async () => {
      const created = await service.create({
        name: 'To Delete',
        slug: createUniqueSlug('delete'),
      });

      await service.delete(created.id);

      const result = await service.get(created.id);
      expect(result).toBeNull();
    });

    it('should throw OrganizationNotFoundError if organization does not exist', async () => {
      await expect(
        service.delete('00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow(OrganizationNotFoundError);
    });

    it('should throw OrganizationNotFoundError if already deleted', async () => {
      const created = await service.create({
        name: 'To Delete',
        slug: createUniqueSlug('delete'),
      });

      await service.delete(created.id);

      await expect(service.delete(created.id)).rejects.toThrow(
        OrganizationNotFoundError
      );
    });
  });

  describe('list', () => {
    // Store created organization IDs for this suite
    let createdOrgIds: string[];

    beforeEach(async () => {
      // Create test organizations and track their IDs
      createdOrgIds = [];
      for (let i = 0; i < 5; i++) {
        const org = await service.create({
          name: `Organization ${i}`,
          slug: createUniqueSlug(`org-${i}`),
          description: `Description for org ${i}`,
        });
        createdOrgIds.push(org.id);
      }
    });

    it('should list all organizations', async () => {
      const result = await service.list();

      // Verify we have at least the organizations we created
      expect(result.items.length).toBeGreaterThanOrEqual(5);
      expect(result.pagination.total).toBeGreaterThanOrEqual(5);
      expect(result.pagination.page).toBe(1);

      // Verify our created organizations are in the list
      const ourOrgIds = createdOrgIds;
      for (const orgId of ourOrgIds) {
        expect(result.items.some((org) => org.id === orgId)).toBe(true);
      }
    });

    it('should paginate organization list', async () => {
      const page1 = await service.list({}, { page: 1, limit: 2 });

      expect(page1.items).toHaveLength(2);
      expect(page1.pagination.totalPages).toBeGreaterThanOrEqual(3);

      const page2 = await service.list({}, { page: 2, limit: 2 });

      expect(page2.items).toHaveLength(2);
      expect(page1.items[0].id).not.toBe(page2.items[0].id);
    });

    it('should search by name', async () => {
      await service.create({
        name: 'Unique Search Term',
        slug: createUniqueSlug('unique'),
      });

      const result = await service.list({ search: 'Unique Search' });

      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.some((org) => org.name.includes('Unique'))).toBe(
        true
      );
    });

    it('should search by description', async () => {
      const result = await service.list({ search: 'Description for org 1' });

      expect(result.items.length).toBeGreaterThan(0);
    });

    it('should not return soft-deleted organizations', async () => {
      // Get the organization before deletion
      const orgBefore = await service.get(createdOrgIds[0]);
      expect(orgBefore).toBeDefined();
      expect(orgBefore?.deletedAt).toBeNull();

      // Delete the organization
      await service.delete(createdOrgIds[0]);

      // Verify it's gone
      const orgAfter = await service.get(createdOrgIds[0]);
      expect(orgAfter).toBeNull();

      // Verify it doesn't appear in list
      const list = await service.list();
      expect(list.items.some((org) => org.id === createdOrgIds[0])).toBe(false);
    });
  });

  describe('isSlugAvailable', () => {
    it('should return true for available slug', async () => {
      const available = await service.isSlugAvailable('new-unique-slug');

      expect(available).toBe(true);
    });

    it('should return false for taken slug', async () => {
      const slug = createUniqueSlug('taken');
      await service.create({
        name: 'Test',
        slug,
      });

      const available = await service.isSlugAvailable(slug);

      expect(available).toBe(false);
    });

    it('should be case-insensitive', async () => {
      const slug = createUniqueSlug('test-case');
      await service.create({
        name: 'Test',
        slug: slug.toLowerCase(),
      });

      const available = await service.isSlugAvailable(slug.toUpperCase());

      expect(available).toBe(false);
    });

    it('should return true for deleted organization slug', async () => {
      const slug = createUniqueSlug('deleted');
      const created = await service.create({
        name: 'To Delete',
        slug,
      });

      await service.delete(created.id);

      const available = await service.isSlugAvailable(slug);

      expect(available).toBe(true);
    });
  });

  describe('pagination determinism', () => {
    it('should return consistent order across pages with identical timestamps', async () => {
      // Create multiple organizations rapidly to potentially have identical timestamps
      const orgs = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          service.create({
            name: `Pagination Test Org ${i}`,
            slug: createUniqueSlug(`pagination-test-${i}`),
          })
        )
      );

      // Get page 1 and page 2 with small page size
      const page1 = await service.list(
        { sortBy: 'createdAt', sortOrder: 'desc' },
        { page: 1, limit: 3 }
      );
      const page2 = await service.list(
        { sortBy: 'createdAt', sortOrder: 'desc' },
        { page: 2, limit: 3 }
      );

      // Collect IDs from both pages
      const page1Ids = page1.items.map((org) => org.id);
      const page2Ids = page2.items.map((org) => org.id);
      const allIds = [...page1Ids, ...page2Ids];

      // Verify no duplicates exist across pages (deterministic ordering)
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(allIds.length);

      // Verify our created orgs appear somewhere in the results
      // (they should be at the top since sorted by createdAt desc)
      const createdIds = orgs.map((org) => org.id);
      const foundIds = createdIds.filter((id) => allIds.includes(id));
      expect(foundIds.length).toBeGreaterThan(0);
    });

    it('should maintain consistent order when fetching same page multiple times', async () => {
      // First, get current total count to understand database state
      const initial = await service.list({}, { page: 1, limit: 1 });
      const totalOrgs = initial.pagination.total;

      // Create some test organizations
      const createdOrgs = await Promise.all(
        Array.from({ length: 4 }, (_, i) =>
          service.create({
            name: `Consistency Test ${i}`,
            slug: createUniqueSlug(`consistency-${i}`),
          })
        )
      );

      // Use a large enough page size to include all data from previous tests + new orgs
      // This ensures we're querying a stable dataset
      const pageSize = Math.min(totalOrgs + createdOrgs.length, 50);

      // Fetch the same page multiple times
      const fetch1 = await service.list(
        { sortBy: 'createdAt', sortOrder: 'desc' },
        { page: 1, limit: pageSize }
      );
      const fetch2 = await service.list(
        { sortBy: 'createdAt', sortOrder: 'desc' },
        { page: 1, limit: pageSize }
      );
      const fetch3 = await service.list(
        { sortBy: 'createdAt', sortOrder: 'desc' },
        { page: 1, limit: pageSize }
      );

      // All fetches should return items in the same order
      const ids1 = fetch1.items.map((org) => org.id);
      const ids2 = fetch2.items.map((org) => org.id);
      const ids3 = fetch3.items.map((org) => org.id);

      expect(ids1).toEqual(ids2);
      expect(ids2).toEqual(ids3);

      // Verify our newly created orgs appear in results (should be at top due to createdAt desc)
      const createdIds = new Set(createdOrgs.map((org) => org.id));
      const topIds = ids1.slice(0, 4);
      const foundNewOrgs = topIds.filter((id) => createdIds.has(id));
      expect(foundNewOrgs.length).toBe(4);
    });
  });
});
