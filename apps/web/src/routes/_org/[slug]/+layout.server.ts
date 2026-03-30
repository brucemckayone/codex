/**
 * Organization layout server load
 * Resolves org from slug and injects branding.
 *
 * Calls the public org info endpoint directly (no auth required) so
 * org pages work across subdomains where session cookies don't propagate.
 * Falls back to the authenticated remote function.
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import { CacheType, VersionedCache } from '@codex/cache';
import { error } from '@sveltejs/kit';
import { logger } from '$lib/observability';
import { createServerApi } from '$lib/server/api';
import { ApiError } from '$lib/server/errors';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({
  params,
  locals,
  platform,
  cookies,
  depends,
}) => {
  // Enable invalidate('cache:org-versions') on the client.
  // Separate from platform 'cache:versions' to prevent cross-subdomain invalidation.
  depends('cache:org-versions');
  const layoutTimer = logger.startTimer('org-layout', { threshold: 3000 });
  const { slug } = params;
  const api = createServerApi(platform, cookies);

  // Try public endpoint first (works across subdomains without cookies)
  try {
    const publicTimer = logger.startTimer('org-layout:public-info', {
      threshold: 1000,
    });
    const org = await api.org.getPublicInfo(slug);
    publicTimer.end({ slug });

    if (org && typeof org === 'object' && 'id' in org) {
      layoutTimer.end({ slug, path: 'public' });
      const typedOrg = org as {
        id: string;
        slug: string;
        name: string;
        description: string | null;
        logoUrl: string | null;
        brandColors: { primary?: string; secondary?: string; accent?: string };
      };

      // Read version keys for staleness detection on the client
      const versions = await readOrgVersions(platform, typedOrg.id);

      return {
        org: typedOrg,
        user: locals.user,
        versions,
      };
    }
  } catch (err) {
    // Public endpoint failed — try authenticated fallback
    logger.warn('Org layout public endpoint failed, trying auth fallback', {
      slug,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Fall back to authenticated endpoint (direct API, no query() wrapper)
  try {
    const authTimer = logger.startTimer('org-layout:auth-fallback', {
      threshold: 2000,
    });
    const org = await api.org.getBySlug(slug);
    authTimer.end({ slug });

    if (org) {
      layoutTimer.end({ slug, path: 'auth-fallback' });

      const versions = await readOrgVersions(platform, org.id);

      return {
        org: {
          id: org.id,
          slug: org.slug,
          name: org.name,
          description: org.description,
          logoUrl: org.logoUrl,
          brandColors: org.brandColors,
        },
        user: locals.user,
        versions,
      };
    }
  } catch (err) {
    // Both endpoints failed — distinguish 404 from other errors
    const status = err instanceof ApiError ? err.status : 500;
    logger.error('Org layout: both endpoints failed', {
      slug,
      status,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  error(404, `Organization "${slug}" not found`);
};

/**
 * Read org-related version keys from KV for client-side staleness detection.
 * Returns {} gracefully when KV is unavailable.
 */
async function readOrgVersions(
  platform: App.Platform | undefined,
  orgId: string
): Promise<Record<string, string | null>> {
  const versions: Record<string, string | null> = {};
  if (!platform?.env?.CACHE_KV) return versions;

  try {
    const cache = new VersionedCache({
      kv: platform.env.CACHE_KV as KVNamespace,
    });
    // Org config version — bumped by org-api on settings/branding update
    versions[CacheType.ORG_CONFIG + ':' + orgId] = await cache.getVersion(
      CacheType.ORG_CONFIG + ':' + orgId
    );
    // Org content version — bumped by content-api on publish/unpublish/delete
    versions[CacheType.COLLECTION_ORG_CONTENT(orgId)] = await cache.getVersion(
      CacheType.COLLECTION_ORG_CONTENT(orgId)
    );
  } catch {
    // Graceful degradation — versions stay empty, no staleness detection
  }
  return versions;
}
