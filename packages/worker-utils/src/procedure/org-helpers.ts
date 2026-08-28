/**
 * Organization Helper Functions
 *
 * Utilities for extracting organization context and checking membership.
 * Extracted to separate file to avoid circular dependencies.
 */

import { RESERVED_SUBDOMAINS_SET } from '@codex/constants';
import { createDbClient, schema } from '@codex/database';
import type { ObservabilityClient } from '@codex/observability';
import type { Bindings } from '@codex/shared-types';
import { and, eq } from 'drizzle-orm';
import type { OrganizationMembership } from './helpers';

/** KV key holding the immutable `slug -> organization id` mapping. */
export function orgSlugCacheKey(slug: string): string {
  return `orgslug:${slug}`;
}

/**
 * Drop the cached `slug -> id` entry. Call on slug change (both the old and the
 * new slug) and on organization delete.
 */
export function invalidateOrgSlugCacheEntry(
  kv: import('@cloudflare/workers-types').KVNamespace,
  slug: string
): Promise<void> {
  return kv.delete(orgSlugCacheKey(slug));
}

/**
 * Isolate-local negative cache: subdomains a Neon lookup has just proven are
 * not organizations.
 *
 * DELIBERATELY NOT IN KV. The account KV write allowance on the free plan is
 * 1,000/day, and the tenant wildcard route is open-ended by design (see
 * Codex-kgrdp: `*.orgs.<domain>` was rejected, so no edge allowlist is
 * possible). One `kv.put` per unknown hostname would let a port scan exhaust
 * the entire daily write budget — which is the very failure this epic is
 * about. Isolate memory costs nothing per entry and is not shared, so the
 * worst case is one Neon query per isolate per TTL window rather than one per
 * request.
 *
 * Correctness never depends on this map: a stale or absent entry only changes
 * whether a Neon query happens.
 */
const negativeSlugCache = new Map<string, number>();

/**
 * Short enough that an organization created seconds after someone probed its
 * slug is not shadowed for long, long enough to collapse a scan burst
 * (10 req/s against one hostname drops from 300 Neon queries to 1).
 */
const NEGATIVE_SLUG_TTL_MS = 30_000;

/** FIFO bound so a random-hostname scan cannot grow the isolate heap. */
const NEGATIVE_SLUG_MAX_ENTRIES = 500;

function isKnownMissingSlug(slug: string, now: number): boolean {
  const expiresAt = negativeSlugCache.get(slug);
  if (expiresAt === undefined) {
    return false;
  }
  if (expiresAt <= now) {
    negativeSlugCache.delete(slug);
    return false;
  }
  return true;
}

function rememberMissingSlug(slug: string, now: number): void {
  if (negativeSlugCache.size >= NEGATIVE_SLUG_MAX_ENTRIES) {
    // Map iterates in insertion order — drop the oldest entry.
    const oldest = negativeSlugCache.keys().next();
    if (!oldest.done) {
      negativeSlugCache.delete(oldest.value);
    }
  }
  negativeSlugCache.set(slug, now + NEGATIVE_SLUG_TTL_MS);
}

/** Test seam: reset the isolate-local negative cache between cases. */
export function __resetNegativeSlugCache(): void {
  negativeSlugCache.clear();
}

/**
 * Extract organization ID from subdomain
 *
 * Resolves organization slug from subdomain (e.g., "acme.revelations.studio" -> acme)
 * and looks up the organization ID.
 *
 * Called from `resolveOrganizationId` inside `enforcePolicyInline`, so it runs
 * on EVERY org-scoped procedure() request. `drizzle-orm/neon-http` makes one
 * HTTPS round trip per SQL statement, so an uncached lookup here is one ~81ms
 * Neon trip per request, multiplied by the subrequest fan-out of the page that
 * triggered it (Codex-kgrdp.23).
 *
 * Three tiers, cheapest first:
 *   1. Zero I/O  - infrastructure hostnames rejected from `RESERVED_SUBDOMAINS_SET`.
 *   2. Zero I/O  - isolate-local negative cache for recently-proven misses.
 *   3. One KV read - write-through cache of `slug -> id`, the same shape as
 *      `checkOrganizationMembership` below. Only real organizations are ever
 *      written, so KV writes are bounded by organization count, not traffic.
 *
 * @param hostname - Request hostname (from Host header)
 * @param env - Worker environment with DATABASE_URL
 * @returns Organization ID or null if not found
 */
