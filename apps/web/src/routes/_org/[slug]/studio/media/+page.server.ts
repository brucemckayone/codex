/**
 * Studio media page - server load
 *
 * Fetches paginated media items for the current organization.
 * Requires studio-level access (creator, admin, or owner).
 */
import { listMedia } from '$lib/remote/media.remote';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, url }) => {
  const { org } = await parent();

  const page = Number(url.searchParams.get('page') ?? '1');
  const limit = 12;

  const mediaResult = await listMedia({
    organizationId: org.id,
    page,
    limit,
  });

  return {
    mediaItems: mediaResult?.items ?? [],
    pagination: mediaResult?.pagination ?? {
      page,
      limit,
      total: 0,
      totalPages: 0,
    },
  };
};
