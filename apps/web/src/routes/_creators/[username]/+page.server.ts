/**
 * Creator profile server load
 *
 * Resolves the creator by username (`getPublicProfile`; no such creator is a
 * 404) and lists their newest published content through the public content
 * list scoped by creatorId (Codex-osuqt).
 * Sets CACHE_HEADERS.PRIVATE (see the call at the end of the load): the
 * (platform) shell around this page renders the signed-in user, and shared
 * caches key on URL and never on Cookie, so a shared window would serve one
 * viewer's chrome to the next. The docstring used to claim DYNAMIC_PUBLIC,
 * which this load has never called.
 */
import { error } from '@sveltejs/kit';
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import { withoutRawBody } from '$lib/server/content-detail';
import { logReadFailure } from '$lib/server/read-failure';
import type { PageServerLoad } from './$types';
import { creatorHandle } from './creator-handle';

const CONTENT_LIMIT = 12;

export const load: PageServerLoad = async ({
  params,
  locals,
  platform,
  cookies,
  setHeaders,
}) => {
  // The handle without its leading @ (URL convention: /@alex-creator).
  const username = creatorHandle(params.username);
  const api = createServerApi(platform, cookies);

  // The creator's public profile from identity-api.
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

  // No such creator is a 404, as on the detail page. It used to render a
  // placeholder profile with HTTP 200: a soft 404 that crawlers index as a
  // real creator page.
  if (!creatorProfile?.id) {
    error(404, 'Creator not found');
  }

  // The creator's published content (fetched below).
  let contentItems: Array<{
    id: string;
    title: string;
    slug: string;
    description: string | null;
    contentType: 'video' | 'audio' | 'written';
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

  // Total published, which the hero shows; contentItems holds only the newest
  // CONTENT_LIMIT of them.
  let contentTotal = 0;
  // A failed read renders an error state, never the "hasn't published" empty
  // state, which would tell a visitor something false.
  let contentError = false;

  // The creator's published content, newest first, across every org they
  // publish in and their personal space: the PUBLIC list scoped by creator.
  // Not `api.content.list`, the studio list, which needs a session and lists
  // the SIGNED-IN user's own content: a visitor got a 401 here, shown as an
  // empty profile, and a signed-in visitor saw their own work on someone
  // else's profile (Codex-osuqt).
  try {
    const params = new URLSearchParams();
    params.set('creatorId', creatorProfile.id);
    params.set('limit', String(CONTENT_LIMIT));
    params.set('sort', 'newest');

    const contentResult = await api.content.getPublicContent(params);
    // Cards draw metadata only; no body reaches this page's HTML.
    contentItems = contentResult.items.map(withoutRawBody);
    contentTotal = contentResult.pagination.total;
  } catch (err) {
    logReadFailure(
      'Creator profile content not loaded',
      { creatorId: creatorProfile.id },
      err
    );
    contentError = true;
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
    contentTotal,
    contentError,
    organizations,
  };
};
