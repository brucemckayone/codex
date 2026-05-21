/**
 * Admin fixture for e2e tests
 * Handles platform owner setup and admin API helpers via REAL admin-api worker
 *
 * Admin API endpoints use `auth: 'required' + requireOrgMembership + requireOrgManagement`
 * (admin-api/CLAUDE.md). Org context is resolved from URL param, subdomain, or
 * `?organizationId=` query param. The e2e test client hits localhost directly
 * (no subdomain) and most admin routes have no orgId path param, so the fixture
 * accepts a `PlatformOwnerContext`-shaped first arg and appends the org id as a
 * query parameter on every request. Without this, the procedure resolver throws
 * `VALIDATION_ERROR { code: 'ORG_CONTEXT_REQUIRED' }` before any role check fires.
 */

import { dbHttp, schema } from '@codex/database';
import { authFixture, httpClient } from '@codex/test-utils/e2e';
import type {
  AdminContentItem,
  AdminPaginatedResponse,
  CustomerDetails,
  CustomerStats,
  CustomerWithStats,
  PlatformOwnerContext,
  RevenueStats,
  TopContentItem,
} from '@codex/test-utils/e2e/helpers/types';
import { eq } from 'drizzle-orm';
import { WORKER_URLS } from '../helpers/worker-urls';

/**
 * Shape required by every admin fixture method: cookie + organization with id.
 * Compatible with the full PlatformOwnerContext returned by createPlatformOwner.
 */
type AdminContext = Pick<PlatformOwnerContext, 'cookie' | 'organization'>;

function adminHeaders(admin: AdminContext) {
  return {
    Cookie: admin.cookie,
    Origin: WORKER_URLS.admin,
  };
}

function adminUrl(path: string, admin: AdminContext): URL {
  const url = new URL(`${WORKER_URLS.admin}${path}`);
  url.searchParams.set('organizationId', admin.organization.id);
  return url;
}

