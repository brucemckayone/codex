import type { MediaUsage } from '@codex/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { MEDIA_BULK_DELETE_MAX, runBulkDelete } from './bulk-delete';

const usage = (live: number, fingerprint = `fp-${live}`): MediaUsage => ({
  total: live,
  live,
  drafts: 0,
  hidden: 0,
  uses: [],
  fingerprint,
});
const refused = (status: number, code?: string) =>
  Object.assign(new Error(String(status)), {
    status,
    body: code ? { code } : undefined,
  });

describe('runBulkDelete', () => {
  it('deletes each unused item with the fingerprint its own fresh read returned', async () => {
    const remove = vi.fn(async () => undefined);
    const readUsage = vi.fn(async (id: string) => usage(0, `fp-${id}`));
    const result = await runBulkDelete(['a', 'b'], { readUsage, remove });

    expect(result).toEqual({
      deleted: ['a', 'b'],
      blocked: [],
      changed: [],
      failed: [],
      rateLimited: [],
      draftsAffected: 0,
    });
    expect(remove.mock.calls).toEqual([
      [{ id: 'a', usage: 'fp-a' }],
      [{ id: 'b', usage: 'fp-b' }],
    ]);
  });

  it('keeps anything published uses, read before or refused at the delete', async () => {
    const remove = vi.fn(async ({ id }: { id: string }) => {
      if (id === 'raced') throw refused(409);
    });
    const readUsage = vi.fn(async (id: string) => usage(id === 'live' ? 1 : 0));
    const result = await runBulkDelete(['live', 'raced', 'free'], {
      readUsage,
      remove,
    });

    expect(result).toMatchObject({
      deleted: ['free'],
      blocked: ['live', 'raced'],
      failed: [],
    });
    // The published one never reached the DELETE.
    expect(remove).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: 'live' })
    );
  });

  it('counts an item another tab deleted as deleted, and reports any other failure', async () => {
    const onFailure = vi.fn();
    const remove = vi.fn(async ({ id }: { id: string }) => {
      if (id === 'gone') throw refused(404);
      if (id === 'outage') throw refused(503);
    });
    const result = await runBulkDelete(['gone', 'outage', 'ok'], {
      readUsage: async () => usage(0),
      remove,
      onFailure,
    });
    expect(result).toMatchObject({
      deleted: ['gone', 'ok'],
      blocked: [],
      failed: ['outage'],
    });
    expect(onFailure).toHaveBeenCalledWith(
      'outage',
      expect.objectContaining({ status: 503 })
    );
  });

  it('a failed usage read deletes nothing for that item', async () => {
    const remove = vi.fn();
    const result = await runBulkDelete(['a'], {
      readUsage: async () => {
        throw refused(500);
      },
      remove,
    });
    expect(result.failed).toEqual(['a']);
    expect(remove).not.toHaveBeenCalled();
  });

  // The strict limiter allows 20 a minute: past the cap the loop would 429.
  it('refuses more than the cap before touching anything', async () => {
    const readUsage = vi.fn();
    const ids = Array.from(
      { length: MEDIA_BULK_DELETE_MAX + 1 },
      (_, i) => `m${i}`
    );
    await expect(
      runBulkDelete(ids, { readUsage, remove: vi.fn() })
    ).rejects.toThrow(RangeError);
    expect(readUsage).not.toHaveBeenCalled();
  });

  // The strict limiter refused one: every further DELETE would be refused too.
  it('stops at a rate limit and hands back what it never tried', async () => {
    const remove = vi.fn(async ({ id }: { id: string }) => {
      if (id === 'b') throw refused(429);
    });
    const result = await runBulkDelete(['a', 'b', 'c', 'd'], {
      readUsage: async () => usage(0),
      remove,
    });
    expect(result).toMatchObject({
      deleted: ['a'],
      rateLimited: ['b', 'c', 'd'],
      failed: [],
    });
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it('tells "the uses changed" apart from "something published uses it"', async () => {
    const remove = vi.fn(async ({ id }: { id: string }) => {
      if (id === 'moved') throw refused(409, 'MEDIA_USAGE_CHANGED');
      if (id === 'live') throw refused(409, 'MEDIA_IN_USE');
    });
    const result = await runBulkDelete(['moved', 'live'], {
      readUsage: async () => usage(0),
      remove,
    });
    expect(result).toMatchObject({ changed: ['moved'], blocked: ['live'] });
  });

  it('counts the drafts that lost their media', async () => {
    const result = await runBulkDelete(['a', 'b'], {
      readUsage: async (id) => ({ ...usage(0), drafts: id === 'a' ? 2 : 1 }),
      remove: async () => undefined,
    });
    expect(result.draftsAffected).toBe(3);
  });
});
