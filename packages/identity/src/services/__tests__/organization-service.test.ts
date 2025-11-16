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
 */

import {
  cleanupDatabase,
  createUniqueSlug,
  type Database,
  setupTestDatabase,
} from '@codex/test-utils';
import type { CreateOrganizationInput } from '@codex/validation';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConflictError, OrganizationNotFoundError } from '../../errors';
import { OrganizationService } from '../organization-service';

describe('OrganizationService', () => {
  let db: Database;
  let service: OrganizationService;

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new OrganizationService({ db, environment: 'test' });
  });

  beforeEach(async () => {
    await cleanupDatabase(db);
  });

  afterAll(async () => {
    await cleanupDatabase(db);
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
    beforeEach(async () => {
      // Create test organizations
      for (let i = 0; i < 5; i++) {
        await service.create({
          name: `Organization ${i}`,
          slug: createUniqueSlug(`org-${i}`),
          description: `Description for org ${i}`,
        });
      }
    });

    it('should list all organizations', async () => {
      const result = await service.list();

      expect(result.items).toHaveLength(5);
      expect(result.pagination.total).toBe(5);
      expect(result.pagination.page).toBe(1);
    });

    it('should paginate organization list', async () => {
      const page1 = await service.list({}, { page: 1, limit: 2 });

      expect(page1.items).toHaveLength(2);
      expect(page1.pagination.totalPages).toBe(3);

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
      const all = await service.list();
      await service.delete(all.items[0].id);

      const result = await service.list();

      expect(result.items).toHaveLength(4);
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
});
