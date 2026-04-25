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
  isPublicAccessType,
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
  depends,
}) => {
  depends('app:auth');
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

  // Cache header is applied ONLY on the success path right before each return.
  // Setting it eagerly here would cause `error(404)` and unhandled rejections
  // in awaits below (renderContentBody, loadAccessAndProgress) to inherit
  // `Cache-Control: public, max-age=...`, poisoning the CDN with the error
  // response. REVALIDATE variant forces browsers to revalidate on every
  // request so a buyer returning from Stripe doesn't see the anonymous
  // response cached earlier.
  const successCacheHeaders = locals.user
    ? CACHE_HEADERS.PRIVATE
    : CACHE_HEADERS.DYNAMIC_PUBLIC_REVALIDATE;

  // Body gating: only render the body once access is confirmed. Free content
  // renders immediately (SEO + first-paint). Everything else (followers /
  // subscribers / paid / team) waits for the authenticated access check below
  // — this is what prevents a non-follower from reading the article text
  // through view-source or the SvelteKit load payload.
  const isPublic = isPublicAccessType(content.accessType);
  const publicBodyHtml = isPublic ? await renderContentBody(content) : null;

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

  // Subscription context (org-scoped content may have tier gating).
  // Skip the round-trip entirely for content that can't require a
  // subscription — non-subscriber accessType and no minimum tier.
  // Saves 2-3 round-trips per non-gated page load (Codex-585ie).
  const mayRequireSubscription =
    !!content.organization?.id &&
    (content.accessType === 'subscribers' || !!content.minimumTierId);

  const subContextPromise = mayRequireSubscription
    ? loadSubscriptionContext(
        content.organization!.id,
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

  // For unauthenticated visitors — body unlocks for public (free) content
  // so visitors can read it; streaming stays locked (no cookie, no signed URL).
  if (!locals.user) {
    setHeaders(successCacheHeaders);
    return {
      content,
      contentBodyHtml: publicBodyHtml,
      hasAccess: isPublic,
      streamingUrl: null,
      progress: null,
      accessAndProgress: null,
      subscriptionContext: subContextPromise,
      creatorProfile,
      username,
      relatedContent: relatedPromise,
    };
  }

  // Authenticated + free content: fast path — body already rendered, stream
  // the access+progress for the player/streaming URL.
  if (isPublic) {
    setHeaders(successCacheHeaders);
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
      subscriptionContext: subContextPromise,
      creatorProfile,
      username,
      relatedContent: relatedPromise,
    };
  }

  // Gated content + authenticated user: await the access check so we can
  // render the body conditionally. Non-followers never receive the text via
  // the load payload.
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

  setHeaders(successCacheHeaders);
  return {
    content,
    contentBodyHtml: gatedBodyHtml,
    hasAccess: null,
    streamingUrl: null,
    progress: null,
    accessAndProgress: Promise.resolve(accessResult),
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
