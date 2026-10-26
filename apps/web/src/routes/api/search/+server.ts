import { createSlugSchema } from '@codex/validation';
import { json } from '@sveltejs/kit';
import { ApiError } from '$lib/api/errors';
import { createServerApi } from '$lib/server/api';
import { logReadFailure } from '$lib/server/read-failure';
import { getDisplayThumbnail } from '$lib/utils/thumbnail';
import type { RequestHandler } from './$types';

type ServerApi = ReturnType<typeof createServerApi>;

/**
 * What a search is scoped to.
 *
 * - `org`: the org the slug names. Both searches run, scoped to it.
 * - `platform`: no scope, or a slug no org has, so the content search widens
 *   to every org's public catalogue (as a search with no scope does) and there
 *   are no creators to search.
 * - `unknown`: the org lookup failed, so the org's id is not known.
 *   Answering with every org's content would put other orgs' work in this
 *   org's palette, so content is not searched. Creators are still fetched:
 *   the org worker scopes them by the slug itself, so they can only be this
 *   org's.
 */
type SearchScope =
  | { kind: 'org'; orgId: string; slug: string }
  | { kind: 'platform' }
  | { kind: 'unknown'; slug: string };

// The org routes' own slug rule. A slug that fails it names no org, and
// sending it would come back a 400, which the read logs at error level as OUR
// contract bug: any visitor could raise those at will with a URL.
const scopeSlugSchema = createSlugSchema(255);

function parseScopeSlug(raw: string | null): string | null {
  if (!raw) return null;
  const parsed = scopeSlugSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// A 404 from either org read means the slug names no org: the documented
// widening, never a failure worth a log.
function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

async function resolveScope(
  api: ServerApi,
  slug: string | null
): Promise<SearchScope> {
  if (!slug) return { kind: 'platform' };
  try {
    const org = await api.org.getPublicInfo(slug);
    if (org?.id) return { kind: 'org', orgId: org.id, slug };
    logReadFailure(
      'Search scope org not loaded',
      { scope: slug },
      new Error('The org lookup answered without an id')
    );
    return { kind: 'unknown', slug };
  } catch (error) {
    if (isNotFound(error)) return { kind: 'platform' };
    logReadFailure('Search scope org not loaded', { scope: slug }, error);
    return { kind: 'unknown', slug };
  }
}

// The `slug` param in publicContentQuerySchema is a content slug filter, not
// an org slug, so an org-scoped search passes the resolved `orgId`.
function searchContent(
  api: ServerApi,
  scope: SearchScope,
  params: URLSearchParams
) {
  if (scope.kind === 'org') {
    return api.content.getPublicContent(
      new URLSearchParams({ ...Object.fromEntries(params), orgId: scope.orgId })
    );
  }
  if (scope.kind === 'platform') return api.content.getDiscoverContent(params);
  return Promise.resolve(null);
}

// Creators belong to an org: a slug no org has has none, and asking would
// only 404. A slug whose lookup failed may still have them. The worker
// matches `search` against each creator's name and username (Codex-pd8m1).
function searchCreators(
  api: ServerApi,
  scope: SearchScope,
  params: URLSearchParams
) {
  if (scope.kind === 'platform') return Promise.resolve(null);
  return api.org.getPublicCreators(scope.slug, params);
}

export const GET: RequestHandler = async ({ url, platform, cookies }) => {
  const q = url.searchParams.get('q')?.slice(0, 200) ?? '';
  const scopeSlug = parseScopeSlug(url.searchParams.get('scope'));
  const limit = 5;

  if (!q) return json({ content: [], creators: [] });

  const api = createServerApi(platform, cookies);
  const scope = await resolveScope(api, scopeSlug);
  const params = new URLSearchParams({ search: q, limit: String(limit) });

  const [contentRes, creatorsRes] = await Promise.allSettled([
    searchContent(api, scope, params),
    searchCreators(api, scope, params),
  ]);

  // The palette answers with what did load; these logs are the only trace of
  // what did not.
  if (contentRes.status === 'rejected') {
    logReadFailure(
      'Search content not loaded',
      { scope: scopeSlug },
      contentRes.reason
    );
  }
  // A creators 404 after a failed lookup is the same "no such org".
  if (creatorsRes.status === 'rejected' && !isNotFound(creatorsRes.reason)) {
    logReadFailure(
      'Search creators not loaded',
      { scope: scopeSlug },
      creatorsRes.reason
    );
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
          // The palette links to the profile by it (Codex-ynktj).
          username: c.username ?? null,
          avatarUrl: c.avatarUrl ?? null,
        }))
      : [];

  return json({ content, creators });
};
