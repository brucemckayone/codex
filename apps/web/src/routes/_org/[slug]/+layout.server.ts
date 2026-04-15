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
import type { SubscriptionTier } from '$lib/types';
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
        brandColors: {
          primary?: string;
          secondary?: string | null;
          accent?: string | null;
          background?: string | null;
        };
        brandFonts?: { body?: string | null; heading?: string | null };
        brandRadius?: number;
        brandDensity?: number;
        brandFineTune?: {
          tokenOverrides?: string | null;
          darkModeOverrides?: string | null;
          shadowScale?: string | null;
          shadowColor?: string | null;
          textScale?: string | null;
          headingWeight?: string | null;
          bodyWeight?: string | null;
        };
        introVideoUrl?: string | null;
        heroLayout?: string;
        enableSubscriptions?: boolean;
      };

      // Stream version keys for client-side staleness detection (non-blocking).
      // Versions don't affect first paint — only used by $effect after hydration.
      const versions = readOrgVersions(platform, typedOrg.id, locals.user?.id);

      // Stream subscription context for "Included" badges (non-blocking)
      const subscriptionContext = locals.user
        ? loadUserSubscriptionContext(api, typedOrg.id)
        : Promise.resolve({
            userTierSortOrder: null as number | null,
            tiers: [] as SubscriptionTier[],
          });

      // Stream follower status for contextual badge labels (non-blocking)
      const isFollowing = locals.user
        ? api.org
            .isFollowing(typedOrg.id)
            .then((r) => r.following)
            .catch(() => false)
        : Promise.resolve(false);

      return {
        org: typedOrg,
        enableSubscriptions: typedOrg.enableSubscriptions ?? true,
        user: locals.user,
        versions,
        subscriptionContext: subscriptionContext.catch(() => ({
          userTierSortOrder: null as number | null,
          tiers: [] as SubscriptionTier[],
        })),
        isFollowing,
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

      const versions = readOrgVersions(platform, org.id, locals.user?.id);

      // Stream subscription context for "Included" badges (non-blocking)
      const subscriptionContext = locals.user
        ? loadUserSubscriptionContext(api, org.id)
        : Promise.resolve({
            userTierSortOrder: null as number | null,
            tiers: [] as SubscriptionTier[],
          });

      // Stream follower status for contextual badge labels (non-blocking)
      const isFollowing = locals.user
        ? api.org
            .isFollowing(org.id)
            .then((r) => r.following)
            .catch(() => false)
        : Promise.resolve(false);

      return {
        org: {
          id: org.id,
          slug: org.slug,
          name: org.name,
          description: org.description,
          logoUrl: org.logoUrl,
          brandColors: org.brandColors,
          brandFonts: org.brandFonts,
          brandRadius: org.brandRadius,
          brandDensity: org.brandDensity,
          brandFineTune: org.brandFineTune,
          introVideoUrl: org.introVideoUrl ?? null,
        },
        // Auth fallback doesn't include feature flags — default to true
        enableSubscriptions: true,
        user: locals.user,
        versions,
        subscriptionContext: subscriptionContext.catch(() => ({
          userTierSortOrder: null as number | null,
          tiers: [] as SubscriptionTier[],
        })),
        isFollowing,
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
 * Load subscription context for badge display.
 *
 * Fetches the user's current subscription and org tiers in parallel.
 * Returns userTierSortOrder (null if no subscription) and the full tiers list
 * so child pages can compute "Included" badges per content item.
 *
 * Streamed (not awaited) to avoid blocking page load.
 */
async function loadUserSubscriptionContext(
  api: ReturnType<typeof createServerApi>,
  orgId: string
): Promise<{ userTierSortOrder: number | null; tiers: SubscriptionTier[] }> {
  const [currentSubscription, tiers] = await Promise.all([
    api.subscription.getCurrent(orgId).catch(() => null),
    api.tiers.list(orgId).catch(() => [] as SubscriptionTier[]),
  ]);

  const userTierSortOrder = currentSubscription?.tier?.sortOrder ?? null;

  return { userTierSortOrder, tiers };
}

/**
 * Read org-related version keys from KV for client-side staleness detection.
 * Optionally reads user library version when userId is provided (for post-purchase invalidation).
 * Returns {} gracefully when KV is unavailable.
 */
async function readOrgVersions(
  platform: App.Platform | undefined,
  orgId: string,
  userId?: string
): Promise<Record<string, string | null>> {
  const versions: Record<string, string | null> = {};
  if (!platform?.env?.CACHE_KV) return versions;

  try {
    const cache = new VersionedCache({
      kv: platform.env.CACHE_KV as KVNamespace,
    });
    const orgConfigKey = `${CacheType.ORG_CONFIG}:${orgId}`;
    const orgContentKey = CacheType.COLLECTION_ORG_CONTENT(orgId);
    const libraryKey = userId
      ? CacheType.COLLECTION_USER_LIBRARY(userId)
      : null;
    const subscriptionKey = userId
      ? CacheType.COLLECTION_USER_SUBSCRIPTION(userId, orgId)
      : null;

    const keys = [
      orgConfigKey,
      orgContentKey,
      ...(libraryKey ? [libraryKey] : []),
      ...(subscriptionKey ? [subscriptionKey] : []),
    ];
    const results = await Promise.all(keys.map((k) => cache.getVersion(k)));
    for (let i = 0; i < keys.length; i++) {
      versions[keys[i]] = results[i];
    }
  } catch {
    // Graceful degradation — versions stay empty, no staleness detection
  }
  return versions;
}
