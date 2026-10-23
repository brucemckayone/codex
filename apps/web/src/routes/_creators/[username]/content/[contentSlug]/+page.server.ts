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
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import {
  ACCESS_CHECK_FAILED_RESULT,
  EMPTY_SUB_CONTEXT,
  handlePurchaseAction,
  isPublicContent,
  loadAccessAndProgress,
  loadRelatedContent,
  loadSubscriptionContext,
  withoutRawBody,
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

  // A 404 from the endpoint means no such creator, which IS a 404 here. Any
  // other failure propagates as a 500 rather than being mislabelled "Creator
  // not found" — the old blanket catch turned every identity-api error,
  // including the route not existing at all, into a 404 on a real creator.
  creatorProfile = await api.account.getPublicProfile(username);

  if (!creatorProfile?.id) {
    error(404, 'Creator not found');
  }

  // Fetch content by creatorId + slug
  // The PUBLIC list scoped by creator and slug, not the studio list, which
  // needs a session and lists the signed-in user's own content: a visitor
  // got a 404 here for every real piece (Codex-osuqt). No result is a 404.
  // A failed request is not, so it propagates as a 500, as the profile
  // lookup above does.
  //
  // A slug longer than publicContentQuerySchema allows (500) names nothing,
  // so it is a 404 here rather than the API's 400 surfacing as a 500.
  if (contentSlug.length > 500) {
    error(404, 'Content not found');
  }
  const contentParams = new URLSearchParams();
  contentParams.set('creatorId', creatorProfile.id);
  contentParams.set('slug', contentSlug);
  contentParams.set('limit', '1');

  const contentResult = await api.content.getPublicContent(contentParams);
  const content =
    (contentResult?.items?.[0] as ContentWithRelations | undefined) ?? null;

  if (!content) {
    error(404, 'Content not found');
  }

  // What the browser receives: the row without its raw body. The body is
  // rendered below from `content` into contentBodyHtml, and only once access
  // allows it.
  const pageContent = withoutRawBody(content);

  // Cache header is applied ONLY on the success path right before each return.
  // This page renders auth-aware HTML (the creator layout injects `user` and
  // the CTA switches on isAuthenticated), so the SAME URL yields different
  // markup per auth state. Shared caches (Cloudflare edge, miniflare) key by
  // URL, NOT by Cookie, so any `public` response cached for an anonymous
  // visitor is served to signed-in users too. PRIVATE keeps it out of shared
  // caches. This creator-scoped lookup is NOT KV-cached in content-api
  // (shouldCachePublicContentQuery skips any query naming a creator), so each
  // render reads the DB. See docs/caching-strategy.md.
  const successCacheHeaders = CACHE_HEADERS.PRIVATE;

  // Body gating: only render the body once access is confirmed. Free content
  // renders immediately (SEO + first-paint). Everything else (followers /
  // subscribers / paid / team) waits for the authenticated access check below
  // — this is what prevents a non-follower from reading the article text
  // through view-source or the SvelteKit load payload.
  const isPublic = isPublicContent(content);
  const publicBodyHtml = isPublic ? await renderContentBody(content) : null;

  // Fetch related content — returned as a bare promise (streamed, below fold)
  const relatedPromise = loadRelatedContent(api, content.organization?.id);

  // Subscription context (org-scoped content may have tier gating).
  // Skip the round-trip entirely for content that can't require a
  // subscription — no tier gate (includedInTierId == null, the WP-1
  // successor of accessType 'subscribers').
  // Saves 2-3 round-trips per non-gated page load (Codex-585ie).
  const gatingOrgId =
    content.includedInTierId != null
      ? (content.organization?.id ?? null)
      : null;

  const subContextPromise = gatingOrgId
    ? loadSubscriptionContext(
        gatingOrgId,
        content.includedInTierId ?? null,
        platform,
        cookies
      ).catch(() => ({
        ...EMPTY_SUB_CONTEXT,
        requiresSubscription: content.includedInTierId != null,
      }))
    : Promise.resolve(EMPTY_SUB_CONTEXT);

  // For unauthenticated visitors — body unlocks for public (free) content
  // so visitors can read it; streaming stays locked (no cookie, no signed URL).
  if (!locals.user) {
    setHeaders(successCacheHeaders);
    return {
      content: pageContent,
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
      content: pageContent,
      contentBodyHtml: publicBodyHtml,
      hasAccess: null,
      streamingUrl: null,
      progress: null,
      accessAndProgress: loadAccessAndProgress(
        content.id,
        platform,
        cookies,
        content
      ).catch(() => ({ ...ACCESS_CHECK_FAILED_RESULT, hasAccess: isPublic })),
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
    content
  ).catch(() => ACCESS_CHECK_FAILED_RESULT);

  const gatedBodyHtml = accessResult.hasAccess
    ? await renderContentBody(content)
    : null;

  setHeaders(successCacheHeaders);
  return {
    content: pageContent,
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
