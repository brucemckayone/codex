import { json } from '@sveltejs/kit';
import { ApiError } from '$lib/api/errors';
import { createServerApi } from '$lib/server/api';
import { logReadFailure } from '$lib/server/read-failure';
import { getDisplayThumbnail } from '$lib/utils/thumbnail';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, platform, cookies }) => {
  const q = url.searchParams.get('q')?.slice(0, 200) ?? '';
  const scope = url.searchParams.get('scope'); // org slug or undefined
  const limit = 5;

  if (!q) return json({ content: [], creators: [] });

  const api = createServerApi(platform, cookies);

  // Resolve org slug → orgId so the content-api can scope by organization.
  // The `slug` param in publicContentQuerySchema is a content slug filter,
  // not an org slug — we must pass `orgId` for org-scoped searches.
  //
  // Only a 404 (no such org) falls back to the platform-wide search. Any other
  // failure leaves the visitor's org unknown, and answering an org-scoped
  // search with every org's content would put other orgs' work in this org's
  // palette, so the content search is skipped instead.
  let orgId: string | undefined;
  let orgLookupFailed = false;
  if (scope) {
    try {
      const org = await api.org.getPublicInfo(scope);
      orgId = org?.id;
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) {
        logReadFailure('Search scope org not loaded', { scope }, error);
        orgLookupFailed = true;
      }
    }
  }

  const params = new URLSearchParams({ search: q, limit: String(limit) });

  const searchContent = () => {
    if (orgId) {
      return api.content.getPublicContent(
        new URLSearchParams({ ...Object.fromEntries(params), orgId })
      );
    }
    if (orgLookupFailed) return Promise.resolve(null);
    return api.content.getDiscoverContent(params);
  };

  const [contentRes, creatorsRes] = await Promise.allSettled([
    searchContent(),
    scope
      ? api.org.getPublicCreators(
          scope,
          new URLSearchParams({ search: q, limit: String(limit) })
        )
      : Promise.resolve({
          items: [] as Array<{ name: string; avatarUrl: string | null }>,
        }),
  ]);

  // The palette answers with what did load; these logs are the only trace of
  // what did not.
  if (contentRes.status === 'rejected') {
    logReadFailure('Search content not loaded', { scope }, contentRes.reason);
  }
  if (creatorsRes.status === 'rejected') {
    logReadFailure('Search creators not loaded', { scope }, creatorsRes.reason);
  }

  const content =
    contentRes.status === 'fulfilled'
      ? (contentRes.value?.items ?? []).map((item) => ({
          id: item.id,
          title: item.title,
          slug: item.slug,
          contentType: item.contentType,
          // The creator's custom thumbnail first, then the video poster the
          // worker resolved onto mediaItem (Codex-une9r).
          thumbnailUrl: getDisplayThumbnail(item),
          organizationSlug: item.organization?.slug ?? null,
        }))
      : [];

  const creators =
    creatorsRes.status === 'fulfilled'
      ? (creatorsRes.value?.items ?? []).map((c) => ({
          name: c.name,
          avatarUrl: c.avatarUrl ?? null,
        }))
      : [];

  return json({ content, creators });
};
