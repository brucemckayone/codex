import { describe, expect, it } from 'vitest';
import {
  contentQuerySchema,
  contentStatusEnum,
  contentTypeEnum,
  createContentSchema,
  createMediaItemSchema,
  createOrganizationSchema,
  mediaQuerySchema,
  mediaStatusEnum,
  mediaTypeEnum,
  updateContentSchema,
  updateMediaItemSchema,
  updateOrganizationSchema,
  uploadRequestSchema,
  visibilityEnum,
} from './content-schemas';

/**
 * Content Validation Schema Tests
 *
 * Test Strategy:
 * 1. Valid inputs (happy path)
 * 2. Invalid inputs (error cases)
 * 3. Edge cases (boundary conditions)
 * 4. Security validations (XSS, injection, path traversal)
 * 5. Database constraint alignment
 *
 * No database required - pure validation logic testing
 */

describe('Organization Schemas', () => {
  describe('createOrganizationSchema', () => {
    it('should validate correct organization data', () => {
      const validOrg = {
        name: 'Acme Corporation',
        slug: 'acme-corp',
        description: 'A leading provider of innovative solutions',
        logoUrl: 'https://example.com/logo.png',
        websiteUrl: 'https://acme.com',
      };

      const result = createOrganizationSchema.parse(validOrg);
      expect(result).toEqual(validOrg);
    });

    it('should validate minimal organization data', () => {
      const minimalOrg = {
        name: 'A',
        slug: 'a',
      };

      const result = createOrganizationSchema.parse(minimalOrg);
      expect(result.name).toBe('A');
      expect(result.slug).toBe('a');
    });

    it('should reject empty name', () => {
      expect(() =>
        createOrganizationSchema.parse({
          name: '',
          slug: 'test',
        })
      ).toThrow('Organization name must be at least 1 characters');
    });

    it('should reject name exceeding 255 characters', () => {
      expect(() =>
        createOrganizationSchema.parse({
          name: 'a'.repeat(256),
          slug: 'test',
        })
      ).toThrow('Organization name must be 255 characters or less');
    });

    it('should reject invalid slug format', () => {
      const invalidSlugs = [
        'spaces in slug',
        'special@chars',
        'special_chars',
        '-leading-hyphen',
        'trailing-hyphen-',
        'double--hyphen',
        '',
      ];

      invalidSlugs.forEach((slug) => {
        expect(() =>
          createOrganizationSchema.parse({
            name: 'Test',
            slug,
          })
        ).toThrow();
      });
    });

    it('should transform slug to lowercase', () => {
      const result = createOrganizationSchema.parse({
        name: 'Test',
        slug: 'TEST-SLUG',
      });

      expect(result.slug).toBe('test-slug');
    });

    it('should reject non-HTTP(S) URLs', () => {
      expect(() =>
        createOrganizationSchema.parse({
          name: 'Test',
          slug: 'test',
          logoUrl: 'javascript:alert(1)',
        })
      ).toThrow('URL must use HTTP or HTTPS protocol');

      expect(() =>
        createOrganizationSchema.parse({
          name: 'Test',
          slug: 'test',
          websiteUrl: 'data:text/html,<script>alert(1)</script>',
        })
      ).toThrow('URL must use HTTP or HTTPS protocol');
    });
  });

  describe('updateOrganizationSchema', () => {
    it('should allow partial updates', () => {
      const partialUpdate = {
        name: 'Updated Name',
      };

      const result = updateOrganizationSchema.parse(partialUpdate);
      expect(result.name).toBe('Updated Name');
      expect(result.slug).toBeUndefined();
    });

    it('should allow empty object', () => {
      const result = updateOrganizationSchema.parse({});
      expect(result).toEqual({});
    });
  });
});

