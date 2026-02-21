/**
 * Organization explore page - server load
 * Fetches content for the organization with filtering and pagination
 */
import { error } from '@sveltejs/kit';
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

const PAGE_SIZE = 12;

// Content item type for explore page
interface ContentItem {
  id: string;
  title: string;
  thumbnail: string | null;
  description: string | null;
  contentType: 'video' | 'audio' | 'article';
  duration: number | null;
  creator?: {
    username?: string;
    displayName?: string;
    avatar?: string | null;
  };
}

export const load: PageServerLoad = async ({
  url,
  params,
  parent,
  setHeaders,
  platform,
  cookies,
}) => {
  setHeaders(CACHE_HEADERS.DYNAMIC_PUBLIC);

  const parentData = await parent();
  const searchParams = url.searchParams;

  // Parse filters from URL
  const q = searchParams.get('q') ?? undefined;
  const type = searchParams.get('type') ?? undefined;
  const sort = (searchParams.get('sort') ?? 'newest') as
    | 'newest'
    | 'popular'
    | 'az';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1'));

  const api = createServerApi(platform, cookies);

  // Build query parameters for API
  const apiParams = new URLSearchParams();
  apiParams.set('status', 'published');
  apiParams.set('visibility', 'public');
  apiParams.set('page', String(page));
  apiParams.set('limit', String(PAGE_SIZE));

  // Add organization filter - filter by org's content
  // Note: This assumes the API supports filtering by organization ID
  // If not, we'll need to filter client-side or add org support
  if (parentData.org?.id) {
    apiParams.set('orgId', parentData.org.id);
  }

  // Add search query
  if (q) {
    apiParams.set('search', q);
  }

  // Add content type filter
  if (type && type !== 'all') {
    const typeMap: Record<string, string> = {
      video: 'video',
      audio: 'audio',
      written: 'article',
    };
    apiParams.set('type', typeMap[type] ?? type);
  }

  // Add sorting
  const sortMap: Record<string, string> = {
    newest: 'createdAt',
    popular: 'views',
    az: 'title',
  };
  apiParams.set('sort', sortMap[sort] ?? 'createdAt');

  // Handle sort direction (az is ascending, others are descending)
  if (sort === 'az') {
    apiParams.set('order', 'asc');
  } else {
    apiParams.set('order', 'desc');
  }

  try {
    const contentResult = await api.content.list(apiParams);

    if (!contentResult) {
      return {
        ...parentData,
        items: [],
        totalPages: 1,
        total: 0,
        filters: { q, type, sort, page },
      };
    }

    const { items: rawItems = [], pagination } = contentResult;
    const total = pagination?.total ?? 0;
    const totalPages = pagination?.totalPages ?? Math.ceil(total / PAGE_SIZE);

    // Transform content items to match ContentCard props
    const items: ContentItem[] = rawItems.map((item: any) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      thumbnail: item.mediaItem?.thumbnailUrl ?? null,
      contentType: item.type === 'article' ? 'article' : (item.type ?? 'video'),
      duration: item.mediaItem?.duration ?? null,
      creator: item.creator
        ? {
            username: item.creator.username,
            displayName: item.creator.name ?? item.creator.displayName,
            avatar: item.creator.avatarUrl ?? null,
          }
        : undefined,
    }));

    return {
      ...parentData,
      items,
      totalPages,
      total,
      filters: { q, type, sort, page },
    };
  } catch (err) {
    console.error('Failed to load org explore content:', err);
    // Return empty state on error rather than throwing
    return {
      ...parentData,
      items: [],
      totalPages: 1,
      total: 0,
      filters: { q, type, sort, page },
    };
  }
};
