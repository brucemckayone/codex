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
 * Runs the DO's real sweep (runCleanup) inside the DO, against the test env's
 * R2 and database, so the check is exercised where the delete happens.
 */
import { env, runInDurableObject } from 'cloudflare:test';
import { closeDbPool, createDbClient, inArray, schema } from '@codex/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type OrphanedFileCleanupDO,
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

describe('OrphanedFileCleanupDO sweep (Codex-r85jo.6)', () => {
  const db = createDbClient(env);
  const ids: Record<keyof typeof keys, string> = {
    reused: '',
    orphan: '',
    absent: '',
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

  it('keeps a re-uploaded key, deletes a genuine orphan, and marks an absent one deleted', async () => {
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
  });
});
