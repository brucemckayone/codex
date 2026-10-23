/**
 * Creator profile server load
 *
 * Fetches creator's published content via the public content endpoint.
 * Since there is no dedicated "get user by username" API, the page uses the
 * username from the URL and fetches public content scoped by search query.
 * Sets CACHE_HEADERS.PRIVATE (see the call at the end of the load): the
 * (platform) shell around this page renders the signed-in user, and shared
 * caches key on URL and never on Cookie, so a shared window would serve one
 * viewer's chrome to the next. The docstring used to claim DYNAMIC_PUBLIC,
 * which this load has never called.
 */
import { logger } from '$lib/observability';
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

const CONTENT_LIMIT = 12;

export const load: PageServerLoad = async ({
  params,
  locals,
  platform,
  cookies,
  setHeaders,
}) => {
  // Strip leading @ from username (URL convention: /@alex-creator)
  const username = params.username.replace(/^@/, '');
  const api = createServerApi(platform, cookies);

  // Attempt to fetch the creator's profile from identity API.
  // This is a best-effort lookup; if the endpoint doesn't exist or the user
  // isn't found, we gracefully degrade to showing just the username.
  let creatorProfile: {
    id?: string;
    name?: string | null;
    image?: string | null;
    bio?: string | null;
    socialLinks?: {
      website?: string;
      twitter?: string;
      youtube?: string;
      instagram?: string;
    } | null;
  } | null = null;

  // `getPublicProfile` returns null ONLY for a 404 (no such creator) and
  // rethrows anything else, so a genuine identity-api outage no longer renders
  // as an anonymous-looking placeholder profile the way the old blanket
  // `catch` did.
  creatorProfile = await api.account.getPublicProfile(username);

  // The creator's published content (fetched below).
  let contentItems: Array<{
    id: string;
    title: string;
    slug: string;
    description: string | null;
    contentType: string;
    thumbnailUrl?: string | null;
    priceCents?: number | null;
    mediaItem?: {
      thumbnailUrl?: string | null;
      durationSeconds?: number | null;
    } | null;
    creator?: {
      id?: string;
      name?: string | null;
    } | null;
    organization?: {
      id?: string;
      name?: string;
      slug?: string;
      logoUrl?: string | null;
    } | null;
  }> = [];

  // The creator's published content, newest first, across every org they
  // publish in and their personal space: the PUBLIC list scoped by creator.
  // Not `api.content.list`, the studio list, which needs a session and lists
  // the SIGNED-IN user's own content: a visitor got a 401 here, shown as an
  // empty profile, and a signed-in visitor saw their own work on someone
  // else's profile (Codex-osuqt).
  if (creatorProfile?.id) {
    try {
      const params = new URLSearchParams();
      params.set('creatorId', creatorProfile.id);
      params.set('limit', String(CONTENT_LIMIT));
      params.set('sort', 'newest');

      const contentResult = await api.content.getPublicContent(params);
      contentItems = contentResult?.items ?? [];
    } catch (error) {
      // The profile still renders, with the empty state. Logged, because an
      // empty profile is otherwise indistinguishable from a creator with no
      // published work.
      logger.warn('Creator profile content not loaded', {
        creatorId: creatorProfile.id,
        error: error instanceof Error ? error.message : String(error),
      });
      contentItems = [];
    }
  }

  // Extract unique organizations from content items
  const orgMap = new Map<
    string,
    { id: string; name: string; slug: string; logoUrl: string | null }
  >();
  for (const item of contentItems) {
    const org = item.organization;
    if (org?.id && org.slug && org.name) {
      orgMap.set(org.id, {
        id: org.id,
        name: org.name,
        slug: org.slug,
        logoUrl: org.logoUrl ?? null,
      });
    }
  }
  const organizations = [...orgMap.values()];

  // Payload includes `user: locals.user`, so the response varies by auth.
  // Shared caches (Cloudflare edge, miniflare) key by URL, NOT by Cookie, so a
  // `public` response cached for an anonymous visitor is served to signed-in
  // users too — the stale "Sign in" render. PRIVATE keeps auth-varying pages
  // out of shared caches. See docs/caching-strategy.md §HTTP/CDN caching.
  setHeaders(CACHE_HEADERS.PRIVATE);

  return {
    username,
    user: locals.user,
    creatorProfile,
    contentItems,
    organizations,
  };
};
