/**
 * Creator content detail page - server load + checkout action
 *
 * Fetches content by creator username and slug, checks user access,
 * and optionally loads streaming URL and playback progress.
 *
 * Form actions:
 * - purchase: Creates a Stripe checkout session and returns the redirect URL.
 *   Phase 1: Personal content purchase is blocked by the backend — returns
 *   a friendly error message instead of a generic 500.
 */
import { error, fail } from '@sveltejs/kit';
import { renderContentBody } from '$lib/editor/render';
import { getPublicContent } from '$lib/remote/content.remote';
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import { ApiError } from '$lib/server/errors';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({
  params,
  locals,
  setHeaders,
  platform,
  cookies,
}) => {
  const { contentSlug } = params;
  // Strip leading @ from username (URL convention: /@alex-creator)
  const username = params.username.replace(/^@/, '');
  const api = createServerApi(platform, cookies);

  // Fetch creator profile to get creatorId
  let creatorProfile: {
    id: string;
    name: string | null;
    image: string | null;
  } | null = null;

  try {
    const profileResult = await api.fetch<{
      id: string;
      name: string | null;
      image: string | null;
    } | null>('identity', `/api/user/public/${encodeURIComponent(username)}`);
    creatorProfile = profileResult ?? null;
  } catch {
    error(404, 'Creator not found');
  }

  if (!creatorProfile?.id) {
    error(404, 'Creator not found');
  }

  // Fetch content by creatorId + slug
  const contentParams = new URLSearchParams();
  contentParams.set('creatorId', creatorProfile.id);
  contentParams.set('slug', contentSlug);
  contentParams.set('status', 'published');
  contentParams.set('limit', '1');

  let content: Record<string, unknown> | null = null;
  try {
    const contentResult = await api.content.list(contentParams);
    content = contentResult?.items?.[0] ?? null;
  } catch {
    content = null;
  }

  if (!content) {
    error(404, 'Content not found');
  }

  // Set cache headers based on auth state
  setHeaders(
    locals.user ? CACHE_HEADERS.PRIVATE : CACHE_HEADERS.DYNAMIC_PUBLIC
  );

  // Render written content body to HTML
  const contentBodyHtml = await renderContentBody(content);

  // Fetch related content in parallel (non-blocking, guards against null org)
  const relatedPromise = content.organization?.id
    ? getPublicContent({
        orgId: content.organization.id,
        sort: 'newest',
        limit: 5,
      }).catch(() => null)
    : Promise.resolve(null);

  // For unauthenticated visitors — no access checks
  if (!locals.user) {
    const relatedResult = await relatedPromise;
    return {
      content,
      contentBodyHtml,
      hasAccess: false,
      streamingUrl: null,
      progress: null,
      creatorProfile,
      username,
      relatedContent: relatedResult?.items ?? [],
    };
  }

  // For authenticated users — check access + progress in parallel
  const [streamResult, progressResult] = await Promise.all([
    api.access.getStreamingUrl(content.id).catch(() => null),
    api.access.getProgress(content.id).catch(() => null),
  ]);

  const hasAccess = !!streamResult?.streamingUrl;
  const streamingUrl = streamResult?.streamingUrl ?? null;
  const progress = progressResult
    ? {
        positionSeconds: progressResult.positionSeconds,
        durationSeconds: progressResult.durationSeconds,
        completed: progressResult.completed,
      }
    : null;

  const relatedResult = await relatedPromise;
  return {
    content,
    contentBodyHtml,
    hasAccess,
    streamingUrl,
    progress,
    creatorProfile,
    username,
    relatedContent: relatedResult?.items ?? [],
  };
};

export const actions: Actions = {
  /**
   * Create a Stripe checkout session for content purchase.
   *
   * Phase 1: Personal content (no organizationId) will be rejected by the
   * backend purchase service. We catch this and return a user-friendly message.
   */
  purchase: async ({ request, url, params, platform, cookies }) => {
    const api = createServerApi(platform, cookies);
    const formData = await request.formData();
    const contentId = formData.get('contentId');

    if (!contentId || typeof contentId !== 'string') {
      return fail(400, { checkoutError: 'Missing content ID' });
    }

    const origin = url.origin;
    const successUrl = `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}&contentSlug=${encodeURIComponent(params.contentSlug)}&username=${encodeURIComponent(params.username)}`;
    const cancelUrl = url.href;

    try {
      const result = await api.checkout.create({
        contentId,
        successUrl,
        cancelUrl,
      });

      return { sessionUrl: result.sessionUrl };
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        return fail(409, {
          checkoutError: 'You already have access to this content.',
        });
      }

      // Phase 1: Personal content purchase blocked by backend
      if (err instanceof ApiError && err.message?.includes('organization')) {
        return fail(422, {
          checkoutError:
            'Purchases for personal creator content are coming soon. Stay tuned!',
        });
      }

      return fail(500, {
        checkoutError: 'Failed to create checkout session. Please try again.',
      });
    }
  },
};
