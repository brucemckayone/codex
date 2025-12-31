/**
 * E2E Test: Content Creation Flow
 * Tests creating content, managing media items, and publishing workflow
 */

import { describe, expect, test } from 'vitest';

import { authFixture, httpClient } from '../fixtures';
import {
  expectSuccessResponse,
  unwrapApiResponse,
} from '../helpers/assertions';
import { WORKER_URLS } from '../helpers/worker-urls';

describe('Content Creation Flow', () => {
  test('should create draft content, add media, and publish', async () => {
    // Step 1: Register and login user (content creator)
    const testEmail = `creator-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const testPassword = 'SecurePassword123!';

    const { user, cookie } = await authFixture.registerUser({
      email: testEmail,
      password: testPassword,
      name: 'Content Creator',
      role: 'creator',
    });

    // Step 2: Create media item (simulating upload)
    const mediaResponse = await httpClient.post(
      `${WORKER_URLS.content}/api/media`,
      {
        headers: {
          Cookie: cookie,
          Origin: WORKER_URLS.content,
        },
        data: {
          title: 'test-video.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
          fileSizeBytes: 1024000,
          r2Key: `media/${user.id}/test-video-${Date.now()}.mp4`,
        },
      }
    );

    await expectSuccessResponse(mediaResponse, 201);
    const media = unwrapApiResponse(await mediaResponse.json());
    expect(media.id).toBeDefined();
    expect(media.status).toBe('uploading');

    // Step 3: Update media status to 'ready' (simulating transcoding completion)
    // DB constraint requires hlsMasterPlaylistKey, thumbnailKey, and durationSeconds when status='ready'
    const updateMediaResponse = await httpClient.patch(
      `${WORKER_URLS.content}/api/media/${media.id}`,
      {
        headers: {
          Cookie: cookie,
          Origin: WORKER_URLS.content,
        },
        data: {
          status: 'ready',
          hlsMasterPlaylistKey: `hls/${media.id}/master.m3u8`,
          thumbnailKey: `thumbnails/${media.id}/thumb.jpg`,
          durationSeconds: 120,
        },
      }
    );

    if (!updateMediaResponse.ok) {
      const errorBody = await updateMediaResponse.text();
      console.log(
        '[TEST DEBUG] Media update failed:',
        updateMediaResponse.status,
        errorBody
      );
    }
    await expectSuccessResponse(updateMediaResponse);
    const updatedMedia = unwrapApiResponse(await updateMediaResponse.json());
    expect(updatedMedia.status).toBe('ready');

    // Step 4: Create draft content with media
    const contentResponse = await httpClient.post(
      `${WORKER_URLS.content}/api/content`,
      {
        headers: {
          Cookie: cookie,
          Origin: WORKER_URLS.content,
        },
        data: {
          title: 'My First Video',
          slug: `my-first-video-${Date.now()}`,
          description: 'Test video description',
          contentType: 'video',
          visibility: 'public',
          mediaItemId: media.id,
        },
      }
    );

    await expectSuccessResponse(contentResponse, 201);
    const content = unwrapApiResponse(await contentResponse.json());
    expect(content.id).toBeDefined();
    expect(content.status).toBe('draft');
    expect(content.title).toBe('My First Video');

    // Step 5: Publish content
    const publishResponse = await httpClient.post(
      `${WORKER_URLS.content}/api/content/${content.id}/publish`,
      {
        headers: {
          Cookie: cookie,
          Origin: WORKER_URLS.content,
        },
        data: {},
      }
    );

    await expectSuccessResponse(publishResponse);
    const publishedContent = unwrapApiResponse(await publishResponse.json());
    expect(publishedContent.status).toBe('published');
    expect(publishedContent.publishedAt).toBeDefined();

    // Step 6: Get content by ID
    const getContentResponse = await httpClient.get(
      `${WORKER_URLS.content}/api/content/${content.id}`,
      {
        headers: {
          Cookie: cookie,
        },
      }
    );

    await expectSuccessResponse(getContentResponse);
    const retrievedContent = unwrapApiResponse(await getContentResponse.json());
    expect(retrievedContent.id).toBe(content.id);
    expect(retrievedContent.status).toBe('published');
  });

  test('should reject publishing content without ready media', async () => {
    // Step 1: Register and login
    const testEmail = `creator-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const { user, cookie } = await authFixture.registerUser({
      email: testEmail,
      password: 'SecurePassword123!',
      name: 'Content Creator',
      role: 'creator',
    });

    // Step 2: Create media item (leave in 'uploading' status)
    const mediaResponse = await httpClient.post(
      `${WORKER_URLS.content}/api/media`,
      {
        headers: {
          Cookie: cookie,
          Origin: WORKER_URLS.content,
        },
        data: {
          title: 'test-video.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
          fileSizeBytes: 1024000,
          r2Key: `media/${user.id}/test-video-${Date.now()}.mp4`,
        },
      }
    );

    const media = unwrapApiResponse(await mediaResponse.json());

    // Step 3: Create draft content with non-ready media
    const contentResponse = await httpClient.post(
      `${WORKER_URLS.content}/api/content`,
      {
        headers: {
          Cookie: cookie,
          Origin: WORKER_URLS.content,
        },
        data: {
          title: 'Unready Content',
          slug: `unready-content-${Date.now()}`,
          contentType: 'video',
          visibility: 'public',
          mediaItemId: media.id,
        },
      }
    );

    const content = unwrapApiResponse(await contentResponse.json());

    // Step 4: Attempt to publish (should fail)
    const publishResponse = await httpClient.post(
      `${WORKER_URLS.content}/api/content/${content.id}/publish`,
      {
        headers: {
          Cookie: cookie,
          Origin: WORKER_URLS.content,
        },
        data: {},
      }
    );

    // Expect validation error (422) or business logic error (400)
    expect(publishResponse.ok).toBe(false);
    expect([400, 422]).toContain(publishResponse.status);
  });

  test('should enforce creator ownership for content operations', async () => {
    // Step 1: Create first user and their content
    const creator1Email = `creator1-${Date.now()}@example.com`;
    const { cookie: creator1Cookie } = await authFixture.registerUser({
      email: creator1Email,
      password: 'Password123!',
      name: 'Creator 1',
      role: 'creator',
    });

    const mediaResponse = await httpClient.post(
      `${WORKER_URLS.content}/api/media`,
      {
        headers: {
          Cookie: creator1Cookie,
          Origin: WORKER_URLS.content,
        },
        data: {
          title: 'video1.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
          fileSizeBytes: 1024000,
          r2Key: `media/user1/video1-${Date.now()}.mp4`,
        },
      }
    );
    const media = unwrapApiResponse(await mediaResponse.json());

    // DB constraint requires hlsMasterPlaylistKey, thumbnailKey, and durationSeconds when status='ready'
    await httpClient.patch(`${WORKER_URLS.content}/api/media/${media.id}`, {
      headers: {
        Cookie: creator1Cookie,
        Origin: WORKER_URLS.content,
      },
      data: {
        status: 'ready',
        hlsMasterPlaylistKey: `hls/${media.id}/master.m3u8`,
        thumbnailKey: `thumbnails/${media.id}/thumb.jpg`,
        durationSeconds: 120,
      },
    });

    const contentResponse = await httpClient.post(
      `${WORKER_URLS.content}/api/content`,
      {
        headers: {
          Cookie: creator1Cookie,
          Origin: WORKER_URLS.content,
        },
        data: {
          title: 'Creator 1 Content',
          slug: `creator1-content-${Date.now()}`,
          contentType: 'video',
          visibility: 'public',
          mediaItemId: media.id,
        },
      }
    );
    const content = unwrapApiResponse(await contentResponse.json());

    // Step 2: Create second user
    const creator2Email = `creator2-${Date.now()}@example.com`;
    const { cookie: creator2Cookie } = await authFixture.registerUser({
      email: creator2Email,
      password: 'Password123!',
      name: 'Creator 2',
      role: 'creator',
    });

    // Step 3: Attempt to update content as different user (should fail)
    const unauthorizedUpdate = await httpClient.patch(
      `${WORKER_URLS.content}/api/content/${content.id}`,
      {
        headers: {
          Cookie: creator2Cookie,
          Origin: WORKER_URLS.content,
        },
        data: {
          title: 'Hijacked Title',
        },
      }
    );

    // Expect 404 (content not found due to creator scoping) or 403 (forbidden)
    expect(unauthorizedUpdate.ok).toBe(false);
    expect([403, 404]).toContain(unauthorizedUpdate.status);
  });
});
