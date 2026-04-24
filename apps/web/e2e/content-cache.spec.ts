import { expect } from '@playwright/test';
import { test } from './fixtures/auth';
import {
  cleanupSharedStudioAuth,
  injectSharedStudioAuth,
  navigateToOrgPage,
  registerSharedStudioUser,
  type SharedStudioAuth,
} from './helpers/studio';

/**
 * Content Cache Invalidation — E2E
 *
 * Locks the live publish→appear chain on the org home and explore pages.
 * Pre-fix behavior (the bug): published content did not appear on `/` or
 * `/explore` until the user flipped a filter, because the public content
 * endpoint's cache-aside used the filter-combo string as `id`, fragmenting
 * the version namespace so `cache.invalidate(COLLECTION_ORG_CONTENT(orgId))`
 * never reached the cached entries.
 *
 * Post-fix verification:
 * - Create + publish content via content-api
 * - Org home (`/`) renders the new item immediately
 * - Org explore (`/explore?sort=newest`) renders the new item immediately
 * - Unpublish → the item disappears from both
 * - `/api/content/public` response carries `Cache-Control: max-age=60`
 */

const CONTENT_API = 'http://localhost:4001';

test.describe('content cache invalidation — publish → appear', () => {
  test.describe.configure({ mode: 'serial' });

  let sharedAuth: SharedStudioAuth;

  test.beforeAll(async () => {
    sharedAuth = await registerSharedStudioUser({
      orgRole: 'owner',
      platformRole: 'creator',
    });
  });

  test.afterAll(async () => {
    await cleanupSharedStudioAuth(sharedAuth);
  });

  test.beforeEach(async ({ page }) => {
    await injectSharedStudioAuth(page, sharedAuth);
  });

  test('publish appears immediately on org home (sort=newest)', async ({
    page,
    request,
  }) => {
    const orgSlug = sharedAuth.member.organization.slug;
    const orgId = sharedAuth.member.organization.id;

    const uniqueTitle = `E2E Cache Fix ${Date.now()}`;
    const uniqueSlug = `e2e-cache-fix-${Date.now()}`;

    // Prime the public cache for `sort=newest` before publish — ensures
    // the next read must come from cache (or post-invalidate miss).
    await request.get(
      `${CONTENT_API}/api/content/public?orgId=${orgId}&sort=newest&limit=12`
    );

    const created = await request.post(`${CONTENT_API}/api/content`, {
      headers: { Cookie: sharedAuth.cookie },
      data: {
        title: uniqueTitle,
        slug: uniqueSlug,
        contentType: 'written',
        accessType: 'free',
        organizationId: orgId,
        contentBody: 'E2E verification body.',
      },
    });
    expect(created.status()).toBe(201);
    const createdBody = (await created.json()) as { data: { id: string } };
    const contentId = createdBody.data.id;

    const published = await request.post(
      `${CONTENT_API}/api/content/${contentId}/publish`,
      { headers: { Cookie: sharedAuth.cookie } }
    );
    expect(published.status()).toBe(200);

    // Allow waitUntil fire-and-forget cache.invalidate to land.
    await page.waitForTimeout(500);

    // Navigate to org home; the spotlight + recent-releases sections should
    // now include the new article. SSR re-renders on every request and the
    // /api/content/public cache was invalidated by the publish above.
    await navigateToOrgPage(page, orgSlug, '/');

    await expect(page.getByText(uniqueTitle).first()).toBeVisible({
      timeout: 15_000,
    });

    // Cleanup
    await request.post(`${CONTENT_API}/api/content/${contentId}/unpublish`, {
      headers: { Cookie: sharedAuth.cookie },
    });
    await request.delete(`${CONTENT_API}/api/content/${contentId}`, {
      headers: { Cookie: sharedAuth.cookie },
    });
  });

  test('publish appears immediately on explore (sort=newest public path)', async ({
    page,
    request,
  }) => {
    const orgSlug = sharedAuth.member.organization.slug;
    const orgId = sharedAuth.member.organization.id;

    const uniqueTitle = `E2E Explore Fix ${Date.now()}`;
    const uniqueSlug = `e2e-explore-fix-${Date.now()}`;

    // Prime the explore/newest filter combo cache.
    await request.get(
      `${CONTENT_API}/api/content/public?orgId=${orgId}&sort=newest&limit=12&page=1&contentType=all`
    );

    const created = await request.post(`${CONTENT_API}/api/content`, {
      headers: { Cookie: sharedAuth.cookie },
      data: {
        title: uniqueTitle,
        slug: uniqueSlug,
        contentType: 'written',
        accessType: 'free',
        organizationId: orgId,
        contentBody: 'E2E verification body.',
      },
    });
    const { id: contentId } = (
      (await created.json()) as { data: { id: string } }
    ).data;
    await request.post(`${CONTENT_API}/api/content/${contentId}/publish`, {
      headers: { Cookie: sharedAuth.cookie },
    });

    await page.waitForTimeout(500);

    await navigateToOrgPage(page, orgSlug, '/explore?sort=newest');
    await expect(page.getByText(uniqueTitle).first()).toBeVisible({
      timeout: 15_000,
    });

    await request.post(`${CONTENT_API}/api/content/${contentId}/unpublish`, {
      headers: { Cookie: sharedAuth.cookie },
    });
    await request.delete(`${CONTENT_API}/api/content/${contentId}`, {
      headers: { Cookie: sharedAuth.cookie },
    });
  });

  test('unpublish removes content from org home', async ({ page, request }) => {
    const orgSlug = sharedAuth.member.organization.slug;
    const orgId = sharedAuth.member.organization.id;

    const uniqueTitle = `E2E Unpublish ${Date.now()}`;
    const uniqueSlug = `e2e-unpublish-${Date.now()}`;

    const created = await request.post(`${CONTENT_API}/api/content`, {
      headers: { Cookie: sharedAuth.cookie },
      data: {
        title: uniqueTitle,
        slug: uniqueSlug,
        contentType: 'written',
        accessType: 'free',
        organizationId: orgId,
        contentBody: 'E2E verification body.',
      },
    });
    const { id: contentId } = (
      (await created.json()) as { data: { id: string } }
    ).data;
    await request.post(`${CONTENT_API}/api/content/${contentId}/publish`, {
      headers: { Cookie: sharedAuth.cookie },
    });

    await page.waitForTimeout(500);
    await navigateToOrgPage(page, orgSlug, '/');
    await expect(page.getByText(uniqueTitle).first()).toBeVisible({
      timeout: 15_000,
    });

    // Unpublish triggers the same invalidation chain as publish.
    await request.post(`${CONTENT_API}/api/content/${contentId}/unpublish`, {
      headers: { Cookie: sharedAuth.cookie },
    });
    await page.waitForTimeout(500);

    await navigateToOrgPage(page, orgSlug, '/');
    await expect(page.getByText(uniqueTitle)).toHaveCount(0, {
      timeout: 15_000,
    });

    await request.delete(`${CONTENT_API}/api/content/${contentId}`, {
      headers: { Cookie: sharedAuth.cookie },
    });
  });
});

test.describe('content cache invalidation — response headers', () => {
  test('public content endpoint carries Cache-Control: public, max-age=60', async ({
    request,
  }) => {
    // Any org works — response headers are middleware-level.
    const anyOrgId = '00000000-0000-0000-0000-000000000001';
    const response = await request.get(
      `${CONTENT_API}/api/content/public?orgId=${anyOrgId}&sort=newest&limit=1`
    );

    const cacheControl = response.headers()['cache-control'];
    expect(cacheControl).toBeDefined();
    // Post-fix: 60s at the edge aligns with working KV invalidation.
    expect(cacheControl).toMatch(/max-age=60/);
    expect(cacheControl).toMatch(/s-maxage=60/);
    expect(cacheControl).toMatch(/public/);
  });
});
