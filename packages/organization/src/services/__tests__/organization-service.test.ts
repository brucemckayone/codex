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

import * as schema from '@codex/database/schema';
import {
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
  validateDatabaseConnection,
} from '@codex/test-utils';
import type { CreateOrganizationInput } from '@codex/validation';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ConflictError,
  LastOwnerError,
  MemberNotFoundError,
  NotFoundError,
  OrganizationNotFoundError,
} from '../../errors';
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
      // Create isolated test data with unique prefix for filtering
      const testPrefix = `paginate-test-${Date.now()}`;
      const createdIds: string[] = [];

      for (let i = 0; i < 5; i++) {
        const org = await service.create({
          name: `${testPrefix} Org ${i}`,
          slug: createUniqueSlug(`paginate-${i}`),
        });
        createdIds.push(org.id);
      }

      // Query only our test data using search filter
      const page1 = await service.list(
        { search: testPrefix },
        { page: 1, limit: 2 }
      );
      const page2 = await service.list(
        { search: testPrefix },
        { page: 2, limit: 2 }
      );

      expect(page1.items).toHaveLength(2);
      expect(page1.pagination.total).toBe(5);
      expect(page1.pagination.totalPages).toBe(3);

      expect(page2.items).toHaveLength(2);
      expect(page1.items[0].id).not.toBe(page2.items[0].id);

      // Verify all returned items are from our test data
      const allReturnedIds = [...page1.items, ...page2.items].map((o) => o.id);
      for (const id of allReturnedIds) {
        expect(createdIds).toContain(id);
      }
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
      // Create isolated test data with unique prefix for filtering
      const testPrefix = `determ-test-${Date.now()}`;

      // Create multiple organizations rapidly to potentially have identical timestamps
      const orgs = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          service.create({
            name: `${testPrefix} Org ${i}`,
            slug: createUniqueSlug(`determ-${i}`),
          })
        )
      );

      // Get page 1 and page 2 with small page size (filtered to our test data)
      const page1 = await service.list(
        { search: testPrefix, sortBy: 'createdAt', sortOrder: 'desc' },
        { page: 1, limit: 3 }
      );
      const page2 = await service.list(
        { search: testPrefix, sortBy: 'createdAt', sortOrder: 'desc' },
        { page: 2, limit: 3 }
      );

      // Collect IDs from both pages
      const page1Ids = page1.items.map((org) => org.id);
      const page2Ids = page2.items.map((org) => org.id);
      const allIds = [...page1Ids, ...page2Ids];

      // Verify we got exactly our 6 orgs across 2 pages
      expect(page1Ids).toHaveLength(3);
      expect(page2Ids).toHaveLength(3);
      expect(allIds).toHaveLength(6);

      // Verify no duplicates exist across pages (deterministic ordering)
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(6);

      // Verify all returned IDs are from our created orgs
      const createdIds = new Set(orgs.map((org) => org.id));
      for (const id of allIds) {
        expect(createdIds.has(id)).toBe(true);
      }
    });

    it('should maintain consistent order when fetching same page multiple times', async () => {
      // Create isolated test data with unique prefix for filtering
      const testPrefix = `consistency-test-${Date.now()}`;

      // Create test organizations (sequentially to ensure distinct timestamps)
      for (let i = 0; i < 4; i++) {
        await service.create({
          name: `${testPrefix} Org ${i}`,
          slug: createUniqueSlug(`consistency-${i}`),
        });
      }

      // Fetch the same filtered page multiple times
      const fetch1 = await service.list(
        { search: testPrefix, sortBy: 'createdAt', sortOrder: 'desc' },
        { page: 1, limit: 3 }
      );
      const fetch2 = await service.list(
        { search: testPrefix, sortBy: 'createdAt', sortOrder: 'desc' },
        { page: 1, limit: 3 }
      );
      const fetch3 = await service.list(
        { search: testPrefix, sortBy: 'createdAt', sortOrder: 'desc' },
        { page: 1, limit: 3 }
      );

      // All fetches should return items in the same order
      const ids1 = fetch1.items.map((org) => org.id);
      const ids2 = fetch2.items.map((org) => org.id);
      const ids3 = fetch3.items.map((org) => org.id);

      expect(ids1).toHaveLength(3);
      expect(ids1).toEqual(ids2);
      expect(ids2).toEqual(ids3);
    });
  });

  /**
   * Member Management Tests
   *
   * Tests for organization member CRUD operations:
   * - listMembers: Paginated member listing with filters
   * - inviteMember: Adding users to organizations
   * - updateMemberRole: Changing member roles with safety checks
   * - removeMember: Removing members with safety checks
   */
  describe('member management', () => {
    let testOrgId: string;
    let testUserIds: string[];
    let inviterUserId: string;

    beforeEach(async () => {
      // Create test organization
      const org = await service.create({
        name: `Test Org ${Date.now()}`,
        slug: createUniqueSlug('test-org'),
      });
      testOrgId = org.id;

      // Create test users (need real users for membership operations)
      testUserIds = await seedTestUsers(db, 4);
      inviterUserId = testUserIds[0];

      // Add inviter as owner of the organization
      await db.insert(schema.organizationMemberships).values({
        organizationId: testOrgId,
        userId: inviterUserId,
        role: 'owner',
        status: 'active',
        invitedBy: null,
      });
    });

    describe('listMembers', () => {
      beforeEach(async () => {
        // Add initial members to organization
        await db.insert(schema.organizationMemberships).values([
          {
            organizationId: testOrgId,
            userId: testUserIds[1],
            role: 'admin',
            status: 'active',
            invitedBy: inviterUserId,
          },
          {
            organizationId: testOrgId,
            userId: testUserIds[2],
            role: 'member',
            status: 'active',
            invitedBy: inviterUserId,
          },
          {
            organizationId: testOrgId,
            userId: testUserIds[3],
            role: 'member',
            status: 'inactive',
            invitedBy: inviterUserId,
          },
        ]);
      });

      it('should return paginated list of members', async () => {
        const result = await service.listMembers(testOrgId, {
          page: 1,
          limit: 10,
        });

        expect(result.items).toHaveLength(4); // owner + admin + 2 members
        expect(result.pagination.page).toBe(1);
        expect(result.pagination.limit).toBe(10);
        expect(result.pagination.total).toBe(4);
        expect(result.pagination.totalPages).toBe(1);
      });

      it('should filter members by role', async () => {
        const result = await service.listMembers(testOrgId, {
          page: 1,
          limit: 10,
          role: 'admin',
        });

        expect(result.items).toHaveLength(1);
        expect(result.items[0].role).toBe('admin');
      });

      it('should filter members by status', async () => {
        const result = await service.listMembers(testOrgId, {
          page: 1,
          limit: 10,
          status: 'active',
        });

        expect(result.items).toHaveLength(3); // owner + admin + active member
        expect(result.items.every((m) => m.status === 'active')).toBe(true);
      });

      it('should paginate correctly with small page size', async () => {
        const result = await service.listMembers(testOrgId, {
          page: 1,
          limit: 2,
        });

        expect(result.items).toHaveLength(2);
        expect(result.pagination.totalPages).toBe(2);
        expect(result.pagination.page).toBe(1);
      });

      it('should return empty list for organization with no members', async () => {
        const emptyOrg = await service.create({
          name: `Empty Org ${Date.now()}`,
          slug: createUniqueSlug('empty-org'),
        });

        const result = await service.listMembers(emptyOrg.id, {
          page: 1,
          limit: 10,
        });

        expect(result.items).toHaveLength(0);
        expect(result.pagination.total).toBe(0);
      });

      it('should include user details in response', async () => {
        const result = await service.listMembers(testOrgId, {
          page: 1,
          limit: 10,
        });

        expect(result.items[0]).toHaveProperty('userId');
        expect(result.items[0]).toHaveProperty('name');
        expect(result.items[0]).toHaveProperty('email');
        expect(result.items[0]).toHaveProperty('avatarUrl');
        expect(result.items[0]).toHaveProperty('role');
        expect(result.items[0]).toHaveProperty('status');
        expect(result.items[0]).toHaveProperty('joinedAt');
      });
    });

    describe('inviteMember', () => {
      // Helper to get user email
      async function getUserEmail(userId: string): Promise<string> {
        const user = await db.query.users.findFirst({
          where: (users, { eq }) => eq(users.id, userId),
          columns: { email: true },
        });
        if (!user) {
          throw new Error(`User not found: ${userId}`);
        }
        return user.email;
      }

      let newUserId: string;

      beforeEach(async () => {
        // Create a user to invite
        [newUserId] = await seedTestUsers(db, 1);
      });

      it('should create membership with valid email', async () => {
        const email = await getUserEmail(newUserId);

        const result = await service.inviteMember(
          testOrgId,
          { email, role: 'member' },
          inviterUserId
        );

        expect(result.userId).toBe(newUserId);
        expect(result.role).toBe('member');
        expect(result.status).toBe('active');
        expect(result.joinedAt).toBeInstanceOf(Date);
        expect(result.id).toBeDefined();
      });

      it('should set role correctly', async () => {
        const email = await getUserEmail(newUserId);

        const result = await service.inviteMember(
          testOrgId,
          { email, role: 'admin' },
          inviterUserId
        );

        expect(result.role).toBe('admin');
      });

      it('should set status to active by default', async () => {
        const email = await getUserEmail(newUserId);

        const result = await service.inviteMember(
          testOrgId,
          { email, role: 'creator' },
          inviterUserId
        );

        expect(result.status).toBe('active');
      });

      it('should throw NotFoundError for non-existent user', async () => {
        await expect(
          service.inviteMember(
            testOrgId,
            { email: 'nonexistent@example.com', role: 'member' },
            inviterUserId
          )
        ).rejects.toThrow(NotFoundError);
      });

      it('should throw ConflictError for duplicate member', async () => {
        const email = await getUserEmail(testUserIds[1]);

        // First invite should succeed
        await service.inviteMember(
          testOrgId,
          { email, role: 'member' },
          inviterUserId
        );

        // Second invite should fail
        await expect(
          service.inviteMember(
            testOrgId,
            { email, role: 'admin' },
            inviterUserId
          )
        ).rejects.toThrow(ConflictError);
      });
    });

    describe('updateMemberRole', () => {
      beforeEach(async () => {
        // Add a test member
        await db.insert(schema.organizationMemberships).values({
          organizationId: testOrgId,
          userId: testUserIds[1],
          role: 'member',
          status: 'active',
          invitedBy: inviterUserId,
        });
      });

      it('should update member role', async () => {
        const result = await service.updateMemberRole(
          testOrgId,
          testUserIds[1],
          'admin'
        );

        expect(result.userId).toBe(testUserIds[1]);
        expect(result.role).toBe('admin');
        expect(result.status).toBe('active');
      });

      it('should promote member to owner', async () => {
        const result = await service.updateMemberRole(
          testOrgId,
          testUserIds[1],
          'owner'
        );

        expect(result.role).toBe('owner');
      });

      it('should throw MemberNotFoundError for non-existent member', async () => {
        await expect(
          service.updateMemberRole(testOrgId, 'nonexistent-user-id', 'admin')
        ).rejects.toThrow(MemberNotFoundError);
      });

      it('should throw LastOwnerError when demoting last owner', async () => {
        // Try to demote the only owner
        await expect(
          service.updateMemberRole(testOrgId, inviterUserId, 'admin')
        ).rejects.toThrow(LastOwnerError);
      });

      it('should allow demotion when multiple owners exist', async () => {
        // Promote another user to owner first
        await db.insert(schema.organizationMemberships).values({
          organizationId: testOrgId,
          userId: testUserIds[2],
          role: 'owner',
          status: 'active',
          invitedBy: inviterUserId,
        });

        // Now we can demote the first owner
        const result = await service.updateMemberRole(
          testOrgId,
          inviterUserId,
          'admin'
        );

        expect(result.role).toBe('admin');
      });
    });

    describe('removeMember', () => {
      beforeEach(async () => {
        // Add test members
        await db.insert(schema.organizationMemberships).values([
          {
            organizationId: testOrgId,
            userId: testUserIds[1],
            role: 'admin',
            status: 'active',
            invitedBy: inviterUserId,
          },
          {
            organizationId: testOrgId,
            userId: testUserIds[2],
            role: 'member',
            status: 'active',
            invitedBy: inviterUserId,
          },
        ]);
      });

      it('should remove member from organization', async () => {
        await service.removeMember(testOrgId, testUserIds[1]);

        // Verify member is removed
        const membership = await db.query.organizationMemberships.findFirst({
          where: (memberships, { and, eq }) =>
            and(
              eq(memberships.organizationId, testOrgId),
              eq(memberships.userId, testUserIds[1])
            ),
        });

        expect(membership).toBeUndefined();
      });

      it('should throw MemberNotFoundError for non-existent member', async () => {
        await expect(
          service.removeMember(testOrgId, 'nonexistent-user-id')
        ).rejects.toThrow(MemberNotFoundError);
      });

      it('should throw LastOwnerError when removing last owner', async () => {
        await expect(
          service.removeMember(testOrgId, inviterUserId)
        ).rejects.toThrow(LastOwnerError);
      });

      it('should allow removing owner when multiple owners exist', async () => {
        // Add another owner
        await db.insert(schema.organizationMemberships).values({
          organizationId: testOrgId,
          userId: testUserIds[1],
          role: 'owner',
          status: 'active',
          invitedBy: inviterUserId,
        });

        // Now we can remove the first owner
        await service.removeMember(testOrgId, inviterUserId);

        // Verify removal
        const membership = await db.query.organizationMemberships.findFirst({
          where: (memberships, { and, eq }) =>
            and(
              eq(memberships.organizationId, testOrgId),
              eq(memberships.userId, inviterUserId)
            ),
        });

        expect(membership).toBeUndefined();
      });

      it('should allow removing non-owner members', async () => {
        await service.removeMember(testOrgId, testUserIds[2]);

        // Verify removal
        const membership = await db.query.organizationMemberships.findFirst({
          where: (memberships, { and, eq }) =>
            and(
              eq(memberships.organizationId, testOrgId),
              eq(memberships.userId, testUserIds[2])
            ),
        });

        expect(membership).toBeUndefined();
      });
    });
  });
});
