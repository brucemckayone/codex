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
import { publicContentSlugSchema } from '@codex/validation';
import { error, redirect } from '@sveltejs/kit';
import { renderContentBody } from '$lib/editor/render';
import { logger } from '$lib/observability';
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import {
  ACCESS_CHECK_FAILED_RESULT,
  EMPTY_SUB_CONTEXT,
  handlePurchaseAction,
  isPublicContent,
  loadAccessAndProgress,
  loadAccessWithBody,
  loadRelatedContent,
  loadSubscriptionContext,
  loadWithdrawnDetail,
  withoutRawBody,
} from '$lib/server/content-detail';
import type { ContentWithRelations } from '$lib/types';
import { buildContentUrl } from '$lib/utils/subdomain';
import { creatorHandle } from '../../creator-handle';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({
  params,
  url,
  locals,
  setHeaders,
  platform,
  cookies,
  depends,
}) => {
  depends('app:auth');
  const { contentSlug } = params;
  // The handle without its leading @ (URL convention: /@alex-creator).
  const username = creatorHandle(params.username);
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
  // A slug the public list refuses (too long, or with a NUL, which Postgres
  // refuses in text) names nothing, so it is a 404 here rather than the API's
  // 400 surfacing as a 500. The rule is the API's own.
  if (!publicContentSlugSchema.safeParse(contentSlug).success) {
    error(404, 'Content not found');
  }
  // One creator can hold this slug once in their personal space AND once per
  // org (slugs are unique per org and per creator's personal space, not per
  // creator), so a single newest match could be the wrong piece. This URL is
  // the PERSONAL piece's (buildCreatorContentUrl): prefer it, and send an org
  // piece to its canonical page on the org's subdomain, where its brand,
  // access and checkout live. A 302, not a 301: a personal piece published
  // later under this slug takes the URL back.
  const contentParams = new URLSearchParams();
  contentParams.set('creatorId', creatorProfile.id);
  contentParams.set('slug', contentSlug);
  contentParams.set('limit', '50');

  const contentResult = await api.content.getPublicContent(contentParams);
  const matches = contentResult.items as ContentWithRelations[];
  const personalPiece =
    matches.find((item) => item.organizationId == null) ?? null;

  // No personal piece on the storefront. For a signed-in reader it may be one
  // withdrawn from sale that they still have (Codex-ov2ii). Asked before the
  // org redirect below: this URL is the personal piece's, so a reader who
  // still has it keeps it even when an org piece shares the slug.
  const withdrawn =
    personalPiece || !locals.user
      ? null
      : await loadWithdrawnDetail(
          { creatorId: creatorProfile.id, slug: contentSlug },
          platform,
          cookies
        );
  const content = personalPiece ?? withdrawn?.content ?? null;

  if (!content) {
    const orgPiece = matches.find((item) => item.organization?.slug);
    if (orgPiece?.organization?.slug) {
      redirect(
        302,
        buildContentUrl(url, {
          slug: orgPiece.slug,
          id: orgPiece.id,
          organizationSlug: orgPiece.organization.slug,
        })
      );
    }
    // Rows matched but none is personal or names its org: the org relation
    // failed to load (listPublic hides a deleted org's pieces), not a missing
    // piece. Still a 404 for the visitor, but logged, or a regression that
    // broke every redirect would look like mistyped URLs.
    if (matches.length > 0) {
      logger.error('Creator content slug matched no personal or org piece', {
        creatorId: creatorProfile.id,
        contentSlug,
        matches: matches.map(({ id, organizationId }) => ({
          id,
          organizationId,
        })),
      });
    }
    error(404, 'Content not found');
  }

  // What the browser receives: the row without its raw body. The body is
  // rendered below into contentBodyHtml, only once access allows it: from
  // `content` when the piece is public, from the access check's body when it
  // is gated (a gated public row carries none, Codex-039vo).
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

  // "More from this creator", streamed below the fold. By creator, not org:
  // this page only ever shows a personal piece (an org piece redirects), so an
  // org-scoped strip never made a request and always rendered empty.
  const relatedPromise = loadRelatedContent(api, {
    creatorId: creatorProfile.id,
  });

  // Withdrawn from sale: the access check already ran and granted, so the page
  // renders the body and player that check returned, with the note in place
  // of any offer (there is nothing left to buy or subscribe to).
  if (withdrawn) {
    setHeaders(successCacheHeaders);
    return {
      content: pageContent,
      contentBodyHtml: withdrawn.body
        ? await renderContentBody(withdrawn.body)
        : null,
      hasAccess: null,
      streamingUrl: null,
      progress: null,
      accessAndProgress: Promise.resolve(withdrawn.access),
      withdrawnHeld: withdrawn.held,
      subscriptionContext: Promise.resolve(EMPTY_SUB_CONTEXT),
      creatorProfile,
      username,
      relatedContent: relatedPromise,
    };
  }

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
  // render the body conditionally. The body comes from that check, not from
  // `content`, whose public row carries none for a gated piece (Codex-039vo).
  // Non-followers never receive the text via the load payload.
  const { access: accessResult, body } = await loadAccessWithBody(
    content.id,
    platform,
    cookies,
    content
  ).catch(() => ({ access: ACCESS_CHECK_FAILED_RESULT, body: null }));

  const gatedBodyHtml =
    accessResult.hasAccess && body ? await renderContentBody(body) : null;

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
