/**
 * Content detail page - server load + checkout action
 *
 * Fetches content by slug, checks user access, and optionally
 * loads streaming URL and playback progress.
 *
 * Form actions:
 * - purchase: Creates a Stripe checkout session and returns the redirect URL
 */
import { publicContentSlugSchema } from '@codex/validation';
import { error } from '@sveltejs/kit';
import { hasStoredText, renderContentBody } from '$lib/editor/render';
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import {
  ACCESS_CHECK_FAILED_RESULT,
  detailPageCacheHeaders,
  EMPTY_SUB_CONTEXT,
  handlePurchaseAction,
  isPublicContent,
  loadAccessAndProgress,
  loadAccessWithBody,
  loadRelatedContent,
  loadSubscriptionContext,
  loadWithdrawnDetail,
  logAccessCheckFault,
  subscriptionContextFault,
  withoutRawBody,
} from '$lib/server/content-detail';
import { logReadFailure } from '$lib/server/read-failure';
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

  // This page renders auth-aware HTML — the org layout injects `user`, and the
  // CTA switches on isAuthenticated — so the SAME URL yields different markup
  // per auth state. Shared caches (Cloudflare edge, miniflare in CI) key by
  // URL, NOT by Cookie, so any `public` response cached for an anonymous
  // visitor is served to signed-in users too — the "You need to sign in" bug
  // for owners. PRIVATE keeps every auth-varying page out of shared caches. The
  // DB stays shielded: the public content list (incl. this slug lookup) is
  // KV-cached in content-api, so PRIVATE costs an SSR render, not a query.
  // See docs/caching-strategy.md §HTTP/CDN caching. A response carrying a
  // gated body is stored nowhere at all (`detailPageCacheHeaders`).
  const successCacheHeaders = CACHE_HEADERS.PRIVATE;

  // Fetch content via public endpoint with org.id + slug — 1 API call.
  // The old getContentBySlug() made 2 sequential HTTP calls:
  //   1. api.org.getBySlug(orgSlug) — redundant (org already resolved by layout)
  //   2. api.content.list({ organizationId, slug })
  // Now: single public call, no auth needed, CDN-cacheable.
  //
  // No result is a 404. A failed request is not: it propagates as a 500, as
  // the creator detail page's does. A `.catch(() => null)` here used to turn
  // every content-api outage into "Content not found". A slug the public list
  // refuses (too long, or with a NUL, which Postgres refuses in text) names
  // nothing, so it is a 404 before any call: the rule is the API's own.
  if (!publicContentSlugSchema.safeParse(contentSlug).success) {
    error(404, 'Content not found');
  }
  // Through the server API, NOT the `getPublicContent` remote query: SvelteKit
  // serialises every remote query's SSR result into the page for hydration
  // (`__sveltekit_*.data`), so the remote form shipped this row, body and all,
  // whatever the load returned. Measured live: the row's contentBodyJson sat
  // in that cache while the returned `content` had it nulled.
  const api = createServerApi(platform, cookies);
  const contentParams = new URLSearchParams();
  contentParams.set('orgId', org.id);
  contentParams.set('slug', contentSlug);
  contentParams.set('limit', '1');
  const contentResult = await api.content.getPublicContent(contentParams);
  const publicRow = contentResult.items[0];

  // Not on the storefront. For a signed-in reader it may be an item withdrawn
  // from sale that they still have: bought, in their course, or in their
  // subscription until it renews (Codex-ov2ii). Everyone else, with access or
  // not, gets the same 404 as before.
  const withdrawn =
    publicRow || !locals.user
      ? null
      : await loadWithdrawnDetail(
          { orgId: org.id, slug: contentSlug },
          platform,
          cookies
        );
  const content = publicRow ?? withdrawn?.content;
  if (!content) {
    error(404, 'Content not found');
  }

  // What the browser receives: the row without its raw body. The body is
  // rendered below into contentBodyHtml, only once access allows it: from
  // `content` when the piece is public, from the access check's body when it
  // is gated (a gated public row carries none, Codex-039vo).
  const pageContent = withoutRawBody(content);

  // Body gating: only render `contentBodyHtml` once access is confirmed.
  // Free content renders immediately (SEO + first-paint). Everything else
  // (followers / subscribers / paid / team) waits for the authenticated
  // access check below — this is what prevents a non-follower from reading
  // the article text through view-source or the SvelteKit load payload.
  const isPublic = isPublicContent(content);
  const renderContext = {
    contentId: content.id,
    surface: 'content-detail' as const,
  };
  const publicBodyHtml = isPublic
    ? await renderContentBody(content, renderContext)
    : null;
  // Stored text that rendered to nothing is a failure the reader is told
  // about, never "no body" (Codex-uuz1g); the view shows a note.
  const publicBodyUnavailable =
    isPublic && hasStoredText(content) && publicBodyHtml == null;

  // Fetch related content — returned as a bare promise (streamed, below fold)
  const relatedPromise = loadRelatedContent(api, { orgId: org.id });

  // Journey cross-link (Codex-2pryk.3.10, F19/F20): the PUBLISHED course(s) this
  // item belongs to. Streamed — it's below-the-fold context (breadcrumb signpost
  // + "part of a journey" + free upsell), not first-paint-critical. PUBLIC read
  // (no auth), so it runs for visitors and owners alike. The `.catch` keeps an
  // unhandled rejection from crashing the load and logs the failure; the FE
  // omits the cross-link gracefully on null / empty.
  const parentCoursesPromise = api.access
    .contentCourses(content.id)
    .catch((error: unknown) => {
      logReadFailure(
        'Content course links not loaded',
        { contentId: content.id },
        error
      );
      return null;
    });

  // Withdrawn from sale: the access check already ran and granted, so the page
  // renders the body and player that check returned, with the note in place
  // of any offer (there is nothing left to buy or subscribe to).
  if (withdrawn) {
    // Always a gated grant: a public piece never takes this path, and the
    // withdrawn read answered only because access was granted.
    const withdrawnBodyHtml = withdrawn.body
      ? await renderContentBody(withdrawn.body, renderContext)
      : null;
    const withdrawnBodyUnavailable =
      withdrawn.body != null &&
      hasStoredText(withdrawn.body) &&
      withdrawnBodyHtml == null;
    setHeaders(detailPageCacheHeaders(true));
    return {
      content: pageContent,
      contentBodyHtml: withdrawnBodyHtml,
      contentBodyUnavailable: withdrawnBodyUnavailable,
      hasAccess: null,
      streamingUrl: null,
      progress: null,
      accessAndProgress: Promise.resolve(withdrawn.access),
      withdrawnHeld: withdrawn.held,
      subscriptionContext: Promise.resolve(EMPTY_SUB_CONTEXT),
      relatedContent: relatedPromise,
      parentCourses: parentCoursesPromise,
    };
  }

  // Only run the subscription-context fetch when content is tier-gated
  // (includedInTierId set — the WP-1 successor of accessType 'subscribers').
  // Non-gated content (paid / free / followers / team) never consumes the
  // result — skipping saves 2-3 round-trips per page load (Codex-585ie).
  const mayRequireSubscription = content.includedInTierId != null;

  const subscriptionContext = mayRequireSubscription
    ? loadSubscriptionContext(
        org.id,
        content.includedInTierId ?? null,
        platform,
        cookies,
        locals.user != null
      ).catch((error) => subscriptionContextFault(content.id, error))
    : Promise.resolve(EMPTY_SUB_CONTEXT);

  // For unauthenticated visitors — no streaming possible, but body unlocks
  // for public (free) content so visitors can read it. Gated content gets
  // null body (paywall teaser / CTA handles the display).
  if (!locals.user) {
    setHeaders(successCacheHeaders);
    return {
      content: pageContent,
      contentBodyHtml: publicBodyHtml,
      contentBodyUnavailable: publicBodyUnavailable,
      hasAccess: isPublic,
      streamingUrl: null,
      progress: null,
      accessAndProgress: null,
      subscriptionContext,
      relatedContent: relatedPromise,
      parentCourses: parentCoursesPromise,
    };
  }

  // For authenticated users on free content: fast path — body is already
  // rendered, stream the access+progress for the player/streaming URL.
  if (isPublic) {
    setHeaders(successCacheHeaders);
    return {
      content: pageContent,
      contentBodyHtml: publicBodyHtml,
      contentBodyUnavailable: publicBodyUnavailable,
      hasAccess: null,
      streamingUrl: null,
      progress: null,
      // fetchAccess catches a failed request itself, so this sees only a
      // fault in our own code; it fails closed, and logs (Codex-uuz1g).
      accessAndProgress: loadAccessAndProgress(
        content.id,
        platform,
        cookies,
        content
      ).catch((error: unknown) => {
        logAccessCheckFault(content.id, error);
        return { ...ACCESS_CHECK_FAILED_RESULT, hasAccess: isPublic };
      }),
      subscriptionContext,
      relatedContent: relatedPromise,
      parentCourses: parentCoursesPromise,
    };
  }

  // Gated content + authenticated user: await the access check so we can
  // render the body conditionally. No SEO cost — non-followers can't see
  // this content anyway, so there's no win in streaming. The security win
  // (body never lands in the payload for denied users) is worth the ~100ms.
  // The body comes from that check, not from `content`, whose public row
  // carries none for a gated piece (Codex-039vo).
  const { access: accessResult, body } = await loadAccessWithBody(
    content.id,
    platform,
    cookies,
    content
  ).catch((error: unknown) => {
    logAccessCheckFault(content.id, error);
    return { access: ACCESS_CHECK_FAILED_RESULT, body: null };
  });

  const gatedBodyHtml =
    accessResult.hasAccess && body
      ? await renderContentBody(body, renderContext)
      : null;
  const gatedBodyUnavailable =
    accessResult.hasAccess &&
    body != null &&
    hasStoredText(body) &&
    gatedBodyHtml == null;

  setHeaders(detailPageCacheHeaders(accessResult.hasAccess));
  return {
    content: pageContent,
    contentBodyHtml: gatedBodyHtml,
    contentBodyUnavailable: gatedBodyUnavailable,
    hasAccess: null,
    streamingUrl: null,
    progress: null,
    // Keep the promise shape so +page.svelte's reactive $effect still fires.
    accessAndProgress: Promise.resolve(accessResult),
    subscriptionContext,
    relatedContent: relatedPromise,
    parentCourses: parentCoursesPromise,
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
