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
 * (`{base}/{w}x{h}-{nonce}/`, kk9nv.5) is never re-written, so the re-upload
 * check is skipped for it. It misfired on the commonest such orphan, an upload
 * whose row write and discard both failed: written seconds before its row, it
 * read as a re-upload and was kept for good. Its own row decides instead.
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
  messageForLog,
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

/**
 * The entities whose rows decide the sized-folder orphans below. Every still
 * base sits under its entity's own id, so these keys do too.
 */
const ent = {
  user: `test-kk9nv13-${crypto.randomUUID()}`,
  liveCategory: crypto.randomUUID(),
  deletedCategory: crypto.randomUUID(),
  org: crypto.randomUUID(),
  course: crypto.randomUUID(),
  content: crypto.randomUUID(),
  noContent: crypto.randomUUID(),
};

const keys = {
  reused: `${prefix}/reused.webp`,
  orphan: `${prefix}/orphan.webp`,
  absent: `${prefix}/absent.webp`,
  // A content id no row has: nothing addresses this folder. Content stills
  // sit under their creator: `{creatorId}/content-thumbnails/{contentId}`.
  fresh: `${ent.user}/content-thumbnails/${ent.noContent}/1600x900-0a1b2c3d/lg.webp`,
  // Sized folders a live row names, in each column shape: a key that is the
  // folder (category, course) and the URL of a file in it (avatar, content).
  referenced: `categories/${ent.liveCategory}/cover/800x600-11111111/lg.webp`,
  avatar: `avatars/${ent.user}/300x300-33333333/md.webp`,
  courseHero: `courses/${ent.course}/hero/1600x900-44444444/lg.webp`,
  courseCover: `courses/${ent.course}/cover/1200x630-99999999/lg.webp`,
  courseSignature: `courses/${ent.course}/signature/600x200-aaaaaaaa/md.webp`,
  content: `${ent.user}/content-thumbnails/${ent.content}/1600x900-88888888/md.webp`,
  // One a soft-deleted category names, and one no row can be found for.
  deletedRow: `categories/${ent.deletedCategory}/cover/800x600-22222222/lg.webp`,
  unplaced: `${prefix}/content-thumbnails/unplaced/1600x900-55555555/lg.webp`,
  // Rows that cannot be placed, each by one guard: an entity whose base the
  // folder is not under (here a deleted row, which would answer "delete"), a
  // type whose base it is not under (a cover row in the course's live hero
  // folder: the cover column is empty, which would answer "delete"), and an
  // id that is not a uuid (which would throw on the uuid column, every try).
  otherEntity: `categories/${ent.liveCategory}/cover/800x600-66666666/lg.webp`,
  otherType: `courses/${ent.course}/hero/1600x900-44444444/md.webp`,
  notUuid: `${ent.user}/content-thumbnails/not-a-uuid/1600x900-77777777/lg.webp`,
};

/** The folder an object key sits in, as a still column stores it. */
const folderOf = (key: string) => key.slice(0, key.lastIndexOf('/'));

const REFERENCED = 'its row still addresses this folder';

function orphanRecord(
  overrides: Partial<OrphanedFileRecord>
): OrphanedFileRecord {
  return {
    id: 'orphan-1',
    r2Key: keys.fresh,
    imageType: 'content_thumbnail',
    originalEntityId: ent.noContent,
    originalEntityType: 'content',
    orphanedAt: new Date(Date.now() - 60 * 1000),
    cleanupAttempts: 0,
    lastAttemptAt: null,
    status: 'pending',
    errorMessage: null,
    fileSizeBytes: null,
    ...overrides,
  };
}

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

  /**
   * `head` reports a write after the row, which the re-upload check reads as
   * a live upload. A sized folder cannot have one, so its own row decides.
   */
  function stubs(referenced: boolean | null) {
    const head = vi.fn().mockResolvedValue({ uploaded: new Date() });
    const isStillFolderReferenced = vi.fn().mockResolvedValue(referenced);
    return {
      head,
      isStillFolderReferenced,
      r2: { head } as unknown as R2Service,
      orphans: { isStillFolderReferenced } as unknown as OrphanedFileService,
    };
  }

  it('deletes a sized-folder orphan its row no longer addresses, without asking R2', async () => {
    const s = stubs(false);
    const record = orphanRecord({});

    expect(await reasonToKeep(record, s.r2, s.orphans)).toBeNull();
    expect(s.isStillFolderReferenced).toHaveBeenCalledWith(
      record,
      folderOf(keys.fresh)
    );
    expect(s.head).not.toHaveBeenCalled();
  });

  it('keeps one its row still addresses: a write that committed but reported failure', async () => {
    const s = stubs(true);

    expect(await reasonToKeep(orphanRecord({}), s.r2, s.orphans)).toBe(
      REFERENCED
    );
    expect(s.head).not.toHaveBeenCalled();
  });

  it('leaves one the service cannot place for review, rather than misreading it as a re-upload', async () => {
    const s = stubs(null);

    expect(
      await reasonToKeep(
        orphanRecord({ originalEntityId: null }),
        s.r2,
        s.orphans
      )
    ).toBe('sized folder with no owning row to check; left for review');
    expect(s.head).not.toHaveBeenCalled();
  });
});