describe('Media Item Schemas', () => {
  describe('createMediaItemSchema', () => {
    it('should validate correct video media data', () => {
      const validMedia = {
        title: 'My Awesome Video',
        description: 'A great video about coding',
        mediaType: 'video' as const,
        mimeType: 'video/mp4' as const,
        fileSizeBytes: 10485760, // 10MB
        r2Key: 'originals/abc123/video.mp4',
      };

      const result = createMediaItemSchema.parse(validMedia);
      expect(result).toEqual(validMedia);
    });

    it('should validate correct audio media data', () => {
      const validMedia = {
        title: 'Podcast Episode 1',
        mediaType: 'audio' as const,
        mimeType: 'audio/mpeg' as const,
        fileSizeBytes: 5242880, // 5MB
        r2Key: 'originals/def456/audio.mp3',
      };

      const result = createMediaItemSchema.parse(validMedia);
      expect(result.title).toBe('Podcast Episode 1');
    });

    it('should reject unsupported MIME types', () => {
      expect(() =>
        createMediaItemSchema.parse({
          title: 'Test',
          mediaType: 'video',
          mimeType: 'video/x-flv', // Not in whitelist
          fileSizeBytes: 1000,
          r2Key: 'test.flv',
        })
      ).toThrow('Unsupported file format');
    });

    it('should reject file size exceeding 5GB', () => {
      expect(() =>
        createMediaItemSchema.parse({
          title: 'Test',
          mediaType: 'video',
          mimeType: 'video/mp4',
          fileSizeBytes: 6 * 1024 * 1024 * 1024, // 6GB
          r2Key: 'test.mp4',
        })
      ).toThrow('File size cannot exceed 5GB');
    });

    it('should reject zero file size', () => {
      expect(() =>
        createMediaItemSchema.parse({
          title: 'Test',
          mediaType: 'video',
          mimeType: 'video/mp4',
          fileSizeBytes: 0,
          r2Key: 'test.mp4',
        })
      ).toThrow('File size must be greater than 0');
    });

    it('should reject invalid R2 key characters', () => {
      const invalidKeys = [
        '../../../etc/passwd', // Path traversal
        'test file.mp4', // Spaces
        'test@file.mp4', // Special chars
        'test|file.mp4',
      ];

      invalidKeys.forEach((r2Key) => {
        expect(() =>
          createMediaItemSchema.parse({
            title: 'Test',
            mediaType: 'video',
            mimeType: 'video/mp4',
            fileSizeBytes: 1000,
            r2Key,
          })
        ).toThrow('R2 key contains invalid characters');
      });
    });
  });

  describe('updateMediaItemSchema', () => {
    it('should validate status update', () => {
      const update = {
        status: 'ready' as const,
      };

      const result = updateMediaItemSchema.parse(update);
      expect(result.status).toBe('ready');
    });

    it('should validate metadata update', () => {
      const update = {
        durationSeconds: 3600, // 1 hour
        width: 1920,
        height: 1080,
        hlsMasterPlaylistKey: 'hls/abc123/master.m3u8',
        thumbnailKey: 'thumbnails/abc123/thumb.jpg',
      };

      const result = updateMediaItemSchema.parse(update);
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
    });

    it('should reject duration exceeding 24 hours', () => {
      expect(() =>
        updateMediaItemSchema.parse({
          durationSeconds: 86401, // 24 hours + 1 second
        })
      ).toThrow();
    });

    it('should reject width exceeding 8K', () => {
      expect(() =>
        updateMediaItemSchema.parse({
          width: 7681, // 8K + 1
        })
      ).toThrow();
    });
  });
});

