import type { KVNamespace } from '@cloudflare/workers-types';
import { VersionedCache } from '@codex/cache';
import { describe, expect, it, vi } from 'vitest';
import { invalidateOrgSlugCache } from '../cache-fanout';

/**
 * Minimal KV stand-in matching the surface used by VersionedCache.invalidate
 * (`put`). Get/delete are unused in these tests so we stub them.
 */
function createMockKV(): KVNamespace & { _puts: Array<[string, string]> } {
  const puts: Array<[string, string]> = [];
  return {
    get: vi.fn(async () => null),
    put: vi.fn(async (key: string, value: string) => {
      puts.push([key, value]);
    }),
    delete: vi.fn(),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
    _puts: puts,
  } as unknown as KVNamespace & { _puts: Array<[string, string]> };
}

describe('invalidateOrgSlugCache', () => {
  it('resolves slug from db and invalidates the slug-keyed cache', async () => {
    const kv = createMockKV();
    const cache = new VersionedCache({ kv });
    const findFirst = vi.fn(async () => ({ slug: 'acme' }));
    const db = {
      query: { organizations: { findFirst } },
    } as unknown as Parameters<typeof invalidateOrgSlugCache>[0]['db'];

    await invalidateOrgSlugCache({ db, cache, orgId: 'org-1' });

    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(kv._puts.some(([k]) => k === 'cache:version:acme')).toBe(true);
  });

  it('is a no-op when orgId is empty', async () => {
    const kv = createMockKV();
    const cache = new VersionedCache({ kv });
    const findFirst = vi.fn();
    const db = {
      query: { organizations: { findFirst } },
    } as unknown as Parameters<typeof invalidateOrgSlugCache>[0]['db'];

    await invalidateOrgSlugCache({ db, cache, orgId: '' });

    expect(findFirst).not.toHaveBeenCalled();
  });

  it('does nothing when the org has no slug', async () => {
    const kv = createMockKV();
    const cache = new VersionedCache({ kv });
    const findFirst = vi.fn(async () => undefined);
    const db = {
      query: { organizations: { findFirst } },
    } as unknown as Parameters<typeof invalidateOrgSlugCache>[0]['db'];

    await invalidateOrgSlugCache({ db, cache, orgId: 'org-1' });

    expect(kv._puts).toHaveLength(0);
  });

  it('swallows DB errors and surfaces via logger.warn', async () => {
    const kv = createMockKV();
    const cache = new VersionedCache({ kv });
    const findFirst = vi.fn(async () => {
      throw new Error('Neon timeout');
    });
    const db = {
      query: { organizations: { findFirst } },
    } as unknown as Parameters<typeof invalidateOrgSlugCache>[0]['db'];
    const warn = vi.fn();

    await expect(
      invalidateOrgSlugCache({ db, cache, orgId: 'org-1', logger: { warn } })
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/org-slug/);
  });
});