describe('messageForLog (Codex-kk9nv.13)', () => {
  it("logs a failed query's driver error, not the query and its params", () => {
    // drizzle's shape: the params can hold a folder with a 32-character user
    // id, and production redaction would hash the whole message for it.
    const failed = Object.assign(
      new Error(
        'Failed query: select "id" from "users"\nparams: avatars/abcdefghijklmnopqrstuvwxyz012345/300x300-aaaaaaaa/'
      ),
      { cause: new Error('Error connecting to database: fetch failed') }
    );
    expect(messageForLog(failed)).toBe(
      'Error connecting to database: fetch failed'
    );
  });

  it('unwraps a failed query wrapped in another failed query, to the driver', () => {
    const driver = new Error('connection terminated');
    const inner = Object.assign(
      new Error('Failed query: update …\nparams: …'),
      {
        cause: driver,
      }
    );
    const outer = Object.assign(
      new Error('Failed query: select …\nparams: …'),
      {
        cause: inner,
      }
    );
    expect(messageForLog(outer)).toBe('connection terminated');
  });

  it('logs any other error as it is, even one with a cause: its own message is the specific one', () => {
    expect(messageForLog(new Error('R2 unavailable'))).toBe('R2 unavailable');
    expect(
      messageForLog(
        Object.assign(new Error('ASSETS_BUCKET not bound'), {
          cause: new Error('binding missing'),
        })
      )
    ).toBe('ASSETS_BUCKET not bound');
    expect(messageForLog('not an error')).toBe('not an error');
  });
});