describe('Content Schemas', () => {
  describe('createContentSchema', () => {
    it('should validate video content with all fields', () => {
      const validContent = {
        title: 'Introduction to TypeScript',
        slug: 'intro-to-typescript',
        description: 'Learn TypeScript from scratch',
        contentType: 'video' as const,
        mediaItemId: '123e4567-e89b-12d3-a456-426614174000',
        organizationId: '123e4567-e89b-12d3-a456-426614174001',
        category: 'Programming',
        tags: ['typescript', 'javascript', 'tutorial'],
        thumbnailUrl: 'https://example.com/thumb.jpg',
        visibility: 'public' as const,
        priceCents: 999,
      };

      const result = createContentSchema.parse(validContent);
      expect(result).toEqual(validContent);
    });

    it('should validate minimal video content', () => {
      const minimalContent = {
        title: 'Test Video',
        slug: 'test-video',
        contentType: 'video' as const,
        mediaItemId: '123e4567-e89b-12d3-a456-426614174000',
      };

      const result = createContentSchema.parse(minimalContent);
      expect(result.visibility).toBe('purchased_only'); // Default
      expect(result.tags).toEqual([]); // Default
    });

    it('should validate free content with public visibility', () => {
      const freeContent = {
        title: 'Free Tutorial',
        slug: 'free-tutorial',
        contentType: 'video' as const,
        mediaItemId: '123e4567-e89b-12d3-a456-426614174000',
        visibility: 'public' as const,
        priceCents: null,
      };

      const result = createContentSchema.parse(freeContent);
      expect(result.priceCents).toBeNull();
      expect(result.visibility).toBe('public');
    });

    it('should reject video content without mediaItemId', () => {
      expect(() =>
        createContentSchema.parse({
          title: 'Test',
          slug: 'test',
          contentType: 'video',
        })
      ).toThrow('Media item is required for video and audio content');
    });

    it('should reject audio content without mediaItemId', () => {
      expect(() =>
        createContentSchema.parse({
          title: 'Test',
          slug: 'test',
          contentType: 'audio',
        })
      ).toThrow('Media item is required for video and audio content');
    });

    it('should reject written content without contentBody', () => {
      expect(() =>
        createContentSchema.parse({
          title: 'Test',
          slug: 'test',
          contentType: 'written',
        })
      ).toThrow('Content body is required for written content');
    });

    it('should validate written content with contentBody', () => {
      const writtenContent = {
        title: 'My Blog Post',
        slug: 'my-blog-post',
        contentType: 'written' as const,
        contentBody: 'This is a long blog post about coding...',
        visibility: 'public' as const,
        priceCents: null,
      };

      const result = createContentSchema.parse(writtenContent);
      expect(result.contentBody).toBeDefined();
    });

    it('should reject free content with purchased_only visibility', () => {
      expect(() =>
        createContentSchema.parse({
          title: 'Test',
          slug: 'test',
          contentType: 'video',
          mediaItemId: '123e4567-e89b-12d3-a456-426614174000',
          visibility: 'purchased_only',
          priceCents: null,
        })
      ).toThrow('Free content cannot have purchased_only visibility');

      expect(() =>
        createContentSchema.parse({
          title: 'Test',
          slug: 'test',
          contentType: 'video',
          mediaItemId: '123e4567-e89b-12d3-a456-426614174000',
          visibility: 'purchased_only',
          priceCents: 0,
        })
      ).toThrow('Free content cannot have purchased_only visibility');
    });

    it('should reject price exceeding $100,000', () => {
      expect(() =>
        createContentSchema.parse({
          title: 'Test',
          slug: 'test',
          contentType: 'video',
          mediaItemId: '123e4567-e89b-12d3-a456-426614174000',
          priceCents: 10000001,
        })
      ).toThrow('Price cannot exceed $100,000');
    });

    it('should reject negative price', () => {
      expect(() =>
        createContentSchema.parse({
          title: 'Test',
          slug: 'test',
          contentType: 'video',
          mediaItemId: '123e4567-e89b-12d3-a456-426614174000',
          priceCents: -1,
        })
      ).toThrow('Price cannot be negative');
    });

    it('should reject more than 20 tags', () => {
      expect(() =>
        createContentSchema.parse({
          title: 'Test',
          slug: 'test',
          contentType: 'video',
          mediaItemId: '123e4567-e89b-12d3-a456-426614174000',
          tags: Array(21).fill('tag'),
        })
      ).toThrow('Maximum 20 tags allowed');
    });

    it('should reject tags exceeding 50 characters', () => {
      expect(() =>
        createContentSchema.parse({
          title: 'Test',
          slug: 'test',
          contentType: 'video',
          mediaItemId: '123e4567-e89b-12d3-a456-426614174000',
          tags: ['a'.repeat(51)],
        })
      ).toThrow('Tag must be 50 characters or less');
    });

    it('should reject empty tags', () => {
      expect(() =>
        createContentSchema.parse({
          title: 'Test',
          slug: 'test',
          contentType: 'video',
          mediaItemId: '123e4567-e89b-12d3-a456-426614174000',
          tags: [''],
        })
      ).toThrow('Tag cannot be empty');
    });

    it('should trim whitespace from tags', () => {
      const result = createContentSchema.parse({
        title: 'Test',
        slug: 'test',
        contentType: 'video',
        mediaItemId: '123e4567-e89b-12d3-a456-426614174000',
        tags: ['  typescript  ', '  javascript  '],
      });

      expect(result.tags).toEqual(['typescript', 'javascript']);
    });

    it('should reject invalid UUIDs', () => {
      expect(() =>
        createContentSchema.parse({
          title: 'Test',
          slug: 'test',
          contentType: 'video',
          mediaItemId: 'not-a-uuid',
        })
      ).toThrow('Invalid ID format');
    });
  });

  describe('updateContentSchema', () => {
    it('should allow partial updates', () => {
      const partialUpdate = {
        title: 'Updated Title',
        priceCents: 1499,
      };

      const result = updateContentSchema.parse(partialUpdate);
      expect(result.title).toBe('Updated Title');
      expect(result.priceCents).toBe(1499);
    });

    it('should not allow updating mediaItemId', () => {
      const update = updateContentSchema.parse({
        title: 'Test',
      });

      expect('mediaItemId' in update).toBe(false);
    });
  });
});

