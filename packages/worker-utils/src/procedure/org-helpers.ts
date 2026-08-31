/**
 * Organization Helper Functions
 *
 * Utilities for extracting organization context and checking membership.
 * Extracted to separate file to avoid circular dependencies.
 */

import type { WaitUntilFn } from '@codex/cache';
import { RESERVED_SUBDOMAINS_SET } from '@codex/constants';
import { createDbClient, schema } from '@codex/database';
import type { ObservabilityClient } from '@codex/observability';
import type { Bindings } from '@codex/shared-types';
import { and, eq } from 'drizzle-orm';
import type { OrganizationMembership } from './helpers';

/**
 * How both write-through caches in this file hand their `kv.put` to the
 * runtime.
 *
 * THE DEFECT THIS PARAMETER FIXES. Both caches used to fire
 * `kv.put(...).catch(() => {})` and the word `waitUntil` did not appear in this
 * file. A Worker cancels every unawaited promise as soon as the response is
 * returned, and these two writes are the last thing each lookup does — so the
 * write was routinely cancelled before KV saw it, the next request missed
 * again, and a cache whose whole purpose was to remove a ~81ms Neon round trip
 * per org-scoped request removed none of them.
 *
 * REQUIRED, NOT OPTIONAL — and the previous version of this comment is why. It
 * argued the parameter should be "optional and guarded rather than required,
 * mirroring `packages/purchase/src/services/fee-config-service.ts`", because
 * two route handlers call these functions directly and passed nothing. What
 * that actually bought was a silent opt-out of the fix: at
 * `workers/identity-api/src/routes/membership.ts` and
 * `workers/content-api/src/routes/categories.ts` the argument was simply
 * absent, `cacheWrite?.(write)` was a no-op, and those two call sites kept the
 * cancelled-write behaviour the change was made to remove. Nothing reported
 * it — not the typecheck (the parameter was optional), and not the contract
 * gate, whose floating-write rule accepts the `cacheWrite?.(write)` call-form
 * as a hand-off and so read 0 violations across 1,242 files while the value at
 * those two sites was `undefined` at runtime.
 *
 * A required parameter turns each of those into a compile error, which is the
 * only mechanism here that a future caller cannot forget. Both of those call
 * sites sit inside `procedure()` handlers and therefore already have a working
 * sink in `ctx.cacheWrite`, so there is no legitimate no-context caller to
 * accommodate — the "genuine non-request context" this would need is not one of
 * them.
 *
 * SINK CONTRACT: the function MUST NOT THROW. `helpers.ts`'s `cacheWriteFor`
 * and `ProcedureContext.cacheWrite` both satisfy that (the first catches the
 * missing-`executionCtx` case, the second is only built where a real request
 * exists), and the promise handed over already carries its own `.catch()`. A
 * cache write must never be the thing that turns an authorization lookup into a
 * 500, so pass `ctx.cacheWrite` rather than a bare `executionCtx.waitUntil`.
 *
 * `WaitUntilFn` is imported rather than redeclared: it is canonically declared
 * in `@codex/cache`, and this is the same job its
 * `helpers/invalidate.ts` does for KV invalidation.
 */
export type CacheWrite = WaitUntilFn;

/**
 * Ceiling on the `slug -> organization id` entry (24h).
 *
 * A BACKSTOP, NOT THE INVALIDATION MECHANISM — see the write site below for the
 * delete path that does the real work, and for why this mapping being wrong is
 * a cross-tenant scoping problem rather than a staleness one.
 */
const ORG_SLUG_CACHE_TTL_SECONDS = 86_400;

/**
 * Ceiling on a cached membership row (60s) — the KV minimum, and the maximum
 * time a revoked membership can still be honoured. See
 * `checkOrganizationMembership` for why this is a security bound and what it
 * costs in KV writes.
 */
const MEMBERSHIP_CACHE_TTL_SECONDS = 60;

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
 *      written, so KV writes stay bounded by organization count (per TTL
 *      window), not by traffic.
 *
 * @param hostname - Request hostname (from Host header)
 * @param env - Worker environment with DATABASE_URL
 * @param obs - Observability client for structured logging, or `undefined`.
 *   Explicitly positional rather than optional because `cacheWrite` after it is
 *   required.
 * @param cacheWrite - REQUIRED sink for the tier-3 write-through, so it
 *   survives the response. Pass `ctx.cacheWrite` inside a `procedure()`
 *   handler; see `CacheWrite` for why this is not optional.
 * @returns Organization ID or null if not found
 */
