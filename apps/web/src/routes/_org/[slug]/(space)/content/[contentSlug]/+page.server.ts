/**
 * Content detail page - server load + checkout action
 *
 * Fetches content by slug, checks user access, and optionally
 * loads streaming URL and playback progress.
 *
 * Form actions:
 * - purchase: Creates a Stripe checkout session and returns the redirect URL
 */
import { error, fail } from '@sveltejs/kit';
import { getPublicContent } from '$lib/remote/content.remote';
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import { ApiError } from '$lib/server/errors';
import type { Actions, PageServerLoad } from './$types';

/**
 * Render content body to HTML for written content.
 * Uses Tiptap generateHTML for JSON content, falls back to marked for legacy markdown.
 */
async function renderContentBody(content: {
  contentType: string;
  contentBodyJson?: Record<string, unknown> | null;
  contentBody?: string | null;
}): Promise<string | null> {
  if (content.contentType !== 'written') return null;

  if (content.contentBodyJson) {
    const { generateHTML } = await import('@tiptap/html');
    const { getRenderExtensions } = await import('$lib/editor/extensions');
    return generateHTML(content.contentBodyJson, getRenderExtensions('full'));
  }

  if (content.contentBody) {
    const { marked } = await import('marked');
    return marked.parse(content.contentBody, { async: false }) as string;
  }

  return null;
}

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

  // For unauthenticated visitors, return immediately — no access checks needed
  if (!parentData.user) {
    return {
      content,
      contentBodyHtml,
      hasAccess: false,
      streamingUrl: null,
      progress: null,
    };
  }

  // For authenticated users, fetch streaming URL + progress in parallel.
  // getStreamingUrl doubles as access check — 403 means no access (expected for non-owners).
  // Use direct API calls instead of query() remote functions to ensure 403s are properly caught.
  const api = createServerApi(platform, cookies);

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

  return { content, contentBodyHtml, hasAccess, streamingUrl, progress };
};

export const actions: Actions = {
  /**
   * Create a Stripe checkout session for content purchase.
   *
   * Returns { sessionUrl } on success for client-side redirect to Stripe.
   * The successUrl points to /checkout/success on the same org subdomain.
   * The cancelUrl returns the user to this content detail page.
   */
  purchase: async ({ request, url, params, platform, cookies }) => {
    const api = createServerApi(platform, cookies);
    const formData = await request.formData();
    const contentId = formData.get('contentId');

    if (!contentId || typeof contentId !== 'string') {
      return fail(400, { checkoutError: 'Missing content ID' });
    }

    const origin = url.origin;
    // Stripe replaces {CHECKOUT_SESSION_ID} with the real session ID at redirect time.
    // contentSlug lets the success page link back to the content detail.
    const successUrl = `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}&contentSlug=${encodeURIComponent(params.contentSlug)}`;
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

      return fail(500, {
        checkoutError: 'Failed to create checkout session. Please try again.',
      });
    }
  },
};
