/**
 * Identity Package - Integration Tests
 *
 * Cross-service integration tests covering:
 * - Organization creation and management workflows
 * - Organization with content relationships
 * - Multi-user organization scenarios
 * - Organization scoping and access patterns
 *
 * Test Count: 10+ tests
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  setupTestDatabase,
  cleanupDatabase,
  seedTestUsers,
  createUniqueSlug,
  type Database,
} from '@codex/test-utils';
import { OrganizationService } from '../services';

describe('Identity Integration Tests', () => {
  let db: Database;
  let orgService: OrganizationService;
  let creatorId: string;
  let otherCreatorId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    const config = { db, environment: 'test' };

    orgService = new OrganizationService(config);

    const userIds = await seedTestUsers(db, 2);
    [creatorId, otherCreatorId] = userIds;
  });

  beforeEach(async () => {
    await cleanupDatabase(db);
  });

  afterAll(async () => {
    await cleanupDatabase(db);
  });

  describe('Organization Creation Workflow', () => {
    it('should create organization with unique slug', async () => {
      const slug = createUniqueSlug('test-org');

      const org = await orgService.create({
        name: 'Test Organization',
        slug,
        creatorId,
      });

      expect(org).toBeDefined();
      expect(org.id).toBeDefined();
      expect(org.name).toBe('Test Organization');
      expect(org.slug).toBe(slug);
      expect(org.creatorId).toBe(creatorId);
      expect(org.createdAt).toBeInstanceOf(Date);
      expect(org.updatedAt).toBeInstanceOf(Date);
    });

    it('should prevent duplicate slugs', async () => {
      const slug = createUniqueSlug('duplicate-org');

      await orgService.create({
        name: 'First Organization',
        slug,
        creatorId,
      });

      await expect(
        orgService.create({
          name: 'Second Organization',
          slug, // Same slug
          creatorId: otherCreatorId,
        })
      ).rejects.toThrow(/slug.*exists/i);
    });

    it('should allow same name for different organizations', async () => {
      const name = 'Acme Inc';

      const org1 = await orgService.create({
        name,
        slug: createUniqueSlug('acme-1'),
        creatorId,
      });

      const org2 = await orgService.create({
        name,
        slug: createUniqueSlug('acme-2'),
        creatorId: otherCreatorId,
      });

      expect(org1.name).toBe(name);
      expect(org2.name).toBe(name);
      expect(org1.slug).not.toBe(org2.slug);
    });
  });

  describe('Organization Retrieval', () => {
    it('should retrieve organization by ID', async () => {
      const slug = createUniqueSlug('retrieve-test');
      const created = await orgService.create({
        name: 'Retrieve Test Org',
        slug,
        creatorId,
      });

      const retrieved = await orgService.getById(created.id, creatorId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.name).toBe(created.name);
      expect(retrieved?.slug).toBe(created.slug);
    });

    it('should retrieve organization by slug', async () => {
      const slug = createUniqueSlug('slug-lookup');
      const created = await orgService.create({
        name: 'Slug Lookup Org',
        slug,
        creatorId,
      });

      const retrieved = await orgService.getBySlug(slug, creatorId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.slug).toBe(slug);
      expect(retrieved?.id).toBe(created.id);
    });

    it('should return null for non-existent organization', async () => {
      const nonExistent = await orgService.getById(
        'non-existent-id',
        creatorId
      );
      expect(nonExistent).toBeNull();
    });

    it('should return null when accessing other creator organization', async () => {
      const slug = createUniqueSlug('creator-isolation');
      const org = await orgService.create({
        name: 'Creator Isolated Org',
        slug,
        creatorId,
      });

      // Try to access with different creator ID
      const accessed = await orgService.getById(org.id, otherCreatorId);
      expect(accessed).toBeNull();
    });
  });

  describe('Organization Updates', () => {
    it('should update organization name and description', async () => {
      const slug = createUniqueSlug('update-test');
      const org = await orgService.create({
        name: 'Original Name',
        slug,
        creatorId,
      });

      const updated = await orgService.update(org.id, {
        name: 'Updated Name',
        description: 'New description',
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.description).toBe('New description');
      expect(updated.slug).toBe(slug); // Slug unchanged
      expect(updated.updatedAt.getTime()).toBeGreaterThan(
        org.updatedAt.getTime()
      );
    });

    it('should prevent slug updates', async () => {
      const slug = createUniqueSlug('immutable-slug');
      const org = await orgService.create({
        name: 'Slug Test',
        slug,
        creatorId,
      });

      // Attempting to update slug should be ignored
      const updated = await orgService.update(org.id, {
        slug: 'new-slug', // This should be ignored
        name: 'Updated Name',
      } as any);

      expect(updated.slug).toBe(slug); // Original slug preserved
      expect(updated.name).toBe('Updated Name');
    });

    it('should update optional fields individually', async () => {
      const slug = createUniqueSlug('partial-update');
      const org = await orgService.create({
        name: 'Test Org',
        slug,
        creatorId,
      });

      // Update website only
      const withWebsite = await orgService.update(org.id, {
        websiteUrl: 'https://example.com',
      });
      expect(withWebsite.websiteUrl).toBe('https://example.com');
      expect(withWebsite.name).toBe('Test Org');

      // Update logo URL only
      const withLogo = await orgService.update(org.id, {
        logoUrl: 'https://cdn.example.com/logo.png',
      });
      expect(withLogo.logoUrl).toBe('https://cdn.example.com/logo.png');
      expect(withLogo.websiteUrl).toBe('https://example.com'); // Previous update preserved
    });
  });

  describe('Organization Listing', () => {
    beforeEach(async () => {
      // Create multiple organizations for listing tests
      await orgService.create({
        name: 'Alpha Organization',
        slug: createUniqueSlug('alpha'),
        creatorId,
      });

      await orgService.create({
        name: 'Beta Organization',
        slug: createUniqueSlug('beta'),
        creatorId,
      });

      await orgService.create({
        name: 'Gamma Organization',
        slug: createUniqueSlug('gamma'),
        creatorId: otherCreatorId, // Different creator
      });
    });

    it('should list organizations for specific creator', async () => {
      const orgs = await orgService.list({
        creatorId,
        limit: 10,
        offset: 0,
      });

      expect(orgs.length).toBe(2);
      expect(orgs.every((org) => org.creatorId === creatorId)).toBe(true);
    });

    it('should respect pagination limits', async () => {
      const firstPage = await orgService.list({
        creatorId,
        limit: 1,
        offset: 0,
      });

      const secondPage = await orgService.list({
        creatorId,
        limit: 1,
        offset: 1,
      });

      expect(firstPage.length).toBe(1);
      expect(secondPage.length).toBe(1);
      expect(firstPage[0].id).not.toBe(secondPage[0].id);
    });

    it('should return empty array for creator with no organizations', async () => {
      await cleanupDatabase(db);

      const orgs = await orgService.list({
        creatorId,
        limit: 10,
        offset: 0,
      });

      expect(orgs).toEqual([]);
    });
  });

  describe('Organization Deletion', () => {
    it('should soft delete organization', async () => {
      const slug = createUniqueSlug('delete-test');
      const org = await orgService.create({
        name: 'To Be Deleted',
        slug,
        creatorId,
      });

      await orgService.delete(org.id);

      // Should not be retrievable after deletion
      const retrieved = await orgService.getById(org.id, creatorId);
      expect(retrieved).toBeNull();
    });

    it('should not list deleted organizations', async () => {
      const org1 = await orgService.create({
        name: 'Org 1',
        slug: createUniqueSlug('org-1'),
        creatorId,
      });

      const org2 = await orgService.create({
        name: 'Org 2',
        slug: createUniqueSlug('org-2'),
        creatorId,
      });

      await orgService.delete(org1.id);

      const orgs = await orgService.list({
        creatorId,
        limit: 10,
        offset: 0,
      });

      expect(orgs.length).toBe(1);
      expect(orgs[0].id).toBe(org2.id);
    });

    it('should allow slug reuse after deletion', async () => {
      const slug = createUniqueSlug('reusable-slug');

      const org1 = await orgService.create({
        name: 'First Org',
        slug,
        creatorId,
      });

      await orgService.delete(org1.id);

      // Should be able to create new org with same slug after deletion
      const org2 = await orgService.create({
        name: 'Second Org',
        slug,
        creatorId: otherCreatorId,
      });

      expect(org2.slug).toBe(slug);
      expect(org2.id).not.toBe(org1.id);
    });
  });

  describe('Creator Isolation', () => {
    it('should only list organizations created by specific creator', async () => {
      await orgService.create({
        name: 'Creator 1 Org A',
        slug: createUniqueSlug('c1-org-a'),
        creatorId,
      });

      await orgService.create({
        name: 'Creator 1 Org B',
        slug: createUniqueSlug('c1-org-b'),
        creatorId,
      });

      await orgService.create({
        name: 'Creator 2 Org A',
        slug: createUniqueSlug('c2-org-a'),
        creatorId: otherCreatorId,
      });

      const creator1Orgs = await orgService.list({
        creatorId,
        limit: 10,
        offset: 0,
      });

      const creator2Orgs = await orgService.list({
        creatorId: otherCreatorId,
        limit: 10,
        offset: 0,
      });

      expect(creator1Orgs.length).toBe(2);
      expect(creator2Orgs.length).toBe(1);
      expect(creator1Orgs.every((org) => org.creatorId === creatorId)).toBe(
        true
      );
      expect(
        creator2Orgs.every((org) => org.creatorId === otherCreatorId)
      ).toBe(true);
    });
  });

  describe('Validation Edge Cases', () => {
    it('should handle very long organization names', async () => {
      const longName = 'A'.repeat(200); // Within 500 char limit
      const slug = createUniqueSlug('long-name');

      const org = await orgService.create({
        name: longName,
        slug,
        creatorId,
      });

      expect(org.name).toBe(longName);
    });

    it('should handle special characters in name', async () => {
      const specialName = 'Test & Co., Inc. (2025)';
      const slug = createUniqueSlug('special-chars');

      const org = await orgService.create({
        name: specialName,
        slug,
        creatorId,
      });

      expect(org.name).toBe(specialName);
    });

    it('should handle valid URLs in optional fields', async () => {
      const slug = createUniqueSlug('url-test');

      const org = await orgService.create({
        name: 'URL Test Org',
        slug,
        creatorId,
        websiteUrl: 'https://example.com/path?query=value',
        logoUrl: 'https://cdn.example.com/images/logo.png',
      });

      expect(org.websiteUrl).toBe('https://example.com/path?query=value');
      expect(org.logoUrl).toBe('https://cdn.example.com/images/logo.png');
    });
  });
});