export async function extractOrganizationFromSubdomain(
  hostname: string,
  env: Bindings,
  obs: ObservabilityClient | undefined,
  cacheWrite: CacheWrite
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
      // Write-through, fire-and-forget, with a 24h ceiling.
      //
      // UNLIKE THE MEMBERSHIP CACHE BELOW, THIS KEY REALLY IS INVALIDATED, and
      // on the same key this reader reads: `invalidateOrgSlugCacheEntry` does
      // `kv.delete(orgslug:{slug})`, and
      // `workers/organization-api/src/routes/organizations.ts` calls it on
      // rename (for the new AND the old slug) and on delete. That was read off
      // the code, not assumed — it is precisely the difference between the two
      // caches in this file, and the reason only one of them was a live defect.
      //
      // The TTL is here anyway because both of those calls are a single
      // fire-and-forget `waitUntil(Promise.all(...).catch(() => {}))`: a KV
      // error, or an eviction before the task runs, leaves the entry in place
      // with nothing left to remove it. And this mapping is not merely stale
      // data — it decides WHICH ORGANIZATION a hostname resolves to, so a slug
      // freed by a rename and later claimed by another organization would
      // resolve to the first one's id and every membership check downstream
      // would run against the wrong tenant. The delete makes that prompt; the
      // TTL makes it terminal.
      //
      // Cost stays bounded by organization count rather than traffic: one extra
      // write per organization per day, because a miss only ever writes for a
      // real organization (unknown labels are absorbed by the isolate-local
      // negative cache above, deliberately never by KV).
      //
      // Handed to `cacheWrite` so returning the response does not cancel it.
      // Without that the entry was never written and every request paid the
      // Neon trip above — see `CacheWrite`.
      const write = kv
        .put(cacheKey, org.id, {
          expirationTtl: ORG_SLUG_CACHE_TTL_SECONDS,
        })
        .catch(() => {});
      cacheWrite(write);
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
 *
 * Exported so a mutation handler can DELETE it, and `members.ts` now does exactly
 * that. It used to pass this string to `VersionedCache.invalidate()`, which writes
 * `cache:version:` + this key — a DIFFERENT key that `checkOrganizationMembership`
 * never reads — so for three months nothing dislodged a stale entry (Codex-rxjwp).
 *
 * ANYTHING CALLING THIS TO INVALIDATE MUST `kv.delete` THE KEY IT RETURNS, and must
 * call this builder rather than hand-writing the format: two independent definitions
 * of the key is precisely how the reader and the invalidator drifted apart.
 */
export function membershipCacheKey(
  organizationId: string,
  userId: string
): string {
  return `membership:${organizationId}:${userId}`;
}

/**
 * Check if user is a member of an organization — the read behind every
 * `requireOrgMembership` / `requireOrgManagement` route.
 *
 * WHAT THIS CACHE ACTUALLY IS: KV cache-aside on the RAW key
 * `membership:{orgId}:{userId}` (`membershipCacheKey`), read below with a plain
 * `kv.get(key, 'json')` that consults no version key, and written with a
 * 60-second `expirationTtl`.
 *
 * EVERY CLAUSE OF WHAT THIS COMMENT USED TO PROMISE WAS FALSE. It said:
 * "mutation handlers write fresh data on invite/role-change and delete on
 * removal, so entries never go stale. No TTL — data persists until explicitly
 * updated or deleted."
 *   - NO MUTATION HANDLER TOUCHES THIS KEY. Commit c1c3d6c1 did build it that
 *     way (`writeMembershipCache` / `deleteMembershipCache`); 2d1c065a
 *     ("denoise round-3: cache-fanout helpers") replaced both with
 *     `VersionedCache.invalidate()`, which `kv.put`s
 *     `cache:version:membership:{orgId}:{userId}` — A KEY THIS READER NEVER
 *     LOOKS AT (`workers/organization-api/src/routes/members.ts`). Nothing
 *     deletes the data key.
 *   - So "entries never go stale" was exactly inverted: entries could never
 *     stop being stale.
 *   - And "no TTL" was not a neutral remark about persistence. This entry
 *     carries the ROLE that every org gate reads, so an unbounded entry with no
 *     invalidation path means a member removed from an organization keeps their
 *     cached `owner`/`admin` role indefinitely.
 *
 * The bug was masked for two commits because the write was usually cancelled at
 * response return (see `CacheWrite`), so most entries were never stored and the
 * next request went to Neon. Making the write reliable turns a dead cache into
 * a live one, which is why the bound lands in the same change rather than after
 * it.
 *
 * THE TTL IS A SECURITY BOUND, NOT A FRESHNESS PREFERENCE. 60s is the ceiling
 * on how long a revoked membership can still be honoured, and it holds whether
 * or not any invalidation runs. Invalidation makes revocation prompt; the TTL
 * makes it CERTAIN. Do not raise it because a hit rate reads better at 300s —
 * that trades a 5x longer window of unauthorized access for a saved Neon read.
 * Do not remove it once the mutation path invalidates properly either: that
 * path is one fire-and-forget `waitUntil`, and surviving its failure is the
 * whole job of a bound.
 *
 * WHAT THE BOUND COSTS, STATED PLAINLY. Writes stop being bounded by (org,
 * user) pairs and become bounded by ACTIVE PAIR-MINUTES: one `kv.put` per (org,
 * user) per 60s of continuous activity — worst case ~1,440/day for a single
 * ceaselessly active member, against an account-wide free-plan allowance of
 * 1,000 writes/day (Codex-kgrdp). Real sessions are bursts rather than days,
 * and each burst still collapses to one Neon read. But if KV writes do become
 * the binding constraint, the fix is a version-key read on this path (one
 * `kv.get` of `cache:version:…`, which is what `VersionedCache` does
 * elsewhere) — NOT a longer TTL on an unversioned authorization cache.
 *
 * ~46 routes across 5 workers use requireOrgMembership, so a hit replaces a
 * ~81ms Neon round trip with one KV read.
 *
 * @param organizationId - Organization UUID
 * @param userId - User ID
 * @param env - Worker environment
 * @param obs - Observability client for structured logging, or `undefined`.
 *   Explicitly positional rather than optional because `cacheWrite` after it is
 *   required.
 * @param cacheWrite - REQUIRED sink for the write-through, so it survives the
 *   response. Pass `ctx.cacheWrite` inside a `procedure()` handler; see
 *   `CacheWrite` for why this is not optional.
 * @returns Membership object or null if not a member
 */
export async function checkOrganizationMembership(
  organizationId: string,
  userId: string,
  env: Bindings,
  obs: ObservabilityClient | undefined,
  cacheWrite: CacheWrite
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
    // Write-through: warm the cache for the next read (fire-and-forget), bounded
    // by `MEMBERSHIP_CACHE_TTL_SECONDS`.
    //
    // THE TTL IS A SECURITY BOUND, NOT TUNING. This entry answers "may this user
    // act on this org?", so a stale copy is granted access that was revoked. Two
    // independent things must end it, because the second one has failed before:
    //   1. `invalidateMembershipCache` deletes this exact key on invite, role
    //      change and removal (workers/organization-api/src/routes/members.ts).
    //      It uses `membershipCacheKey` — the same builder read above — so the
    //      two cannot drift apart.
    //   2. `expirationTtl` caps residual access at 60s even if (1) regresses.
    // (1) DID regress: commit 2d1c065a replaced the original `kv.delete` with a
    // `VersionedCache` version bump, writing `cache:version:membership:*` — a key
    // this raw `kv.get` never consults — and nothing deleted the data key for
    // three months. It went unnoticed only because this write had no `waitUntil`
    // and was cancelled at response return, so the entry rarely existed. Making
    // the write reliable is what made the missing bound urgent; see Codex-rxjwp.
    //
    // Handed to `cacheWrite` so returning the response does not cancel it —
    // see `CacheWrite`.
    const key = membershipCacheKey(organizationId, userId);
    const write = kv
      .put(
        key,
        JSON.stringify({
          role: membership.role,
          status: membership.status,
          joinedAt: membership.joinedAt.toISOString(),
        }),
        { expirationTtl: MEMBERSHIP_CACHE_TTL_SECONDS }
      )
      .catch(() => {});
    cacheWrite(write);
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
