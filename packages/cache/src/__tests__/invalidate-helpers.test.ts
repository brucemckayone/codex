import type { KVNamespace } from '@cloudflare/workers-types';
import { createMockKVNamespace } from '@codex/test-utils/mocks';
import { describe, expect, it, vi } from 'vitest';
import { CacheType } from '../cache-keys';
import {
  invalidateOrgPublicCaches,
  invalidateUserLibrary,
} from '../helpers/invalidate';
import { VersionedCache } from '../versioned-cache';

describe('invalidateUserLibrary', () => {
  it('bumps COLLECTION_USER_LIBRARY version key when kv + userId provided', async () => {
    const kv = createMockKVNamespace();
    const tasks: Promise<unknown>[] = [];
    const waitUntil = (p: Promise<unknown>) => {
      tasks.push(p);
    };

    invalidateUserLibrary({
      kv: kv as unknown as KVNamespace,
      waitUntil,
      userId: 'user-123',
    });

    await Promise.all(tasks);

    // VersionedCache.invalidate writes the version key
    const expectedKey = `cache:version:${CacheType.COLLECTION_USER_LIBRARY('user-123')}`;
    expect(kv.put.mock.calls.some(([k]: unknown[]) => k === expectedKey)).toBe(
      true
    );
  });

  it('is a no-op when kv binding is missing', async () => {
    const tasks: Promise<unknown>[] = [];
    const waitUntil = (p: Promise<unknown>) => {
      tasks.push(p);
    };

    invalidateUserLibrary({
      kv: undefined,
      waitUntil,
      userId: 'user-123',
    });

    expect(tasks).toHaveLength(0);
  });

  it('is a no-op when userId is empty', async () => {
    const kv = createMockKVNamespace();
    const tasks: Promise<unknown>[] = [];
    const waitUntil = (p: Promise<unknown>) => {
      tasks.push(p);
    };

    invalidateUserLibrary({
      kv: kv as unknown as KVNamespace,
      waitUntil,
      userId: '',
    });

    expect(tasks).toHaveLength(0);
  });

  it('stays non-throwing when the KV put fails, and registers both sinks', async () => {
    const baseKv = createMockKVNamespace();
    const failingKv = {
      ...baseKv,
      put: vi.fn(async () => {
        throw new Error('KV down');
      }),
    } as unknown as KVNamespace;
    const tasks: Promise<unknown>[] = [];
    const waitUntil = (p: Promise<unknown>) => {
      tasks.push(p);
    };
    const warn = vi.fn();

    invalidateUserLibrary({
      kv: failingKv,
      waitUntil,
      userId: 'user-1',
      logger: { warn },
    });

    await Promise.all(tasks);

    // TWO registrations, not one, since the cache is now constructed WITH the
    // sink (RULE 7): `invalidate` parks its own version-key put on `waitUntil`
    // before awaiting it, and the helper additionally parks the whole
    // `invalidate()` promise. Both resolve off the same put, so the duplicate
    // costs nothing but keeping the isolate alive twice over for one write —
    // and the inner registration is what makes `void cache.invalidate(id)`
    // safe elsewhere (Codex-mhoaz).
    expect(tasks).toHaveLength(2);

    // The helper is non-throwing, which is the property that matters here.
    //
    // NOT via `logger.warn`, despite what this case used to be called:
    // `invalidate()` catches its own failure and deliberately does not rethrow
    // ("invalidation failures are not critical"), so the helper's `.catch` is
    // unreachable for a put error and `warn` is never called. The logger stays
    // in the signature for the resolve-then-invalidate helpers that CAN throw.
    expect(warn).not.toHaveBeenCalled();
  });
});

// Codex-kk9nv.9: the creators list has its own version, so a member's profile
// write no longer evicts the org's config, which every org page reads.
describe('invalidateOrgPublicCaches', () => {
  const SLUG = 'studio-alpha';

  async function primed() {
    const kv = createMockKVNamespace();
    const cache = new VersionedCache({
      kv: kv as unknown as KVNamespace,
      waitUntil: (p) => void p,
    });
    const config = vi.fn().mockResolvedValue({ name: 'Studio Alpha' });
    const creators = vi.fn().mockResolvedValue({ items: [] });
    const read = () =>
      Promise.all([
        cache.get(SLUG, CacheType.ORG_CONFIG, config),
        cache.get(
          CacheType.COLLECTION_ORG_CREATORS(SLUG),
          CacheType.ORG_CREATORS,
          creators
        ),
      ]);
    await read();
    return { cache, config, creators, read };
  }

  it('a creators-only bump refetches the list and keeps the config', async () => {
    const { cache, config, creators, read } = await primed();

    await cache.invalidate(CacheType.COLLECTION_ORG_CREATORS(SLUG));
    await read();

    expect(creators).toHaveBeenCalledTimes(2);
    expect(config).toHaveBeenCalledTimes(1);
  });

  it('stales both the config and the creators list', async () => {
    const { cache, config, creators, read } = await primed();

    await invalidateOrgPublicCaches(cache, SLUG);
    await read();

    expect(config).toHaveBeenCalledTimes(2);
    expect(creators).toHaveBeenCalledTimes(2);
  });
});
