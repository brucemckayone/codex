/**
 * Studio Customers Page - server load
 *
 * Lists all organization customers with pagination for the studio customers table.
 * Auth and membership checks are handled by the parent studio layout
 * (redirects to login/join if not authenticated or not a member).
 * Additional admin/owner guard ensures only privileged roles can view customers.
 */
import { error } from '@sveltejs/kit';
import { createServerApi } from '$lib/server/api';
import type { PageServerLoad } from './$types';

const CUSTOMERS_LIMIT = 20;

export const load: PageServerLoad = async ({
  parent,
  url,
  platform,
  cookies,
}) => {
  const { org, userRole } = await parent();

  // Admin/owner only guard
  if (userRole !== 'admin' && userRole !== 'owner') {
    error(403, 'Insufficient permissions to view customers');
  }

  // Parse pagination from URL params with validation
  const page = Math.max(
    1,
    parseInt(url.searchParams.get('page') || '1', 10) || 1
  );

  // Build query parameters
  const params = new URLSearchParams();
  params.set('organizationId', org.id);
  params.set('page', String(page));
  params.set('limit', String(CUSTOMERS_LIMIT));

  try {
    const api = createServerApi(platform, cookies);
    const result = await api.admin.getCustomers(params);

    return {
      customers: {
        items: result.items,
        pagination: result.pagination,
      },
    };
  } catch {
    return {
      customers: {
        items: [],
        pagination: {
          page: 1,
          limit: CUSTOMERS_LIMIT,
          total: 0,
          totalPages: 0,
        },
      },
    };
  }
};
