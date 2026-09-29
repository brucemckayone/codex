/**
 * Codex-61zsk.10: the orphan sweep deletes a page image's OBJECTS, and only
 * once no page references it.
 *
 * A page image is queued as its three object keys
 * (`landing-pages/{page}/images/{image}/{sm,md,lg}.webp`) at upload and again
 * when a save drops it. The first version queued the BASE key instead, which
 * holds no object: the sweep deleted nothing, marked the row deleted, and the
 * variants stayed in R2 for good. These tests run the DO's real sweep against
 * the test env's R2 and database, so "deleted" here means the objects are
 * gone, not that a row says so.
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
  type OrphanedFileCleanupDO,
  reasonToKeep,
} from '../durable-objects/orphaned-file-cleanup-do';

type TestEnv = typeof env & {
  ORPHAN_CLEANUP_DO: DurableObjectNamespace;
  ASSETS_BUCKET: R2Bucket;
};
const testEnv = env as TestEnv;

const DAY = 24 * 60 * 60 * 1000;

/** The three object keys of a page image under a page that does not exist. */
function pageImageObjects(): string[] {
  const base = `landing-pages/${crypto.randomUUID()}/images/${crypto.randomUUID()}`;
  return [`${base}/sm.webp`, `${base}/md.webp`, `${base}/lg.webp`];
}

function orphan(overrides: Partial<OrphanedFileRecord>): OrphanedFileRecord {
  return {
    id: 'orphan-1',
    r2Key: pageImageObjects()[2] ?? '',
    imageType: 'page_image',
    originalEntityId: null,
    originalEntityType: null,
    orphanedAt: new Date(Date.now() - 8 * DAY),
    cleanupAttempts: 0,
    lastAttemptAt: null,
    status: 'pending',
    errorMessage: null,
    fileSizeBytes: null,
    ...overrides,
  };
}

describe('reasonToKeep — page images', () => {
  function stubs(referenced: boolean) {
    const head = vi.fn().mockResolvedValue({ uploaded: new Date() });
    const isPageImageReferenced = vi.fn().mockResolvedValue(referenced);
    return {
      head,
      isPageImageReferenced,
      r2: { head } as unknown as R2Service,
      orphans: { isPageImageReferenced } as unknown as OrphanedFileService,
    };
  }

  it('keeps an image a page still references', async () => {
    const s = stubs(true);
    const record = orphan({});

    expect(await reasonToKeep(record, s.r2, s.orphans)).toBe(
      'still referenced by a landing page'
    );
    // Asked with the BASE key a block stores, not the object key.
    expect(s.isPageImageReferenced).toHaveBeenCalledWith(
      record.r2Key.replace(/\/lg\.webp$/, '')
    );
  });

  it('deletes one no page references, without the re-upload check', async () => {
    // A page-image key is never re-written, so the re-upload check could only
    // misfire: `head` reports a write minutes before the row, which it would
    // read as a re-upload and keep for good.
    const s = stubs(false);

    expect(await reasonToKeep(orphan({}), s.r2, s.orphans)).toBeNull();
    expect(s.head).not.toHaveBeenCalled();
  });

  it('keeps a page_image row whose key is not a page-image object', async () => {
    const s = stubs(false);
    const record = orphan({
      r2Key: `landing-pages/${crypto.randomUUID()}/images/${crypto.randomUUID()}`,
    });

    expect(await reasonToKeep(record, s.r2, s.orphans)).toBe(
      'not a page-image object key; left for review'
    );
    expect(s.isPageImageReferenced).not.toHaveBeenCalled();
  });

  it('still applies the re-upload check to every other image type', async () => {
    const s = stubs(false);
    const record = orphan({
      imageType: 'content_thumbnail',
      r2Key: 'creator-1/content-thumbnails/content-1/lg.webp',
      orphanedAt: new Date(Date.now() - 60 * 1000),
    });

    expect(await reasonToKeep(record, s.r2, s.orphans)).toBe(
      'key re-written after it was orphaned; it holds a live upload'
    );
    expect(s.isPageImageReferenced).not.toHaveBeenCalled();
  });
});

describe('OrphanedFileCleanupDO sweep — page images (Codex-61zsk.10)', () => {
  const db = createDbClient(env);
  const due = pageImageObjects();
  const young = pageImageObjects();
  const ids: string[] = [];

  beforeAll(async () => {
    for (const key of [...due, ...young]) {
      await testEnv.ASSETS_BUCKET.put(key, 'webp bytes');
    }
    const rows = await db
      .insert(schema.orphanedImageFiles)
      .values([
        ...due.map((r2Key) => ({
          r2Key,
          imageType: 'page_image' as const,
          orphanedAt: new Date(Date.now() - 8 * DAY),
        })),
        ...young.map((r2Key) => ({
          r2Key,
          imageType: 'page_image' as const,
          orphanedAt: new Date(Date.now() - 60 * 1000),
        })),
      ])
      .returning({ id: schema.orphanedImageFiles.id });
    ids.push(...rows.map((row) => row.id));
  });

  afterAll(async () => {
    await db
      .delete(schema.orphanedImageFiles)
      .where(inArray(schema.orphanedImageFiles.id, ids));
    await testEnv.ASSETS_BUCKET.delete([...due, ...young]);
    await closeDbPool();
  });

  // runCleanup() is called directly rather than through `/trigger`, for the
  // reason `orphan-cleanup-sweep.test.ts` gives (SQLite DO storage teardown).
  async function sweep(stub: DurableObjectStub) {
    return runInDurableObject(stub, (instance) =>
      // biome-ignore lint/complexity/useLiteralKeys: runCleanup is private; bracket access is TypeScript's sanctioned escape hatch
      (instance as OrphanedFileCleanupDO)['runCleanup']()
    );
  }

  async function statuses(keys: string[]) {
    const rows = await db
      .select({
        r2Key: schema.orphanedImageFiles.r2Key,
        status: schema.orphanedImageFiles.status,
      })
      .from(schema.orphanedImageFiles)
      .where(inArray(schema.orphanedImageFiles.r2Key, keys));
    return rows.map((row) => row.status);
  }

  it('deletes all three objects of an unreferenced image past its grace, and leaves a young one alone', async () => {
    const ns = testEnv.ORPHAN_CLEANUP_DO;
    const stub = ns.get(ns.idFromName('singleton'));

    // The sweep takes the 50 OLDEST due rows; a shared test database can hold
    // older ones, so sweep until ours have been reached.
    for (let run = 0; run < 5; run++) {
      await sweep(stub);
      if (!(await statuses(due)).includes('pending')) break;
    }

    expect(await statuses(due)).toEqual(['deleted', 'deleted', 'deleted']);
    for (const key of due) {
      expect(await testEnv.ASSETS_BUCKET.head(key)).toBeNull();
    }

    expect(await statuses(young)).toEqual(['pending', 'pending', 'pending']);
    for (const key of young) {
      expect(await testEnv.ASSETS_BUCKET.head(key)).not.toBeNull();
    }
  });
});