describe('Query Schemas', () => {
  describe('contentQuerySchema', () => {
    it('should validate with default values', () => {
      const result = contentQuerySchema.parse({});

      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.sortBy).toBe('createdAt');
      expect(result.sortOrder).toBe('desc');
    });

    it('should validate with all filters', () => {
      const query = {
        page: 2,
        limit: 50,
        status: 'published' as const,
        contentType: 'video' as const,
        visibility: 'public' as const,
        category: 'Programming',
        organizationId: '123e4567-e89b-12d3-a456-426614174000',
        search: 'typescript tutorial',
        sortBy: 'publishedAt' as const,
        sortOrder: 'asc' as const,
      };

      const result = contentQuerySchema.parse(query);
      expect(result).toEqual(query);
    });

    it('should reject page less than 1', () => {
      expect(() => contentQuerySchema.parse({ page: 0 })).toThrow();
    });

    it('should reject limit exceeding 100', () => {
      expect(() => contentQuerySchema.parse({ limit: 101 })).toThrow();
    });

    it('should reject invalid sortBy field', () => {
      expect(() =>
        contentQuerySchema.parse({ sortBy: 'invalidField' })
      ).toThrow();
    });
  });

  describe('mediaQuerySchema', () => {
    it('should validate with defaults', () => {
      const result = mediaQuerySchema.parse({});

      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.sortBy).toBe('createdAt');
    });

    it('should validate with filters', () => {
      const query = {
        status: 'ready' as const,
        mediaType: 'video' as const,
        sortBy: 'uploadedAt' as const,
      };

      const result = mediaQuerySchema.parse(query);
      expect(result.status).toBe('ready');
      expect(result.mediaType).toBe('video');
    });
  });
});

describe('Upload Request Schema', () => {
  describe('uploadRequestSchema', () => {
    it('should validate correct upload request', () => {
      const validRequest = {
        filename: 'video.mp4',
        contentType: 'video/mp4' as const,
        fileSizeBytes: 10485760,
        title: 'My Video',
        description: 'A great video',
        mediaType: 'video' as const,
      };

      const result = uploadRequestSchema.parse(validRequest);
      expect(result).toEqual(validRequest);
    });

    it('should reject filename with path traversal', () => {
      expect(() =>
        uploadRequestSchema.parse({
          filename: '../../../etc/passwd',
          contentType: 'video/mp4',
          fileSizeBytes: 1000,
          title: 'Test',
          mediaType: 'video',
        })
      ).toThrow('Filename contains invalid characters');
    });

    it('should reject filename with spaces', () => {
      expect(() =>
        uploadRequestSchema.parse({
          filename: 'my video.mp4',
          contentType: 'video/mp4',
          fileSizeBytes: 1000,
          title: 'Test',
          mediaType: 'video',
        })
      ).toThrow('Filename contains invalid characters');
    });

    it('should allow valid filename characters', () => {
      const validFilenames = [
        'video.mp4',
        'video-final.mp4',
        'video_v2.mp4',
        'video.final.mp4',
      ];

      validFilenames.forEach((filename) => {
        const result = uploadRequestSchema.parse({
          filename,
          contentType: 'video/mp4',
          fileSizeBytes: 1000,
          title: 'Test',
          mediaType: 'video',
        });

        expect(result.filename).toBe(filename);
      });
    });
  });
});

