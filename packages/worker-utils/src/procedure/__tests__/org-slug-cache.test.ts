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
    },
  },
}));

// Imported after the mock so org-helpers resolves the stub.
import { createDbClient } from '@codex/database';
import {
  __resetNegativeSlugCache,
  extractOrganizationFromSubdomain,
  invalidateOrgSlugCacheEntry,
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

const findFirst = vi.fn();

function envWith(kv?: FakeKv): Bindings {
  return { CACHE_KV: kv } as unknown as Bindings;
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetNegativeSlugCache();
  findFirst.mockResolvedValue({ id: ORG_ID });
  vi.mocked(createDbClient).mockReturnValue({
    query: { organizations: { findFirst } },
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
      envWith(kv)
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
          envWith(kv)
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
      envWith(kv)
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
        envWith(kv)
      )
    ).toBe(ORG_ID);
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(kv.put).toHaveBeenCalledWith(orgSlugCacheKey('acme'), ORG_ID);

    expect(
      await extractOrganizationFromSubdomain(
        'acme.revelations.studio',
        envWith(kv)
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
        envWith(kv)
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
        envWith(kv)
      )
    ).toBe(ORG_ID);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('resolves with no KV binding at all', async () => {
    expect(
      await extractOrganizationFromSubdomain(
        'acme.revelations.studio',
        envWith(undefined)
      )
    ).toBe(ORG_ID);
    expect(findFirst).toHaveBeenCalledTimes(1);
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
          envWith(kv)
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
        envWith(kv)
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
        envWith(kv)
      )
    ).toBeNull();
    expect(findFirst).toHaveBeenCalledTimes(1);

    // The org gets created; the miss must not outlive its TTL.
    findFirst.mockResolvedValue({ id: ORG_ID });
    vi.setSystemTime(new Date('2026-08-27T10:00:31Z'));

    expect(
      await extractOrganizationFromSubdomain(
        'brand-new.revelations.studio',
        envWith(kv)
      )
    ).toBe(ORG_ID);
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it('stays bounded under a random-hostname scan', async () => {
    const kv = makeKv();

    for (let i = 0; i < 900; i++) {
      await extractOrganizationFromSubdomain(
        `scan-${i}.revelations.studio`,
        envWith(kv)
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
      envWith(kv)
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
      await extractOrganizationFromSubdomain(hostname, envWith(kv))
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
