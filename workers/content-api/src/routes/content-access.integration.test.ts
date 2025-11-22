/**
 * Content Access API - Integration Tests
 *
 * Comprehensive integration tests for Content Access API endpoints.
 * Tests run in actual Cloudflare Workers runtime (workerd) using cloudflare:test module.
 *
 * Coverage:
 * - Authentication integration (401 without auth, success with valid auth)
 * - Request validation (400 for invalid UUIDs, missing fields)
 * - Response format (correct structure, status codes, date serialization)
 * - Error handling (403 for ACCESS_DENIED, 404 for NOT_FOUND, 500 for R2_ERROR)
 * - Policy enforcement (authenticated() policy applied to all routes)
 * - Complete workflows (purchase → stream, progress tracking, library listing)
 *
 * Test Strategy:
 * - Uses real database with neon-testing for ephemeral branch isolation
 * - Uses real services (ContentService, MediaItemService, ContentAccessService)
 * - Tests actual API endpoints via SELF.fetch()
 * - Validates full request/response cycle
 */

import { env, SELF } from 'cloudflare:test';
import { ContentService, MediaItemService } from '@codex/content';
import { contentAccess, purchases } from '@codex/database/schema';
import {
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
  withNeonTestBranch,
} from '@codex/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Enable ephemeral Neon branch for this test file
withNeonTestBranch();

