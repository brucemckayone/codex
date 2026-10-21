/**
 * Codex-r85jo.6: the orphan sweep must not delete a key a later upload has
 * re-occupied.
 *
 * Image keys are deterministic and overwritten in place, so this sequence is
 * ordinary: a thumbnail delete's R2 call fails, the key is recorded as an
 * orphan, the creator uploads a new thumbnail to the SAME key, and the sweep
 * runs. Before this bead the sweep deleted the key unconditionally, so the live
 * thumbnail went with it.
 *
 * Codex-kk9nv.13: a still in a folder named for its size
 * (`{base}/{w}x{h}-{nonce}/`, kk9nv.5) is never re-written, so the check is
 * skipped for it. It misfired on the commonest such orphan, an upload whose
 * row write and discard both failed: written seconds before its row, it read
 * as a re-upload and was kept for good.
 *
 * Runs the DO's real sweep (runCleanup) inside the DO, against the test env's
 * R2 and database, so the check is exercised where the delete happens.
 */
import { env, runInDurableObject } from 'cloudflare:test';
import type { R2Service } from '@codex/cloudflare-clients';
import { closeDbPool, createDbClient, inArray, schema } from '@codex/database';
import type {
  OrphanedFileRecord,
  OrphanedFileService,
} from '@codex/image-processing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  isFreshStillObject,
  type OrphanedFileCleanupDO,
  reasonToKeep,
  wasRewrittenAfterOrphaning,
} from '../durable-objects/orphaned-file-cleanup-do';

type TestEnv = typeof env & {
  ORPHAN_CLEANUP_DO: DurableObjectNamespace;
  ASSETS_BUCKET: R2Bucket;
};
const testEnv = env as TestEnv;

const MINUTE = 60 * 1000;
const prefix = `test-r85jo6/${crypto.randomUUID()}`;
const keys = {
  reused: `${prefix}/reused.webp`,
  orphan: `${prefix}/orphan.webp`,
  absent: `${prefix}/absent.webp`,
  fresh: `${prefix}/1600x900-0a1b2c3d/lg.webp`,
};

describe('wasRewrittenAfterOrphaning', () => {
  const orphanedAt = new Date('2026-09-23T12:00:00Z');

  it('treats a write after the orphan was recorded as a re-upload', () => {
    expect(
      wasRewrittenAfterOrphaning(new Date('2026-09-23T12:30:00Z'), orphanedAt)
    ).toBe(true);
  });

  it('treats a write well before the orphan was recorded as the orphan', () => {
    expect(
      wasRewrittenAfterOrphaning(new Date('2026-09-23T11:00:00Z'), orphanedAt)
    ).toBe(false);
  });

  it('keeps a write inside the clock-skew margin, because deleting it could destroy a live upload', () => {
    expect(
      wasRewrittenAfterOrphaning(new Date('2026-09-23T11:57:00Z'), orphanedAt)
    ).toBe(true);
  });
});

describe('isFreshStillObject (Codex-kk9nv.13)', () => {
  it.each([
    'creator-1/content-thumbnails/content-1/1600x900-0a1b2c3d/lg.webp',
    'avatars/user-1/300x300-ffffffff/sm.webp',
    'courses/course-1/cover/1200x630-0a1b2c3d/xl.webp',
  ])('recognises an object in a sized folder: %s', (key) => {
    expect(isFreshStillObject(key)).toBe(true);
  });

  it.each([
    ['a legacy fixed key', 'creator-1/content-thumbnails/content-1/lg.webp'],
    ['a nonce one digit short', 'avatars/user-1/300x300-fffffff/sm.webp'],
    ['a sized folder above the parent', 'c/1600x900-0a1b2c3d/sub/lg.webp'],
    ['a bare file name', 'lg.webp'],
  ])('leaves %s to the re-upload check', (_what, key) => {
    expect(isFreshStillObject(key)).toBe(false);
  });

  it('decides a sized-folder orphan without asking R2 when it was written', async () => {
    // `head` reports a write after the row, which the re-upload check reads
    // as a live upload. A sized folder cannot have one.
    const head = vi.fn().mockResolvedValue({ uploaded: new Date() });
    const record: OrphanedFileRecord = {
      id: 'orphan-1',
      r2Key: keys.fresh,
      imageType: 'content_thumbnail',
      originalEntityId: null,
      originalEntityType: null,
      orphanedAt: new Date(Date.now() - 60 * 1000),
      cleanupAttempts: 0,
      lastAttemptAt: null,
      status: 'pending',
      errorMessage: null,
      fileSizeBytes: null,
    };

    expect(
      await reasonToKeep(
        record,
        { head } as unknown as R2Service,
        {} as OrphanedFileService
      )
    ).toBeNull();
    expect(head).not.toHaveBeenCalled();
  });
});

