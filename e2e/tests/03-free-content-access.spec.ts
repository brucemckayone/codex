/**
 * E2E Test: Free Content Access
 *
 * Tests the complete flow for accessing free (priceCents=0) content:
 * 1. Creator publishes free content
 * 2. Any authenticated user can access streaming URL
 * 3. Playback progress tracking works for free content
 * 4. User library includes free content
 *
 * This test validates the access control logic for public free content.
 */

import { expect, test } from '@playwright/test';
import { authFixture } from '../fixtures';
import {
  expectSuccessResponse,
  unwrapApiResponse,
} from '../helpers/assertions';
import { WORKER_URLS } from '../helpers/worker-urls';

test.describe('Free Content Access Flow', () => {
  test('should allow any authenticated user to access free content', async ({
    request,
  }) => {
    // Step 1: Create a creator and publish free content
    const testEmail = `creator-free-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const testPassword = 'SecurePassword123!';

    const { cookie: creatorCookie } = await authFixture.registerUser(request, {
      email: testEmail,
      password: testPassword,
      name: 'Free Content Creator',
      role: 'creator',
    });

    // Create media item (using test files uploaded to R2 in global setup)
    // R2 structure: {creatorId}/originals/{mediaId}/original.mp4
    const testCreatorId = 'e2e-test-creator';
    const testMediaId = 'e2e-test-video-001';
    const mediaResponse = await request.post(
      `${WORKER_URLS.content}/api/media`,
      {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.content,
        },
        data: {
          title: 'Free Video Media',
          description: 'Media for free content',
          mediaType: 'video',
          r2Key: `${testCreatorId}/originals/${testMediaId}/original.mp4`,
          fileSizeBytes: 1048576,
          mimeType: 'video/mp4',
        },
      }
    );
    await expectSuccessResponse(mediaResponse, 201);
    const media = unwrapApiResponse(await mediaResponse.json());

    // Mark media as ready (using test HLS and thumbnail uploaded to R2)
    const readyMediaResponse = await request.patch(
      `${WORKER_URLS.content}/api/media/${media.id}`,
      {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.content,
        },
        data: {
          status: 'ready',
          hlsMasterPlaylistKey: `${testCreatorId}/hls/${testMediaId}/master.m3u8`,
          thumbnailKey: `${testCreatorId}/thumbnails/${testMediaId}/thumb.jpg`,
          durationSeconds: 300,
          width: 1920,
          height: 1080,
        },
      }
    );
    await expectSuccessResponse(readyMediaResponse);

    // Create free content (priceCents = 0)
    const contentResponse = await request.post(
      `${WORKER_URLS.content}/api/content`,
      {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.content,
        },
        data: {
          title: 'Free Educational Video',
          slug: `free-video-${Date.now()}`,
          description: 'This is a free educational resource',
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'public',
          priceCents: 0, // FREE
          category: 'Education',
          tags: ['free', 'education', 'tutorial'],
        },
      }
    );
    await expectSuccessResponse(contentResponse, 201);
    const content = unwrapApiResponse(await contentResponse.json());

    // Publish the content
    const publishResponse = await request.post(
      `${WORKER_URLS.content}/api/content/${content.id}/publish`,
      {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.content,
        },
      }
    );
    await expectSuccessResponse(publishResponse);
    const publishedContent = unwrapApiResponse(await publishResponse.json());
    expect(publishedContent.status).toBe('published');

    // Step 2: Create a regular viewer (not creator)
    const viewerEmail = `viewer-free-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const viewerPassword = 'SecurePassword123!';

    const { cookie: viewerCookie } = await authFixture.registerUser(request, {
      email: viewerEmail,
      password: viewerPassword,
      name: 'Free Content Viewer',
      role: 'user',
    });

    // Step 3: Viewer can access free content without purchase
    const accessResponse = await request.get(
      `${WORKER_URLS.content}/api/access/content/${content.id}/stream`,
      {
        headers: {
          Cookie: viewerCookie,
          Origin: WORKER_URLS.content,
        },
      }
    );
    await expectSuccessResponse(accessResponse);
    const accessData = await accessResponse.json();

    // Verify streaming URL was provided
    expect(accessData.data.streamingUrl).toBeDefined();
    expect(accessData.data.streamingUrl).toContain('master.m3u8');
    expect(accessData.data.expiresAt).toBeDefined();
    expect(accessData.data.contentType).toBe('video');

    // Step 4: Track playback progress
    const progressResponse = await request.post(
      `${WORKER_URLS.content}/api/access/content/${content.id}/progress`,
      {
        headers: {
          Cookie: viewerCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.content,
        },
        data: {
          positionSeconds: 150,
          durationSeconds: 300,
          completed: false,
        },
      }
    );
    expect(progressResponse.status()).toBe(204); // No content response

    // Step 5: Retrieve playback progress
    const getProgressResponse = await request.get(
      `${WORKER_URLS.content}/api/access/content/${content.id}/progress`,
      {
        headers: {
          Cookie: viewerCookie,
          Origin: WORKER_URLS.content,
        },
      }
    );
    await expectSuccessResponse(getProgressResponse);
    const progressData = await getProgressResponse.json();
    const progress = progressData.data?.progress || progressData.progress;

    expect(progress).toBeDefined();
    expect(progress.positionSeconds).toBe(150);
    expect(progress.durationSeconds).toBe(300);
    expect(progress.completed).toBe(false);

    // Note: Free content (priceCents=0) doesn't appear in user library
    // User library only shows purchased content per ContentAccessService.listUserLibrary()
    // If we want to show watched free content, that would be a separate "watch history" endpoint
  });

  test('should deny access to unpublished free content', async ({
    request,
  }) => {
    // Create creator and draft free content
    const creatorEmail = `creator-draft-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const creatorPassword = 'SecurePassword123!';

    const { cookie: creatorCookie } = await authFixture.registerUser(request, {
      email: creatorEmail,
      password: creatorPassword,
      name: 'Draft Creator',
      role: 'creator',
    });

    // Create draft content (not published)
    const contentResponse = await request.post(
      `${WORKER_URLS.content}/api/content`,
      {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.content,
        },
        data: {
          title: 'Draft Free Content',
          slug: `draft-free-${Date.now()}`,
          contentType: 'written',
          contentBody: 'This is draft content',
          visibility: 'public',
          priceCents: 0,
        },
      }
    );
    await expectSuccessResponse(contentResponse, 201);
    const content = unwrapApiResponse(await contentResponse.json());
    expect(content.status).toBe('draft');

    // Create viewer
    const viewerEmail = `viewer-draft-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const viewerPassword = 'SecurePassword123!';

    const { cookie: viewerCookie } = await authFixture.registerUser(request, {
      email: viewerEmail,
      password: viewerPassword,
      name: 'Viewer',
      role: 'user',
    });

    // Attempt to access draft content - should fail
    const accessResponse = await request.get(
      `${WORKER_URLS.content}/api/access/content/${content.id}/stream`,
      {
        headers: {
          Cookie: viewerCookie,
          Origin: WORKER_URLS.content,
        },
      }
    );

    // Should deny access (403 or 404)
    expect(accessResponse.ok()).toBeFalsy();
    expect(accessResponse.status()).toBeGreaterThanOrEqual(403);
    expect(accessResponse.status()).toBeLessThanOrEqual(404);
  });

  test('should handle multiple viewers accessing same free content', async ({
    request,
  }) => {
    // Create creator and publish free content
    const creatorEmail = `creator-popular-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const creatorPassword = 'SecurePassword123!';

    const { cookie: creatorCookie } = await authFixture.registerUser(request, {
      email: creatorEmail,
      password: creatorPassword,
      name: 'Popular Creator',
      role: 'creator',
    });

    // Create media item (using test files uploaded to R2 in global setup)
    const testCreatorId = 'e2e-test-creator';
    const testMediaId = 'e2e-test-video-001';
    const mediaResponse = await request.post(
      `${WORKER_URLS.content}/api/media`,
      {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.content,
        },
        data: {
          title: 'Popular Video Media',
          description: 'Media for popular content',
          mediaType: 'video',
          r2Key: `${testCreatorId}/originals/${testMediaId}/original.mp4`,
          fileSizeBytes: 1048576,
          mimeType: 'video/mp4',
        },
      }
    );
    await expectSuccessResponse(mediaResponse, 201);
    const media = unwrapApiResponse(await mediaResponse.json());

    // Update media to ready status
    const updateMediaResponse = await request.patch(
      `${WORKER_URLS.content}/api/media/${media.id}`,
      {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.content,
        },
        data: {
          status: 'ready',
          hlsMasterPlaylistKey: `${testCreatorId}/hls/${testMediaId}/master.m3u8`,
          thumbnailKey: `${testCreatorId}/thumbnails/${testMediaId}/thumb.jpg`,
          durationSeconds: 300,
          width: 1920,
          height: 1080,
        },
      }
    );
    await expectSuccessResponse(updateMediaResponse);

    // Create and publish free video content
    const contentResponse = await request.post(
      `${WORKER_URLS.content}/api/content`,
      {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.content,
        },
        data: {
          title: 'Popular Free Video',
          slug: `popular-video-${Date.now()}`,
          description: 'A popular free educational video',
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'public',
          priceCents: 0,
        },
      }
    );
    await expectSuccessResponse(contentResponse, 201);
    const content = unwrapApiResponse(await contentResponse.json());

    // Publish
    const publishResponse = await request.post(
      `${WORKER_URLS.content}/api/content/${content.id}/publish`,
      {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.content,
        },
      }
    );
    await expectSuccessResponse(publishResponse);

    // Create multiple viewers
    const viewer1Email = `viewer1-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const viewer2Email = `viewer2-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const viewer3Email = `viewer3-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

    const { cookie: cookie1 } = await authFixture.registerUser(request, {
      email: viewer1Email,
      password: 'SecurePassword123!',
      name: 'Viewer 1',
      role: 'user',
    });

    const { cookie: cookie2 } = await authFixture.registerUser(request, {
      email: viewer2Email,
      password: 'SecurePassword123!',
      name: 'Viewer 2',
      role: 'user',
    });

    const { cookie: cookie3 } = await authFixture.registerUser(request, {
      email: viewer3Email,
      password: 'SecurePassword123!',
      name: 'Viewer 3',
      role: 'user',
    });

    // All viewers can access the same free content
    const access1 = await request.get(
      `${WORKER_URLS.content}/api/access/content/${content.id}/stream`,
      {
        headers: { Cookie: cookie1, Origin: WORKER_URLS.content },
      }
    );
    const access2 = await request.get(
      `${WORKER_URLS.content}/api/access/content/${content.id}/stream`,
      {
        headers: { Cookie: cookie2, Origin: WORKER_URLS.content },
      }
    );
    const access3 = await request.get(
      `${WORKER_URLS.content}/api/access/content/${content.id}/stream`,
      {
        headers: { Cookie: cookie3, Origin: WORKER_URLS.content },
      }
    );

    await expectSuccessResponse(access1);
    await expectSuccessResponse(access2);
    await expectSuccessResponse(access3);

    // Each viewer gets their own streaming URL
    const data1 = await access1.json();
    const data2 = await access2.json();
    const data3 = await access3.json();

    expect(data1.data.streamingUrl).toBeDefined();
    expect(data2.data.streamingUrl).toBeDefined();
    expect(data3.data.streamingUrl).toBeDefined();
  });
});
