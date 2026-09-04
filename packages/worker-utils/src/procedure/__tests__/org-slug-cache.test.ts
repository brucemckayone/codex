/**
 * Proof tests for the `slug -> organization id` resolution path
 * (Codex-kgrdp.23 defect 1 / 1b).
 *
 * Every case here fails against the pre-fix implementation, which did an
 * unconditional Neon `organizations.findFirst` on EVERY org-scoped request and
 * carried its own six-entry hand-maintained infrastructure deny-list.
 *
 * The three tiers under test, cheapest first:
 *   1. zero I/O  — reserved hostnames rejected from RESERVED_SUBDOMAINS_SET
 *   2. zero I/O  — isolate-local negative cache for proven misses
 *   3. one KV read — write-through `slug -> id` cache
 */
import type { Bindings } from '@codex/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@codex/database', () => ({
  createDbClient: vi.fn(),
  schema: {
    organizations: {
      slug: 'organizations-slug-col-sentinel',
      deletedAt: 'organizations-deletedAt-col-sentinel',
    },
    organizationMemberships: {
      organizationId: 'memberships-org-col-sentinel',
      userId: 'memberships-user-col-sentinel',
      status: 'memberships-status-col-sentinel',
    },
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, value: unknown) => ({ eq: [col, value] }),
  and: (...parts: unknown[]) => ({ and: parts }),
  isNull: (col: unknown) => ({ isNull: [col] }),
}));

// Imported after the mock so org-helpers resolves the stub.
import { createDbClient } from '@codex/database';
import {
  __resetNegativeSlugCache,
  type CacheWrite,
  checkOrganizationMembership,
  extractOrganizationFromSubdomain,
  invalidateOrgSlugCacheEntry,
  membershipCacheKey,
  orgSlugCacheKey,
} from '../org-helpers';

const ORG_ID = '9f8c1d4e-0b2a-4c6d-8e1f-2a3b4c5d6e7f';

function makeKv() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
}

type FakeKv = ReturnType<typeof makeKv>;

/**
 * The write sink both helpers now REQUIRE (see `CacheWrite` in org-helpers).
 *
 * Passed explicitly at every call below rather than omitted, because omitting
 * it no longer compiles — that is the point of the change, and
 * `org-cache-write-required.type-check.ts` is where the compiler proves it.
 * A test that needs to ASSERT the hand-off uses its own `vi.fn()` instead of
 * this one; this is only here so the cases about something else can stay about
 * something else.
 */
const sink: CacheWrite = () => {};

const findFirst = vi.fn();
const membershipFindFirst = vi.fn();

