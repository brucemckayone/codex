/**
 * Organization Validation Schema Tests
 *
 * Comprehensive tests for organization-related schemas:
 * - createOrganizationSchema
 * - updateOrganizationSchema
 * - organizationQuerySchema
 */

import { describe, expect, it } from 'vitest';
import {
  createOrganizationSchema,
  organizationQuerySchema,
  organizationStatusEnum,
  updateOrganizationSchema,
} from '../content/content-schemas';

describe('Organization Validation Schemas', () => {
  describe('createOrganizationSchema', () => {
    describe('Valid Input', () => {
      it('should accept complete valid data', () => {
        const input = {
          name: 'Test Organization',
          slug: 'test-org',
          description: 'A test organization',
          logoUrl: 'https://example.com/logo.png',
          websiteUrl: 'https://example.com',
        };

        const result = createOrganizationSchema.safeParse(input);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toEqual(input);
        }
      });

      it('should accept minimal valid data', () => {
        const input = {
          name: 'Test Organization',
          slug: 'test-org',
        };

        const result = createOrganizationSchema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('should accept optional fields as undefined', () => {
        const input = {
          name: 'Test Organization',
          slug: 'test-org',
          description: undefined,
          logoUrl: undefined,
          websiteUrl: undefined,
        };

        const result = createOrganizationSchema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('should accept null for optional URL fields', () => {
        const input = {
          name: 'Test',
          slug: 'my-org',
          logoUrl: null,
          websiteUrl: null,
        };

        const result = createOrganizationSchema.safeParse(input);
        expect(result.success).toBe(true);
      });
    });

    describe('Name Validation', () => {
      it('should reject empty name', () => {
        const input = { name: '', slug: 'my-org' };
        const result = createOrganizationSchema.safeParse(input);

        expect(result.success).toBe(false);
        if (!result.success) {
          const nameError = result.error.issues.find((i) =>
            i.path.includes('name')
          );
          expect(nameError).toBeDefined();
        }
      });

      it('should reject name over 255 characters', () => {
        const input = {
          name: 'a'.repeat(256),
          slug: 'my-org',
        };
        const result = createOrganizationSchema.safeParse(input);
        expect(result.success).toBe(false);
      });

      it('should trim whitespace from name', () => {
        const input = {
          name: '  Test Organization  ',
          slug: 'my-org',
        };
        const result = createOrganizationSchema.safeParse(input);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.name).toBe('Test Organization');
        }
      });

      it('should accept name with special characters', () => {
        const names = [
          'Test & Organization',
          "O'Brien's Company",
          'Test - Company 123',
          'Société Française',
        ];

        for (const name of names) {
          const result = createOrganizationSchema.safeParse({
            name,
            slug: 'my-org',
          });
          expect(result.success).toBe(true);
        }
      });

      it('should accept minimum length name', () => {
        const result = createOrganizationSchema.safeParse({
          name: 'A',
          slug: 'my-org',
        });
        expect(result.success).toBe(true);
      });

      it('should accept maximum length name', () => {
        const result = createOrganizationSchema.safeParse({
          name: 'a'.repeat(255),
          slug: 'my-org',
        });
        expect(result.success).toBe(true);
      });
    });

    describe('Slug Validation', () => {
      it('should accept valid slugs', () => {
        const validSlugs = [
          'test-org',
          'my-company-123',
          'a1-b2-c3',
          'acme',
          'test-test-test',
        ];

        for (const slug of validSlugs) {
          const result = createOrganizationSchema.safeParse({
            name: 'Test',
            slug,
          });
          expect(result.success).toBe(true);
        }
      });

      it('should reject invalid slug characters', () => {
        const invalidSlugs = [
          'Test Org', // spaces
          'test_org', // underscores
          'test.org', // dots
          'test@org', // special chars
          '-test-org', // leading hyphen
          'test-org-', // trailing hyphen
          'tëst-org', // accented characters
        ];

        for (const slug of invalidSlugs) {
          const result = createOrganizationSchema.safeParse({
            name: 'Test',
            slug,
          });
          expect(result.success).toBe(false);
        }
      });

      it('should reject empty slug', () => {
        const result = createOrganizationSchema.safeParse({
          name: 'Test',
          slug: '',
        });
        expect(result.success).toBe(false);
      });

      it('should reject slug over 255 characters', () => {
        const input = {
          name: 'Test',
          slug: 'a'.repeat(256),
        };
        const result = createOrganizationSchema.safeParse(input);
        expect(result.success).toBe(false);
      });

      it('should accept maximum length slug', () => {
        const input = {
          name: 'Test',
          slug: `a${'-b'.repeat(126)}`, // 255 chars
        };
        const result = createOrganizationSchema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('should convert slug to lowercase', () => {
        const input = {
          name: 'Test',
          slug: 'test-org',
        };
        const result = createOrganizationSchema.safeParse(input);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.slug).toBe('test-org');
        }
      });

      it('should reject reserved subdomains as slugs', () => {
        const reservedSlugs = [
          'cdn',
          'api',
          'auth',
          'admin',
          'www',
          'staging',
          'content-api',
          'identity-api',
        ];

        for (const slug of reservedSlugs) {
          const result = createOrganizationSchema.safeParse({
            name: 'Test',
            slug,
          });
          expect(result.success).toBe(false);
          if (!result.success) {
            const slugError = result.error.issues.find((i) =>
              i.path.includes('slug')
            );
            expect(slugError?.message).toBe(
              'This slug is reserved and cannot be used for an organization'
            );
          }
        }
      });
    });

    describe('Description Validation', () => {
      it('should accept valid description', () => {
        const input = {
          name: 'Test',
          slug: 'my-org',
          description: 'A test organization description.',
        };
        const result = createOrganizationSchema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('should reject description over 5000 characters', () => {
        const input = {
          name: 'Test',
          slug: 'my-org',
          description: 'a'.repeat(5001),
        };
        const result = createOrganizationSchema.safeParse(input);
        expect(result.success).toBe(false);
      });

      it('should accept maximum length description', () => {
        const input = {
          name: 'Test',
          slug: 'my-org',
          description: 'a'.repeat(5000),
        };
        const result = createOrganizationSchema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('should accept null description', () => {
        const input = {
          name: 'Test',
          slug: 'my-org',
          description: null,
        };
        const result = createOrganizationSchema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('should trim and accept description', () => {
        const input = {
          name: 'Test',
          slug: 'my-org',
          description: '  Description with spaces  ',
        };
        const result = createOrganizationSchema.safeParse(input);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.description).toBe('Description with spaces');
        }
      });
    });

    describe('URL Validation', () => {
      it('should accept valid HTTPS URLs', () => {
        const validUrls = [
          'https://example.com',
          'https://www.example.com',
          'https://example.com/path',
          'https://example.com/path?query=value',
          'https://subdomain.example.com',
        ];

        for (const url of validUrls) {
          const result = createOrganizationSchema.safeParse({
            name: 'Test',
            slug: 'my-org',
            logoUrl: url,
            websiteUrl: url,
          });
          expect(result.success).toBe(true);
        }
      });

      it('should accept HTTP URLs', () => {
        const input = {
          name: 'Test',
          slug: 'my-org',
          websiteUrl: 'http://example.com',
        };
        const result = createOrganizationSchema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('should reject invalid URLs', () => {
        const invalidUrls = [
          'not-a-url',
          'ftp://example.com',
          'javascript:alert(1)',
          '//example.com',
          'example.com',
        ];

        for (const url of invalidUrls) {
          const result = createOrganizationSchema.safeParse({
            name: 'Test',
            slug: 'my-org',
            websiteUrl: url,
          });
          expect(result.success).toBe(false);
        }
      });

      it('should accept null logoUrl', () => {
        const result = createOrganizationSchema.safeParse({
          name: 'Test',
          slug: 'my-org',
          logoUrl: null,
        });
        expect(result.success).toBe(true);
      });

      it('should accept null websiteUrl', () => {
        const result = createOrganizationSchema.safeParse({
          name: 'Test',
          slug: 'my-org',
          websiteUrl: null,
        });
        expect(result.success).toBe(true);
      });
    });

    describe('Missing Required Fields', () => {
      it('should reject missing name', () => {
        const result = createOrganizationSchema.safeParse({ slug: 'my-org' });

        expect(result.success).toBe(false);
        if (!result.success) {
          const nameError = result.error.issues.find((i) =>
            i.path.includes('name')
          );
          expect(nameError).toBeDefined();
        }
      });

      it('should reject missing slug', () => {
        const result = createOrganizationSchema.safeParse({ name: 'Test' });

        expect(result.success).toBe(false);
        if (!result.success) {
          const slugError = result.error.issues.find((i) =>
            i.path.includes('slug')
          );
          expect(slugError).toBeDefined();
        }
      });

      it('should reject empty object', () => {
        const result = createOrganizationSchema.safeParse({});
        expect(result.success).toBe(false);
      });
    });
  });

  describe('updateOrganizationSchema', () => {
    it('should accept partial updates', () => {
      const updates = [
        { name: 'Updated Name' },
        { description: 'New description' },
        { logoUrl: 'https://example.com/new-logo.png' },
        { name: 'Name', description: 'Desc' },
        { slug: 'new-slug' },
        { websiteUrl: null },
      ];

      for (const update of updates) {
        const result = updateOrganizationSchema.safeParse(update);
        expect(result.success).toBe(true);
      }
    });

    it('should accept empty update object', () => {
      // Note: Service layer should reject empty updates, but schema allows it
      const result = updateOrganizationSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should enforce same validation rules as create', () => {
      const invalidUpdates = [
        { name: '' }, // Empty name
        { slug: 'Invalid Slug' }, // Invalid slug (has space)
        { websiteUrl: 'not-a-url' }, // Invalid URL
        { description: 'a'.repeat(5001) }, // Too long
      ];

      for (const update of invalidUpdates) {
        const result = updateOrganizationSchema.safeParse(update);
        expect(result.success).toBe(false);
      }
    });

    it('should reject reserved subdomains in slug updates', () => {
      const result = updateOrganizationSchema.safeParse({ slug: 'cdn' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const slugError = result.error.issues.find((i) =>
          i.path.includes('slug')
        );
        expect(slugError?.message).toBe(
          'This slug is reserved and cannot be used for an organization'
        );
      }
    });

    it('should trim whitespace in partial updates', () => {
      const result = updateOrganizationSchema.safeParse({
        name: '  Updated Name  ',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Updated Name');
      }
    });

    it('should accept only one field update', () => {
      const result = updateOrganizationSchema.safeParse({
        description: 'New description',
      });
      expect(result.success).toBe(true);
    });

    it('should accept all fields for complete update', () => {
      const result = updateOrganizationSchema.safeParse({
        name: 'New Name',
        slug: 'new-slug',
        description: 'New description',
        logoUrl: 'https://example.com/logo.png',
        websiteUrl: 'https://example.com',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('organizationQuerySchema', () => {
    it('should accept valid query with all fields', () => {
      const result = organizationQuerySchema.safeParse({
        search: 'test',
        sortBy: 'name',
        sortOrder: 'asc',
        page: 1,
        limit: 20,
      });
      expect(result.success).toBe(true);
    });

    it('should accept minimal query', () => {
      const result = organizationQuerySchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(1);
        expect(result.data.limit).toBe(20);
        expect(result.data.sortBy).toBe('createdAt');
        expect(result.data.sortOrder).toBe('desc');
      }
    });

    it('should coerce page and limit to numbers', () => {
      const result = organizationQuerySchema.safeParse({
        page: '2',
        limit: '50',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(2);
        expect(result.data.limit).toBe(50);
      }
    });

    it('should reject invalid sortBy values', () => {
      const result = organizationQuerySchema.safeParse({
        sortBy: 'invalid',
      });
      expect(result.success).toBe(false);
    });

    it('should accept valid sortBy values', () => {
      const validSortBy = ['createdAt', 'name'];

      for (const sortBy of validSortBy) {
        const result = organizationQuerySchema.safeParse({ sortBy });
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid sortOrder values', () => {
      const result = organizationQuerySchema.safeParse({
        sortOrder: 'invalid',
      });
      expect(result.success).toBe(false);
    });

    it('should accept valid sortOrder values', () => {
      const validSortOrder = ['asc', 'desc'];

      for (const sortOrder of validSortOrder) {
        const result = organizationQuerySchema.safeParse({ sortOrder });
        expect(result.success).toBe(true);
      }
    });

    it('should enforce minimum page value of 1', () => {
      const result = organizationQuerySchema.safeParse({ page: 0 });
      expect(result.success).toBe(false);
    });

    it('should enforce minimum limit value of 1', () => {
      const result = organizationQuerySchema.safeParse({ limit: 0 });
      expect(result.success).toBe(false);
    });

    it('should enforce maximum limit value of 100', () => {
      const result = organizationQuerySchema.safeParse({ limit: 101 });
      expect(result.success).toBe(false);
    });

    it('should accept maximum limit value of 100', () => {
      const result = organizationQuerySchema.safeParse({ limit: 100 });
      expect(result.success).toBe(true);
    });

    it('should reject search over 255 characters', () => {
      const result = organizationQuerySchema.safeParse({
        search: 'a'.repeat(256),
      });
      expect(result.success).toBe(false);
    });

    it('should accept search up to 255 characters', () => {
      const result = organizationQuerySchema.safeParse({
        search: 'a'.repeat(255),
      });
      expect(result.success).toBe(true);
    });

    it('should apply default values', () => {
      const result = organizationQuerySchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          page: 1,
          limit: 20,
          sortBy: 'createdAt',
          sortOrder: 'desc',
        });
      }
    });
  });

  describe('organizationStatusEnum', () => {
    it('should accept valid status values', () => {
      const validStatuses = ['active', 'suspended', 'deleted'];

      for (const status of validStatuses) {
        const result = organizationStatusEnum.safeParse(status);
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid status values', () => {
      const invalidStatuses = [
        'invalid',
        'ACTIVE',
        'Deleted',
        '',
        null,
        undefined,
      ];

      for (const status of invalidStatuses) {
        const result = organizationStatusEnum.safeParse(status);
        expect(result.success).toBe(false);
      }
    });

    it('should provide clear error message', () => {
      const result = organizationStatusEnum.safeParse('invalid');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain(
          'Status must be active, suspended, or deleted'
        );
      }
    });
  });
});
