/**
 * Content detail page - server load
 *
 * Fetches content by slug, checks user access, and optionally
 * loads streaming URL and playback progress.
 */
import { error } from '@sveltejs/kit';
import { getContentBySlug } from '$lib/remote/content.remote';
import {
  getPlaybackProgress,
  getStreamingUrl,
} from '$lib/remote/library.remote';
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, parent, setHeaders }) => {
  const { org } = await parent();
  const { contentSlug } = params;

  // Always private — response varies by auth state
  setHeaders(CACHE_HEADERS.PRIVATE);

  // Fetch content by org + content slug
  const contentResult = await getContentBySlug({
    orgSlug: org.slug,
    contentSlug,
  }).catch(() => null);

  const content = contentResult?.data;
  if (!content) {
    error(404, 'Content not found');
  }

  // Check access for logged-in users
  let hasAccess = false;
  let streamingUrl: string | null = null;
  let progress: {
    positionSeconds: number;
    durationSeconds: number;
    completed: boolean;
  } | null = null;

  const parentData = await parent();
  if (parentData.user) {
    try {
      const streamResult = await getStreamingUrl(content.id);
      if (streamResult?.streamingUrl) {
        hasAccess = true;
        streamingUrl = streamResult.streamingUrl;

        // Only fetch progress if user has access
        const progressResult = await getPlaybackProgress(content.id);
        if (progressResult) {
          progress = {
            positionSeconds: progressResult.positionSeconds,
            durationSeconds: progressResult.durationSeconds,
            completed: progressResult.completed,
          };
        }
      }
    } catch {
      // Access denied or error — user doesn't have access
      hasAccess = false;
    }
  }

  return {
    content,
    hasAccess,
    streamingUrl,
    progress,
  };
};
