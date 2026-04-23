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
  isPublicAccessType,
  loadAccessAndProgress,
  loadSubscriptionContext,
} from '$lib/server/content-detail';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({
  params,
  parent,
  locals,
  setHeaders,
  platform,
  cookies,
  depends,
}) => {
  depends('app:auth');
  const parentData = await parent();
  const { org } = parentData;
  const { contentSlug } = params;

  // Public visitors get CDN caching; authenticated responses vary by access state.
  // REVALIDATE variant forces browsers to revalidate on every request so a buyer
  // returning from Stripe doesn't see the anonymous response cached earlier.
  setHeaders(
    locals.user
      ? CACHE_HEADERS.PRIVATE
      : CACHE_HEADERS.DYNAMIC_PUBLIC_REVALIDATE
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

  // Body gating: only render `contentBodyHtml` once access is confirmed.
  // Free content renders immediately (SEO + first-paint). Everything else
  // (followers / subscribers / paid / team) waits for the authenticated
  // access check below — this is what prevents a non-follower from reading
  // the article text through view-source or the SvelteKit load payload.
  const isPublic = isPublicAccessType(content.accessType);
  const publicBodyHtml = isPublic ? await renderContentBody(content) : null;

  // Fetch related content — returned as a bare promise (streamed, below fold)
  const relatedPromise = getPublicContent({
    orgId: org.id,
    sort: 'newest',
    limit: 5,
  })
    .then((r) => r?.items ?? [])
    .catch(() => [] as Awaited<ReturnType<typeof getPublicContent>>['items']);

  // Only run the subscription-context fetch when content may be gated by
  // a subscription (accessType === 'subscribers' or an explicit minimum tier).
  // Non-gated content (paid / free / followers / team) never consumes the
  // result — skipping saves 2-3 round-trips per page load (Codex-585ie).
  const mayRequireSubscription =
    content.accessType === 'subscribers' || !!content.minimumTierId;

  const subscriptionContext = mayRequireSubscription
    ? loadSubscriptionContext(
        org.id,
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

  // For unauthenticated visitors — no streaming possible, but body unlocks
  // for public (free) content so visitors can read it. Gated content gets
  // null body (paywall teaser / CTA handles the display).
  if (!locals.user) {
    return {
      content,
      contentBodyHtml: publicBodyHtml,
      hasAccess: isPublic,
      streamingUrl: null,
      progress: null,
      accessAndProgress: null,
      subscriptionContext,
      relatedContent: relatedPromise,
    };
  }

  // For authenticated users on free content: fast path — body is already
  // rendered, stream the access+progress for the player/streaming URL.
  if (isPublic) {
    return {
      content,
      contentBodyHtml: publicBodyHtml,
      hasAccess: null,
      streamingUrl: null,
      progress: null,
      accessAndProgress: loadAccessAndProgress(
        content.id,
        platform,
        cookies,
        content.accessType
      ).catch(() => ({
        hasAccess: isPublic,
        streamingUrl: null,
        waveformUrl: null,
        expiresAt: null,
        revocationReason: null,
        progress: null,
      })),
      subscriptionContext,
      relatedContent: relatedPromise,
    };
  }

  // Gated content + authenticated user: await the access check so we can
  // render the body conditionally. No SEO cost — non-followers can't see
  // this content anyway, so there's no win in streaming. The security win
  // (body never lands in the payload for denied users) is worth the ~100ms.
  const accessResult = await loadAccessAndProgress(
    content.id,
    platform,
    cookies,
    content.accessType
  ).catch(() => ({
    hasAccess: false,
    streamingUrl: null,
    waveformUrl: null,
    expiresAt: null,
    revocationReason: null,
    progress: null,
  }));

  const gatedBodyHtml = accessResult.hasAccess
    ? await renderContentBody(content)
    : null;

  return {
    content,
    contentBodyHtml: gatedBodyHtml,
    hasAccess: null,
    streamingUrl: null,
    progress: null,
    // Keep the promise shape so +page.svelte's reactive $effect still fires.
    accessAndProgress: Promise.resolve(accessResult),
    subscriptionContext,
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