export async function extractOrganizationFromSubdomain(
  hostname: string,
  env: Bindings,
  obs?: ObservabilityClient
): Promise<string | null> {
  // Parse subdomain from hostname
  // Examples:
  //   "acme.revelations.studio" -> "acme"
  //   "localhost:3000" -> null (local development)
  //   "content-api.revelations.studio" -> null (not an org subdomain)

  const parts = hostname.split('.');

  // Local development or IP address - no organization context
  if (hostname.includes('localhost') || hostname.includes('127.0.0.1')) {
    return null;
  }

  // Need at least subdomain.domain.tld (3 parts)
  if (parts.length < 3) {
    return null;
  }

  // Hostnames are case-insensitive; slugs are lowercase by
  // `createSlugSchema` (packages/validation/src/primitives.ts:67), so
  // normalise once and use the same value for the deny-list, the cache key
  // and the query.
  const subdomain = parts[0]?.toLowerCase();
  if (!subdomain) {
    return null;
  }

  // Infrastructure subdomains are not organizations. Single source of truth:
  // `@codex/constants` RESERVED_SUBDOMAINS_SET, generated from the files that
  // actually provision each hostname and pinned by
  // packages/constants/src/__tests__/reserved-subdomains.test.ts.
  //
  // Safe as a hard reject: `organizationSlugSchema`
  // (packages/validation/src/content/content-schemas.ts:48) refines against
  // this same set on create AND update, so no organization can hold a
  // reserved slug. This is the third copy of this list found drifting in
  // Codex-kgrdp — it must never be hand-maintained again.
  if (RESERVED_SUBDOMAINS_SET.has(subdomain)) {
    return null;
  }

  const now = Date.now();
  if (isKnownMissingSlug(subdomain, now)) {
    return null;
  }

  const kv = env.CACHE_KV as
    | import('@cloudflare/workers-types').KVNamespace
    | undefined;
  const cacheKey = orgSlugCacheKey(subdomain);

  if (kv) {
    try {
      const cached = await kv.get(cacheKey, 'text');
      if (cached) {
        return cached;
      }
    } catch {
      // KV read failed - fall through to DB
    }
  }

  // Query database for organization by slug
  try {
    const db = createDbClient(env);
    const org = await db.query.organizations.findFirst({
      where: eq(schema.organizations.slug, subdomain),
      columns: {
        id: true,
      },
    });

    if (!org?.id) {
      rememberMissingSlug(subdomain, now);
      return null;
    }

    if (kv) {
      // Write-through, fire-and-forget. No TTL: slug -> id changes only when
      // the slug itself changes, and that path deletes the key explicitly.
      kv.put(cacheKey, org.id).catch(() => {});
    }

    return org.id;
  } catch (error) {
    obs?.error('Error looking up organization from subdomain', {
      hostname,
      subdomain,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Build the KV key for a membership cache entry.
 * Exported so mutation handlers can write-through or delete.
 */
export function membershipCacheKey(
  organizationId: string,
  userId: string
): string {
  return `membership:${organizationId}:${userId}`;
}

/**
 * Check if user is a member of an organization
 *
 * Write-through KV cache: mutation handlers write fresh data on
 * invite/role-change and delete on removal, so entries never go stale.
 * No TTL — data persists until explicitly updated or deleted.
 *
 * ~46 routes across 5 workers use requireOrgMembership, so caching
 * here eliminates ~200ms per request (1 KV read vs 1 Neon query).
 *
 * @param organizationId - Organization UUID
 * @param userId - User ID
 * @param env - Worker environment
 * @param obs - Optional observability client for structured logging
 * @returns Membership object or null if not a member
 */
export async function checkOrganizationMembership(
  organizationId: string,
  userId: string,
  env: Bindings,
  obs?: ObservabilityClient
): Promise<OrganizationMembership | null> {
  const kv = env.CACHE_KV as
    | import('@cloudflare/workers-types').KVNamespace
    | undefined;

  if (kv) {
    try {
      const key = membershipCacheKey(organizationId, userId);
      const cached = await kv.get(key, 'json');

      if (cached !== null) {
        // Rehydrate Date from ISO string
        const data = cached as {
          role: string;
          status: string;
          joinedAt: string;
        };
        return {
          role: data.role,
          status: data.status,
          joinedAt: new Date(data.joinedAt),
        };
      }
    } catch {
      // KV read failed — fall through to DB
    }
  }

  // KV miss or no KV — fetch from DB and write-through
  const membership = await fetchMembershipFromDB(
    organizationId,
    userId,
    env,
    obs
  );

  if (kv && membership) {
    // Write-through: warm the cache for next read (fire-and-forget)
    const key = membershipCacheKey(organizationId, userId);
    kv.put(
      key,
      JSON.stringify({
        role: membership.role,
        status: membership.status,
        joinedAt: membership.joinedAt.toISOString(),
      })
    ).catch(() => {});
  }

  return membership;
}

/**
 * Fetch membership from database (extracted for cache-aside fetcher)
 */
async function fetchMembershipFromDB(
  organizationId: string,
  userId: string,
  env: Bindings,
  obs?: ObservabilityClient
): Promise<OrganizationMembership | null> {
  try {
    const db = createDbClient(env);
    const membership = await db.query.organizationMemberships.findFirst({
      where: and(
        eq(schema.organizationMemberships.organizationId, organizationId),
        eq(schema.organizationMemberships.userId, userId),
        eq(schema.organizationMemberships.status, 'active')
      ),
      columns: {
        role: true,
        status: true,
        createdAt: true,
      },
    });

    if (!membership) {
      return null;
    }

    return {
      role: membership.role,
      status: membership.status,
      joinedAt: membership.createdAt,
    };
  } catch (error) {
    obs?.error('Error checking organization membership', {
      organizationId,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
