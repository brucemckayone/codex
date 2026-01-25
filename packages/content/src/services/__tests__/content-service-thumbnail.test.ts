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

// Mock ImageProcessingService
vi.mock('@codex/image-processing', () => {
  return {
    ImageProcessingService: class {
      constructor() {}
      async processContentThumbnail(
        creatorId: string,
        contentId: string,
        formData: FormData
      ) {
        return {
          basePath: `${creatorId}/content-thumbnails/${contentId}`,
          urls: {
            sm: `${creatorId}/content-thumbnails/${contentId}/sm.webp`,
            md: `${creatorId}/content-thumbnails/${contentId}/md.webp`,
            lg: `${creatorId}/content-thumbnails/${contentId}/lg.webp`,
          },
        };
      }
    },
  };
});

describe('ContentService.uploadThumbnail', () => {
  let db: Database;
  let service: ContentService;
  let creatorId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
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
      mockR2
    );

    // Assert Result
    expect(result.basePath).toContain(created.id);
    expect(result.urls.sm).toBeDefined();

    // Assert Database Update
    const updated = await service.get(created.id, creatorId);
    expect(updated?.thumbnailUrl).toBe(result.basePath);
  });
});
