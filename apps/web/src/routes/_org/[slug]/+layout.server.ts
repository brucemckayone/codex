/**
 * Organization layout server load
 * Resolves org from slug and injects branding.
 *
 * Calls the public org info endpoint directly (no auth required) so
 * org pages work across subdomains where session cookies don't propagate.
 * Falls back to the authenticated endpoint ONLY when that call failed — never
 * when it definitively answered "no such org" (see resolveOrgOrThrow).
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import { CacheType, VersionedCache } from '@codex/cache';
import { error } from '@sveltejs/kit';
import { logger } from '$lib/observability';
import { createServerApi } from '$lib/server/api';
import { ApiError } from '$lib/server/errors';
import type { SubscriptionTier } from '$lib/types';
import type { LayoutServerLoad } from './$types';

/**
 * Isolate-local negative cache for slugs that definitively do not resolve.
 *
 * The wildcard subdomain route is open-ended by design — ANY host reaches this
 * load — so an unknown slug is not an edge case. Under a subdomain scan it is
 * the majority of traffic: 6,937 Neon `/sql` calls in 24h against 239 real
 * visits (Codex-kgrdp.20). Every probe used to walk the whole chain — public
 * info → organization-api → Neon → 404, then the auth fallback → Neon → 404
 * again — and log at `error` on the way out.
 *
 * WHY MEMORY AND NOT KV. A KV-backed negative cache costs a WRITE per novel
 * slug, and KV's free tier allows 1,000 writes/day billed ACCOUNT-wide. A
 * scanner feeding random slugs would convert a read/DB problem into a
 * write-quota outage that also takes down the session cache and the rate
 * limiter — i.e. it would hand the attacker a cheaper weapon than the one
 * we're disarming. It would also be un-invalidatable: nothing in the
 * org-create path knows to clear a negative marker, so a slug probed a moment
 * before its org was created would keep 404-ing until the marker expired.
 * Module scope costs zero KV operations, zero subrequests and zero DB queries,
 * and a short TTL self-heals.
 *
 * WHAT IT BUYS, HONESTLY. An isolate is not shared across colos, so this
 * absorbs a burst rather than deduplicating globally. That matches the traffic
 * being defended against: a scan lands repeatedly on a small number of
 * isolates, and each pays exactly one probe per slug per TTL window before
 * going free. The first probe per isolate still costs the honest price of
 * answering correctly.
 */
const MISSING_SLUG_TTL_MS = 60_000;

/**
 * Hard bound on entries — random-slug scanning would otherwise grow the map
 * without limit inside a long-lived isolate. A negative cache is entirely
 * expendable, so eviction is deliberately crude: prune what has expired, then
 * drop the oldest insertions.
 */
const MISSING_SLUG_MAX_ENTRIES = 256;

/** slug → epoch ms at which its negative entry expires. */
const missingSlugExpiry = new Map<string, number>();

/**
 * Absorbed-probe counter, rolled up rather than logged per request.
 *
 * The old code emitted one `error`-level record per unknown slug, which is why
 * this route is the top source of production errors — a scan does not merely
 * cost subrequests, it costs log volume. One record per
 * {@link MISSING_SLUG_ROLLUP_EVERY} absorbed probes still tells an operator a
 * scan is in progress and being served for free, without reintroducing
 * per-request spam.
 */
const MISSING_SLUG_ROLLUP_EVERY = 100;
let missingSlugHits = 0;

function isKnownMissingSlug(slug: string): boolean {
  const expiresAt = missingSlugExpiry.get(slug);
  if (expiresAt === undefined) return false;
  if (expiresAt > Date.now()) return true;
  missingSlugExpiry.delete(slug);
  return false;
}

function rememberMissingSlug(slug: string): void {
  const now = Date.now();
  if (missingSlugExpiry.size >= MISSING_SLUG_MAX_ENTRIES) {
    for (const [key, expiresAt] of missingSlugExpiry) {
      if (expiresAt <= now) missingSlugExpiry.delete(key);
    }
    // Map iterates in insertion order, so the first key is the oldest.
    while (missingSlugExpiry.size >= MISSING_SLUG_MAX_ENTRIES) {
      const oldest = missingSlugExpiry.keys().next().value;
      if (oldest === undefined) break;
      missingSlugExpiry.delete(oldest);
    }
  }
  missingSlugExpiry.set(slug, now + MISSING_SLUG_TTL_MS);
}