describe('OrphanedFileCleanupDO sweep (Codex-r85jo.6)', () => {
  const db = createDbClient(env);
  const ids = Object.fromEntries(
    Object.keys(keys).map((name) => [name, ''])
  ) as Record<keyof typeof keys, string>;

  beforeAll(async () => {
    // The rows that decide the sized folders. The avatar and content columns
    // are a URL of a file in the folder; the category and course columns are
    // the folder.
    await db.insert(schema.users).values({
      id: ent.user,
      name: 'Sweep test',
      email: `${ent.user}@test.invalid`,
      avatarUrl: `https://cdn.test.invalid/${folderOf(keys.avatar)}/lg.webp`,
    });
    await db.insert(schema.content).values({
      id: ent.content,
      creatorId: ent.user,
      title: 'Sweep test',
      slug: `${ent.user}-content`,
      contentType: 'written',
      thumbnailUrl: `https://cdn.test.invalid/${folderOf(keys.content)}/lg.webp`,
    });
    await db.insert(schema.categories).values([
      {
        id: ent.liveCategory,
        creatorId: ent.user,
        name: 'Live cover',
        slug: `${ent.user}-live`,
        coverImageKey: folderOf(keys.referenced),
      },
      {
        id: ent.deletedCategory,
        creatorId: ent.user,
        name: 'Deleted cover',
        slug: `${ent.user}-gone`,
        coverImageKey: folderOf(keys.deletedRow),
        deletedAt: new Date(),
      },
    ]);
    await db
      .insert(schema.organizations)
      .values({ id: ent.org, name: 'Sweep test', slug: `sweep-${ent.org}` });
    await db.insert(schema.courses).values({
      id: ent.course,
      organizationId: ent.org,
      creatorId: ent.user,
      slug: 'sweep-test',
      title: 'Sweep test',
      coverImageKey: folderOf(keys.courseCover),
      heroImageKey: folderOf(keys.courseHero),
      signatureImageKey: folderOf(keys.courseSignature),
    });

    // A genuine orphan: its bytes were written long before the key was
    // orphaned. R2's `uploaded` cannot be backdated, so the ROW is dated
    // after it instead — the same ordering.
    await testEnv.ASSETS_BUCKET.put(keys.orphan, 'old bytes');

    const hourAgo = new Date(Date.now() - 60 * MINUTE);
    const rows = await db
      .insert(schema.orphanedImageFiles)
      .values([
        {
          r2Key: keys.reused,
          imageType: 'content_thumbnail',
          orphanedAt: hourAgo,
        },
        {
          r2Key: keys.orphan,
          imageType: 'content_thumbnail',
          orphanedAt: new Date(Date.now() + 30 * MINUTE),
        },
        {
          r2Key: keys.absent,
          imageType: 'content_thumbnail',
          orphanedAt: hourAgo,
        },
        {
          r2Key: keys.fresh,
          imageType: 'content_thumbnail',
          originalEntityId: ent.noContent,
          originalEntityType: 'content',
          orphanedAt: hourAgo,
        },
        {
          r2Key: keys.referenced,
          imageType: 'category_cover',
          originalEntityId: ent.liveCategory,
          originalEntityType: 'category',
          orphanedAt: hourAgo,
        },
        {
          r2Key: keys.avatar,
          imageType: 'avatar',
          originalEntityId: ent.user,
          originalEntityType: 'user',
          orphanedAt: hourAgo,
        },
        {
          r2Key: keys.courseHero,
          imageType: 'course_hero',
          originalEntityId: ent.course,
          originalEntityType: 'course',
          orphanedAt: hourAgo,
        },
        {
          r2Key: keys.courseCover,
          imageType: 'course_cover',
          originalEntityId: ent.course,
          originalEntityType: 'course',
          orphanedAt: hourAgo,
        },
        {
          r2Key: keys.courseSignature,
          imageType: 'course_signature',
          originalEntityId: ent.course,
          originalEntityType: 'course',
          orphanedAt: hourAgo,
        },
        {
          r2Key: keys.deletedRow,
          imageType: 'category_cover',
          originalEntityId: ent.deletedCategory,
          originalEntityType: 'category',
          orphanedAt: hourAgo,
        },
        {
          r2Key: keys.content,
          imageType: 'content_thumbnail',
          originalEntityId: ent.content,
          originalEntityType: 'content',
          orphanedAt: hourAgo,
        },
        {
          r2Key: keys.unplaced,
          imageType: 'content_thumbnail',
          orphanedAt: hourAgo,
        },
        {
          r2Key: keys.otherEntity,
          imageType: 'category_cover',
          originalEntityId: ent.deletedCategory,
          originalEntityType: 'category',
          orphanedAt: hourAgo,
        },
        {
          r2Key: keys.otherType,
          imageType: 'course_cover',
          originalEntityId: ent.course,
          originalEntityType: 'course',
          orphanedAt: hourAgo,
        },
        {
          r2Key: keys.notUuid,
          imageType: 'content_thumbnail',
          originalEntityId: 'not-a-uuid',
          originalEntityType: 'content',
          orphanedAt: hourAgo,
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

    // Each object lands AFTER its row was written: the re-upload's real
    // order, and the timing the re-upload check misreads at a sized folder,
    // so only the key's shape and its row can tell them apart.
    for (const name of [
      'reused',
      'fresh',
      'referenced',
      'avatar',
      'courseHero',
      'courseCover',
      'courseSignature',
      'content',
      'deletedRow',
      'unplaced',
      'otherEntity',
      'otherType',
      'notUuid',
    ] as const) {
      await testEnv.ASSETS_BUCKET.put(keys[name], `${name} bytes`);
    }
  });

  afterAll(async () => {
    // Only the orphan rows that were written: a setup that failed part-way
    // leaves '' ids, and a '' in a uuid IN list would throw before the rows
    // below were cleaned up.
    const written = Object.values(ids).filter(Boolean);
    if (written.length > 0) {
      await db
        .delete(schema.orphanedImageFiles)
        .where(inArray(schema.orphanedImageFiles.id, written));
    }
    await testEnv.ASSETS_BUCKET.delete(Object.values(keys));
    // The course goes with its org; content, categories and courses restrict
    // the user.
    await db
      .delete(schema.organizations)
      .where(inArray(schema.organizations.id, [ent.org]));
    await db
      .delete(schema.content)
      .where(inArray(schema.content.id, [ent.content]));
    await db
      .delete(schema.categories)
      .where(
        inArray(schema.categories.id, [ent.liveCategory, ent.deletedCategory])
      );
    await db.delete(schema.users).where(inArray(schema.users.id, [ent.user]));
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

  /** A row's status and, for a retained one, the reason it was kept. */
  async function outcomeOf(id: string) {
    const [row] = await db
      .select({
        status: schema.orphanedImageFiles.status,
        reason: schema.orphanedImageFiles.errorMessage,
      })
      .from(schema.orphanedImageFiles)
      .where(inArray(schema.orphanedImageFiles.id, [id]));
    return row;
  }

  /**
   * The sweep takes the 50 OLDEST pending rows. A shared test database can
   * hold older rows from other suites, so sweep until every one of ours has
   * been reached rather than assuming the first batch contains them.
   */
  async function sweepUntilReached() {
    const ns = testEnv.ORPHAN_CLEANUP_DO;
    const stub = ns.get(ns.idFromName('singleton'));
    const runs = [];
    for (let run = 0; run < 5; run++) {
      runs.push(await sweep(stub));
      const outcomes = await Promise.all(Object.values(ids).map(outcomeOf));
      if (!outcomes.some((outcome) => outcome?.status === 'pending')) break;
    }
    return runs;
  }

  // One test, not several: R2 is isolated storage, so a delete is rolled back
  // when the test that made it ends, while the database keeps its rows.
  it('keeps what a re-upload or a live row still holds, and deletes the rest', async () => {
    // The logger writes through console, which the test and the DO share,
    // as do the files that run after this one: restore it however this ends.
    const warn = vi.spyOn(console, 'warn');
    let runs: Awaited<ReturnType<typeof sweepUntilReached>>;
    let reviewWarnings: string[];
    try {
      runs = await sweepUntilReached();
      reviewWarnings = warn.mock.calls
        .map(([line]) => String(line))
        .filter((line) => line.includes('Orphan left for review'));
    } finally {
      warn.mockRestore();
    }

    expect(await outcomeOf(ids.reused)).toMatchObject({ status: 'retained' });
    expect(await testEnv.ASSETS_BUCKET.head(keys.reused)).not.toBeNull();

    expect(await outcomeOf(ids.orphan)).toMatchObject({ status: 'deleted' });
    expect(await testEnv.ASSETS_BUCKET.head(keys.orphan)).toBeNull();

    expect(await outcomeOf(ids.absent)).toMatchObject({ status: 'deleted' });

    // A sized folder is decided by its own row (Codex-kk9nv.13), in every
    // column shape, and kept for that reason, not by the re-upload timing.
    const keptReferenced = [
      'referenced',
      'avatar',
      'courseHero',
      'courseCover',
      'courseSignature',
      'content',
    ] as const;
    for (const name of keptReferenced) {
      expect(await outcomeOf(ids[name])).toEqual({
        status: 'retained',
        reason: REFERENCED,
      });
      expect(await testEnv.ASSETS_BUCKET.head(keys[name])).not.toBeNull();
    }
    for (const name of ['fresh', 'deletedRow'] as const) {
      expect(await outcomeOf(ids[name])).toMatchObject({ status: 'deleted' });
      expect(await testEnv.ASSETS_BUCKET.head(keys[name])).toBeNull();
    }

    // Each row one guard refuses to place is kept on the first try, object
    // and all, and named twice: in the run's result, and in a warning logged
    // as it is kept, the one a person sees.
    const forReview = [
      'unplaced',
      'otherEntity',
      'otherType',
      'notUuid',
    ] as const;
    for (const name of forReview) {
      expect(await outcomeOf(ids[name])).toEqual({
        status: 'retained',
        reason: 'sized folder with no owning row to check; left for review',
      });
      expect(await testEnv.ASSETS_BUCKET.head(keys[name])).not.toBeNull();
    }
    const named = runs.flatMap((run) =>
      run.leftForReview.map((orphan) => orphan.orphanId)
    );
    expect(named).toEqual(
      expect.arrayContaining(forReview.map((name) => ids[name]))
    );
    for (const name of forReview) {
      expect(
        reviewWarnings.filter((line) => line.includes(ids[name]))
      ).toHaveLength(1);
    }
    // And only those: a key kept for a live reference or a re-upload is not
    // one a person needs to look at.
    for (const name of ['reused', ...keptReferenced] as const) {
      expect(named).not.toContain(ids[name]);
      expect(reviewWarnings.some((line) => line.includes(ids[name]))).toBe(
        false
      );
    }
    // Up to five sweeps of a shared database, each a query or more per row.
  }, 30_000);
});
