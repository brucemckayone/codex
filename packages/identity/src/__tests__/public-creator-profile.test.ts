/**
 * `IdentityService.getPublicProfileByUsername` — the platform's only
 * anonymous-readable user endpoint.
 *
 * Background: the three `creators.<host>/<username>` page loads have always
 * called `GET /api/user/public/:username`, and no worker served it. Every call
 * 404'd into a `catch` that set the profile to null, so every creator's public
 * page rendered a placeholder — URL handle for a name, letter avatar,
 * boilerplate bio, no social links.
 *
 * Two properties here are load-bearing and would not be caught by a test that
 * merely checks the happy path:
 *
 * 1. The response must NEVER carry `email`. The pre-existing `USER_PROFILE`
 *    cache entry does carry it, so reusing that entry (the obvious
 *    optimisation) would put PII one careless `return` away from the public.
 * 2. The profile must be cached by USER ID, not by username. All three
 *    existing invalidation sites (`updateProfile`, `uploadAvatar`,
 *    `upgradeToCreator`) call `invalidate(userId)`; keying the profile by
 *    username would make every one of them silently miss, serving a stale bio
 *    or avatar until the TTL expired.
 */

import { CacheType } from '@codex/cache';
import type { R2Service } from '@codex/cloudflare-clients';
import type { Database } from '@codex/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IdentityService } from '../services/identity-service';

vi.mock('@codex/image-processing', () => ({
  ImageProcessingService: class {
    processUserAvatar = vi.fn();
  },
  extractMimeType: (m: string) => m,
  MAX_IMAGE_SIZE_BYTES: 10 * 1024 * 1024,
  SUPPORTED_IMAGE_MIME_TYPES: ['image/jpeg'],
}));

/** The row shape the service's column allowlist asks for. */
const CREATOR_ROW = {
  id: 'user-abc',
  name: 'Alex Creator',
  image: 'https://oauth.example/avatar.png',
  avatarUrl: 'https://cdn.codex.test/custom.webp',
  bio: 'Makes things.',
  socialLinks: { website: 'https://alex.example' },
};

/**
 * A cache double that RECORDS its keys and still runs the fetchers, so the DB
 * path is exercised for real rather than stubbed past.
 */
function makeCache() {
  const gets: Array<{ id: string; type: string }> = [];
  const invalidated: string[] = [];
  return {
    gets,
    invalidated,
    get: vi.fn(
      async (id: string, type: string, fetcher: () => Promise<unknown>) => {
        gets.push({ id, type });
        return await fetcher();
      }
    ),
    getWithResult: vi.fn(
      async (id: string, type: string, fetcher: () => Promise<unknown>) => {
        gets.push({ id, type });
        return { data: await fetcher(), hit: false };
      }
    ),
    invalidate: vi.fn(async (id: string) => {
      invalidated.push(id);
    }),
  };
}

function makeService(cache?: ReturnType<typeof makeCache>) {
  const findFirst = vi.fn();
  const db = {
    query: { users: { findFirst } },
    update: vi.fn(),
  } as unknown as Database;

  const service = new IdentityService({
    db,
    environment: 'test',
    r2Service: {} as unknown as R2Service,
    r2PublicUrlBase: 'https://cdn.codex.test',
    // biome-ignore lint/suspicious/noExplicitAny: cache double
    cache: cache as any,
  });

  return { service, findFirst };
}

describe('getPublicProfileByUsername — the public projection', () => {
  let cache: ReturnType<typeof makeCache>;

  beforeEach(() => {
    cache = makeCache();
  });

  it('returns exactly the five public fields and NOTHING else', async () => {
    const { service, findFirst } = makeService(cache);
    // hop 1 resolves the id, hop 2 reads the row
    findFirst
      .mockResolvedValueOnce({ id: 'user-abc' })
      .mockResolvedValueOnce(CREATOR_ROW);

    const profile = await service.getPublicProfileByUsername('alex-creator');

    expect(Object.keys(profile ?? {}).sort()).toEqual([
      'bio',
      'id',
      'image',
      'name',
      'socialLinks',
    ]);
  });

  it('never leaks email, even when the DB row carries one', async () => {
    const { service, findFirst } = makeService(cache);
    // A row that DOES include email — simulating someone widening the
    // allowlist, or the service being pointed at a full-row query later.
    findFirst.mockResolvedValueOnce({ id: 'user-abc' }).mockResolvedValueOnce({
      ...CREATOR_ROW,
      email: 'alex@private.example',
      role: 'creator',
      emailVerified: true,
    });

    const profile = await service.getPublicProfileByUsername('alex-creator');

    const serialised = JSON.stringify(profile);
    expect(serialised).not.toContain('alex@private.example');
    expect(serialised).not.toContain('private.example');
    expect(profile).not.toHaveProperty('email');
    expect(profile).not.toHaveProperty('role');
    expect(profile).not.toHaveProperty('emailVerified');
  });

  it('asks the DB for an explicit column allowlist that excludes email', async () => {
    const { service, findFirst } = makeService(cache);
    findFirst
      .mockResolvedValueOnce({ id: 'user-abc' })
      .mockResolvedValueOnce(CREATOR_ROW);

    await service.getPublicProfileByUsername('alex-creator');

    // The profile read is the SECOND call. `columns` must be present — a
    // findFirst with no `columns` returns the whole row including email, so
    // its absence is the regression this asserts against.
    const profileCall = findFirst.mock.calls[1]?.[0] as {
      columns?: Record<string, boolean>;
    };
    expect(profileCall.columns).toBeDefined();
    expect(profileCall.columns).not.toHaveProperty('email');
    expect(profileCall.columns).not.toHaveProperty('role');
    expect(Object.keys(profileCall.columns ?? {}).sort()).toEqual([
      'avatarUrl',
      'bio',
      'id',
      'image',
      'name',
      'socialLinks',
    ]);
  });

  it('prefers a custom uploaded avatar over the OAuth provider image', async () => {
    const { service, findFirst } = makeService(cache);
    findFirst
      .mockResolvedValueOnce({ id: 'user-abc' })
      .mockResolvedValueOnce(CREATOR_ROW);

    const profile = await service.getPublicProfileByUsername('alex-creator');

    expect(profile?.image).toBe('https://cdn.codex.test/custom.webp');
  });

  it('falls back to the provider image when there is no custom avatar', async () => {
    const { service, findFirst } = makeService(cache);
    findFirst
      .mockResolvedValueOnce({ id: 'user-abc' })
      .mockResolvedValueOnce({ ...CREATOR_ROW, avatarUrl: null });

    const profile = await service.getPublicProfileByUsername('alex-creator');

    expect(profile?.image).toBe('https://oauth.example/avatar.png');
  });
});

