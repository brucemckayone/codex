/**
 * Admin fixture for e2e tests
 * Handles platform owner setup and admin API helpers via REAL admin-api worker
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
   *
   * Admin-api routes are gated by `requireOrgMembership` + `requireOrgManagement`
   * with `auth: 'required'` (not `auth: 'platform_owner'`), so the procedure
   * does NOT auto-resolve the org from the platform_owner user. The fixture
   * must pass `organizationId` explicitly via query string — that's the
   * supported resolver path for routes without a UUID URL param.
   */
  async getRevenueStats(
    cookie: string,
    organizationId: string,
    params?: { startDate?: string; endDate?: string }
  ): Promise<RevenueStats> {
    const url = new URL(`${WORKER_URLS.admin}/api/admin/analytics/revenue`);
    url.searchParams.set('organizationId', organizationId);
    if (params?.startDate) url.searchParams.set('startDate', params.startDate);
    if (params?.endDate) url.searchParams.set('endDate', params.endDate);

    const response = await httpClient.get(url.toString(), {
      headers: {
        Cookie: cookie,
        Origin: WORKER_URLS.admin,
      },
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
  async getCustomerStats(
    cookie: string,
    organizationId: string
  ): Promise<CustomerStats> {
    const url = new URL(`${WORKER_URLS.admin}/api/admin/analytics/customers`);
    url.searchParams.set('organizationId', organizationId);
    const response = await httpClient.get(url.toString(), {
      headers: {
        Cookie: cookie,
        Origin: WORKER_URLS.admin,
      },
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
    cookie: string,
    organizationId: string,
    limit?: number
  ): Promise<TopContentItem[]> {
    const url = new URL(`${WORKER_URLS.admin}/api/admin/analytics/top-content`);
    url.searchParams.set('organizationId', organizationId);
    if (limit) url.searchParams.set('limit', limit.toString());

    const response = await httpClient.get(url.toString(), {
      headers: {
        Cookie: cookie,
        Origin: WORKER_URLS.admin,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`getTopContent failed (${response.status}): ${error}`);
    }

    const body = await response.json();
    // List envelope: { items, pagination } at top level
    return body.items ?? [];
  },

  // ============================================================================
  // Content Management API Helpers
  // ============================================================================

  /**
   * GET /api/admin/content
   */
  async listAllContent(
    cookie: string,
    organizationId: string,
    params?: { page?: number; limit?: number; status?: string }
  ): Promise<AdminPaginatedResponse<AdminContentItem>> {
    const url = new URL(`${WORKER_URLS.admin}/api/admin/content`);
    url.searchParams.set('organizationId', organizationId);
    if (params?.page) url.searchParams.set('page', params.page.toString());
    if (params?.limit) url.searchParams.set('limit', params.limit.toString());
    if (params?.status) url.searchParams.set('status', params.status);

    const response = await httpClient.get(url.toString(), {
      headers: {
        Cookie: cookie,
        Origin: WORKER_URLS.admin,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`listAllContent failed (${response.status}): ${error}`);
    }

    const body = await response.json();
    return body; // List envelope: { items, pagination } at top level
  },

  /**
   * POST /api/admin/content/:contentId/publish
   *
   * Route param is `:contentId` (not `:id`), so the procedure's org resolver
   * does not pick it up — orgId must be supplied via `?organizationId=` query.
   */
  async publishContent(
    cookie: string,
    organizationId: string,
    contentId: string
  ): Promise<AdminContentItem> {
    const url = new URL(
      `${WORKER_URLS.admin}/api/admin/content/${contentId}/publish`
    );
    url.searchParams.set('organizationId', organizationId);
    const response = await httpClient.post(url.toString(), {
      headers: {
        Cookie: cookie,
        Origin: WORKER_URLS.admin,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`publishContent failed (${response.status}): ${error}`);
    }

    const body = await response.json();
    return body.data;
  },

  /**
   * POST /api/admin/content/:contentId/unpublish
   */
  async unpublishContent(
    cookie: string,
    organizationId: string,
    contentId: string
  ): Promise<AdminContentItem> {
    const url = new URL(
      `${WORKER_URLS.admin}/api/admin/content/${contentId}/unpublish`
    );
    url.searchParams.set('organizationId', organizationId);
    const response = await httpClient.post(url.toString(), {
      headers: {
        Cookie: cookie,
        Origin: WORKER_URLS.admin,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`unpublishContent failed (${response.status}): ${error}`);
    }

    const body = await response.json();
    return body.data;
  },

  /**
   * DELETE /api/admin/content/:contentId
   */
  async deleteContent(
    cookie: string,
    organizationId: string,
    contentId: string
  ): Promise<boolean> {
    const url = new URL(`${WORKER_URLS.admin}/api/admin/content/${contentId}`);
    url.searchParams.set('organizationId', organizationId);
    const response = await httpClient.delete(url.toString(), {
      headers: {
        Cookie: cookie,
        Origin: WORKER_URLS.admin,
      },
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
    cookie: string,
    organizationId: string,
    params?: { page?: number; limit?: number }
  ): Promise<AdminPaginatedResponse<CustomerWithStats>> {
    const url = new URL(`${WORKER_URLS.admin}/api/admin/customers`);
    url.searchParams.set('organizationId', organizationId);
    if (params?.page) url.searchParams.set('page', params.page.toString());
    if (params?.limit) url.searchParams.set('limit', params.limit.toString());

    const response = await httpClient.get(url.toString(), {
      headers: {
        Cookie: cookie,
        Origin: WORKER_URLS.admin,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`listCustomers failed (${response.status}): ${error}`);
    }

    const body = await response.json();
    return body; // List envelope: { items, pagination } at top level
  },

  /**
   * GET /api/admin/customers/:id
   *
   * The `:id` route param holds a Better Auth user ID (alphanumeric, not a
   * UUID) so the resolver's param-UUID path falls through and we provide
   * orgId via query — the supported resolver path for non-UUID `:id` routes.
   */
  async getCustomerDetails(
    cookie: string,
    organizationId: string,
    customerId: string
  ): Promise<CustomerDetails> {
    const url = new URL(
      `${WORKER_URLS.admin}/api/admin/customers/${customerId}`
    );
    url.searchParams.set('organizationId', organizationId);
    const response = await httpClient.get(url.toString(), {
      headers: {
        Cookie: cookie,
        Origin: WORKER_URLS.admin,
      },
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
   *
   * Named route params (`customerId`, `contentId`) don't match the resolver's
   * `id || orgId || organizationId` lookup, so org must come from query.
   */
  async grantContentAccess(
    cookie: string,
    organizationId: string,
    customerId: string,
    contentId: string
  ): Promise<boolean> {
    const url = new URL(
      `${WORKER_URLS.admin}/api/admin/customers/${customerId}/grant-access/${contentId}`
    );
    url.searchParams.set('organizationId', organizationId);
    const response = await httpClient.post(url.toString(), {
      headers: {
        Cookie: cookie,
        Origin: WORKER_URLS.admin,
      },
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