function envWith(kv?: FakeKv): Bindings {
  return { CACHE_KV: kv } as unknown as Bindings;
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetNegativeSlugCache();
  findFirst.mockResolvedValue({ id: ORG_ID });
  membershipFindFirst.mockResolvedValue({
    role: 'owner',
    status: 'active',
    createdAt: new Date('2026-01-01T00:00:00Z'),
  });
  vi.mocked(createDbClient).mockReturnValue({
    query: {
      organizations: { findFirst },
      organizationMemberships: { findFirst: membershipFindFirst },
    },
  } as unknown as ReturnType<typeof createDbClient>);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('extractOrganizationFromSubdomain — reserved hostnames (defect 1b)', () => {
  // The exact hostnames the old six-entry list was missing. Each one reached
  // Neon on every request before this fix.
  const missingFromOldList = [
    'organization-api',
    'ecom-api',
    'media-api',
    'notifications-api',
    'admin-api',
    'cdn-media',
    'cdn-assets',
    'cdn-resources',
    'cdn-platform',
    'preview',
    'app',
    'codex',
    'creators',
    'auth-staging',
  ];

  it.each(missingFromOldList)('rejects %s with zero I/O', async (subdomain) => {
    const kv = makeKv();

    const result = await extractOrganizationFromSubdomain(
      `${subdomain}.revelations.studio`,
      envWith(kv),
      undefined,
      sink
    );

    expect(result).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
    expect(kv.get).not.toHaveBeenCalled();
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('still rejects the hostnames the old hand-list already covered', async () => {
    const kv = makeKv();

    for (const subdomain of [
      'www',
      'api',
      'content-api',
      'identity-api',
      'auth',
      'admin',
    ]) {
      expect(
        await extractOrganizationFromSubdomain(
          `${subdomain}.revelations.studio`,
          envWith(kv),
          undefined,
          sink
        )
      ).toBeNull();
    }

    expect(findFirst).not.toHaveBeenCalled();
  });
});

describe('extractOrganizationFromSubdomain — positive KV cache (defect 1)', () => {
  it('serves a cached id without touching Neon', async () => {
    const kv = makeKv();
    kv.store.set(orgSlugCacheKey('acme'), ORG_ID);

    const result = await extractOrganizationFromSubdomain(
      'acme.revelations.studio',
      envWith(kv),
      undefined,
      sink
    );

    expect(result).toBe(ORG_ID);
    expect(kv.get).toHaveBeenCalledWith(orgSlugCacheKey('acme'), 'text');
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('write-throughs on a miss so the next request is cache-only', async () => {
    const kv = makeKv();

    expect(
      await extractOrganizationFromSubdomain(
        'acme.revelations.studio',
        envWith(kv),
        undefined,
        sink
      )
    ).toBe(ORG_ID);
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(kv.put).toHaveBeenCalledWith(orgSlugCacheKey('acme'), ORG_ID, {
      expirationTtl: 86_400,
    });

    expect(
      await extractOrganizationFromSubdomain(
        'acme.revelations.studio',
        envWith(kv),
        undefined,
        sink
      )
    ).toBe(ORG_ID);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('lowercases the hostname label before lookup', async () => {
    const kv = makeKv();
    kv.store.set(orgSlugCacheKey('acme'), ORG_ID);

    expect(
      await extractOrganizationFromSubdomain(
        'ACME.revelations.studio',
        envWith(kv),
        undefined,
        sink
      )
    ).toBe(ORG_ID);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('falls through to Neon when the KV read throws', async () => {
    const kv = makeKv();
    kv.get.mockRejectedValueOnce(new Error('KV unavailable'));

    expect(
      await extractOrganizationFromSubdomain(
        'acme.revelations.studio',
        envWith(kv),
        undefined,
        sink
      )
    ).toBe(ORG_ID);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('resolves with no KV binding at all', async () => {
    expect(
      await extractOrganizationFromSubdomain(
        'acme.revelations.studio',
        envWith(undefined),
        undefined,
        sink
      )
    ).toBe(ORG_ID);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('filters soft-deleted orgs out of the slug lookup', async () => {
    // A soft-deleted org keeps its slug row, and this resolution is pinned
    // into KV for 24h — without the deletedAt predicate a slug reused by a
    // NEW tenant could resolve every org-scoped request to the deleted
    // tenant's id. Assert the query actually carries the predicate.
    expect(
      await extractOrganizationFromSubdomain(
        'acme.revelations.studio',
        envWith(undefined),
        undefined,
        sink
      )
    ).toBe(ORG_ID);

    expect(findFirst).toHaveBeenCalledTimes(1);
    const where = findFirst.mock.calls[0][0].where;
    expect(where).toEqual({
      and: [
        { eq: ['organizations-slug-col-sentinel', 'acme'] },
        { isNull: ['organizations-deletedAt-col-sentinel'] },
      ],
    });
  });
});

describe('extractOrganizationFromSubdomain — negative cache', () => {
  beforeEach(() => {
    findFirst.mockResolvedValue(undefined);
  });

  it('absorbs a repeated probe of an unknown hostname after one Neon trip', async () => {
    const kv = makeKv();

    for (let i = 0; i < 25; i++) {
      expect(
        await extractOrganizationFromSubdomain(
          'supabase.revelations.studio',
          envWith(kv),
          undefined,
          sink
        )
      ).toBeNull();
    }

    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('NEVER writes a miss to KV — the account write cap is 1,000/day', async () => {
    const kv = makeKv();

    for (const label of ['scan-a', 'scan-b', 'scan-c']) {
      await extractOrganizationFromSubdomain(
        `${label}.revelations.studio`,
        envWith(kv),
        undefined,
        sink
      );
    }

    expect(kv.put).not.toHaveBeenCalled();
    expect(kv.store.size).toBe(0);
  });

  it('expires so an org created just after a probe is not shadowed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-27T10:00:00Z'));
    const kv = makeKv();

    expect(
      await extractOrganizationFromSubdomain(
        'brand-new.revelations.studio',
        envWith(kv),
        undefined,
        sink
      )
    ).toBeNull();
    expect(findFirst).toHaveBeenCalledTimes(1);

    // The org gets created; the miss must not outlive its TTL.
    findFirst.mockResolvedValue({ id: ORG_ID });
    vi.setSystemTime(new Date('2026-08-27T10:00:31Z'));

    expect(
      await extractOrganizationFromSubdomain(
        'brand-new.revelations.studio',
        envWith(kv),
        undefined,
        sink
      )
    ).toBe(ORG_ID);
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it('stays bounded under a random-hostname scan', async () => {
    const kv = makeKv();

    for (let i = 0; i < 900; i++) {
      await extractOrganizationFromSubdomain(
        `scan-${i}.revelations.studio`,
        envWith(kv),
        undefined,
        sink
      );
    }

    // Every distinct label is a real miss, so each costs one Neon trip; the
    // guarantee under test is that none of them cost a KV WRITE and the map
    // does not grow without bound (proven via the FIFO eviction below).
    expect(kv.put).not.toHaveBeenCalled();

    // The oldest labels have been evicted, so re-probing one queries again.
    findFirst.mockClear();
    await extractOrganizationFromSubdomain(
      'scan-0.revelations.studio',
      envWith(kv),
      undefined,
      sink
    );
    expect(findFirst).toHaveBeenCalledTimes(1);
  });
});

describe('extractOrganizationFromSubdomain — non-org hostnames', () => {
  it.each([
    'localhost:3000',
    '127.0.0.1:8787',
    'revelations.studio',
    'lvh.me:3000',
  ])('returns null with zero I/O for %s', async (hostname) => {
    const kv = makeKv();

    expect(
      await extractOrganizationFromSubdomain(
        hostname,
        envWith(kv),
        undefined,
        sink
      )
    ).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
    expect(kv.get).not.toHaveBeenCalled();
  });
});

describe('invalidateOrgSlugCacheEntry', () => {
  it('deletes the slug -> id key so a rename cannot keep resolving', async () => {
    const kv = makeKv();
    kv.store.set(orgSlugCacheKey('old-slug'), ORG_ID);

    await invalidateOrgSlugCacheEntry(
      kv as unknown as Parameters<typeof invalidateOrgSlugCacheEntry>[0],
      'old-slug'
    );

    expect(kv.delete).toHaveBeenCalledWith(orgSlugCacheKey('old-slug'));
    expect(kv.store.has(orgSlugCacheKey('old-slug'))).toBe(false);
  });
});

// ============================================================================
// The write-through actually survives the response (Codex-345hg)
// ============================================================================

/**
 * Both write-through caches in org-helpers fired `kv.put(...).catch(() => {})`
 * and the word `waitUntil` appeared nowhere in the file. A Worker cancels every
 * unawaited promise the moment the response is returned, and the put is the
 * last thing each lookup does — so the entry was routinely never written, the
 * next request missed again, and a cache built to remove one ~81ms Neon round
 * trip per org-scoped request removed none of them.
 *
 * WHY THE EXISTING `expect(kv.put).toHaveBeenCalledWith(...)` ABOVE CANNOT
 * CATCH THAT. A vitest mock records the call synchronously, at the instant
 * `kv.put` is invoked. Only the real runtime cancels the returned promise, and
 * a mock has no runtime — so that assertion is true whether or not the write is
 * protected, and stayed green through the entire defect. The assertions below
 * are about the HANDOFF: they check that the promise reached `waitUntil`, which
 * is the only thing that makes the write outlive the response.
 *
 * Each of these fails on the pre-fix tree: neither function took a fourth/fifth
 * argument, so the spy is never called.
 */
describe('write-through survives the response — waitUntil handoff', () => {
  const USER_ID = 'user-1';

  it('hands the slug -> id put to waitUntil', async () => {
    const kv = makeKv();
    const cacheWrite = vi.fn<(p: Promise<unknown>) => void>();

    expect(
      await extractOrganizationFromSubdomain(
        'acme.revelations.studio',
        envWith(kv),
        undefined,
        cacheWrite
      )
    ).toBe(ORG_ID);

    // The write happened AND was handed off. Both halves matter: the first
    // without the second is exactly the defect.
    expect(kv.put).toHaveBeenCalledWith(orgSlugCacheKey('acme'), ORG_ID, {
      expirationTtl: 86_400,
    });
    expect(cacheWrite).toHaveBeenCalledTimes(1);

    const handed = cacheWrite.mock.calls[0]?.[0];
    expect(handed).toBeInstanceOf(Promise);
    await expect(handed).resolves.toBeUndefined();
  });

  it('hands the membership put to waitUntil', async () => {
    const kv = makeKv();
    const cacheWrite = vi.fn<(p: Promise<unknown>) => void>();

    const membership = await checkOrganizationMembership(
      ORG_ID,
      USER_ID,
      envWith(kv),
      undefined,
      cacheWrite
    );

    expect(membership?.role).toBe('owner');
    expect(kv.put).toHaveBeenCalledTimes(1);
    expect(cacheWrite).toHaveBeenCalledTimes(1);
    await expect(cacheWrite.mock.calls[0]?.[0]).resolves.toBeUndefined();

    // And the entry that landed is the one the next read wants.
    expect(kv.store.get(membershipCacheKey(ORG_ID, USER_ID))).toBe(
      JSON.stringify({
        role: 'owner',
        status: 'active',
        joinedAt: '2026-01-01T00:00:00.000Z',
      })
    );
  });

  it('never hands off a write that did not happen — a miss stays out of KV', async () => {
    const kv = makeKv();
    const cacheWrite = vi.fn<(p: Promise<unknown>) => void>();
    findFirst.mockResolvedValue(undefined);

    expect(
      await extractOrganizationFromSubdomain(
        'nobody.revelations.studio',
        envWith(kv),
        undefined,
        cacheWrite
      )
    ).toBeNull();

    expect(kv.put).not.toHaveBeenCalled();
    expect(cacheWrite).not.toHaveBeenCalled();
  });

  it('never hands off when the user is not a member', async () => {
    const kv = makeKv();
    const cacheWrite = vi.fn<(p: Promise<unknown>) => void>();
    membershipFindFirst.mockResolvedValue(undefined);

    expect(
      await checkOrganizationMembership(
        ORG_ID,
        USER_ID,
        envWith(kv),
        undefined,
        cacheWrite
      )
    ).toBeNull();

    expect(kv.put).not.toHaveBeenCalled();
    expect(cacheWrite).not.toHaveBeenCalled();
  });

  it('a rejecting put still resolves for waitUntil, so it cannot become an unhandled rejection', async () => {
    const kv = makeKv();
    kv.put.mockRejectedValueOnce(new Error('KV write quota exhausted'));
    const cacheWrite = vi.fn<(p: Promise<unknown>) => void>();

    expect(
      await extractOrganizationFromSubdomain(
        'acme.revelations.studio',
        envWith(kv),
        undefined,
        cacheWrite
      )
    ).toBe(ORG_ID);

    await expect(cacheWrite.mock.calls[0]?.[0]).resolves.toBeUndefined();
  });

  it('resolves normally when the sink does nothing with the promise', async () => {
    const kv = makeKv();

    // The sink is a runtime affordance, not a correctness dependency: neither
    // lookup may change its ANSWER based on what the sink does. This used to be
    // titled "the parameter is optional" and asserted the opposite — that
    // omitting it was supported — which is exactly the shape that let
    // workers/identity-api/src/routes/membership.ts and
    // workers/content-api/src/routes/categories.ts keep the cancelled write.
    // Omission is now a compile error, proven in
    // `org-cache-write-required.type-check.ts` (a runtime test cannot see an
    // absent argument: `cacheWrite?.(write)` on `undefined` does nothing,
    // successfully).
    expect(
      await extractOrganizationFromSubdomain(
        'acme.revelations.studio',
        envWith(kv),
        undefined,
        sink
      )
    ).toBe(ORG_ID);
    expect(kv.put).toHaveBeenCalledTimes(1);

    expect(
      (
        await checkOrganizationMembership(
          ORG_ID,
          USER_ID,
          envWith(kv),
          undefined,
          sink
        )
      )?.role
    ).toBe('owner');
  });
});

// ============================================================================
// The two entries are BOUNDED (Codex-345hg · authorization cache)
// ============================================================================

/**
 * `checkOrganizationMembership` writes the role that every `requireOrgMembership`
 * and `requireOrgManagement` gate reads, on a raw key nothing deletes: the one
 * mutation-side caller bumps `cache:version:membership:{orgId}:{userId}` via
 * `VersionedCache.invalidate()`, which this reader never consults. Until the
 * write became reliable the entry was usually cancelled before KV saw it, which
 * masked the fact that there was no way to end one.
 *
 * So the `expirationTtl` is the bound on unauthorized access, and these cases
 * pin the NUMBER rather than importing the constant on purpose: a security
 * ceiling that can be raised without failing a test is not a ceiling. Changing
 * either value must break here and be argued for again.
 */
describe('cache entries carry a TTL', () => {
  const USER_ID = 'user-1';

  it('bounds a cached membership at 60s, so a removed member cannot outlive it', async () => {
    const kv = makeKv();

    await checkOrganizationMembership(
      ORG_ID,
      USER_ID,
      envWith(kv),
      undefined,
      sink
    );

    expect(kv.put).toHaveBeenCalledTimes(1);
    const [key, , options] = kv.put.mock.calls[0] ?? [];
    expect(key).toBe(membershipCacheKey(ORG_ID, USER_ID));
    // 60s is the KV minimum and the contract's own invalidation bound.
    expect(options).toEqual({ expirationTtl: 60 });
  });

  it("bounds the slug -> id entry at 24h, in case a rename's delete is lost", async () => {
    const kv = makeKv();

    await extractOrganizationFromSubdomain(
      'acme.revelations.studio',
      envWith(kv),
      undefined,
      sink
    );

    const [key, value, options] = kv.put.mock.calls[0] ?? [];
    expect(key).toBe(orgSlugCacheKey('acme'));
    expect(value).toBe(ORG_ID);
    // Longer than the membership bound because this key IS invalidated
    // (organizations.ts deletes it on rename and delete); the TTL only has to
    // survive that fire-and-forget delete failing.
    expect(options).toEqual({ expirationTtl: 86_400 });
  });

  it('never lets a TTL go missing on either write', async () => {
    const kv = makeKv();

    await extractOrganizationFromSubdomain(
      'acme.revelations.studio',
      envWith(kv),
      undefined,
      sink
    );
    await checkOrganizationMembership(
      ORG_ID,
      USER_ID,
      envWith(kv),
      undefined,
      sink
    );

    expect(kv.put).toHaveBeenCalledTimes(2);
    for (const call of kv.put.mock.calls) {
      const options = call[2] as { expirationTtl?: number } | undefined;
      expect(typeof options?.expirationTtl).toBe('number');
      expect(options?.expirationTtl).toBeGreaterThanOrEqual(60);
    }
  });
});