export const adminFixture = {
  /**
   * Create platform owner user with organization
   *
   * 1. Registers user via auth worker
   * 2. Updates user.role to 'platform_owner' in database
   * 3. Creates organization
   * 4. Creates organization membership with role='owner'
   */
  async createPlatformOwner(data: {
    email: string;
    password: string;
    name?: string;
    orgName: string;
    orgSlug: string;
  }): Promise<PlatformOwnerContext> {
    // Step 1: Register user via auth worker
    const registeredUser = await authFixture.registerUser({
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

  /**
   * Create regular organization owner (NOT a platform owner)
   * For testing cross-org access denial - regular users should only access their own org
   *
   * 1. Registers user via auth worker (keeps default role)
   * 2. Creates organization
   * 3. Creates organization membership with role='owner'
   */
  async createOrgOwner(data: {
    email: string;
    password: string;
    name?: string;
    orgName: string;
    orgSlug: string;
  }): Promise<PlatformOwnerContext> {
    // Step 1: Register user via auth worker (keeps default role, NOT platform_owner)
    const registeredUser = await authFixture.registerUser({
      email: data.email,
      password: data.password,
      name: data.name ?? 'Org Owner',
      role: 'customer',
    });

    // Step 2: Create organization directly in database
    const [organization] = await dbHttp
      .insert(schema.organizations)
      .values({
        name: data.orgName,
        slug: data.orgSlug,
        description: 'E2E Test Organization',
      })
      .returning();

    // Step 3: Create organization membership with owner role
    await dbHttp.insert(schema.organizationMemberships).values({
      organizationId: organization.id,
      userId: registeredUser.user.id,
      role: 'owner',
      status: 'active',
    });

    return {
      user: registeredUser.user,
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
    admin: AdminContext,
    params?: { startDate?: string; endDate?: string }
  ): Promise<RevenueStats> {
    const url = adminUrl('/api/admin/analytics/revenue', admin);
    if (params?.startDate) url.searchParams.set('startDate', params.startDate);
    if (params?.endDate) url.searchParams.set('endDate', params.endDate);

    const response = await httpClient.get(url.toString(), {
      headers: adminHeaders(admin),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`getRevenueStats failed (${response.status}): ${error}`);
    }

    const body = await response.json();
    return body.data;
  },

  /**
   * GET /api/admin/analytics/customers
   */
  async getCustomerStats(admin: AdminContext): Promise<CustomerStats> {
    const url = adminUrl('/api/admin/analytics/customers', admin);
    const response = await httpClient.get(url.toString(), {
      headers: adminHeaders(admin),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`getCustomerStats failed (${response.status}): ${error}`);
    }

    const body = await response.json();
    return body.data;
  },

  /**
   * GET /api/admin/analytics/top-content
   * Returns paginated response, extracts items array for backward compatibility
   */
  async getTopContent(
    admin: AdminContext,
    limit?: number
  ): Promise<TopContentItem[]> {
    const url = adminUrl('/api/admin/analytics/top-content', admin);
    if (limit) url.searchParams.set('limit', limit.toString());

    const response = await httpClient.get(url.toString(), {
      headers: adminHeaders(admin),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`getTopContent failed (${response.status}): ${error}`);
    }

    const body = await response.json();
    return body.items ?? [];
  },

  // ============================================================================
  // Content Management API Helpers
  // ============================================================================

  /**
   * GET /api/admin/content
   */
  async listAllContent(
    admin: AdminContext,
    params?: { page?: number; limit?: number; status?: string }
  ): Promise<AdminPaginatedResponse<AdminContentItem>> {
    const url = adminUrl('/api/admin/content', admin);
    if (params?.page) url.searchParams.set('page', params.page.toString());
    if (params?.limit) url.searchParams.set('limit', params.limit.toString());
    if (params?.status) url.searchParams.set('status', params.status);

    const response = await httpClient.get(url.toString(), {
      headers: adminHeaders(admin),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`listAllContent failed (${response.status}): ${error}`);
    }

    const body = await response.json();
    return body;
  },

  /**
   * POST /api/admin/content/:id/publish
   */
  async publishContent(
    admin: AdminContext,
    contentId: string
  ): Promise<AdminContentItem> {
    const url = adminUrl(`/api/admin/content/${contentId}/publish`, admin);
    const response = await httpClient.post(url.toString(), {
      headers: adminHeaders(admin),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`publishContent failed (${response.status}): ${error}`);
    }

    const body = await response.json();
    return body.data;
  },

  /**
   * POST /api/admin/content/:id/unpublish
   */
  async unpublishContent(
    admin: AdminContext,
    contentId: string
  ): Promise<AdminContentItem> {
    const url = adminUrl(`/api/admin/content/${contentId}/unpublish`, admin);
    const response = await httpClient.post(url.toString(), {
      headers: adminHeaders(admin),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`unpublishContent failed (${response.status}): ${error}`);
    }

    const body = await response.json();
    return body.data;
  },

  /**
   * DELETE /api/admin/content/:id
   */
  async deleteContent(
    admin: AdminContext,
    contentId: string
  ): Promise<boolean> {
    const url = adminUrl(`/api/admin/content/${contentId}`, admin);
    const response = await httpClient.delete(url.toString(), {
      headers: adminHeaders(admin),
    });

    if (!response.ok && response.status !== 204) {
      const error = await response.text();
      throw new Error(`deleteContent failed (${response.status}): ${error}`);
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
    admin: AdminContext,
    params?: { page?: number; limit?: number }
  ): Promise<AdminPaginatedResponse<CustomerWithStats>> {
    const url = adminUrl('/api/admin/customers', admin);
    if (params?.page) url.searchParams.set('page', params.page.toString());
    if (params?.limit) url.searchParams.set('limit', params.limit.toString());

    const response = await httpClient.get(url.toString(), {
      headers: adminHeaders(admin),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`listCustomers failed (${response.status}): ${error}`);
    }

    const body = await response.json();
    return body;
  },

  /**
   * GET /api/admin/customers/:id
   */
  async getCustomerDetails(
    admin: AdminContext,
    customerId: string
  ): Promise<CustomerDetails> {
    const url = adminUrl(`/api/admin/customers/${customerId}`, admin);
    const response = await httpClient.get(url.toString(), {
      headers: adminHeaders(admin),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(
        `getCustomerDetails failed (${response.status}): ${error}`
      );
    }

    const body = await response.json();
    return body.data;
  },

  /**
   * POST /api/admin/customers/:customerId/grant-access/:contentId
   */
  async grantContentAccess(
    admin: AdminContext,
    customerId: string,
    contentId: string
  ): Promise<boolean> {
    const url = adminUrl(
      `/api/admin/customers/${customerId}/grant-access/${contentId}`,
      admin
    );
    const response = await httpClient.post(url.toString(), {
      headers: adminHeaders(admin),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(
        `grantContentAccess failed (${response.status}): ${error}`
      );
    }

    return true;
  },
};