/**
 * Test seam — clears the negative cache between cases.
 *
 * The `_` prefix is not decoration: SvelteKit's `validate_layout_server_exports`
 * rejects any export from a `+layout.server.ts` that isn't `load` / `prerender`
 * / `ssr` / `csr` / `trailingSlash` / `config`, and skips keys beginning with
 * `_`. That is the sanctioned escape hatch for a non-route export.
 */
export function _resetMissingOrgSlugCache(): void {
  missingSlugExpiry.clear();
  missingSlugHits = 0;
}

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
  const { slug } = params;

  // Cheapest possible answer first: a slug this isolate already resolved as a
  // definitive 404 never reaches the network again inside the TTL window.
  if (isKnownMissingSlug(slug)) {
    missingSlugHits++;
    if (missingSlugHits % MISSING_SLUG_ROLLUP_EVERY === 0) {
      logger.warn('Org layout: absorbing unknown-slug probes', {
        absorbedProbes: missingSlugHits,
        distinctSlugs: missingSlugExpiry.size,
      });
    }
    error(404, `Organization "${slug}" not found`);
  }

  const layoutTimer = logger.startTimer('org-layout', { threshold: 3000 });
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

      // Stream version keys for client-side staleness detection (non-blocking).
      // Versions don't affect first paint — only used by $effect after hydration.
      const versions = readOrgVersions(platform, org.id, locals.user?.id);

      // Fetch tiers for "Included" badges (public, KV-cached ~10ms).
      // User subscription data is loaded client-side via subscriptionCollection.
      const tiers = loadOrgTiers(api, org.id);

      return {
        org,
        enableSubscriptions: org.enableSubscriptions ?? true,
        user: locals.user,
        versions,
        subscriptionContext: tiers
          .then((t) => ({ tiers: t }))
          .catch(() => ({ tiers: [] as SubscriptionTier[] })),
      };
    }
  } catch (err) {
    /*
      Separate "there is no such org" from "the call did not complete".

      Both endpoints resolve the slug through the SAME auth-independent query —
      `OrganizationService.getBySlug`, a single `slug = ? AND deleted_at IS
      NULL` lookup with no membership, visibility or role predicate (see
      packages/organization/src/services/organization-service.ts). So a 404
      from the public endpoint is not "you may not see this org", it is "the row
      does not exist", and the authenticated endpoint is guaranteed to return
      the same 404 one Neon query later. Running it doubled the cost of every
      miss and bought nothing.

      The fallback is preserved for the case it was actually written for: the
      public endpoint FAILING. `/public/:slug/info` does strictly more work than
      `/slug/:slug` — branding + feature settings + a KV round trip — so it can
      500, time out (ApiError 408 from the 10s abort in $lib/server/api), or hit
      the API rate limit while the leaner authenticated route still answers.
      Every non-404 status, and every non-ApiError throw (a network failure
      carries no status), still falls through to it. So an org that legitimately
      needs the authenticated path — a signed-in visitor whose public read broke
      — is unaffected; only the provably-pointless retry is gone.

      The status alone is not enough: a 404 must ALSO carry the worker's
      `NOT_FOUND` error code. A 404 with no parseable envelope is a ROUTE that
      isn't there — a deploy skew where `/public/:slug/info` is missing but
      `/slug/:slug` is not, or an edge 404 that never reached the worker (Hono's
      default 404 is plain text, so `code` comes back undefined). Treating that
      as "the org does not exist" would 404 every real org for the TTL. The
      ambiguous case therefore falls through to the fallback, which is the
      fail-safe direction: at worst we pay the old double cost.
    */
    const status = err instanceof ApiError ? err.status : undefined;
    const code = err instanceof ApiError ? err.code : undefined;

    if (status === 404 && code === 'NOT_FOUND') {
      rememberMissingSlug(slug);
      layoutTimer.end({ slug, path: 'not-found' });
      // `info`, not `error`: a request for a subdomain nobody owns is a normal
      // outcome of an open-ended wildcard route, not a platform fault.
      logger.info('Org layout: slug does not resolve to an organization', {
        slug,
      });
      error(404, `Organization "${slug}" not found`);
    }

    // Public endpoint failed — try authenticated fallback
    logger.warn('Org layout public endpoint failed, trying auth fallback', {
      slug,
      status,
      code,
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

      // Fetch tiers for "Included" badges (public, KV-cached ~10ms).
      // User subscription data is loaded client-side via subscriptionCollection.
      const tiers = loadOrgTiers(api, org.id);

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
          // Auth fallback doesn't carry branding/feature flags — fall back to
          // the same defaults the public endpoint uses so consumers reading
          // `data.org.heroLayout` / `data.org.enableSubscriptions` don't see
          // `undefined` and silently render the wrong layout/UI.
          heroLayout: 'default' as const,
          enableSubscriptions: true,
        },
        // Auth fallback doesn't include feature flags — default to true
        enableSubscriptions: true,
        user: locals.user,
        versions,
        subscriptionContext: tiers
          .then((t) => ({ tiers: t }))
          .catch(() => ({ tiers: [] as SubscriptionTier[] })),
      };
    }
  } catch (err) {
    // Both endpoints failed — distinguish 404 from other errors
    const status = err instanceof ApiError ? err.status : 500;
    const code = err instanceof ApiError ? err.code : undefined;
    // A definitive not-found here is definitive for the same reason as above
    // (same resolver), so it is worth remembering even though this path is
    // narrow: it needs an authenticated caller, since an anonymous one gets a
    // 401 from `/slug/:slug`.
    if (status === 404 && code === 'NOT_FOUND') rememberMissingSlug(slug);
    logger.error('Org layout: both endpoints failed', {
      slug,
      status,
      code,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  error(404, `Organization "${slug}" not found`);
};

/**
 * Load org tiers for badge display.
 *
 * Tiers are public and KV-cached (~10ms). User subscription data
 * is now loaded client-side via subscriptionCollection (localStorage-backed),
 * removing the ~567ms server-side subscription.getCurrent() call.
 */
async function loadOrgTiers(
  api: ReturnType<typeof createServerApi>,
  orgId: string
): Promise<SubscriptionTier[]> {
  return api.tiers.list(orgId).catch(() => [] as SubscriptionTier[]);
}

/**
 * Read org-related version keys from KV for client-side staleness detection.
 * Optionally reads user library + subscription versions when userId is provided
 * (for post-purchase / cross-device invalidation).
 * Returns {} gracefully when KV is unavailable.
 *
 * Codex-kgrdp.6 — this used to read a fourth key, `org:config:{orgId}`, and
 * that read was dead on arrival: NOTHING on the platform ever calls
 * `cache.invalidate('org:config:{orgId}')`. The org worker caches public info
 * keyed by SLUG (`cache.get(slug, CacheType.ORG_CONFIG, …)` in
 * workers/organization-api/src/routes/organizations.ts), so the version key it
 * bumps is `cache:version:{slug}`, never `cache:version:org:config:{orgId}`.
 * `getVersion` therefore returned null on every request forever;
 * `getStaleKeys` drops null versions, `updateStoredVersions` skips them, and
 * `resolveStaleCacheTargets` maps that key to no client collection at all (it
 * is explicitly whitelisted out of the unmapped-key warning). Dropping it
 * removes 1 of 4 billed KV reads for a signed-in visitor and 1 of 2 for an
 * anonymous one, with provably no behaviour change.
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
    const orgContentKey = CacheType.COLLECTION_ORG_CONTENT(orgId);
    const libraryKey = userId
      ? CacheType.COLLECTION_USER_LIBRARY(userId)
      : null;
    const subscriptionKey = userId
      ? CacheType.COLLECTION_USER_SUBSCRIPTION(userId, orgId)
      : null;

    const keys = [
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
