/**
 * Studio Categories — server load
 *
 * Owner/admin-only management surface for the org's topic taxonomy.
 *
 * The studio `+layout.server.ts` already gates the subtree to
 * creator/admin/owner and exposes `userRole`. This page narrows that to
 * owner|admin (categories curation) and redirects lesser roles back to the
 * studio dashboard — a server-side gate, not merely a client `$effect`.
 *
 * It also loads the org's categories for instant first paint; the page's
 * `getCategories` remote query then owns reactive refresh after mutations.
 */
import { redirect } from '@sveltejs/kit';
import {
  type StudioCategory,
  toStudioCategory,
} from '$lib/remote/categories.types';
import { createServerApi } from '$lib/server/api';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, platform, cookies }) => {
  const { org, userRole } = await parent();

  // Curation gate: owner/admin only (members/creators bounce to the dashboard).
  if (userRole !== 'owner' && userRole !== 'admin') {
    redirect(302, '/studio');
  }

  const api = createServerApi(platform, cookies);
  const params = new URLSearchParams();
  params.set('organizationId', org.id);
  params.set('limit', '100');

  let categories: StudioCategory[] = [];
  try {
    const result = await api.categories.list(params);
    categories = (result?.items ?? []).map(toStudioCategory);
  } catch {
    // Non-fatal — the client getCategories query re-fetches; render empty.
  }

  return { orgId: org.id, categories };
};