describe('getPublicProfileByUsername — absent and deleted users', () => {
  it('returns null (does NOT throw) for an unknown username', async () => {
    const cache = makeCache();
    const { service, findFirst } = makeService(cache);
    findFirst.mockResolvedValueOnce(undefined);

    await expect(
      service.getPublicProfileByUsername('nobody')
    ).resolves.toBeNull();
  });

  it('does not read the profile slot at all when the username does not resolve', async () => {
    const cache = makeCache();
    const { service, findFirst } = makeService(cache);
    findFirst.mockResolvedValueOnce(undefined);

    await service.getPublicProfileByUsername('nobody');

    // Only the username hop ran — no wasted second lookup, and nothing is
    // written for a name that does not exist.
    expect(cache.gets.map((g) => g.type)).toEqual([CacheType.USERNAME_TO_ID]);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('returns null when the id resolves but the row is gone', async () => {
    const cache = makeCache();
    const { service, findFirst } = makeService(cache);
    findFirst
      .mockResolvedValueOnce({ id: 'user-abc' })
      .mockResolvedValueOnce(undefined);

    await expect(
      service.getPublicProfileByUsername('alex-creator')
    ).resolves.toBeNull();
  });

  it('scopes BOTH hops to non-deleted rows', async () => {
    const cache = makeCache();
    const { service, findFirst } = makeService(cache);
    findFirst
      .mockResolvedValueOnce({ id: 'user-abc' })
      .mockResolvedValueOnce(CREATOR_ROW);

    await service.getPublicProfileByUsername('alex-creator');

    // A soft-deleted account frees its username (the unique index is partial
    // on deleted_at IS NULL), so an unscoped lookup would resurrect a deleted
    // creator's profile — or hand their handle's traffic to them after
    // deletion. Both hops must carry a where clause.
    for (const call of findFirst.mock.calls) {
      expect((call[0] as { where?: unknown }).where).toBeDefined();
    }
    expect(findFirst).toHaveBeenCalledTimes(2);
  });
});

describe('getPublicProfileByUsername — cache keying (the invalidation contract)', () => {
  it('keys the username hop by username and the profile by USER ID', async () => {
    const cache = makeCache();
    const { service, findFirst } = makeService(cache);
    findFirst
      .mockResolvedValueOnce({ id: 'user-abc' })
      .mockResolvedValueOnce(CREATOR_ROW);

    await service.getPublicProfileByUsername('Alex-Creator');

    expect(cache.gets).toEqual([
      // lowercased, so `/@Alex-Creator` and `/@alex-creator` share one slot
      // instead of fragmenting the version namespace across casings.
      { id: 'alex-creator', type: CacheType.USERNAME_TO_ID },
      // THE contract: keyed by id, so `invalidate(userId)` reaches it.
      { id: 'user-abc', type: CacheType.USER_PUBLIC_PROFILE },
    ]);
  });

  it('does not reuse USER_PROFILE, whose cached entry carries email', async () => {
    const cache = makeCache();
    const { service, findFirst } = makeService(cache);
    findFirst
      .mockResolvedValueOnce({ id: 'user-abc' })
      .mockResolvedValueOnce(CREATOR_ROW);

    await service.getPublicProfileByUsername('alex-creator');

    expect(cache.gets.map((g) => g.type)).not.toContain(CacheType.USER_PROFILE);
  });

  it('works with no cache injected, hitting the DB directly', async () => {
    const { service, findFirst } = makeService(undefined);
    findFirst
      .mockResolvedValueOnce({ id: 'user-abc' })
      .mockResolvedValueOnce(CREATOR_ROW);

    const profile = await service.getPublicProfileByUsername('alex-creator');

    expect(profile?.name).toBe('Alex Creator');
    expect(findFirst).toHaveBeenCalledTimes(2);
  });
});