describe('OrphanedFileCleanupDO sweep (Codex-r85jo.6)', () => {
  const db = createDbClient(env);
  const ids: Record<keyof typeof keys, string> = {
    reused: '',
    orphan: '',
    absent: '',
    fresh: '',
  };

  beforeAll(async () => {
    // A genuine orphan: its bytes were written long before the key was
    // orphaned. R2's `uploaded` cannot be backdated, so the ROW is dated
    // after it instead — the same ordering.
    await testEnv.ASSETS_BUCKET.put(keys.orphan, 'old bytes');

    const rows = await db
      .insert(schema.orphanedImageFiles)
      .values([
        {
          r2Key: keys.reused,
          imageType: 'content_thumbnail',
          orphanedAt: new Date(Date.now() - 60 * MINUTE),
        },
        {
          r2Key: keys.orphan,
          imageType: 'content_thumbnail',
          orphanedAt: new Date(Date.now() + 30 * MINUTE),
        },
        {
          r2Key: keys.absent,
          imageType: 'content_thumbnail',
          orphanedAt: new Date(Date.now() - 60 * MINUTE),
        },
        {
          r2Key: keys.fresh,
          imageType: 'content_thumbnail',
          orphanedAt: new Date(Date.now() - 60 * MINUTE),
        },
      ])
      .returning({
        id: schema.orphanedImageFiles.id,
        r2Key: schema.orphanedImageFiles.r2Key,
      });
    for (const row of rows) {
      const name = (Object.keys(keys) as (keyof typeof keys)[]).find(
        (k) => keys[k] === row.r2Key
      );
      if (name) ids[name] = row.id;
    }

    // The re-upload lands at the orphaned key AFTER the row was written.
    await testEnv.ASSETS_BUCKET.put(keys.reused, 'new live bytes');
    // The same timing at a sized folder (Codex-kk9nv.13), so only the key's
    // shape can tell the two apart.
    await testEnv.ASSETS_BUCKET.put(keys.fresh, 'orphaned bytes');
  });

  afterAll(async () => {
    await db
      .delete(schema.orphanedImageFiles)
      .where(inArray(schema.orphanedImageFiles.id, Object.values(ids)));
    await testEnv.ASSETS_BUCKET.delete(Object.values(keys));
    await closeDbPool();
  });

  // runCleanup() is called directly rather than through `/trigger`. The only
  // difference is that `/trigger` also persists `lastRunResult` with
  // storage.put. On this SQLite-backed DO that write leaves a -shm file open,
  // and the pool's isolated-storage teardown then fails ("Expected .sqlite,
  // got …sqlite-shm"). The sweep under test is the same code either way.
  async function sweep(stub: DurableObjectStub) {
    return runInDurableObject(stub, (instance) =>
      // biome-ignore lint/complexity/useLiteralKeys: runCleanup is private; bracket access is TypeScript's sanctioned escape hatch
      (instance as OrphanedFileCleanupDO)['runCleanup']()
    );
  }

  async function statusOf(id: string) {
    const [row] = await db
      .select({ status: schema.orphanedImageFiles.status })
      .from(schema.orphanedImageFiles)
      .where(inArray(schema.orphanedImageFiles.id, [id]));
    return row?.status;
  }

  it('keeps a re-uploaded key, deletes a genuine orphan and a sized-folder one, and marks an absent one deleted', async () => {
    const ns = testEnv.ORPHAN_CLEANUP_DO;
    const stub = ns.get(ns.idFromName('singleton'));

    // The sweep takes the 50 OLDEST pending rows. A shared test database can
    // hold older rows from other suites, so trigger until all three of ours
    // have been reached rather than assuming the first batch contains them.
    for (let run = 0; run < 5; run++) {
      await sweep(stub);
      const pending = await Promise.all(Object.values(ids).map(statusOf));
      if (!pending.includes('pending')) break;
    }

    expect(await statusOf(ids.reused)).toBe('retained');
    expect(await testEnv.ASSETS_BUCKET.head(keys.reused)).not.toBeNull();

    expect(await statusOf(ids.orphan)).toBe('deleted');
    expect(await testEnv.ASSETS_BUCKET.head(keys.orphan)).toBeNull();

    expect(await statusOf(ids.absent)).toBe('deleted');

    expect(await statusOf(ids.fresh)).toBe('deleted');
    expect(await testEnv.ASSETS_BUCKET.head(keys.fresh)).toBeNull();
  });
});
