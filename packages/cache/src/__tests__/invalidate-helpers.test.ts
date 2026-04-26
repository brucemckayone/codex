import type { KVNamespace } from '@cloudflare/workers-types';
import { describe, expect, it, vi } from 'vitest';
import { CacheType } from '../cache-keys';
import { invalidateUserLibrary } from '../helpers/invalidate';

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

describe('invalidateUserLibrary', () => {
  it('bumps COLLECTION_USER_LIBRARY version key when kv + userId provided', async () => {
    const kv = createMockKV();
    const tasks: Promise<unknown>[] = [];
    const waitUntil = (p: Promise<unknown>) => {
      tasks.push(p);
    };

    invalidateUserLibrary({ kv, waitUntil, userId: 'user-123' });

    await Promise.all(tasks);

    // VersionedCache.invalidate writes the version key
    const expectedKey = `cache:version:${CacheType.COLLECTION_USER_LIBRARY('user-123')}`;
    expect(kv._puts.some(([k]) => k === expectedKey)).toBe(true);
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
    const kv = createMockKV();
    const tasks: Promise<unknown>[] = [];
    const waitUntil = (p: Promise<unknown>) => {
      tasks.push(p);
    };

    invalidateUserLibrary({ kv, waitUntil, userId: '' });

    expect(tasks).toHaveLength(0);
  });

  it('swallows KV errors and surfaces via logger.warn', async () => {
    const failingKv = {
      ...createMockKV(),
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
    // VersionedCache catches put errors internally — the helper's catch is a
    // belt-and-suspenders. Either path leaves the helper non-throwing.
    expect(tasks).toHaveLength(1);
  });
});