describe('Enum Schemas', () => {
  it('should validate mediaTypeEnum', () => {
    expect(mediaTypeEnum.parse('video')).toBe('video');
    expect(mediaTypeEnum.parse('audio')).toBe('audio');
    expect(() => mediaTypeEnum.parse('invalid')).toThrow(
      'Media type must be video or audio'
    );
  });

  it('should validate mediaStatusEnum', () => {
    const validStatuses = [
      'uploading',
      'uploaded',
      'transcoding',
      'ready',
      'failed',
    ];
    validStatuses.forEach((status) => {
      expect(mediaStatusEnum.parse(status)).toBe(status);
    });
    expect(() => mediaStatusEnum.parse('invalid')).toThrow(
      'Invalid media status'
    );
  });

  it('should validate contentTypeEnum', () => {
    expect(contentTypeEnum.parse('video')).toBe('video');
    expect(contentTypeEnum.parse('audio')).toBe('audio');
    expect(contentTypeEnum.parse('written')).toBe('written');
    expect(() => contentTypeEnum.parse('invalid')).toThrow(
      'Content type must be video, audio, or written'
    );
  });

  it('should validate visibilityEnum', () => {
    const validVisibilities = [
      'public',
      'private',
      'members_only',
      'purchased_only',
    ];
    validVisibilities.forEach((visibility) => {
      expect(visibilityEnum.parse(visibility)).toBe(visibility);
    });
    expect(() => visibilityEnum.parse('invalid')).toThrow(
      'Invalid visibility setting'
    );
  });

  it('should validate contentStatusEnum', () => {
    expect(contentStatusEnum.parse('draft')).toBe('draft');
    expect(contentStatusEnum.parse('published')).toBe('published');
    expect(contentStatusEnum.parse('archived')).toBe('archived');
    expect(() => contentStatusEnum.parse('invalid')).toThrow(
      'Status must be draft, published, or archived'
    );
  });
});

describe('Security Validations', () => {
  describe('XSS Prevention', () => {
    it('should reject javascript: URLs', () => {
      expect(() =>
        createOrganizationSchema.parse({
          name: 'Test',
          slug: 'test',
          logoUrl: 'javascript:alert(1)',
        })
      ).toThrow();

      expect(() =>
        createContentSchema.parse({
          title: 'Test',
          slug: 'test',
          contentType: 'video',
          mediaItemId: '123e4567-e89b-12d3-a456-426614174000',
          thumbnailUrl: 'javascript:alert(1)',
        })
      ).toThrow();
    });

    it('should reject data: URLs', () => {
      expect(() =>
        createOrganizationSchema.parse({
          name: 'Test',
          slug: 'test',
          websiteUrl: 'data:text/html,<script>alert(1)</script>',
        })
      ).toThrow();
    });
  });

  describe('Path Traversal Prevention', () => {
    it('should reject path traversal in R2 keys', () => {
      expect(() =>
        createMediaItemSchema.parse({
          title: 'Test',
          mediaType: 'video',
          mimeType: 'video/mp4',
          fileSizeBytes: 1000,
          r2Key: '../../../etc/passwd',
        })
      ).toThrow();
    });

    it('should reject path traversal in filenames', () => {
      expect(() =>
        uploadRequestSchema.parse({
          filename: '../../../etc/passwd',
          contentType: 'video/mp4',
          fileSizeBytes: 1000,
          title: 'Test',
          mediaType: 'video',
        })
      ).toThrow();
    });
  });

  describe('Database Constraint Alignment', () => {
    it('should enforce CHECK constraint on media_type', () => {
      // Only 'video' and 'audio' allowed (matches line 73 in database schema)
      expect(() =>
        createMediaItemSchema.parse({
          title: 'Test',
          mediaType: 'document', // Not in enum
          mimeType: 'video/mp4',
          fileSizeBytes: 1000,
          r2Key: 'test.mp4',
        })
      ).toThrow();
    });

    it('should enforce CHECK constraint on media_status', () => {
      // Only specific statuses allowed (matches line 72 in database schema)
      expect(() =>
        updateMediaItemSchema.parse({
          status: 'processing', // Not in enum
        })
      ).toThrow();
    });

    it('should enforce CHECK constraint on content_type', () => {
      // Only 'video', 'audio', 'written' allowed (matches line 150 in database schema)
      expect(() =>
        createContentSchema.parse({
          title: 'Test',
          slug: 'test',
          contentType: 'image', // Not in enum
          mediaItemId: '123e4567-e89b-12d3-a456-426614174000',
        })
      ).toThrow();
    });

    it('should enforce CHECK constraint on visibility', () => {
      // Only specific visibility values allowed (matches line 149 in database schema)
      expect(() =>
        createContentSchema.parse({
          title: 'Test',
          slug: 'test',
          contentType: 'video',
          mediaItemId: '123e4567-e89b-12d3-a456-426614174000',
          visibility: 'hidden', // Not in enum
        })
      ).toThrow();
    });

    it('should enforce CHECK constraint on price_cents non-negative', () => {
      // Price must be >= 0 (matches line 151 in database schema)
      expect(() =>
        createContentSchema.parse({
          title: 'Test',
          slug: 'test',
          contentType: 'video',
          mediaItemId: '123e4567-e89b-12d3-a456-426614174000',
          priceCents: -100,
        })
      ).toThrow();
    });
  });
});
