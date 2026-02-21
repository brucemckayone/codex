/**
 * Content Detail Page - Server Load
 *
 * Fetches content by organization and content slugs.
 * Checks streaming access and returns signed URL if available.
 * Data is SSR'd and passed to client for hydration.
 */

import { error } from '@sveltejs/kit';
import { getContentBySlug } from '$lib/remote/content.remote';
import {
  getPlaybackProgress,
  getStreamingUrl,
} from '$lib/remote/library.remote';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({
  params,
  setHeaders,
  platform,
}) => {
  const { slug: orgSlug, contentSlug } = params;

  // Cache headers - vary by cookie for authenticated/non-authenticated
  setHeaders({
    'Cache-Control': 'private, no-cache, max-age=0',
    Vary: 'Cookie',
  });

  try {
    // Fetch organization data first (needed for page title and display)
    const { createServerApi } = await import('$lib/server/api');
    const api = createServerApi(platform, undefined); // No cookies needed for public org data

    let org: { id: string; slug: string; name: string } | null = null;
    try {
      const orgResponse = await api.org.getBySlug(orgSlug);
      org = orgResponse?.data
        ? {
            id: orgResponse.data.id,
            slug: orgResponse.data.slug,
            name: orgResponse.data.name,
          }
        : null;
    } catch {
      // Org fetch failed, continue without org data
    }

    if (!org) {
      error(404, 'Organization not found');
    }

    // Fetch content by slugs
    const contentResult = await getContentBySlug({ orgSlug, contentSlug });
    const content = contentResult?.data;

    if (!content) {
      error(404, 'Content not found');
    }

    // Check streaming access (throws 403 if no access)
    let hasAccess = false;
    let streamingUrl: string | null = null;

    try {
      const streamResult = await getStreamingUrl(content.id);
      streamingUrl = streamResult?.streamingUrl ?? null;
      hasAccess = !!streamingUrl;
    } catch {
      // 403 or other error means no access
      hasAccess = false;
    }

    // Fetch playback progress for resuming
    let progressPosition = 0;
    let progressDuration = 0;
    let progressCompleted = false;

    try {
      const progress = await getPlaybackProgress(content.id);
      progressPosition = progress.positionSeconds;
      progressDuration = progress.durationSeconds;
      progressCompleted = progress.completed;
    } catch {
      // No progress available
    }

    return {
      content,
      hasAccess,
      streamingUrl,
      progress: {
        positionSeconds: progressPosition,
        durationSeconds: progressDuration,
        completed: progressCompleted,
      },
      org,
      orgSlug,
    };
  } catch (e) {
    if (e instanceof Error && e.message === 'Content not found') {
      error(404, 'Content not found');
    }
    throw e;
  }
};
