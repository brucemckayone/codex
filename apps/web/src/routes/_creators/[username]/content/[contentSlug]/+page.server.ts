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
import { error } from '@sveltejs/kit';
import { renderContentBody } from '$lib/editor/render';
import { getPublicContent } from '$lib/remote/content.remote';
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import {
  handlePurchaseAction,
  loadAccessAndProgress,
  loadSubscriptionContext,
} from '$lib/server/content-detail';
import type { ContentWithRelations } from '$lib/types';
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

  let content: ContentWithRelations | null = null;
  try {
    const contentResult = await api.content.list(contentParams);
    content = (contentResult?.items?.[0] as ContentWithRelations) ?? null;
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

  // Fetch related content — returned as a bare promise (streamed, below fold)
  const relatedPromise = content.organization?.id
    ? getPublicContent({
        orgId: content.organization.id,
        sort: 'newest',
        limit: 5,
      })
        .then((r) => r?.items ?? [])
        .catch(
          () => [] as Awaited<ReturnType<typeof getPublicContent>>['items']
        )
    : Promise.resolve(
        [] as Awaited<ReturnType<typeof getPublicContent>>['items']
      );

  // Subscription context (org-scoped content may have tier gating)
  const subContextPromise = content.organization?.id
    ? loadSubscriptionContext(
        content.organization.id,
        content.minimumTierId ?? null,
        platform,
        cookies,
        content.accessType
      ).catch(() => ({
        requiresSubscription:
          content.accessType === 'subscribers' || !!content.minimumTierId,
        hasSubscription: false,
        subscriptionCoversContent: false,
        currentSubscription: null,
        tiers: [],
      }))
    : Promise.resolve({
        requiresSubscription: false,
        hasSubscription: false,
        subscriptionCoversContent: false,
        currentSubscription: null,
        tiers: [],
      });

  // For unauthenticated visitors — no access checks, no streaming
  if (!locals.user) {
    return {
      content,
      contentBodyHtml,
      hasAccess: false as const,
      streamingUrl: null,
      progress: null,
      accessAndProgress: null,
      subscriptionContext: subContextPromise,
      creatorProfile,
      username,
      relatedContent: relatedPromise,
    };
  }

  // For authenticated users — stream access+progress (secondary, not needed for first paint)
  return {
    content,
    contentBodyHtml,
    hasAccess: null,
    streamingUrl: null,
    progress: null,
    accessAndProgress: loadAccessAndProgress(
      content.id,
      platform,
      cookies
    ).catch(() => ({
      hasAccess: false as const,
      streamingUrl: null,
      progress: null,
    })),
    subscriptionContext: subContextPromise,
    creatorProfile,
    username,
    relatedContent: relatedPromise,
  };
};

export const actions: Actions = {
  /**
   * Create a Stripe checkout session for content purchase.
   *
   * Phase 1: Personal content (no organizationId) will be rejected by the
   * backend purchase service. The shared handler catches this and returns a
   * user-friendly message.
   */
  purchase: async ({ request, url, params, platform, cookies }) =>
    handlePurchaseAction({
      request,
      url,
      platform,
      cookies,
      buildSuccessUrl: (origin) =>
        `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}&contentSlug=${encodeURIComponent(params.contentSlug)}&username=${encodeURIComponent(params.username)}`,
    }),
};
