import { json } from '@sveltejs/kit';
import { createServerApi } from '$lib/server/api';
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
  let orgId: string | undefined;
  if (scope) {
    try {
      const org = await api.org.getPublicInfo(scope);
      orgId = org?.id;
    } catch {
      // Org not found — fall back to platform-wide search
    }
  }

  const params = new URLSearchParams({ search: q, limit: String(limit) });

  const [contentRes, creatorsRes] = await Promise.allSettled([
    orgId
      ? api.content.getPublicContent(
          new URLSearchParams({ ...Object.fromEntries(params), orgId })
        )
      : api.content.getDiscoverContent(params),
    scope
      ? api.org.getPublicCreators(
          scope,
          new URLSearchParams({ search: q, limit: String(limit) })
        )
      : Promise.resolve({
          items: [] as Array<{ name: string; avatarUrl: string | null }>,
        }),
  ]);

  const content =
    contentRes.status === 'fulfilled'
      ? (contentRes.value?.items ?? []).map((item) => {
          // Prefer the resolved CDN thumbnailUrl from mediaItem (set by resolveR2Urls),
          // then fall back to the content-level custom thumbnailUrl field.
          const mediaItem = item.mediaItem as
            | (typeof item.mediaItem & { thumbnailUrl?: string | null })
            | null;
          return {
            id: item.id,
            title: item.title,
            slug: item.slug,
            contentType: item.contentType,
            thumbnailUrl: mediaItem?.thumbnailUrl ?? item.thumbnailUrl ?? null,
            organizationSlug: item.organization?.slug ?? null,
          };
        })
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
