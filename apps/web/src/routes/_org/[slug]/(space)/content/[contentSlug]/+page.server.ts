/**
 * Content detail page - server load + checkout action
 *
 * Fetches content by slug, checks user access, and optionally
 * loads streaming URL and playback progress.
 *
 * Form actions:
 * - purchase: Creates a Stripe checkout session and returns the redirect URL
 */
import { error } from '@sveltejs/kit';
import { renderContentBody } from '$lib/editor/render';
import { getPublicContent } from '$lib/remote/content.remote';
import { CACHE_HEADERS } from '$lib/server/cache';
import {
  handlePurchaseAction,
  loadAccessAndProgress,
} from '$lib/server/content-detail';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({
  params,
  parent,
  setHeaders,
  platform,
  cookies,
}) => {
  const parentData = await parent();
  const { org } = parentData;
  const { contentSlug } = params;

  // Public visitors get CDN caching; authenticated responses vary by access state
  setHeaders(
    parentData.user ? CACHE_HEADERS.PRIVATE : CACHE_HEADERS.DYNAMIC_PUBLIC
  );

  // Fetch content via public endpoint with org.id + slug — 1 API call.
  // The old getContentBySlug() made 2 sequential HTTP calls:
  //   1. api.org.getBySlug(orgSlug) — redundant (org already resolved by layout)
  //   2. api.content.list({ organizationId, slug })
  // Now: single public call, no auth needed, CDN-cacheable.
  const contentResult = await getPublicContent({
    orgId: org.id,
    slug: contentSlug,
    limit: 1,
  }).catch(() => null);

  const content = contentResult?.items?.[0];
  if (!content) {
    error(404, 'Content not found');
  }

  // Render written content body to HTML (server-side)
  const contentBodyHtml = await renderContentBody(content);

  // Fetch related content — returned as a bare promise (streamed, below fold)
  const relatedPromise = getPublicContent({
    orgId: org.id,
    sort: 'newest',
    limit: 5,
  })
    .then((r) => r?.items ?? [])
    .catch(() => [] as Awaited<ReturnType<typeof getPublicContent>>['items']);

  // For unauthenticated visitors — no access checks needed, no streaming
  if (!parentData.user) {
    return {
      content,
      contentBodyHtml,
      hasAccess: false as const,
      streamingUrl: null,
      progress: null,
      accessAndProgress: null,
      relatedContent: relatedPromise,
    };
  }

  // For authenticated users — stream access+progress (secondary, not needed for first paint).
  // getStreamingUrl doubles as access check — 403 means no access (expected for non-owners).
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
    relatedContent: relatedPromise,
  };
};

export const actions: Actions = {
  /**
   * Create a Stripe checkout session for content purchase.
   *
   * Returns { sessionUrl } on success for client-side redirect to Stripe.
   * The successUrl points to /checkout/success on the same org subdomain.
   * The cancelUrl returns the user to this content detail page.
   */
  purchase: async ({ request, url, params, platform, cookies }) =>
    handlePurchaseAction({
      request,
      url,
      platform,
      cookies,
      buildSuccessUrl: (origin) =>
        `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}&contentSlug=${encodeURIComponent(params.contentSlug)}`,
    }),
};
