/**
 * Admin fixture for e2e tests
 * Handles platform owner setup and admin API helpers via REAL admin-api worker
 */

import { dbHttp, schema } from '@codex/database';
import type { APIRequestContext } from '@playwright/test';
import { eq } from 'drizzle-orm';

import type {
  AdminContentItem,
  AdminPaginatedResponse,
  CustomerDetails,
  CustomerStats,
  CustomerWithStats,
  PlatformOwnerContext,
  RevenueStats,
  TopContentItem,
} from '../helpers/types';
import { WORKER_URLS } from '../helpers/worker-urls';
import { authFixture } from './auth.fixture';

export const adminFixture = {
  /**
   * Create platform owner user with organization
   *
   * 1. Registers user via auth worker
   * 2. Updates user.role to 'platform_owner' in database
   * 3. Creates organization
   * 4. Creates organization membership with role='owner'
   */
  async createPlatformOwner(
    request: APIRequestContext,
    data: {
      email: string;
      password: string;
      name?: string;
      orgName: string;
      orgSlug: string;
    }
  ): Promise<PlatformOwnerContext> {
    // Step 1: Register user via auth worker
    const registeredUser = await authFixture.registerUser(request, {
      email: data.email,
      password: data.password,
      name: data.name ?? 'Platform Admin',
      role: 'customer', // Will upgrade to platform_owner
    });

    // Step 2: Update user role to platform_owner in database
    await dbHttp
      .update(schema.users)
      .set({ role: 'platform_owner' })
      .where(eq(schema.users.id, registeredUser.user.id));

    // Step 3: Create organization directly in database
    const [organization] = await dbHttp
      .insert(schema.organizations)
      .values({
        name: data.orgName,
        slug: data.orgSlug,
        description: 'E2E Test Organization for Admin Dashboard',
      })
      .returning();

    // Step 4: Create organization membership with owner role
    await dbHttp.insert(schema.organizationMemberships).values({
      organizationId: organization.id,
      userId: registeredUser.user.id,
      role: 'owner',
      status: 'active',
    });

    // Update user object with new role
    const updatedUser = {
      ...registeredUser.user,
      role: 'platform_owner',
    };

    return {
      user: updatedUser,
      session: registeredUser.session,
      cookie: registeredUser.cookie,
      organization,
    };
  },

  // ============================================================================
  // Analytics API Helpers
  // ============================================================================

  /**
   * GET /api/admin/analytics/revenue
   */
  async getRevenueStats(
    request: APIRequestContext,
    cookie: string,
    params?: { startDate?: string; endDate?: string }
  ): Promise<RevenueStats> {
    const url = new URL(`${WORKER_URLS.admin}/api/admin/analytics/revenue`);
    if (params?.startDate) url.searchParams.set('startDate', params.startDate);
    if (params?.endDate) url.searchParams.set('endDate', params.endDate);

    const response = await request.get(url.toString(), {
      headers: {
        Cookie: cookie,
        Origin: WORKER_URLS.admin,
      },
    });

    if (!response.ok()) {
      const error = await response.text();
      throw new Error(
        `getRevenueStats failed (${response.status()}): ${error}`
      );
    }

    const body = await response.json();
    return body.data;
  },

  /**
   * GET /api/admin/analytics/customers
   */
  async getCustomerStats(
    request: APIRequestContext,
    cookie: string
  ): Promise<CustomerStats> {
    const response = await request.get(
      `${WORKER_URLS.admin}/api/admin/analytics/customers`,
      {
        headers: {
          Cookie: cookie,
          Origin: WORKER_URLS.admin,
        },
      }
    );

    if (!response.ok()) {
      const error = await response.text();
      throw new Error(
        `getCustomerStats failed (${response.status()}): ${error}`
      );
    }

    const body = await response.json();
    return body.data;
  },

  /**
   * GET /api/admin/analytics/top-content
   */
  async getTopContent(
    request: APIRequestContext,
    cookie: string,
    limit?: number
  ): Promise<TopContentItem[]> {
    const url = new URL(`${WORKER_URLS.admin}/api/admin/analytics/top-content`);
    if (limit) url.searchParams.set('limit', limit.toString());

    const response = await request.get(url.toString(), {
      headers: {
        Cookie: cookie,
        Origin: WORKER_URLS.admin,
      },
    });

    if (!response.ok()) {
      const error = await response.text();
      throw new Error(`getTopContent failed (${response.status()}): ${error}`);
    }

    const body = await response.json();
    return body.data;
  },

  // ============================================================================
  // Content Management API Helpers
  // ============================================================================

  /**
   * GET /api/admin/content
   */
  async listAllContent(
    request: APIRequestContext,
    cookie: string,
    params?: { page?: number; limit?: number; status?: string }
  ): Promise<AdminPaginatedResponse<AdminContentItem>> {
    const url = new URL(`${WORKER_URLS.admin}/api/admin/content`);
    if (params?.page) url.searchParams.set('page', params.page.toString());
    if (params?.limit) url.searchParams.set('limit', params.limit.toString());
    if (params?.status) url.searchParams.set('status', params.status);

    const response = await request.get(url.toString(), {
      headers: {
        Cookie: cookie,
        Origin: WORKER_URLS.admin,
      },
    });

    if (!response.ok()) {
      const error = await response.text();
      throw new Error(`listAllContent failed (${response.status()}): ${error}`);
    }

    return response.json();
  },

  /**
   * POST /api/admin/content/:id/publish
   */
  async publishContent(
    request: APIRequestContext,
    cookie: string,
    contentId: string
  ): Promise<AdminContentItem> {
    const response = await request.post(
      `${WORKER_URLS.admin}/api/admin/content/${contentId}/publish`,
      {
        headers: {
          Cookie: cookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.admin,
        },
      }
    );

    if (!response.ok()) {
      const error = await response.text();
      throw new Error(`publishContent failed (${response.status()}): ${error}`);
    }

    const body = await response.json();
    return body.data;
  },

  /**
   * POST /api/admin/content/:id/unpublish
   */
  async unpublishContent(
    request: APIRequestContext,
    cookie: string,
    contentId: string
  ): Promise<AdminContentItem> {
    const response = await request.post(
      `${WORKER_URLS.admin}/api/admin/content/${contentId}/unpublish`,
      {
        headers: {
          Cookie: cookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.admin,
        },
      }
    );

    if (!response.ok()) {
      const error = await response.text();
      throw new Error(
        `unpublishContent failed (${response.status()}): ${error}`
      );
    }

    const body = await response.json();
    return body.data;
  },

  /**
   * DELETE /api/admin/content/:id
   */
  async deleteContent(
    request: APIRequestContext,
    cookie: string,
    contentId: string
  ): Promise<boolean> {
    const response = await request.delete(
      `${WORKER_URLS.admin}/api/admin/content/${contentId}`,
      {
        headers: {
          Cookie: cookie,
          Origin: WORKER_URLS.admin,
        },
      }
    );

    if (!response.ok() && response.status() !== 204) {
      const error = await response.text();
      throw new Error(`deleteContent failed (${response.status()}): ${error}`);
    }

    return true;
  },

  // ============================================================================
  // Customer Management API Helpers
  // ============================================================================

  /**
   * GET /api/admin/customers
   */
  async listCustomers(
    request: APIRequestContext,
    cookie: string,
    params?: { page?: number; limit?: number }
  ): Promise<AdminPaginatedResponse<CustomerWithStats>> {
    const url = new URL(`${WORKER_URLS.admin}/api/admin/customers`);
    if (params?.page) url.searchParams.set('page', params.page.toString());
    if (params?.limit) url.searchParams.set('limit', params.limit.toString());

    const response = await request.get(url.toString(), {
      headers: {
        Cookie: cookie,
        Origin: WORKER_URLS.admin,
      },
    });

    if (!response.ok()) {
      const error = await response.text();
      throw new Error(`listCustomers failed (${response.status()}): ${error}`);
    }

    return response.json();
  },

  /**
   * GET /api/admin/customers/:id
   */
  async getCustomerDetails(
    request: APIRequestContext,
    cookie: string,
    customerId: string
  ): Promise<CustomerDetails> {
    const response = await request.get(
      `${WORKER_URLS.admin}/api/admin/customers/${customerId}`,
      {
        headers: {
          Cookie: cookie,
          Origin: WORKER_URLS.admin,
        },
      }
    );

    if (!response.ok()) {
      const error = await response.text();
      throw new Error(
        `getCustomerDetails failed (${response.status()}): ${error}`
      );
    }

    const body = await response.json();
    return body.data;
  },

  /**
   * POST /api/admin/customers/:customerId/grant-access/:contentId
   */
  async grantContentAccess(
    request: APIRequestContext,
    cookie: string,
    customerId: string,
    contentId: string
  ): Promise<boolean> {
    const response = await request.post(
      `${WORKER_URLS.admin}/api/admin/customers/${customerId}/grant-access/${contentId}`,
      {
        headers: {
          Cookie: cookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.admin,
        },
      }
    );

    if (!response.ok()) {
      const error = await response.text();
      throw new Error(
        `grantContentAccess failed (${response.status()}): ${error}`
      );
    }

    return true;
  },
};
