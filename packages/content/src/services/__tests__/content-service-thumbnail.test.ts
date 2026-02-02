import type { R2Bucket } from '@cloudflare/workers-types';
import { content, mediaItems } from '@codex/database/schema';
import {
  createTestMediaItemInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import type { CreateContentInput } from '@codex/validation';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ContentService } from '../content-service';

// Mock dependencies
const _mockR2 = {} as unknown as R2Bucket;

// Store db reference for mock to use
let mockDb: Database | null = null;

// Mock ImageProcessingService - mock at method level for testing
const mockProcessContentThumbnail = vi
  .fn()
  .mockImplementation(async (contentId: string, creatorId: string) => {
    // Generate URL same as real service
    const url = `https://test-bucket.s3.amazonaws.com/${creatorId}/thumbnails/${contentId}/lg.webp`;

    // Update database (same as real service does at line 90-93)
    if (mockDb) {
      await mockDb
        .update(content)
        .set({ thumbnailUrl: url })
        .where(eq(content.id, contentId));
    }

    return {
      url,
      size: 12345,
      mimeType: 'image/webp',
    };
  });

vi.mock('@codex/image-processing', () => ({
  ImageProcessingService: class {
    processContentThumbnail = mockProcessContentThumbnail;
  },
  // Preserve other exports
  extractMimeType: (mimeType: string) => mimeType,
  MAX_IMAGE_SIZE_BYTES: 10 * 1024 * 1024,
  SUPPORTED_MIME_TYPES: new Set(['image/jpeg', 'image/png', 'image/webp']),
  validateImageUpload: () => ({ valid: true, errors: [] }),
}));

describe('ContentService.uploadThumbnail', () => {
  let db: Database;
  let service: ContentService;
  let creatorId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    mockDb = db; // Set db reference for mock to use
    service = new ContentService({ db, environment: 'test' });
    [creatorId] = await seedTestUsers(db, 1);
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  it('should upload thumbnail and update content record', async () => {
    // Arrange: Create content
    const [media] = await db
      .insert(mediaItems)
      .values(
        createTestMediaItemInput(creatorId, {
          mediaType: 'video',
          status: 'ready',
        })
      )
      .returning();

    const input: CreateContentInput = {
      title: 'Thumbnail Test',
      slug: createUniqueSlug('thumb-test'),
      contentType: 'video',
      mediaItemId: media.id,
      visibility: 'public',
      priceCents: 0,
      tags: [],
    };

    const created = await service.create(input, creatorId);

    // Mock R2 Bucket (simple cast as we don't use it in the mocked service)
    const mockR2 = {} as R2Bucket;

    // Mock File (using Blob as File is DOM API, or check if supported in test env)
    // Node environment might not have File, but vitest with jsdom/happy-dom might.
    // If not, we can mock it or use Blob.
    const file = new File(['dummy content'], 'thumb.jpg', {
      type: 'image/jpeg',
    });

    // Act
    const result = await service.uploadThumbnail(
      created.id,
      creatorId,
      file,
      mockR2,
      'https://cdn-test.revelations.studio'
    );

    // Assert Result
    expect(result.url).toContain(created.id);
    expect(result.size).toBeGreaterThan(0);
    expect(result.mimeType).toMatch(/^image\//);

    // Assert Database Update
    const updated = await service.get(created.id, creatorId);
    expect(updated?.thumbnailUrl).toBe(result.url);
  });
});