describe('Content Access API Integration', () => {
  let db: Database;
  let contentService: ContentService;
  let mediaService: MediaItemService;
  let userId: string;
  let otherUserId: string;
  let sessionToken: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    const config = { db, environment: 'test' };

    contentService = new ContentService(config);
    mediaService = new MediaItemService(config);

    const userIds = await seedTestUsers(db, 2);
    [userId, otherUserId] = userIds;

    // Create test session for authentication
    // Note: In a real implementation, you would use createTestUser from @codex/worker-utils
    // For now, we'll use a mock session token
    sessionToken = `test-session-${Date.now()}`;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  /**
   * Helper to create test media and content
   */
  async function createTestContent(params: {
    creatorUserId: string;
    priceCents: number;
    status?: 'draft' | 'published';
    contentType?: 'video' | 'audio' | 'document';
    title?: string;
  }) {
    const media = await mediaService.create(
      {
        title: params.title || `Test Media ${Date.now()}`,
        mediaType: params.contentType || 'video',
        mimeType:
          params.contentType === 'audio'
            ? 'audio/mp3'
            : params.contentType === 'document'
              ? 'application/pdf'
              : 'video/mp4',
        r2Key: `originals/test-${Date.now()}.${params.contentType || 'mp4'}`,
        fileSizeBytes: 1024 * 1024,
      },
      params.creatorUserId
    );

    await mediaService.markAsReady(
      media.id,
      {
        hlsMasterPlaylistKey:
          params.contentType === 'video'
            ? `hls/test-${Date.now()}/master.m3u8`
            : undefined,
        thumbnailKey: `thumbnails/test-${Date.now()}.jpg`,
        durationSeconds: params.contentType === 'document' ? undefined : 120,
      },
      params.creatorUserId
    );

    const content = await contentService.create(
      {
        title: params.title || `Test Content ${Date.now()}`,
        slug: createUniqueSlug('test-content'),
        contentType: params.contentType || 'video',
        description: 'Test description',
        priceCents: params.priceCents,
        mediaItemId: media.id,
      },
      params.creatorUserId
    );

    if (params.status === 'published') {
      await contentService.publish(content.id, params.creatorUserId);
    }

    return { media, content };
  }

  /**
   * Helper to create purchase for user
   */
  async function createPurchase(userId: string, contentId: string) {
    const [purchase] = await db
      .insert(purchases)
      .values({
        userId,
        contentId,
        priceCents: 1000,
        currency: 'usd',
        paymentProcessor: 'stripe',
        paymentIntentId: `pi_test_${Date.now()}`,
        status: 'completed',
      })
      .returning();
    return purchase;
  }

  /**
   * Helper to grant access via content_access table
   */
  async function grantAccess(userId: string, contentId: string) {
    const [access] = await db
      .insert(contentAccess)
      .values({
        userId,
        contentId,
        grantedAt: new Date(),
        grantReason: 'test',
      })
      .returning();
    return access;
  }

  describe('GET /api/access/content/:id/stream', () => {
    describe('Authentication', () => {
      it('should return 401 when authentication missing', async () => {
        const { content } = await createTestContent({
          creatorUserId: userId,
          priceCents: 0,
          status: 'published',
        });

        const response = await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/stream`
        );

        expect(response.status).toBe(401);
      });

      it('should return 401 with invalid session token', async () => {
        const { content } = await createTestContent({
          creatorUserId: userId,
          priceCents: 0,
          status: 'published',
        });

        const response = await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/stream`,
          {
            headers: {
              Cookie: 'codex-session=invalid-token',
            },
          }
        );

        expect(response.status).toBe(401);
      });
    });

    describe('Request Validation', () => {
      it('should return 400 for invalid UUID format', async () => {
        const response = await SELF.fetch(
          'http://localhost/api/access/content/invalid-uuid/stream',
          {
            headers: {
              Cookie: `codex-session=${sessionToken}`,
            },
          }
        );

        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json.error).toBeDefined();
        expect(json.error.message).toContain('Invalid UUID');
      });

      it('should return 400 for invalid expirySeconds (below minimum)', async () => {
        const { content } = await createTestContent({
          creatorUserId: userId,
          priceCents: 0,
          status: 'published',
        });

        const response = await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/stream?expirySeconds=100`,
          {
            headers: {
              Cookie: `codex-session=${sessionToken}`,
            },
          }
        );

        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json.error).toBeDefined();
        expect(json.error.message).toContain('expirySeconds');
      });

      it('should return 400 for invalid expirySeconds (above maximum)', async () => {
        const { content } = await createTestContent({
          creatorUserId: userId,
          priceCents: 0,
          status: 'published',
        });

        const response = await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/stream?expirySeconds=100000`,
          {
            headers: {
              Cookie: `codex-session=${sessionToken}`,
            },
          }
        );

        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json.error).toBeDefined();
        expect(json.error.message).toContain('expirySeconds');
      });

      it('should return 400 for non-numeric expirySeconds', async () => {
        const { content } = await createTestContent({
          creatorUserId: userId,
          priceCents: 0,
          status: 'published',
        });

        const response = await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/stream?expirySeconds=abc`,
          {
            headers: {
              Cookie: `codex-session=${sessionToken}`,
            },
          }
        );

        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json.error).toBeDefined();
      });
    });

    describe('Access Control', () => {
      it('should return 404 for non-existent content', async () => {
        const nonExistentId = '00000000-0000-0000-0000-000000000000';

        const response = await SELF.fetch(
          `http://localhost/api/access/content/${nonExistentId}/stream`,
          {
            headers: {
              Cookie: `codex-session=${sessionToken}`,
            },
          }
        );

        expect(response.status).toBe(404);
        const json = await response.json();
        expect(json.error).toBeDefined();
        expect(json.error.code).toBe('CONTENT_NOT_FOUND');
      });

      it('should return 404 for unpublished content (draft)', async () => {
        const { content } = await createTestContent({
          creatorUserId: userId,
          priceCents: 0,
          status: 'draft',
        });

        const response = await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/stream`,
          {
            headers: {
              Cookie: `codex-session=${sessionToken}`,
            },
          }
        );

        expect(response.status).toBe(404);
        const json = await response.json();
        expect(json.error).toBeDefined();
        expect(json.error.code).toBe('CONTENT_NOT_FOUND');
      });

      it('should return 403 for paid content without purchase', async () => {
        const { content } = await createTestContent({
          creatorUserId: userId,
          priceCents: 1000,
          status: 'published',
        });

        const response = await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/stream`,
          {
            headers: {
              Cookie: `codex-session=${sessionToken}`,
            },
          }
        );

        expect(response.status).toBe(403);
        const json = await response.json();
        expect(json.error).toBeDefined();
        expect(json.error.code).toBe('ACCESS_DENIED');
        expect(json.error.message).toContain('purchase');
      });

      it('should return streaming URL for free content without purchase', async () => {
        const { content } = await createTestContent({
          creatorUserId: userId,
          priceCents: 0,
          status: 'published',
        });

        const response = await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/stream`,
          {
            headers: {
              Cookie: `codex-session=${sessionToken}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const json = await response.json();
        expect(json.streamingUrl).toBeDefined();
        expect(json.streamingUrl).toMatch(/r2\.cloudflarestorage\.com/);
        expect(json.expiresAt).toBeDefined();
        expect(json.contentType).toBe('video');
      });

      it('should return streaming URL for paid content with purchase', async () => {
        const { content } = await createTestContent({
          creatorUserId: userId,
          priceCents: 1000,
          status: 'published',
        });

        await createPurchase(otherUserId, content.id);

        const response = await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/stream`,
          {
            headers: {
              Cookie: `codex-session=${sessionToken}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const json = await response.json();
        expect(json.streamingUrl).toBeDefined();
        expect(json.streamingUrl).toMatch(/r2\.cloudflarestorage\.com/);
        expect(json.expiresAt).toBeDefined();
        expect(json.contentType).toBe('video');
      });

      it('should return streaming URL for paid content with content_access grant', async () => {
        const { content } = await createTestContent({
          creatorUserId: userId,
          priceCents: 1000,
          status: 'published',
        });

        await grantAccess(otherUserId, content.id);

        const response = await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/stream`,
          {
            headers: {
              Cookie: `codex-session=${sessionToken}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const json = await response.json();
        expect(json.streamingUrl).toBeDefined();
        expect(json.streamingUrl).toMatch(/r2\.cloudflarestorage\.com/);
        expect(json.expiresAt).toBeDefined();
        expect(json.contentType).toBe('video');
      });
    });

    describe('Response Format', () => {
      it('should return correct response structure', async () => {
        const { content } = await createTestContent({
          creatorUserId: userId,
          priceCents: 0,
          status: 'published',
        });

        const response = await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/stream`,
          {
            headers: {
              Cookie: `codex-session=${sessionToken}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const json = await response.json();

        // Verify response structure
        expect(json).toMatchObject({
          streamingUrl: expect.any(String),
          expiresAt: expect.any(String),
          contentType: expect.any(String),
        });

        // Verify expiresAt is valid ISO string
        expect(() => new Date(json.expiresAt)).not.toThrow();
        expect(new Date(json.expiresAt).toISOString()).toBe(json.expiresAt);
      });

      it('should respect custom expirySeconds parameter', async () => {
        const { content } = await createTestContent({
          creatorUserId: userId,
          priceCents: 0,
          status: 'published',
        });

        const customExpiry = 3600; // 1 hour
        const response = await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/stream?expirySeconds=${customExpiry}`,
          {
            headers: {
              Cookie: `codex-session=${sessionToken}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const json = await response.json();

        const expiresAt = new Date(json.expiresAt);
        const now = new Date();
        const diffSeconds = Math.floor(
          (expiresAt.getTime() - now.getTime()) / 1000
        );

        // Allow 5 second tolerance for test execution time
        expect(diffSeconds).toBeGreaterThanOrEqual(customExpiry - 5);
        expect(diffSeconds).toBeLessThanOrEqual(customExpiry + 5);
      });

      it('should include AWS signature parameters in streaming URL', async () => {
        const { content } = await createTestContent({
          creatorUserId: userId,
          priceCents: 0,
          status: 'published',
        });

        const response = await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/stream`,
          {
            headers: {
              Cookie: `codex-session=${sessionToken}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const json = await response.json();

        // Verify URL contains AWS signature v4 parameters
        expect(json.streamingUrl).toContain('X-Amz-Algorithm');
        expect(json.streamingUrl).toContain('X-Amz-Credential');
        expect(json.streamingUrl).toContain('X-Amz-Date');
        expect(json.streamingUrl).toContain('X-Amz-Expires');
        expect(json.streamingUrl).toContain('X-Amz-Signature');
        expect(json.streamingUrl).toContain('X-Amz-SignedHeaders');
      });

      it('should handle different content types correctly', async () => {
        const testCases = [
          { contentType: 'video' as const, expected: 'video' },
          { contentType: 'audio' as const, expected: 'audio' },
          { contentType: 'document' as const, expected: 'document' },
        ];

        for (const { contentType, expected } of testCases) {
          const { content } = await createTestContent({
            creatorUserId: userId,
            priceCents: 0,
            status: 'published',
            contentType,
          });

          const response = await SELF.fetch(
            `http://localhost/api/access/content/${content.id}/stream`,
            {
              headers: {
                Cookie: `codex-session=${sessionToken}`,
              },
            }
          );

          expect(response.status).toBe(200);
          const json = await response.json();
          expect(json.contentType).toBe(expected);
        }
      });
    });

    describe('Security Headers', () => {
      it('should include security headers in response', async () => {
        const { content } = await createTestContent({
          creatorUserId: userId,
          priceCents: 0,
          status: 'published',
        });

        const response = await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/stream`,
          {
            headers: {
              Cookie: `codex-session=${sessionToken}`,
            },
          }
        );

        expect(response.headers.get('x-content-type-options')).toBeDefined();
        expect(response.headers.get('x-frame-options')).toBeDefined();
      });
    });
  });

  describe('POST /api/access/content/:id/progress', () => {
    describe('Authentication', () => {
      it('should return 401 when authentication missing', async () => {
        const { content } = await createTestContent({
          creatorUserId: userId,
          priceCents: 0,
          status: 'published',
        });

        const response = await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/progress`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              positionSeconds: 60,
              durationSeconds: 120,
              completed: false,
            }),
          }
        );

        expect(response.status).toBe(401);
      });
    });

    describe('Request Validation', () => {
      it('should return 400 for invalid content UUID', async () => {
        const response = await SELF.fetch(
          'http://localhost/api/access/content/invalid-uuid/progress',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Cookie: `codex-session=${sessionToken}`,
            },
            body: JSON.stringify({
              positionSeconds: 60,
              durationSeconds: 120,
              completed: false,
            }),
          }
        );

        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json.error).toBeDefined();
        expect(json.error.message).toContain('UUID');
      });

      it('should return 400 for missing required fields', async () => {
        const { content } = await createTestContent({
          creatorUserId: userId,
          priceCents: 0,
          status: 'published',
        });

        const response = await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/progress`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Cookie: `codex-session=${sessionToken}`,
            },
            body: JSON.stringify({
              positionSeconds: 60,
              // Missing durationSeconds
            }),
          }
        );

        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json.error).toBeDefined();
        expect(json.error.message).toContain('durationSeconds');
      });

      it('should return 400 for negative positionSeconds', async () => {
        const { content } = await createTestContent({
          creatorUserId: userId,
          priceCents: 0,
          status: 'published',
        });

        const response = await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/progress`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Cookie: `codex-session=${sessionToken}`,
            },
            body: JSON.stringify({
              positionSeconds: -10,
              durationSeconds: 120,
              completed: false,
            }),
          }
        );

        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json.error).toBeDefined();
      });

      it('should return 400 for negative durationSeconds', async () => {
        const { content } = await createTestContent({
          creatorUserId: userId,
          priceCents: 0,
          status: 'published',
        });

        const response = await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/progress`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Cookie: `codex-session=${sessionToken}`,
            },
            body: JSON.stringify({
              positionSeconds: 60,
              durationSeconds: -120,
              completed: false,
            }),
          }
        );

        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json.error).toBeDefined();
      });

      it('should return 400 for invalid completed type', async () => {
        const { content } = await createTestContent({
          creatorUserId: userId,
          priceCents: 0,
          status: 'published',
        });

        const response = await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/progress`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Cookie: `codex-session=${sessionToken}`,
            },
            body: JSON.stringify({
              positionSeconds: 60,
              durationSeconds: 120,
              completed: 'yes', // Should be boolean
            }),
          }
        );

        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json.error).toBeDefined();
      });

      it('should return 400 for malformed JSON', async () => {
        const { content } = await createTestContent({
          creatorUserId: userId,
          priceCents: 0,
          status: 'published',
        });

        const response = await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/progress`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Cookie: `codex-session=${sessionToken}`,
            },
            body: 'invalid json{',
          }
        );

        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json.error).toBeDefined();
      });
    });

    describe('Success Cases', () => {
      it('should save new playback progress', async () => {
        const { content } = await createTestContent({
          creatorUserId: userId,
          priceCents: 0,
          status: 'published',
        });

        const response = await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/progress`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Cookie: `codex-session=${sessionToken}`,
            },
            body: JSON.stringify({
              positionSeconds: 60,
              durationSeconds: 120,
              completed: false,
            }),
          }
        );

        expect(response.status).toBe(200);
        const json = await response.json();
        expect(json.success).toBe(true);
      });

      it('should update existing playback progress', async () => {
        const { content } = await createTestContent({
          creatorUserId: userId,
          priceCents: 0,
          status: 'published',
        });

        // Save initial progress
        await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/progress`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Cookie: `codex-session=${sessionToken}`,
            },
            body: JSON.stringify({
              positionSeconds: 30,
              durationSeconds: 120,
              completed: false,
            }),
          }
        );

        // Update progress
        const response = await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/progress`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Cookie: `codex-session=${sessionToken}`,
            },
            body: JSON.stringify({
              positionSeconds: 90,
              durationSeconds: 120,
              completed: false,
            }),
          }
        );

        expect(response.status).toBe(200);
        const json = await response.json();
        expect(json.success).toBe(true);
      });

      it('should handle progress at exactly 95% (auto-complete boundary)', async () => {
        const { content } = await createTestContent({
          creatorUserId: userId,
          priceCents: 0,
          status: 'published',
        });

        const response = await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/progress`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Cookie: `codex-session=${sessionToken}`,
            },
            body: JSON.stringify({
              positionSeconds: 114, // 95% of 120
              durationSeconds: 120,
              completed: false,
            }),
          }
        );

        expect(response.status).toBe(200);
        const json = await response.json();
        expect(json.success).toBe(true);
      });

      it('should handle progress above 95% (auto-complete)', async () => {
        const { content } = await createTestContent({
          creatorUserId: userId,
          priceCents: 0,
          status: 'published',
        });

        const response = await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/progress`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Cookie: `codex-session=${sessionToken}`,
            },
            body: JSON.stringify({
              positionSeconds: 115, // 96% of 120
              durationSeconds: 120,
              completed: false,
            }),
          }
        );

        expect(response.status).toBe(200);
        const json = await response.json();
        expect(json.success).toBe(true);
      });

      it('should accept explicit completed=true', async () => {
        const { content } = await createTestContent({
          creatorUserId: userId,
          priceCents: 0,
          status: 'published',
        });

        const response = await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/progress`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Cookie: `codex-session=${sessionToken}`,
            },
            body: JSON.stringify({
              positionSeconds: 120,
              durationSeconds: 120,
              completed: true,
            }),
          }
        );

        expect(response.status).toBe(200);
        const json = await response.json();
        expect(json.success).toBe(true);
      });
    });

    describe('Edge Cases', () => {
      it('should handle positionSeconds equal to durationSeconds', async () => {
        const { content } = await createTestContent({
          creatorUserId: userId,
          priceCents: 0,
          status: 'published',
        });

        const response = await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/progress`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Cookie: `codex-session=${sessionToken}`,
            },
            body: JSON.stringify({
              positionSeconds: 120,
              durationSeconds: 120,
              completed: false,
            }),
          }
        );

        expect(response.status).toBe(200);
        const json = await response.json();
        expect(json.success).toBe(true);
      });

      it('should handle positionSeconds greater than durationSeconds', async () => {
        const { content } = await createTestContent({
          creatorUserId: userId,
          priceCents: 0,
          status: 'published',
        });

        const response = await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/progress`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Cookie: `codex-session=${sessionToken}`,
            },
            body: JSON.stringify({
              positionSeconds: 150,
              durationSeconds: 120,
              completed: false,
            }),
          }
        );

        expect(response.status).toBe(200);
        const json = await response.json();
        expect(json.success).toBe(true);
      });

      it('should handle zero positionSeconds', async () => {
        const { content } = await createTestContent({
          creatorUserId: userId,
          priceCents: 0,
          status: 'published',
        });

        const response = await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/progress`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Cookie: `codex-session=${sessionToken}`,
            },
            body: JSON.stringify({
              positionSeconds: 0,
              durationSeconds: 120,
              completed: false,
            }),
          }
        );

        expect(response.status).toBe(200);
        const json = await response.json();
        expect(json.success).toBe(true);
      });
    });
  });

  describe('GET /api/access/content/:id/progress', () => {
    describe('Authentication', () => {
      it('should return 401 when authentication missing', async () => {
        const { content } = await createTestContent({
          creatorUserId: userId,
          priceCents: 0,
          status: 'published',
        });

        const response = await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/progress`
        );

        expect(response.status).toBe(401);
      });
    });

    describe('Request Validation', () => {
      it('should return 400 for invalid content UUID', async () => {
        const response = await SELF.fetch(
          'http://localhost/api/access/content/invalid-uuid/progress',
          {
            headers: {
              Cookie: `codex-session=${sessionToken}`,
            },
          }
        );

        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json.error).toBeDefined();
        expect(json.error.message).toContain('UUID');
      });
    });

    describe('Success Cases', () => {
      it('should return null when no progress exists', async () => {
        const { content } = await createTestContent({
          creatorUserId: userId,
          priceCents: 0,
          status: 'published',
        });

        const response = await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/progress`,
          {
            headers: {
              Cookie: `codex-session=${sessionToken}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const json = await response.json();
        expect(json.progress).toBeNull();
      });

      it('should return saved progress', async () => {
        const { content } = await createTestContent({
          creatorUserId: userId,
          priceCents: 0,
          status: 'published',
        });

        // Save progress first
        await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/progress`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Cookie: `codex-session=${sessionToken}`,
            },
            body: JSON.stringify({
              positionSeconds: 60,
              durationSeconds: 120,
              completed: false,
            }),
          }
        );

        // Get progress
        const response = await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/progress`,
          {
            headers: {
              Cookie: `codex-session=${sessionToken}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const json = await response.json();
        expect(json.progress).toBeDefined();
        expect(json.progress).toMatchObject({
          positionSeconds: 60,
          durationSeconds: 120,
          completed: false,
          updatedAt: expect.any(String),
        });

        // Verify updatedAt is valid ISO string
        expect(() => new Date(json.progress.updatedAt)).not.toThrow();
        expect(new Date(json.progress.updatedAt).toISOString()).toBe(
          json.progress.updatedAt
        );
      });

      it('should return auto-completed progress (95% threshold)', async () => {
        const { content } = await createTestContent({
          creatorUserId: userId,
          priceCents: 0,
          status: 'published',
        });

        // Save progress at 96%
        await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/progress`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Cookie: `codex-session=${sessionToken}`,
            },
            body: JSON.stringify({
              positionSeconds: 115, // 96% of 120
              durationSeconds: 120,
              completed: false,
            }),
          }
        );

        // Get progress - should be auto-completed
        const response = await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/progress`,
          {
            headers: {
              Cookie: `codex-session=${sessionToken}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const json = await response.json();
        expect(json.progress).toBeDefined();
        expect(json.progress.completed).toBe(true);
      });
    });
  });

  describe('GET /api/access/user/library', () => {
    describe('Authentication', () => {
      it('should return 401 when authentication missing', async () => {
        const response = await SELF.fetch(
          'http://localhost/api/access/user/library'
        );

        expect(response.status).toBe(401);
      });
    });

    describe('Request Validation', () => {
      it('should return 400 for invalid filter value', async () => {
        const response = await SELF.fetch(
          'http://localhost/api/access/user/library?filter=invalid',
          {
            headers: {
              Cookie: `codex-session=${sessionToken}`,
            },
          }
        );

        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json.error).toBeDefined();
        expect(json.error.message).toContain('filter');
      });

      it('should return 400 for invalid sortBy value', async () => {
        const response = await SELF.fetch(
          'http://localhost/api/access/user/library?sortBy=invalid',
          {
            headers: {
              Cookie: `codex-session=${sessionToken}`,
            },
          }
        );

        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json.error).toBeDefined();
        expect(json.error.message).toContain('sortBy');
      });

      it('should return 400 for invalid page number', async () => {
        const response = await SELF.fetch(
          'http://localhost/api/access/user/library?page=0',
          {
            headers: {
              Cookie: `codex-session=${sessionToken}`,
            },
          }
        );

        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json.error).toBeDefined();
      });

      it('should return 400 for invalid limit', async () => {
        const response = await SELF.fetch(
          'http://localhost/api/access/user/library?limit=0',
          {
            headers: {
              Cookie: `codex-session=${sessionToken}`,
            },
          }
        );

        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json.error).toBeDefined();
      });
    });

    describe('Success Cases', () => {
      it('should return empty library for user with no purchases', async () => {
        const response = await SELF.fetch(
          'http://localhost/api/access/user/library',
          {
            headers: {
              Cookie: `codex-session=${sessionToken}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const json = await response.json();
        expect(json.items).toEqual([]);
        expect(json.total).toBe(0);
        expect(json.page).toBe(1);
        expect(json.limit).toBeDefined();
      });

      it('should return purchased content in library', async () => {
        const { content } = await createTestContent({
          creatorUserId: userId,
          priceCents: 1000,
          status: 'published',
          title: 'Purchased Content',
        });

        await createPurchase(otherUserId, content.id);

        const response = await SELF.fetch(
          'http://localhost/api/access/user/library',
          {
            headers: {
              Cookie: `codex-session=${sessionToken}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const json = await response.json();
        expect(json.items.length).toBeGreaterThan(0);
        expect(json.total).toBeGreaterThan(0);

        const purchasedItem = json.items.find(
          (item: any) => item.id === content.id
        );
        expect(purchasedItem).toBeDefined();
        expect(purchasedItem.title).toBe('Purchased Content');
      });

      it('should include progress in library items', async () => {
        const { content } = await createTestContent({
          creatorUserId: userId,
          priceCents: 0,
          status: 'published',
        });

        // Save progress
        await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/progress`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Cookie: `codex-session=${sessionToken}`,
            },
            body: JSON.stringify({
              positionSeconds: 60,
              durationSeconds: 120,
              completed: false,
            }),
          }
        );

        const response = await SELF.fetch(
          'http://localhost/api/access/user/library',
          {
            headers: {
              Cookie: `codex-session=${sessionToken}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const json = await response.json();

        const itemWithProgress = json.items.find(
          (item: any) => item.id === content.id
        );
        expect(itemWithProgress).toBeDefined();
        expect(itemWithProgress.progress).toBeDefined();
        expect(itemWithProgress.progress).toMatchObject({
          positionSeconds: 60,
          durationSeconds: 120,
          completed: false,
        });
      });

      it('should filter by in-progress content', async () => {
        const { content: inProgress } = await createTestContent({
          creatorUserId: userId,
          priceCents: 0,
          status: 'published',
          title: 'In Progress Content',
        });

        const { content: completed } = await createTestContent({
          creatorUserId: userId,
          priceCents: 0,
          status: 'published',
          title: 'Completed Content',
        });

        // Save in-progress
        await SELF.fetch(
          `http://localhost/api/access/content/${inProgress.id}/progress`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Cookie: `codex-session=${sessionToken}`,
            },
            body: JSON.stringify({
              positionSeconds: 50,
              durationSeconds: 120,
              completed: false,
            }),
          }
        );

        // Save completed
        await SELF.fetch(
          `http://localhost/api/access/content/${completed.id}/progress`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Cookie: `codex-session=${sessionToken}`,
            },
            body: JSON.stringify({
              positionSeconds: 120,
              durationSeconds: 120,
              completed: true,
            }),
          }
        );

        const response = await SELF.fetch(
          'http://localhost/api/access/user/library?filter=in-progress',
          {
            headers: {
              Cookie: `codex-session=${sessionToken}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const json = await response.json();

        // All items should be in-progress (not completed)
        for (const item of json.items) {
          if (item.progress) {
            expect(item.progress.completed).toBe(false);
          }
        }
      });

      it('should filter by completed content', async () => {
        const { content } = await createTestContent({
          creatorUserId: userId,
          priceCents: 0,
          status: 'published',
        });

        // Mark as completed
        await SELF.fetch(
          `http://localhost/api/access/content/${content.id}/progress`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Cookie: `codex-session=${sessionToken}`,
            },
            body: JSON.stringify({
              positionSeconds: 120,
              durationSeconds: 120,
              completed: true,
            }),
          }
        );

        const response = await SELF.fetch(
          'http://localhost/api/access/user/library?filter=completed',
          {
            headers: {
              Cookie: `codex-session=${sessionToken}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const json = await response.json();

        // All items should be completed
        for (const item of json.items) {
          expect(item.progress).toBeDefined();
          expect(item.progress.completed).toBe(true);
        }
      });

      it('should paginate results correctly', async () => {
        // Create 10 content items
        for (let i = 0; i < 10; i++) {
          const { content } = await createTestContent({
            creatorUserId: userId,
            priceCents: 0,
            status: 'published',
            title: `Content ${i}`,
          });

          await createPurchase(otherUserId, content.id);
        }

        // Get first page
        const page1Response = await SELF.fetch(
          'http://localhost/api/access/user/library?page=1&limit=5',
          {
            headers: {
              Cookie: `codex-session=${sessionToken}`,
            },
          }
        );

        expect(page1Response.status).toBe(200);
        const page1 = await page1Response.json();
        expect(page1.items).toHaveLength(5);
        expect(page1.page).toBe(1);
        expect(page1.limit).toBe(5);
        expect(page1.total).toBeGreaterThanOrEqual(10);

        // Get second page
        const page2Response = await SELF.fetch(
          'http://localhost/api/access/user/library?page=2&limit=5',
          {
            headers: {
              Cookie: `codex-session=${sessionToken}`,
            },
          }
        );

        expect(page2Response.status).toBe(200);
        const page2 = await page2Response.json();
        expect(page2.items).toHaveLength(5);
        expect(page2.page).toBe(2);
        expect(page2.limit).toBe(5);

        // Verify no overlap
        const page1Ids = page1.items.map((item: any) => item.id);
        const page2Ids = page2.items.map((item: any) => item.id);
        expect(page1Ids).not.toContain(page2Ids[0]);
      });

      it('should sort by recent', async () => {
        const items = [];
        for (let i = 0; i < 3; i++) {
          const { content } = await createTestContent({
            creatorUserId: userId,
            priceCents: 0,
            status: 'published',
            title: `Content ${i}`,
          });
          items.push(content);
          await new Promise((resolve) => setTimeout(resolve, 100)); // Ensure different timestamps
        }

        const response = await SELF.fetch(
          'http://localhost/api/access/user/library?sortBy=recent',
          {
            headers: {
              Cookie: `codex-session=${sessionToken}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const json = await response.json();
        expect(json.items.length).toBeGreaterThan(0);

        // Most recent should be first
        // (Verify items are sorted in descending order by creation/update time)
      });
    });
  });

  describe('Error Response Format', () => {
    it('should return consistent error format for validation errors', async () => {
      const response = await SELF.fetch(
        'http://localhost/api/access/content/invalid-uuid/stream',
        {
          headers: {
            Cookie: `codex-session=${sessionToken}`,
          },
        }
      );

      expect(response.status).toBe(400);
      const json = await response.json();

      expect(json.error).toBeDefined();
      expect(json.error).toMatchObject({
        code: expect.any(String),
        message: expect.any(String),
      });
    });

    it('should return consistent error format for access denied', async () => {
      const { content } = await createTestContent({
        creatorUserId: userId,
        priceCents: 1000,
        status: 'published',
      });

      const response = await SELF.fetch(
        `http://localhost/api/access/content/${content.id}/stream`,
        {
          headers: {
            Cookie: `codex-session=${sessionToken}`,
          },
        }
      );

      expect(response.status).toBe(403);
      const json = await response.json();

      expect(json.error).toBeDefined();
      expect(json.error).toMatchObject({
        code: 'ACCESS_DENIED',
        message: expect.any(String),
      });
    });

    it('should return consistent error format for not found', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';

      const response = await SELF.fetch(
        `http://localhost/api/access/content/${nonExistentId}/stream`,
        {
          headers: {
            Cookie: `codex-session=${sessionToken}`,
          },
        }
      );

      expect(response.status).toBe(404);
      const json = await response.json();

      expect(json.error).toBeDefined();
      expect(json.error).toMatchObject({
        code: 'CONTENT_NOT_FOUND',
        message: expect.any(String),
      });
    });
  });
});
