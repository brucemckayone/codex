/**
 * E2E Test: Organization Lifecycle
 *
 * Validates the full lifecycle of organizations:
 * 1. Creation logic and default fields
 * 2. Slug validation and uniqueness
 * 3. Retrieval patterns (ID, Slug, Search)
 * 4. Update lifecycle and authorization
 * 5. Soft delete lifecycle and consequences
 */

import { closeDbPool } from '@codex/database';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { adminFixture, authFixture, httpClient } from '../fixtures';
import {
  expectErrorResponse,
  expectForbidden,
  expectNotFound,
  expectSuccessResponse,
} from '../helpers/assertions';
import type { PlatformOwnerContext, RegisteredUser } from '../helpers/types';
import { WORKER_URLS } from '../helpers/worker-urls';

describe('Organization Lifecycle', () => {
  let creator: PlatformOwnerContext;
  let outsider: RegisteredUser;

  const orgBaseUrl = `${WORKER_URLS.organization}/api/organizations`;

  beforeAll(async () => {
    // Create Creator (as platform_owner) and Outsider users
    // Using adminFixture ensure the user has platform_owner role and bypasses local subdomain restrictions
    creator = await adminFixture.createPlatformOwner({
      email: `creator-org-${Date.now()}@example.com`,
      password: 'SecurePassword123!',
      orgName: 'Initial Org',
      orgSlug: `initial-org-${Date.now()}`,
    });

    outsider = await authFixture.registerUser({
      email: `outsider-org-${Date.now()}@example.com`,
      password: 'SecurePassword123!',
      name: 'Org Outsider',
    });
  }, 60000);

  // ============================================================================
  // 1. Organization Creation
  // ============================================================================

  describe('Organization Creation', () => {
    test(
      'should create organization with valid data',
      { timeout: 30000 },
      async () => {
        const orgData = {
          name: `Lifecycle Org ${Date.now()}`,
          slug: `lifecycle-org-${Date.now()}`,
          description: 'Test organization created via E2E lifecycle test',
          websiteUrl: 'https://lifecycle.example.com',
        };

        const response = await httpClient.post(orgBaseUrl, {
          headers: {
            Cookie: creator.cookie,
            Origin: WORKER_URLS.organization,
          },
          data: orgData,
        });

        await expectSuccessResponse(response, 201);
        const body = await response.json();
        const data = body.data;

        expect(data.id).toBeDefined();
        expect(data.name).toBe(orgData.name);
        expect(data.slug).toBe(orgData.slug);
        expect(data.createdAt).toBeDefined();
        expect(data.updatedAt).toBeDefined();
        expect(data.deletedAt).toBeNull();
      }
    );
  });

  // ============================================================================
  // 2. Slug Validation & Uniqueness
  // ============================================================================

  describe('Slug Validation & Uniqueness', () => {
    test('should check slug availability', { timeout: 30000 }, async () => {
      const uniqueSlug = `unique-slug-${Date.now()}`;

      const response = await httpClient.get(
        `${orgBaseUrl}/check-slug/${uniqueSlug}`,
        {
          headers: {
            Cookie: creator.cookie,
          },
        }
      );

      await expectSuccessResponse(response);
      const body = await response.json();
      expect(body.data.available).toBe(true);
    });

    test(
      'should reject duplicate slug with 409',
      { timeout: 30000 },
      async () => {
        const sharedSlug = `duplicate-slug-${Date.now()}`;

        // Create first org
        await httpClient.post(orgBaseUrl, {
          headers: {
            Cookie: creator.cookie,
            Origin: WORKER_URLS.organization,
          },
          data: {
            name: 'First Org',
            slug: sharedSlug,
          },
        });

        // Try to create second org with same slug
        const response = await httpClient.post(orgBaseUrl, {
          headers: {
            Cookie: outsider.cookie,
            Origin: WORKER_URLS.organization,
          },
          data: {
            name: 'Second Org',
            slug: sharedSlug,
          },
        });

        expect(response.status).toBe(409);
        await expectErrorResponse(response, 'CONFLICT', 409);

        // Verify check-slug reports it as taken
        const checkResponse = await httpClient.get(
          `${orgBaseUrl}/check-slug/${sharedSlug}`,
          {
            headers: {
              Cookie: creator.cookie,
            },
          }
        );
        const checkBody = await checkResponse.json();
        expect(checkBody.data.available).toBe(false);
      }
    );

    test(
      'should reject invalid slug format with 400',
      { timeout: 30000 },
      async () => {
        const response = await httpClient.post(orgBaseUrl, {
          headers: {
            Cookie: creator.cookie,
            Origin: WORKER_URLS.organization,
          },
          data: {
            name: 'Invalid Slug Org',
            slug: 'Invalid Slug!',
          },
        });

        expect(response.status).toBe(400);
        await expectErrorResponse(response, 'VALIDATION_ERROR', 400);
      }
    );
  });

  // ============================================================================
  // 3. Retrieval & Listing
  // ============================================================================

  describe('Retrieval & Listing', () => {
    test(
      'should retrieve organization by ID and Slug',
      { timeout: 30000 },
      async () => {
        const orgName = `Retrieval Org ${Date.now()}`;
        const orgSlug = `retrieval-org-${Date.now()}`;

        const createRes = await httpClient.post(orgBaseUrl, {
          headers: {
            Cookie: creator.cookie,
            Origin: WORKER_URLS.organization,
          },
          data: { name: orgName, slug: orgSlug },
        });
        const body = await createRes.json();
        const created = body.data;

        // Get by ID
        const getByIdRes = await httpClient.get(`${orgBaseUrl}/${created.id}`, {
          headers: { Cookie: outsider.cookie },
        });
        await expectSuccessResponse(getByIdRes);
        const getByIdBody = await getByIdRes.json();
        expect(getByIdBody.data.name).toBe(orgName);

        // Get by Slug
        const getBySlugRes = await httpClient.get(
          `${orgBaseUrl}/slug/${orgSlug}`,
          {
            headers: { Cookie: outsider.cookie },
          }
        );
        await expectSuccessResponse(getBySlugRes);
        const getBySlugBody = await getBySlugRes.json();
        expect(getBySlugBody.data.id).toBe(created.id);
      }
    );

    test(
      'should list organizations with search',
      { timeout: 30000 },
      async () => {
        const uniqueName = `SearchableOrg${Date.now()}`;
        await httpClient.post(orgBaseUrl, {
          headers: {
            Cookie: creator.cookie,
            Origin: WORKER_URLS.organization,
          },
          data: { name: uniqueName, slug: `search-org-${Date.now()}` },
        });

        const response = await httpClient.get(
          `${orgBaseUrl}?search=${uniqueName}`,
          {
            headers: { Cookie: outsider.cookie },
          }
        );

        await expectSuccessResponse(response);
        const body = await response.json();
        const data = body.data;
        expect(data.items.length).toBeGreaterThanOrEqual(1);
        expect(
          data.items.some((org: { name: string }) => org.name === uniqueName)
        ).toBe(true);
      }
    );
  });

  // ============================================================================
  // 4. Update Lifecycle & Authorization
  // ============================================================================

  describe('Update Lifecycle & Authorization', () => {
    test(
      'should update organization name and description',
      { timeout: 30000 },
      async () => {
        const createRes = await httpClient.post(orgBaseUrl, {
          headers: {
            Cookie: creator.cookie,
            Origin: WORKER_URLS.organization,
          },
          data: { name: 'Old Name', slug: `update-org-${Date.now()}` },
        });
        const body = await createRes.json();
        const created = body.data;

        const updatedData = {
          name: 'New Name',
          description: 'Updated Description',
        };

        const response = await httpClient.patch(`${orgBaseUrl}/${created.id}`, {
          headers: {
            Cookie: creator.cookie,
            Origin: WORKER_URLS.organization,
          },
          data: updatedData,
        });

        await expectSuccessResponse(response);
        const updatedBody = await response.json();
        expect(updatedBody.data.name).toBe(updatedData.name);
        expect(updatedBody.data.description).toBe(updatedData.description);
      }
    );

    test(
      'should reject update from non-member user',
      { timeout: 30000 },
      async () => {
        const createRes = await httpClient.post(orgBaseUrl, {
          headers: {
            Cookie: creator.cookie,
            Origin: WORKER_URLS.organization,
          },
          data: { name: 'Protected Org', slug: `protected-org-${Date.now()}` },
        });
        const body = await createRes.json();
        const created = body.data;

        const response = await httpClient.patch(`${orgBaseUrl}/${created.id}`, {
          headers: {
            Cookie: outsider.cookie,
            Origin: WORKER_URLS.organization,
          },
          data: { name: 'Hacker Name' },
        });

        expect(response.status).toBe(403);
        await expectForbidden(response);
      }
    );

    test(
      'should reject slug update to existing slug',
      { timeout: 30000 },
      async () => {
        const slug1 = `shared-slug-1-${Date.now()}`;
        const slug2 = `shared-slug-2-${Date.now()}`;

        await httpClient.post(orgBaseUrl, {
          headers: {
            Cookie: creator.cookie,
            Origin: WORKER_URLS.organization,
          },
          data: { name: 'Org 1', slug: slug1 },
        });

        const createRes2 = await httpClient.post(orgBaseUrl, {
          headers: {
            Cookie: creator.cookie,
            Origin: WORKER_URLS.organization,
          },
          data: { name: 'Org 2', slug: slug2 },
        });
        const body2 = await createRes2.json();
        const org2 = body2.data;

        // Try to update org2's slug to slug1
        const response = await httpClient.patch(`${orgBaseUrl}/${org2.id}`, {
          headers: {
            Cookie: creator.cookie,
            Origin: WORKER_URLS.organization,
          },
          data: { slug: slug1 },
        });

        expect(response.status).toBe(409);
        await expectErrorResponse(response, 'CONFLICT', 409);
      }
    );
  });

  // ============================================================================
  // 5. Soft Delete Lifecycle
  // ============================================================================

  describe('Soft Delete Lifecycle', () => {
    test(
      'should reject deletion from non-member',
      { timeout: 30000 },
      async () => {
        const createRes = await httpClient.post(orgBaseUrl, {
          headers: {
            Cookie: creator.cookie,
            Origin: WORKER_URLS.organization,
          },
          data: {
            name: 'Protected Deletion',
            slug: `delete-fail-${Date.now()}`,
          },
        });
        const body = await createRes.json();
        const created = body.data;

        const response = await httpClient.delete(
          `${orgBaseUrl}/${created.id}`,
          {
            headers: {
              Cookie: outsider.cookie,
              Origin: WORKER_URLS.organization,
            },
          }
        );

        expect(response.status).toBe(403);
        await expectForbidden(response);
      }
    );

    test(
      'should soft delete organization and hide from retrieval',
      { timeout: 30000 },
      async () => {
        const orgSlug = `delete-success-${Date.now()}`;
        const createRes = await httpClient.post(orgBaseUrl, {
          headers: {
            Cookie: creator.cookie,
            Origin: WORKER_URLS.organization,
          },
          data: { name: 'To Be Deleted', slug: orgSlug },
        });
        const body = await createRes.json();
        const created = body.data;

        // Delete
        const deleteRes = await httpClient.delete(
          `${orgBaseUrl}/${created.id}`,
          {
            headers: {
              Cookie: creator.cookie,
              Origin: WORKER_URLS.organization,
            },
          }
        );
        await expectSuccessResponse(deleteRes);

        // Verify hidden from retrieval by ID
        const getByIdRes = await httpClient.get(`${orgBaseUrl}/${created.id}`, {
          headers: { Cookie: creator.cookie },
        });
        await expectNotFound(getByIdRes);

        // Verify check-slug reports it as available (reusable)
        // Note: This depends on business logic choice in plan.
        // If unique index is partial WHERE deleted_at IS NULL, it's reusable.
        const checkResponse = await httpClient.get(
          `${orgBaseUrl}/check-slug/${orgSlug}`,
          {
            headers: {
              Cookie: creator.cookie,
            },
          }
        );
        const checkBody = await checkResponse.json();
        expect(checkBody.data.available).toBe(true);
      }
    );
  });

  afterAll(async () => {
    await closeDbPool();
  });
});
