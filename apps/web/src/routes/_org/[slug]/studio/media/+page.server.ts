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

  const status = url.searchParams.get('status') as
    | 'uploading'
    | 'uploaded'
    | 'transcoding'
    | 'ready'
    | 'failed'
    | null;
  const mediaType = url.searchParams.get('mediaType') as
    | 'video'
    | 'audio'
    | null;

  const mediaResult = await listMedia({
    organizationId: org.id,
    page,
    limit,
    ...(status && { status }),
    ...(mediaType && { mediaType }),
  });

  return {
    mediaItems: mediaResult?.items ?? [],
    pagination: mediaResult?.pagination ?? {
      page,
      limit,
      total: 0,
      totalPages: 0,
    },
    filters: {
      status: status ?? 'all',
      mediaType: mediaType ?? 'all',
    },
  };
};
